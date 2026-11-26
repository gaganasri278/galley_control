import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import {
  AlertOctagon,
  Camera,
  CameraOff,
  CheckCircle2,
  QrCode,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import {
  fetchOrders,
  fetchSecurityEvents,
  verifyQrToken,
} from "../api/client";
import { useAuth } from "../context/AuthContext";

function classifyCameraError(err) {
  const name = err?.name || "";
  const rawMsg = typeof err === "string" ? err : err?.message || "";
  const lower = `${name} ${rawMsg}`.toLowerCase();

  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Camera access requires a secure context (https:// or http://localhost). Open the app on http://localhost:5173 or HTTPS and retry.";
  }
  if (
    lower.includes("notallowed") ||
    lower.includes("permission denied") ||
    lower.includes("permission dismissed")
  ) {
    return "Browser camera permission was denied. Allow webcam access in your browser site settings, then click 'Start Camera'.";
  }
  if (
    lower.includes("notfound") ||
    lower.includes("devicesnotfound") ||
    lower.includes("requested device not found") ||
    lower.includes("no camera")
  ) {
    return "No webcam device detected. Connect a camera or use manual QR verification / quick-fill below.";
  }
  if (
    lower.includes("notreadable") ||
    lower.includes("trackstart") ||
    lower.includes("could not start video source") ||
    lower.includes("in use")
  ) {
    return "Camera is currently in use by another application or browser tab. Close other camera apps and click 'Start Camera'.";
  }
  if (lower.includes("overconstrained")) {
    return "Selected camera could not match requested constraints. Try picking another camera or click 'Start Camera'.";
  }
  return rawMsg
    ? `Unable to start webcam (${rawMsg}). You can still paste or quick-fill a QR token below.`
    : "Webcam unavailable. Use manual token verification below to test QR validation & duplicate rejection.";
}

export default function CounterScanner() {
  const { user } = useAuth();
  const { refreshNonce } = useOutletContext() || {};
  const [searchParams] = useSearchParams();
  const initialToken = searchParams.get("token") || "";

  const [tokenInput, setTokenInput] = useState(initialToken);
  const [orders, setOrders] = useState([]);
  const [securityEvents, setSecurityEvents] = useState([]);
  const [verdict, setVerdict] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [verifying, setVerifying] = useState(false);

  const scannerRef = useRef(null);
  const sessionSeqRef = useRef(0);
  const scanHandlingRef = useRef(false);

  const loadScannerData = useCallback(async () => {
    try {
      const [ordRes, secRes] = await Promise.all([
        fetchOrders(false),
        fetchSecurityEvents(),
      ]);
      setOrders(ordRes.orders || []);
      setSecurityEvents(secRes.events || []);
    } catch {
      // Handled smoothly without wiping scanner UI
    }
  }, []);

  useEffect(() => {
    loadScannerData();
  }, [loadScannerData, refreshNonce]);

  useEffect(() => {
    if (initialToken) setTokenInput(initialToken);
  }, [initialToken]);

  const stopCameraInstance = useCallback(async () => {
    const active = scannerRef.current;
    scannerRef.current = null;
    if (active) {
      try {
        if (active.isScanning) {
          await active.stop();
        }
      } catch {
        // Ignore stop transition errors
      }
      try {
        active.clear();
      } catch {
        // Ignore DOM clear errors
      }
    }
    setScanning(false);
    setStartingCamera(false);
  }, []);

  const runVerification = useCallback(
    async (tok) => {
      const clean = (tok || "").trim();
      if (!clean) return;
      setVerifying(true);
      try {
        const res = await verifyQrToken(clean);
        setVerdict(res);
      } catch (err) {
        setVerdict({
          valid: false,
          risk_level: err.status === 403 ? "HIGH" : "LOW",
          message: err.message,
          explanation:
            err.status === 403
              ? "Role or outlet-scope restriction blocked counter verification."
              : "Verification failed before ticket state update.",
        });
      } finally {
        setVerifying(false);
        await loadScannerData();
      }
    },
    [loadScannerData]
  );

  const startCamera = useCallback(
    async (explicitCameraId = null) => {
      const seq = ++sessionSeqRef.current;
      scanHandlingRef.current = false;
      setCameraError("");
      setStartingCamera(true);

      await stopCameraInstance();
      if (seq !== sessionSeqRef.current) return;

      try {
        let devs = cameras;
        if (!devs.length) {
          try {
            devs = await Html5Qrcode.getCameras();
            if (seq !== sessionSeqRef.current) return;
            setCameras(devs || []);
          } catch {
            devs = [];
          }
        }

        const preferred =
          explicitCameraId ||
          selectedCameraId ||
          (devs.length ? devs[0].id : { facingMode: "environment" });

        const qr = new Html5Qrcode("qr-reader-region", { verbose: false });
        scannerRef.current = qr;

        const scanConfig = {
          fps: 10,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1.0,
        };

        const onDecoded = async (decodedText) => {
          if (scanHandlingRef.current) return;
          scanHandlingRef.current = true;
          setTokenInput(decodedText);
          sessionSeqRef.current += 1;
          await stopCameraInstance();
          await runVerification(decodedText);
        };

        try {
          await qr.start(preferred, scanConfig, onDecoded, () => {});
        } catch (startErr) {
          if (seq !== sessionSeqRef.current) {
            await stopCameraInstance();
            return;
          }
          try {
            await qr.start(
              { facingMode: "user" },
              scanConfig,
              onDecoded,
              () => {}
            );
          } catch {
            throw startErr;
          }
        }

        if (seq !== sessionSeqRef.current) {
          await stopCameraInstance();
          return;
        }

        setScanning(true);
        setStartingCamera(false);
      } catch (err) {
        if (seq !== sessionSeqRef.current) return;
        await stopCameraInstance();
        setCameraError(classifyCameraError(err));
      }
    },
    [runVerification, selectedCameraId, stopCameraInstance, cameras]
  );

  const handleStopClick = async () => {
    sessionSeqRef.current += 1;
    await stopCameraInstance();
  };

  useEffect(() => {
    startCamera();
    return () => {
      sessionSeqRef.current += 1;
      stopCameraInstance();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Left: Webcam QR Scanner + Quick Verification */}
      <div className="lg:col-span-5 space-y-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-indigo-600" />
              <div>
                <h2 className="font-extrabold text-sm text-slate-900 dark:text-white">
                  Counter Ticket Scanner
                </h2>
                <p className="text-[11px] text-slate-500">
                  {user?.role === "outlet_manager" && user?.outlet_name
                    ? `Kitchen Counter: ${user.outlet_name}`
                    : "Admin: All Campus Kitchens"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {scanning ? (
                <button
                  type="button"
                  onClick={handleStopClick}
                  className="px-3 py-1.5 rounded-xl border border-rose-200 text-rose-600 dark:border-rose-900 text-xs font-bold hover:bg-rose-50 inline-flex items-center gap-1.5 transition"
                >
                  <CameraOff className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => startCamera(selectedCameraId || null)}
                  disabled={startingCamera}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center gap-1.5 transition shadow-sm"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>{startingCamera ? "Starting..." : "Start Camera"}</span>
                </button>
              )}
            </div>
          </div>

          {/* Viewfinder Viewport */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 overflow-hidden relative min-h-[260px] flex items-center justify-center">
            <div id="qr-reader-region" className="w-full" />
            {!scanning && !startingCamera && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-xs text-slate-400">
                <Camera className="w-8 h-8 mb-2 opacity-40" />
                <span>Camera paused. Click 'Start Camera' or enter token code below.</span>
              </div>
            )}
            {startingCamera && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-xs text-white text-xs">
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin mb-2" />
                <span>Initializing webcam...</span>
              </div>
            )}
          </div>

          {cameraError && (
            <div
              role="alert"
              className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-4 text-xs text-amber-800 dark:text-amber-200 space-y-2.5"
            >
              <div className="font-medium">{cameraError}</div>
              <div className="text-[11px] text-amber-700/80 dark:text-amber-300/80 space-y-1 bg-amber-100/50 dark:bg-amber-900/30 p-2.5 rounded-xl border border-amber-200/60 dark:border-amber-800/60">
                <p><strong>How to enable camera:</strong> In your browser address bar next to the website URL (left side), click the <strong>tune / lock icon</strong> (or the camera icon on the right), switch <strong>Camera</strong> to <strong>Allow</strong>, then refresh.</p>
                <p><strong>No camera needed:</strong> You can also click any order token in <strong>Kitchen Active Tickets Quick-Fill</strong> below to test verification immediately!</p>
              </div>
              <button
                type="button"
                onClick={() => startCamera(selectedCameraId || null)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline pt-0.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Camera Permission</span>
              </button>
            </div>
          )}

          {/* Manual Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runVerification(tokenInput);
            }}
            className="space-y-2"
          >
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
              Manual Token / Barcode Verification
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="GC-ORD-XXXXXX-XXXXXXXX"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                className="flex-1 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none"
              />
              <button
                type="submit"
                disabled={!tokenInput.trim() || verifying}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm transition disabled:opacity-50"
              >
                {verifying ? "Checking..." : "Verify"}
              </button>
            </div>
          </form>

          {/* Quick-Fill Active Order Tokens */}
          {orders.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Kitchen Active Tickets Quick-Fill
              </div>
              <div className="flex flex-wrap gap-1.5">
                {orders.slice(0, 6).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setTokenInput(o.qr_token || "")}
                    className={`px-3 py-1 rounded-xl text-xs font-semibold border transition ${
                      o.qr_status === "ACTIVE"
                        ? "border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300"
                        : "border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-slate-500"
                    }`}
                  >
                    {o.order_code} ({o.qr_status})
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Verdict + Security Audit */}
      <div className="lg:col-span-7 space-y-6">
        {verdict ? (
          <div
            className={`rounded-3xl border-2 p-6 space-y-4 shadow-sm animate-in fade-in duration-200 ${
              verdict.valid
                ? "border-emerald-500/60 bg-emerald-50/60 dark:bg-emerald-950/30"
                : "border-rose-500/60 bg-rose-50/60 dark:bg-rose-950/30"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {verdict.valid ? (
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <AlertOctagon className="w-8 h-8 text-rose-600 dark:text-rose-400 shrink-0" />
                )}
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">
                    {verdict.valid ? "VALID TICKET — ORDER DISPATCHED" : "VERIFICATION REJECTED"}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">{verdict.message}</p>
                </div>
              </div>
              <span
                className={`text-xs font-black uppercase px-3 py-1 rounded-full ${
                  verdict.valid
                    ? "bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-200"
                    : "bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-rose-200"
                }`}
              >
                RISK: {verdict.risk_level}
              </span>
            </div>

            {verdict.explanation && (
              <div className="rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-4 text-xs text-slate-700 dark:text-slate-300">
                <strong className="text-indigo-600 dark:text-indigo-400">Rule & Security Policy:</strong>{" "}
                {verdict.explanation}
              </div>
            )}

            {!scanning && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => startCamera(selectedCameraId || null)}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-sm inline-flex items-center gap-2"
                >
                  <Camera className="w-4 h-4" />
                  <span>Scan Next Ticket</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-400 shadow-sm">
            Scan a student QR meal pass via webcam or enter a token code. Double scanning triggers instant fraud blocking and flags duplicate ticket security events.
          </div>
        )}

        {/* Security Incident Stream */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Counter Guard & Security Telemetry
              </h3>
            </div>
            <span className="text-xs text-slate-400">{securityEvents.length} total events</span>
          </div>

          {securityEvents.length === 0 ? (
            <p className="text-xs text-slate-400 py-3">No suspicious ticket activity detected.</p>
          ) : (
            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
              {securityEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5 text-xs flex items-start justify-between gap-3"
                >
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">
                      {ev.event_type}{" "}
                      <span className="text-rose-600 font-semibold text-[11px]">({ev.risk_level})</span>
                    </div>
                    <p className="text-slate-500 mt-0.5">{ev.ai_explanation}</p>
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                      ev.resolved ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {ev.resolved ? "Resolved" : "Pending"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
