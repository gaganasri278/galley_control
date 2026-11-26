import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Flame,
  MessageSquareWarning,
  Package,
  QrCode,
  ShieldAlert,
  Sparkles,
  Store,
  Users,
  X,
} from "lucide-react";
import { Link, useOutletContext } from "react-router-dom";
import AiAssistantPanel from "../components/AiAssistantPanel";
import {
  actOnRecommendation,
  fetchAdminOrganisations,
  fetchDashboardSummary,
  resolveReview,
  resolveSecurityEvent,
} from "../api/client";

export default function ManagerDashboard() {
  const { refreshNonce, triggerRefresh } = useOutletContext() || {};
  const [organisations, setOrganisations] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    setError("");
    try {
      const orgFilter = selectedOrgId ? Number(selectedOrgId) : null;
      const [data, orgRes] = await Promise.all([
        fetchDashboardSummary(orgFilter),
        fetchAdminOrganisations().catch(() => ({ organisations: [] })),
      ]);
      setSummary(data);
      setOrganisations(orgRes.organisations || []);
    } catch (err) {
      setError(err.message || "Failed to load platform dashboard.");
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard, refreshNonce]);

  const handleRecAction = async (recId, status) => {
    try {
      await actOnRecommendation(recId, status);
      await loadDashboard();
      if (triggerRefresh) triggerRefresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleResolveSecurity = async (eventId) => {
    try {
      await resolveSecurityEvent(eventId);
      await loadDashboard();
      if (triggerRefresh) triggerRefresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleResolveReview = async (revId) => {
    try {
      await resolveReview(revId);
      await loadDashboard();
      if (triggerRefresh) triggerRefresh();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading && !summary) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-12 text-center shadow-sm">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
        <div className="text-base font-semibold text-slate-800 dark:text-slate-200">
          Synthesizing Multi-Tenant Intelligence
        </div>
        <div className="text-xs text-slate-500 mt-1">
          Consolidating telemetry from Central Orchestrator & 8 Specialised AI Agents...
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="rounded-2xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-6 text-sm text-rose-800 dark:text-rose-200">
        {error || "Unable to load manager summary."}
      </div>
    );
  }

  const metrics = summary.analytics.summary_metrics;
  const outlets = summary.outlet_performance.outlets || [];
  const heatmap = summary.analytics.demand_heatmap || [];
  const feedback = summary.feedback;
  const security = summary.security;
  const inventory = summary.inventory;

  return (
    <div className="space-y-8">
      {/* Header & Tenant Selector */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              Platform Governance Console
            </span>
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight mt-0.5">
            Cross-Organisation Operations & Multi-Agent Telemetry
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Governance across {organisations.length || 1} campus organisations, {outlets.length} active counters, and autonomous agents.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Scope analytics by organisation"
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Organisations ({organisations.length})</option>
            {organisations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name} ({org.status})
              </option>
            ))}
          </select>

          <Link
            to="/admin/outlets"
            className="px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 inline-flex items-center gap-2 shadow-xs transition"
          >
            <Store className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Manage Outlets & Users</span>
          </Link>

          <Link
            to="/admin/scanner"
            className="px-4 py-2.5 rounded-2xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 inline-flex items-center gap-2 shadow-md shadow-indigo-600/30 transition"
          >
            <QrCode className="w-4 h-4" />
            <span>QR Scanner</span>
          </Link>
        </div>
      </div>

      {/* Orchestrator + 8 Agents Banner */}
      <div className="rounded-3xl border border-indigo-200 dark:border-indigo-900/60 bg-gradient-to-r from-indigo-500/10 via-slate-100/50 to-indigo-500/5 dark:from-indigo-950/40 dark:via-slate-900 dark:to-indigo-950/20 p-5 space-y-3 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 text-xs font-bold uppercase tracking-wider">
            <Sparkles className="w-4 h-4" />
            <span>{summary.orchestrator} • 8 Active Specialized AI Agents</span>
          </div>
          <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-300 font-semibold">
            Live Isolation Enforced
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {summary.active_agents.map((ag) => (
            <span
              key={ag}
              className="text-[11px] font-medium px-3 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 shadow-xs"
            >
              {ag}
            </span>
          ))}
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: "Live Orders Today", val: metrics.live_orders, badge: "LIVE" },
          { label: "Total Handled", val: metrics.total_orders_including_sample, badge: "COMBINED" },
          { label: "Total Revenue", val: `₹${metrics.combined_revenue}`, badge: "REVENUE" },
          { label: "Average Rating", val: `${metrics.avg_rating} ★`, badge: "FEEDBACK" },
          { label: "Stockout Alerts", val: metrics.out_of_stock_items, badge: "INVENTORY" },
          { label: "Security Reviews", val: metrics.open_security_reviews, badge: "AUDIT" },
        ].map((k) => (
          <div
            key={k.label}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-xs space-y-1.5"
          >
            <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              {k.badge}
            </span>
            <div className="text-2xl font-black text-slate-900 dark:text-white pt-1">{k.val}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{k.label}</div>
          </div>
        ))}
      </div>

      {/* AI Recommendations + Security Events */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Human-in-the-Loop AI Recommendations */}
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span>AI Operational Recommendations (Human-in-the-Loop)</span>
            </h3>
            <span className="text-[11px] text-slate-400">Advisory Only</span>
          </div>

          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {summary.recommendations.map((rec) => (
              <div
                key={rec.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-4 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 dark:text-white">{rec.title}</span>
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      rec.status === "APPROVED"
                        ? "bg-emerald-100 text-emerald-800"
                        : rec.status === "DISMISSED"
                          ? "bg-slate-200 text-slate-600"
                          : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {rec.status}
                  </span>
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{rec.rationale}</p>
                {rec.status === "PENDING_APPROVAL" && (
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => handleRecAction(rec.id, "APPROVED")}
                      className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1 shadow-xs transition"
                    >
                      <Check className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRecAction(rec.id, "DISMISSED")}
                      className="px-3 py-1 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold flex items-center gap-1 hover:bg-slate-300"
                    >
                      <X className="w-3.5 h-3.5" /> Dismiss
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Security Incident Reviews */}
        <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-500" />
              <span>Security & Fraud Telemetry</span>
            </h3>
            <span className="text-[11px] text-slate-400">
              {security.unresolved_count} Unresolved
            </span>
          </div>

          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {security.events.slice(0, 5).map((ev) => (
              <div
                key={ev.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3.5 text-xs flex items-start justify-between gap-2"
              >
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">
                    {ev.event_type} <span className="text-rose-600 font-semibold">({ev.risk_level})</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2">
                    {ev.ai_explanation}
                  </p>
                </div>
                {ev.resolved === 0 ? (
                  <button
                    type="button"
                    onClick={() => handleResolveSecurity(ev.id)}
                    className="shrink-0 px-2.5 py-1 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-semibold text-[11px]"
                  >
                    Resolve
                  </button>
                ) : (
                  <span className="text-[10px] text-emerald-600 font-bold shrink-0">
                    Reviewed
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Outlet Performance Benchmarking Table */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Store className="w-4 h-4 text-indigo-600" />
          <span>Outlet Counters Benchmarking & Bottleneck Analysis</span>
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                <th className="py-3 px-3">Counter</th>
                <th className="py-3 px-3">Total Orders (Live)</th>
                <th className="py-3 px-3">Revenue</th>
                <th className="py-3 px-3">Avg Wait</th>
                <th className="py-3 px-3">Cancel %</th>
                <th className="py-3 px-3">Rating</th>
                <th className="py-3 px-3">Queue Status</th>
                <th className="py-3 px-3">Bottleneck & AI Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {outlets.map((o) => (
                <tr key={o.outlet_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                  <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">{o.outlet_name}</td>
                  <td className="py-3 px-3 font-semibold text-slate-700 dark:text-slate-300">
                    {o.total_orders} ({o.live_orders})
                  </td>
                  <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">₹{o.total_sales}</td>
                  <td className="py-3 px-3 text-slate-500">{o.avg_completion_minutes}m</td>
                  <td className="py-3 px-3 text-slate-500">{o.cancel_rate_pct}%</td>
                  <td className="py-3 px-3 text-amber-500 font-bold">{o.avg_rating || "—"} ★</td>
                  <td className="py-3 px-3">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        o.congestion_level === "HIGH"
                          ? "bg-rose-100 text-rose-800"
                          : o.congestion_level === "MODERATE"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {o.congestion_level}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-semibold text-amber-600 dark:text-amber-400">{o.bottleneck}</div>
                    <div className="text-slate-500 text-[11px]">{o.recommended_action}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Demand Heatmap & Inventory Waste Intelligence */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Demand Heatmap */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-500" />
              <span>Campus Food Demand Heatmap</span>
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              SLOT PEAKS
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-center border-collapse">
              <thead>
                <tr className="text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="py-2 text-left pr-2">Outlet</th>
                  {heatmap[0]?.slots.map((s) => (
                    <th key={s.slot} className="py-2 px-1 font-semibold">
                      {s.slot}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {heatmap.map((row) => (
                  <tr key={row.outlet_id}>
                    <td className="py-2.5 pr-2 text-left font-bold text-slate-900 dark:text-white">
                      {row.outlet_name}
                    </td>
                    {row.slots.map((cell) => {
                      const bg =
                        cell.orders >= 2
                          ? "bg-indigo-600 text-white"
                          : cell.orders === 1
                            ? "bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-400";
                      return (
                        <td key={cell.slot} className="p-1">
                          <div
                            className={`rounded-xl py-1.5 px-2 font-bold transition ${bg}`}
                            title={`Orders: ${cell.orders}`}
                          >
                            {cell.orders}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Customer Feedback Sentiment Breakdown */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <MessageSquareWarning className="w-4 h-4 text-emerald-500" />
              <span>Customer Sentiment & Feedback Intelligence</span>
            </h3>
            <span className="text-[11px] text-slate-400">
              {feedback.resolved_count}/{feedback.total_reviews} Resolved
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-3">
              <div className="text-xl font-black text-emerald-700 dark:text-emerald-300">
                {feedback.sentiment_breakdown.POSITIVE}
              </div>
              <div className="text-[11px] text-slate-500">Positive</div>
            </div>
            <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
              <div className="text-xl font-black text-slate-700 dark:text-slate-300">
                {feedback.sentiment_breakdown.NEUTRAL}
              </div>
              <div className="text-[11px] text-slate-500">Neutral</div>
            </div>
            <div className="rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 p-3">
              <div className="text-xl font-black text-rose-700 dark:text-rose-300">
                {feedback.sentiment_breakdown.NEGATIVE}
              </div>
              <div className="text-[11px] text-slate-500">Negative</div>
            </div>
          </div>

          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {feedback.recent_reviews.map((rev) => (
              <div
                key={rev.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3 text-xs flex items-start justify-between gap-2"
              >
                <div>
                  <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>{rev.outlet_name}</span>
                    <span className="text-amber-500">★ {rev.rating}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                      {rev.category}
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 mt-0.5">{rev.comment}</p>
                </div>
                {rev.rating >= 4 || rev.sentiment === "POSITIVE" ? null : Boolean(rev.is_resolved) ? (
                  <span className="text-[10px] text-emerald-600 font-bold shrink-0 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Resolved
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleResolveReview(rev.id)}
                    className="shrink-0 px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 font-bold hover:bg-amber-500/25 text-[11px]"
                  >
                    Resolve
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Cross-Organisation AI Assistant */}
      <AiAssistantPanel onDataChanged={loadDashboard} />
    </div>
  );
}
