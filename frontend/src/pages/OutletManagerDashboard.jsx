import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  Bot,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ChefHat,
  Clock,
  Edit3,
  Image as ImageIcon,
  Leaf,
  Package,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Store,
  Trash2,
  Upload,
  UserPlus,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { Link, useOutletContext } from "react-router-dom";
import AiAssistantPanel from "../components/AiAssistantPanel";
import {
  actOnRecommendation,
  addOutletMenuItem,
  createOrgManager,
  createOrgOutlet,
  deleteMenuItemImage,
  fetchOrgSummary,
  fetchOutletDashboard,
  markOrderPreparing,
  resolveReview,
  updateMenuItem,
  updateOrgOutlet,
  updateOutletStock,
  uploadMenuItemImage,
  resolveImageUrl,
} from "../api/client";

const FALLBACK_FOOD_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400" fill="none">
      <defs>
        <linearGradient id="bg2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1e1b4b"/>
          <stop offset="100%" stop-color="#312e81"/>
        </linearGradient>
      </defs>
      <rect width="600" height="400" fill="url(#bg2)"/>
      <ellipse cx="300" cy="230" rx="160" ry="75" fill="#f8fafc"/>
      <ellipse cx="300" cy="225" rx="125" ry="55" fill="#f59e0b"/>
      <circle cx="280" cy="215" r="20" fill="#ef4444"/>
      <circle cx="320" cy="220" r="22" fill="#10b981"/>
      <circle cx="300" cy="235" r="18" fill="#3b82f6"/>
      <path d="M270 140 C270 110, 285 100, 275 70" stroke="#f8fafc" stroke-width="4" stroke-linecap="round" fill="none" opacity="0.7"/>
      <path d="M300 135 C300 105, 315 95, 305 65" stroke="#f8fafc" stroke-width="4" stroke-linecap="round" fill="none" opacity="0.7"/>
      <path d="M330 140 C330 110, 345 100, 335 70" stroke="#f8fafc" stroke-width="4" stroke-linecap="round" fill="none" opacity="0.7"/>
      <text x="300" y="350" font-family="-apple-system, sans-serif" font-size="20" font-weight="bold" fill="#e0e7ff" text-anchor="middle">CAMPUS KITCHEN SPECIAL</text>
    </svg>`
  );

export default function OutletManagerDashboard() {
  const { refreshNonce } = useOutletContext() || {};
  const [data, setData] = useState(null);
  const [orgSummary, setOrgSummary] = useState(null);
  const [selectedOutletId, setSelectedOutletId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [activeOrgTool, setActiveOrgTool] = useState("");
  const [activeTab, setActiveTab] = useState("queue"); // "queue" | "menu"

  // Search & filter in Menu tab
  const [menuSearch, setMenuSearch] = useState("");
  const [menuFilterCategory, setMenuFilterCategory] = useState("ALL");

  // Editing Item Modal State
  const [editingItem, setEditingItem] = useState(null);
  const [editForm, setEditForm] = useState({
    name: "",
    category: "",
    price: 0,
    stock_qty: 0,
    prep_minutes: 5,
    is_veg: true,
    is_available: true,
    description: "",
  });
  const [uploadingImage, setUploadingImage] = useState(false);

  // Forms
  const [outletForm, setOutletForm] = useState({
    name: "",
    location: "",
    avg_prep_minutes: 7,
    active_staff: 3,
  });
  const [menuForm, setMenuForm] = useState({
    name: "",
    category: "Meals",
    price: 80,
    stock_qty: 20,
    prep_minutes: 6,
    is_veg: true,
    description: "",
  });
  const [menuItemImageFile, setMenuItemImageFile] = useState(null);

  const [mgrForm, setMgrForm] = useState({
    full_name: "",
    username: "",
    email: "",
    password: "",
  });

  const loadData = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetchOutletDashboard(selectedOutletId);
      setData(res);
      if (res.is_org_manager) {
        const orgRes = await fetchOrgSummary().catch(() => null);
        setOrgSummary(orgRes);
      }
    } catch (err) {
      setError(err.message || "Failed to load outlet dashboard.");
    } finally {
      setLoading(false);
    }
  }, [selectedOutletId]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshNonce]);

  const handleSelectOutlet = (oid) => {
    setSelectedOutletId(Number(oid));
  };

  const handlePrepare = async (orderId, orderCode) => {
    setBusyId(`prep-${orderId}`);
    setError("");
    setNotice("");
    try {
      await markOrderPreparing(orderId);
      setNotice(`Order ${orderCode} status updated to PREPARING.`);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateOutlet = async (e) => {
    e.preventDefault();
    setBusyId("create-outlet");
    setError("");
    setNotice("");
    try {
      const res = await createOrgOutlet({
        name: outletForm.name.trim(),
        location: outletForm.location.trim(),
        avg_prep_minutes: Number(outletForm.avg_prep_minutes),
        active_staff: Number(outletForm.active_staff),
      });
      setNotice(`Outlet "${res.outlet.name}" provisioned successfully.`);
      setActiveOrgTool("");
      setOutletForm({ name: "", location: "", avg_prep_minutes: 7, active_staff: 3 });
      setSelectedOutletId(res.outlet.id);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleOutletStatusChange = async (newStatus) => {
    if (!data?.outlet) return;
    setBusyId("status-toggle");
    setError("");
    setNotice("");
    try {
      await updateOrgOutlet(data.outlet.id, { status: newStatus });
      setNotice(`Kitchen counter marked as ${newStatus}.`);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleAddMenuItem = async (e) => {
    e.preventDefault();
    if (!data?.outlet) return;
    setBusyId("add-menu");
    setError("");
    setNotice("");
    try {
      const res = await addOutletMenuItem({
        outlet_id: data.outlet.id,
        name: menuForm.name.trim(),
        category: menuForm.category.trim(),
        price: Number(menuForm.price),
        stock_qty: Number(menuForm.stock_qty),
        prep_minutes: Number(menuForm.prep_minutes),
        is_veg: Boolean(menuForm.is_veg),
        description: menuForm.description.trim() || null,
      });

      // If manager attached an image during creation, upload it now
      if (menuItemImageFile && res?.menu_item?.id) {
        await uploadMenuItemImage(res.menu_item.id, menuItemImageFile).catch(() => {});
      }

      setNotice(`New item "${menuForm.name}" published to menu.`);
      setActiveOrgTool("");
      setMenuForm({
        name: "",
        category: "Meals",
        price: 80,
        stock_qty: 20,
        prep_minutes: 6,
        is_veg: true,
        description: "",
      });
      setMenuItemImageFile(null);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateOutletManager = async (e) => {
    e.preventDefault();
    if (!data?.outlet) return;
    setBusyId("add-mgr");
    setError("");
    setNotice("");
    try {
      const res = await createOrgManager({
        full_name: mgrForm.full_name.trim(),
        username: mgrForm.username.trim(),
        email: mgrForm.email.trim(),
        password: mgrForm.password,
        outlet_id: data.outlet.id,
      });
      setNotice(`Manager account created for ${res.user.full_name} (@${res.user.username}).`);
      setActiveOrgTool("");
      setMgrForm({ full_name: "", username: "", email: "", password: "" });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleStockChange = async (item, newQty) => {
    const safeQty = Math.max(0, newQty);
    setBusyId(`stock-${item.id}`);
    setNotice("");
    setError("");
    try {
      await updateOutletStock(item.id, safeQty);
      setNotice(`Updated ${item.name} stock to ${safeQty} units.`);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleOpenEditItem = (item) => {
    setEditingItem(item);
    setEditForm({
      name: item.name,
      category: item.category,
      price: item.price,
      stock_qty: item.stock_qty,
      prep_minutes: item.prep_minutes,
      is_veg: Boolean(item.is_veg),
      is_available: item.is_available !== false,
      description: item.description || "",
    });
  };

  const handleSaveEditItem = async (e) => {
    e.preventDefault();
    if (!editingItem) return;
    setBusyId(`save-item-${editingItem.id}`);
    setError("");
    setNotice("");
    try {
      await updateMenuItem(editingItem.id, {
        name: editForm.name.trim(),
        category: editForm.category.trim(),
        price: Number(editForm.price),
        stock_qty: Number(editForm.stock_qty),
        prep_minutes: Number(editForm.prep_minutes),
        is_veg: Boolean(editForm.is_veg),
        is_available: Boolean(editForm.is_available),
        description: editForm.description.trim() || null,
      });
      setNotice(`Updated item details for "${editForm.name}".`);
      setEditingItem(null);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleUploadImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !editingItem) return;
    setUploadingImage(true);
    setError("");
    try {
      const res = await uploadMenuItemImage(editingItem.id, file);
      setEditingItem((prev) => (prev ? { ...prev, image_url: res.image_url } : null));
      setNotice(`New food photo uploaded for "${editingItem.name}".`);
      await loadData();
    } catch (err) {
      setError(err.message || "Failed to upload image.");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleDeleteImage = async () => {
    if (!editingItem) return;
    setUploadingImage(true);
    setError("");
    try {
      await deleteMenuItemImage(editingItem.id);
      setEditingItem((prev) => (prev ? { ...prev, image_url: null } : null));
      setNotice(`Custom photo removed for "${editingItem.name}".`);
      await loadData();
    } catch (err) {
      setError(err.message || "Failed to delete image.");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleResolveReview = async (reviewId) => {
    setBusyId(`rev-${reviewId}`);
    try {
      await resolveReview(reviewId);
      setNotice("Feedback complaint marked as resolved.");
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleRecAction = async (recId, status) => {
    setBusyId(`rec-${recId}`);
    try {
      await actOnRecommendation(recId, status);
      setNotice(`Recommendation ${status.toLowerCase()}.`);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const menuItems = data?.menu_items || [];
  const categories = useMemo(() => {
    const cats = new Set();
    menuItems.forEach((m) => cats.add(m.category));
    return ["ALL", ...Array.from(cats)];
  }, [menuItems]);

  const filteredMenuItems = useMemo(() => {
    return menuItems.filter((item) => {
      if (menuFilterCategory !== "ALL" && item.category !== menuFilterCategory) return false;
      if (menuSearch.trim()) {
        const q = menuSearch.toLowerCase();
        const matchName = item.name.toLowerCase().includes(q);
        const matchCat = item.category.toLowerCase().includes(q);
        const matchDesc = (item.description || "").toLowerCase().includes(q);
        if (!matchName && !matchCat && !matchDesc) return false;
      }
      return true;
    });
  }, [menuItems, menuFilterCategory, menuSearch]);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-12 text-center shadow-sm">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
        <div className="text-base font-semibold text-slate-800 dark:text-slate-200">
          Loading Outlet Kitchen Operations
        </div>
        <div className="text-xs text-slate-500 mt-1">
          Synchronizing queue orders, inventory thresholds, and telemetry...
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-6 text-sm text-rose-800 dark:text-rose-200">
        {error || "Unable to load outlet operations console."}
      </div>
    );
  }

  const {
    is_org_manager: isOrgManager,
    available_outlets: availableOutlets = [],
    outlet,
    metrics,
    orders,
    reviews,
    recommendations,
    security_events,
  } = data;

  if (!outlet) {
    return (
      <div className="space-y-6">
        <section className="rounded-3xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 p-8 space-y-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/80 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Organisation Onboarding</h2>
              <p className="text-xs text-slate-500">Create your organisation's first canteen kitchen counter to begin operations.</p>
            </div>
          </div>

          <form onSubmit={handleCreateOutlet} className="space-y-4 max-w-lg text-xs">
            <div>
              <label className="block text-slate-500 font-semibold mb-1">Outlet Counter Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Main Courtyard Bistro"
                value={outletForm.name}
                onChange={(e) => setOutletForm({ ...outletForm, name: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-slate-500 font-semibold mb-1">Campus Location</label>
              <input
                type="text"
                required
                placeholder="e.g. North Quad, Ground Floor"
                value={outletForm.location}
                onChange={(e) => setOutletForm({ ...outletForm, location: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Base Prep SLA (mins)</label>
                <input
                  type="number"
                  required
                  min={1}
                  value={outletForm.avg_prep_minutes}
                  onChange={(e) => setOutletForm({ ...outletForm, avg_prep_minutes: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Staff Count</label>
                <input
                  type="number"
                  required
                  min={1}
                  value={outletForm.active_staff}
                  onChange={(e) => setOutletForm({ ...outletForm, active_staff: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={busyId === "create-outlet"}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition shadow-md shadow-indigo-600/30"
            >
              {busyId === "create-outlet" ? "Creating..." : "Provision Outlet Counter"}
            </button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Alert / Notice Banner */}
      {error && (
        <div className="rounded-2xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-5 py-4 text-xs text-rose-800 dark:text-rose-200 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError("")} className="font-bold ml-4">
            ×
          </button>
        </div>
      )}

      {notice && (
        <div className="rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-5 py-4 text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{notice}</span>
          </div>
          <button type="button" onClick={() => setNotice("")} className="font-bold ml-4">
            ×
          </button>
        </div>
      )}

      {/* Outlet Header & Operational Controls */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Store className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                  {outlet.name}
                </h2>
                {isOrgManager && availableOutlets.length > 1 && (
                  <select
                    aria-label="Switch active outlet"
                    value={outlet.id}
                    onChange={(e) => handleSelectOutlet(e.target.value)}
                    className="rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 px-3 py-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400"
                  >
                    {availableOutlets.map((ao) => (
                      <option key={ao.id} value={ao.id}>
                        {ao.name} ({ao.status})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Location: <strong className="text-slate-700 dark:text-slate-300">{outlet.location}</strong> • Base SLA: {outlet.avg_prep_minutes} mins • Staff: {outlet.active_staff}
              </p>
            </div>
          </div>

          {/* Status Changer & Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-2xl border border-slate-200 dark:border-slate-700">
              {["OPEN", "BUSY", "CLOSED"].map((st) => (
                <button
                  key={st}
                  type="button"
                  disabled={busyId === "status-toggle" || outlet.status === st}
                  onClick={() => handleOutletStatusChange(st)}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition ${
                    outlet.status === st
                      ? st === "OPEN"
                        ? "bg-emerald-600 text-white shadow-sm"
                        : st === "BUSY"
                          ? "bg-amber-600 text-white shadow-sm"
                          : "bg-rose-600 text-white shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            {isOrgManager && (
              <button
                type="button"
                onClick={() => setActiveOrgTool((p) => (p === "menu" ? "" : "menu"))}
                className="px-3.5 py-2 rounded-2xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition shadow-sm shadow-indigo-600/20 flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Dish</span>
              </button>
            )}

            <Link
              to="/manager/scanner"
              className="px-3.5 py-2 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold hover:opacity-90 transition flex items-center gap-1.5 shadow-sm"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Counter Scanner</span>
            </Link>
          </div>
        </div>

        {/* Collapsible Tool: Add New Menu Item */}
        {isOrgManager && activeOrgTool === "menu" && (
          <section className="mt-4 rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/30 p-5 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Add New Food Dish to {outlet.name}
              </h3>
              <button
                type="button"
                onClick={() => setActiveOrgTool("")}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddMenuItem} className="space-y-3 text-xs">
              <div className="grid sm:grid-cols-4 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Dish Name (e.g. Masala Dosa)"
                  value={menuForm.name}
                  onChange={(e) => setMenuForm({ ...menuForm, name: e.target.value })}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white"
                />
                <input
                  type="text"
                  required
                  placeholder="Category (e.g. South Indian)"
                  value={menuForm.category}
                  onChange={(e) => setMenuForm({ ...menuForm, category: e.target.value })}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white"
                />
                <input
                  type="number"
                  required
                  min={1}
                  step="1"
                  placeholder="Price (₹)"
                  value={menuForm.price}
                  onChange={(e) => setMenuForm({ ...menuForm, price: e.target.value })}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white"
                />
                <input
                  type="number"
                  required
                  min={0}
                  placeholder="Initial Stock"
                  value={menuForm.stock_qty}
                  onChange={(e) => setMenuForm({ ...menuForm, stock_qty: e.target.value })}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <textarea
                  rows={2}
                  placeholder="Appetizing description of ingredients and taste..."
                  value={menuForm.description}
                  onChange={(e) => setMenuForm({ ...menuForm, description: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={menuForm.is_veg}
                      onChange={(e) => setMenuForm({ ...menuForm, is_veg: e.target.checked })}
                      className="rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Vegetarian</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-indigo-600 dark:text-indigo-400 font-medium">
                    <Camera className="w-4 h-4" />
                    <span>{menuItemImageFile ? menuItemImageFile.name : "Attach Food Photo"}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => setMenuItemImageFile(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={busyId === "add-menu"}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition shadow-sm"
                >
                  {busyId === "add-menu" ? "Publishing..." : "Add to Live Menu"}
                </button>
              </div>
            </form>
          </section>
        )}
      </div>

      {/* Operational KPI Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-2">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Queue Orders</div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {metrics?.queue_length ?? orders.length}
          </div>
          <div className="text-[11px] text-slate-400">Live student requests</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-2">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Live Revenue</div>
          <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
            ₹{Number(metrics?.live_revenue || 0).toFixed(2)}
          </div>
          <div className="text-[11px] text-slate-400">Paid today</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-2">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Estimated Wait</div>
          <div className="text-2xl font-black text-amber-500">
            ~{metrics?.estimated_wait_minutes ?? outlet.avg_prep_minutes}m
          </div>
          <div className="text-[11px] text-slate-400">Preparation bottleneck SLA</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-2">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Menu Catalog</div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {menuItems.length}
          </div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
            {menuItems.filter((i) => i.stock_qty > 0).length} in stock
          </div>
        </div>
      </div>

      {/* Navigation Tabs: Kitchen Queue vs Menu & Dishes Studio */}
      <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("queue")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-bold transition ${
            activeTab === "queue"
              ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/25"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <ChefHat className="w-4 h-4" />
          <span>Live Kitchen Queue ({orders.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("menu")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-bold transition ${
            activeTab === "menu"
              ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/25"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <UtensilsCrossed className="w-4 h-4" />
          <span>Menu & Food Photo Studio ({menuItems.length})</span>
        </button>
      </div>

      {/* TAB 1: Kitchen Queue View */}
      {activeTab === "queue" && (
        <div className="space-y-5">
          {orders.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-12 text-center text-slate-500">
              <ChefHat className="w-10 h-10 mx-auto text-slate-400 mb-3 opacity-60" />
              <p className="text-sm font-semibold">No active kitchen orders in queue.</p>
              <p className="text-xs mt-1">Orders placed by campus students appear here in real time.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {orders.map((ord) => (
                <div
                  key={ord.id}
                  className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex flex-col justify-between space-y-4"
                >
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                      <div>
                        <span className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                          {ord.order_code}
                        </span>
                        <div className="text-xs text-slate-500">{ord.student_name}</div>
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                          ord.order_status === "COLLECTED"
                            ? "bg-slate-100 dark:bg-slate-800 text-slate-500"
                            : ord.order_status === "READY"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : ord.order_status === "PREPARING"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                : "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"
                        }`}
                      >
                        {ord.order_status}
                      </span>
                    </div>

                    <div className="mt-3 space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                      {ord.items?.map((i) => (
                        <div key={i.menu_item_id} className="flex justify-between">
                          <span>{i.item_name}</span>
                          <span className="font-bold">×{i.quantity}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-slate-500">
                      Slot: <strong className="text-slate-700 dark:text-slate-300">{ord.scheduled_slot}</strong>
                    </span>

                    <div className="flex items-center gap-2">
                      {ord.order_status === "PLACED" && (
                        <button
                          type="button"
                          disabled={busyId === `prep-${ord.id}`}
                          onClick={() => handlePrepare(ord.id, ord.order_code)}
                          className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition shadow-sm"
                        >
                          {busyId === `prep-${ord.id}` ? "Updating..." : "Mark Preparing"}
                        </button>
                      )}
                      {ord.qr_status === "ACTIVE" && (
                        <Link
                          to="/manager/scanner"
                          className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 font-semibold transition"
                        >
                          Scan QR →
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Menu & Food Photo Studio */}
      {activeTab === "menu" && (
        <div className="space-y-6">
          {/* Menu Search & Category Filter Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search dishes or categories..."
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setMenuFilterCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    menuFilterCategory === cat
                      ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm font-semibold"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Food Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredMenuItems.map((item) => (
              <div
                key={item.id}
                className="group rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm flex flex-col justify-between hover:shadow-md transition"
              >
                {/* Photo Thumbnail */}
                <div className="relative h-44 w-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <img
                    src={resolveImageUrl(item.image_url) || FALLBACK_FOOD_IMG}
                    alt={item.name}
                    className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = FALLBACK_FOOD_IMG;
                    }}
                  />

                  {/* Veg & Category Badges */}
                  <div className="absolute top-3 left-3 flex items-center gap-1.5">
                    <span
                      className={`flex items-center justify-center w-6 h-6 rounded-lg bg-white/95 dark:bg-slate-900/95 backdrop-blur shadow-sm border ${
                        item.is_veg ? "border-emerald-500" : "border-rose-500"
                      }`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full ${item.is_veg ? "bg-emerald-600" : "bg-rose-600"}`} />
                    </span>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-lg bg-white/90 dark:bg-slate-900/90 text-slate-800 dark:text-slate-200 backdrop-blur shadow-sm">
                      {item.category}
                    </span>
                  </div>

                  {/* Edit Photo / Details Button */}
                  <button
                    type="button"
                    onClick={() => handleOpenEditItem(item)}
                    className="absolute bottom-3 right-3 px-3 py-1.5 rounded-xl bg-white/90 dark:bg-slate-900/90 hover:bg-white text-slate-800 dark:text-slate-100 backdrop-blur text-xs font-bold shadow-md flex items-center gap-1.5 transition"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Edit Dish & Photo</span>
                  </button>
                </div>

                {/* Dish Information */}
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <h4 className="font-bold text-base text-slate-900 dark:text-white">{item.name}</h4>
                      <span className="text-base font-extrabold text-indigo-600 dark:text-indigo-400">
                        ₹{item.price.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                      {item.description || "Freshly cooked campus canteen meal."}
                    </p>
                  </div>

                  {/* Stock Control Bar */}
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                    <div>
                      <div className="text-[10px] text-slate-400 font-semibold uppercase">Stock Level</div>
                      <div className="font-bold text-slate-800 dark:text-slate-200">
                        {item.stock_qty <= 0 ? (
                          <span className="text-rose-600">0 (Out of stock)</span>
                        ) : (
                          `${item.stock_qty} available`
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={busyId === `stock-${item.id}`}
                        onClick={() => handleStockChange(item, 0)}
                        className="px-2 py-1 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 text-[11px] font-bold"
                        title="Set out of stock"
                      >
                        0
                      </button>
                      <button
                        type="button"
                        disabled={busyId === `stock-${item.id}` || item.stock_qty <= 0}
                        onClick={() => handleStockChange(item, item.stock_qty - 1)}
                        className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 text-[11px] font-bold"
                        title="Reduce by 1"
                      >
                        -1
                      </button>
                      <button
                        type="button"
                        disabled={busyId === `stock-${item.id}`}
                        onClick={() => handleStockChange(item, item.stock_qty + 10)}
                        className="px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 text-indigo-600 text-[11px] font-bold hover:bg-indigo-100"
                        title="Add 10 units"
                      >
                        +10
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: Edit Menu Item & Photo Management */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-extrabold text-lg text-slate-900 dark:text-white">
                Edit Menu Item & Food Photo
              </h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Photo Section */}
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Food Item Photograph
              </label>
              <div className="flex items-center gap-4">
                <div className="relative h-24 w-32 rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0">
                  <img
                    src={resolveImageUrl(editingItem.image_url) || FALLBACK_FOOD_IMG}
                    alt={editingItem.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = FALLBACK_FOOD_IMG;
                    }}
                  />
                  {uploadingImage && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-xs">
                      Uploading...
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer transition shadow-sm">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload New Photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleUploadImage}
                      disabled={uploadingImage}
                    />
                  </label>

                  {editingItem.image_url && (
                    <button
                      type="button"
                      onClick={handleDeleteImage}
                      disabled={uploadingImage}
                      className="block text-xs font-semibold text-rose-600 hover:underline"
                    >
                      Remove Custom Photo
                    </button>
                  )}
                  <p className="text-[11px] text-slate-400">Accepts JPEG, PNG, WebP up to 5MB.</p>
                </div>
              </div>
            </div>

            {/* Form Details */}
            <form onSubmit={handleSaveEditItem} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Item Title</label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Category</label>
                  <input
                    type="text"
                    required
                    value={editForm.category}
                    onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Price (₹)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    step="0.5"
                    value={editForm.price}
                    onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Stock</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={editForm.stock_qty}
                    onChange={(e) => setEditForm({ ...editForm, stock_qty: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Description</label>
                <textarea
                  rows={3}
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-center gap-6 pt-1">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={editForm.is_veg}
                    onChange={(e) => setEditForm({ ...editForm, is_veg: e.target.checked })}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Vegetarian Dish</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={editForm.is_available}
                    onChange={(e) => setEditForm({ ...editForm, is_available: e.target.checked })}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Available on Menu</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 font-semibold hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyId === `save-item-${editingItem.id}`}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition shadow-sm"
                >
                  {busyId === `save-item-${editingItem.id}` ? "Saving Changes..." : "Save Details"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Recommendations + Customer Reviews + Security Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Recommendations Column */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <Bot className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-bold text-slate-900 dark:text-white">AI Autonomous Recommendations</h3>
          </div>

          {recommendations.length === 0 ? (
            <p className="text-xs text-slate-400 py-4">No active AI suggestions requiring action.</p>
          ) : (
            <div className="space-y-3">
              {recommendations.map((rec) => (
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
                  <p className="text-slate-600 dark:text-slate-400">{rec.rationale}</p>
                  {rec.status === "PENDING_APPROVAL" && (
                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        disabled={busyId === `rec-${rec.id}`}
                        onClick={() => handleRecAction(rec.id, "APPROVED")}
                        className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1 shadow-sm"
                      >
                        <Check className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button
                        type="button"
                        disabled={busyId === `rec-${rec.id}`}
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
          )}
        </section>

        {/* Customer Reviews & Security Alerts */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h3 className="font-bold text-slate-900 dark:text-white">Customer Reviews & Security Feed</h3>
          </div>

          <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
            {reviews.length === 0 ? (
              <p className="text-xs text-slate-400">No student reviews recorded yet.</p>
            ) : (
              reviews.map((rev) => (
                <div
                  key={rev.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3.5 text-xs flex items-start justify-between gap-3"
                >
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">
                      {rev.student_name} • {rev.rating} ★ ({rev.category})
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 mt-0.5">{rev.comment}</p>
                  </div>
                  {rev.rating >= 4 || rev.sentiment === "POSITIVE" ? null : rev.is_resolved ? (
                    <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Resolved
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === `rev-${rev.id}`}
                      onClick={() => handleResolveReview(rev.id)}
                      className="px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs font-semibold hover:bg-amber-500/25 shrink-0"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
              <span>Recent Security Events ({security_events.length})</span>
            </div>
            {security_events.slice(0, 3).map((ev) => (
              <div
                key={ev.id}
                className="rounded-xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 px-3 py-2 text-[11px] text-slate-700 dark:text-slate-300"
              >
                <strong className="text-rose-700 dark:text-rose-300">{ev.event_type}</strong> ({ev.risk_level}) — {ev.ai_explanation}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Outlet-Scoped Conversational AI Assistant */}
      <AiAssistantPanel outletId={outlet.id} onDataChanged={loadData} />
    </div>
  );
}
