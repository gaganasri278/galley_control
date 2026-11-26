import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Flame,
  Leaf,
  MessageSquarePlus,
  Minus,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  Users,
  UtensilsCrossed,
  X,
  XCircle,
} from "lucide-react";
import { useOutletContext } from "react-router-dom";
import {
  cancelOrder,
  checkoutOrder,
  fetchCatalogOverview,
  fetchGroupOrders,
  fetchOrders,
  submitReview,
  resolveImageUrl,
} from "../api/client";
import AiAssistantPanel from "../components/AiAssistantPanel";
import { useAuth } from "../context/AuthContext";

const SLOTS = ["ASAP", "11:00 Break", "13:00 Lunch", "17:00 Snacks"];

const FALLBACK_FOOD_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400" fill="none">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1e1b4b"/>
          <stop offset="100%" stop-color="#312e81"/>
        </linearGradient>
      </defs>
      <rect width="600" height="400" fill="url(#bg)"/>
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

export default function StudentPortal() {
  const { user } = useAuth();
  const { refreshNonce } = useOutletContext() || {};

  const [catalog, setCatalog] = useState({ outlets: [], menu_items: [] });
  const [orders, setOrders] = useState([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState("");

  const outlets = catalog.outlets || [];
  const menuItems = catalog.menu_items || [];

  const [selectedOutletId, setSelectedOutletId] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [vegOnly, setVegOnly] = useState(false);
  const [sortBy, setSortBy] = useState("popular"); // popular, price_asc, price_desc, prep_asc

  const [cart, setCart] = useState([]);
  const [studentName, setStudentName] = useState(user?.full_name || "");
  const [groupCode, setGroupCode] = useState("");
  const [scheduledSlot, setScheduledSlot] = useState("ASAP");
  const [simulateSuccess, setSimulateSuccess] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState(null);
  const [substitutePrompt, setSubstitutePrompt] = useState(null);
  const [latestPass, setLatestPass] = useState(null);
  const [viewingQrPass, setViewingQrPass] = useState(null);
  const [groupInfo, setGroupInfo] = useState(null);
  const [refundOutcome, setRefundOutcome] = useState(null);
  const [copiedToken, setCopiedToken] = useState(false);

  const maxCartPrep = useMemo(() => {
    if (!cart.length) return 0;
    return Math.max(...cart.map((c) => c.prep_minutes || 0));
  }, [cart]);

  // Review Form
  const [reviewOutletId, setReviewOutletId] = useState(1);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewResult, setReviewResult] = useState(null);

  const loadStudentData = useCallback(async () => {
    setPageError("");
    try {
      const [catData, ordData] = await Promise.all([
        fetchCatalogOverview(),
        fetchOrders(false),
      ]);
      setCatalog(catData);
      setOrders(ordData.orders || []);
      if (catData.outlets?.length && !catData.outlets.some((o) => o.id === selectedOutletId)) {
        setSelectedOutletId(catData.outlets[0].id);
      }
    } catch (err) {
      setPageError(err.message || "Could not load student portal data.");
    } finally {
      setPageLoading(false);
    }
  }, [selectedOutletId]);

  useEffect(() => {
    loadStudentData();
  }, [loadStudentData, refreshNonce]);

  const onDataChanged = loadStudentData;

  const activeOutletId = outlets.some((o) => o.id === selectedOutletId)
    ? selectedOutletId
    : outlets[0]?.id;

  // Extract all categories from available items
  const categories = useMemo(() => {
    const cats = new Set();
    menuItems.forEach((m) => {
      if (m.category) cats.add(m.category);
    });
    return ["ALL", ...Array.from(cats)];
  }, [menuItems]);

  // Filtered and sorted menu items
  const filteredItems = useMemo(() => {
    return menuItems
      .filter((item) => {
        if (activeOutletId && item.outlet_id !== activeOutletId) return false;
        if (vegOnly && !item.is_veg) return false;
        if (selectedCategory !== "ALL" && item.category !== selectedCategory) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchName = item.name.toLowerCase().includes(q);
          const matchDesc = (item.description || "").toLowerCase().includes(q);
          const matchCat = (item.category || "").toLowerCase().includes(q);
          if (!matchName && !matchDesc && !matchCat) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "price_asc") return a.price - b.price;
        if (sortBy === "price_desc") return b.price - a.price;
        if (sortBy === "prep_asc") return a.prep_minutes - b.prep_minutes;
        return a.id - b.id; // default popular / id
      });
  }, [menuItems, activeOutletId, vegOnly, selectedCategory, searchQuery, sortBy]);

  const handleSelectOutlet = (oid) => {
    if (oid !== activeOutletId && cart.length > 0) {
      setCart([]);
      setBanner({
        type: "info",
        text: "Switched outlet — your cart was cleared to keep each order at a single kitchen counter.",
      });
    }
    setSelectedOutletId(oid);
    setSubstitutePrompt(null);
  };

  const addToCart = (item) => {
    setBanner(null);
    setSubstitutePrompt(null);
    if (item.outlet_id !== activeOutletId) {
      setSelectedOutletId(item.outlet_id);
      setCart([{ ...item, quantity: 1 }]);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) {
        return prev.map((c) =>
          c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const updateQty = (itemId, delta) => {
    setCart((prev) =>
      prev
        .map((c) =>
          c.id === itemId ? { ...c, quantity: c.quantity + delta } : c
        )
        .filter((c) => c.quantity > 0)
    );
  };

  const cartTotal = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const handleCheckout = async (e) => {
    e.preventDefault();
    if (!cart.length) return;
    setSubmitting(true);
    setBanner(null);
    setSubstitutePrompt(null);
    setRefundOutcome(null);

    try {
      const result = await checkoutOrder({
        outlet_id: activeOutletId,
        student_name: studentName.trim() || "Student",
        items: cart.map((c) => ({ menu_item_id: c.id, quantity: c.quantity })),
        group_code: groupCode.trim() || null,
        scheduled_slot: scheduledSlot,
        simulate_payment_success: simulateSuccess,
      });
      setLatestPass(result);
      setCart([]);
      setBanner({
        type: "success",
        text: `Order ${result.order_code} successfully placed! Digital QR pass ready below.`,
      });
      if (result.group_code) {
        const g = await fetchGroupOrders(result.group_code);
        setGroupInfo(g);
      }
      await onDataChanged();
    } catch (err) {
      if (err.status === 409 && err.detail?.substitute) {
        setSubstitutePrompt(err.detail);
      }
      setBanner({ type: "error", text: err.message });
      await onDataChanged();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwapSubstitute = (detail) => {
    const subItem = menuItems.find((m) => m.id === detail.substitute.id);
    if (!subItem) return;
    setCart((prev) =>
      prev.map((c) =>
        c.id === detail.unavailable_item_id ? { ...subItem, quantity: c.quantity } : c
      )
    );
    setSubstitutePrompt(null);
    setBanner({
      type: "success",
      text: `Swapped to ${subItem.name}. Ready to place order!`,
    });
  };

  const handleLookupGroup = async () => {
    if (!groupCode.trim()) return;
    try {
      const g = await fetchGroupOrders(groupCode.trim());
      setGroupInfo(g);
    } catch (err) {
      setBanner({ type: "error", text: err.message });
    }
  };

  const handleCancelOrder = async (orderId) => {
    setRefundOutcome(null);
    try {
      const res = await cancelOrder(orderId, "Student requested cancellation");
      setRefundOutcome(res);
      if (latestPass?.order_id === orderId && res.refund_approved) {
        setLatestPass(null);
      }
      await onDataChanged();
    } catch (err) {
      setBanner({ type: "error", text: err.message });
    }
  };

  const handleSubmitReview = async (e) => {
    e.preventDefault();
    if (!reviewComment.trim()) return;
    setReviewSubmitting(true);
    setReviewResult(null);
    try {
      const res = await submitReview({
        outlet_id: Number(reviewOutletId || activeOutletId),
        student_name: studentName.trim() || "Student",
        rating: Number(reviewRating),
        comment: reviewComment.trim(),
      });
      setReviewResult(res);
      setReviewComment("");
      await onDataChanged();
    } catch (err) {
      setBanner({ type: "error", text: err.message });
    } finally {
      setReviewSubmitting(false);
    }
  };

  const copyToken = (token) => {
    navigator.clipboard?.writeText(token);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 1500);
  };

  if (pageLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-12 text-center shadow-sm">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
        <div className="text-base font-semibold text-slate-800 dark:text-slate-200">
          Loading Campus Canteen Menu
        </div>
        <div className="text-xs text-slate-500 mt-1">
          Retrieving live menus, preparation queues, and active passes...
        </div>
      </div>
    );
  }

  const activeOutlet = outlets.find((o) => o.id === activeOutletId);

  return (
    <div className="space-y-8">
      {/* Notifications & System Banners */}
      {pageError && (
        <div className="rounded-2xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-5 py-4 text-sm text-rose-800 dark:text-rose-200 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{pageError}</span>
          </div>
          <button
            type="button"
            onClick={loadStudentData}
            className="text-xs font-semibold underline hover:no-underline ml-4"
          >
            Retry
          </button>
        </div>
      )}

      {banner && (
        <div
          className={`rounded-2xl border px-5 py-4 text-sm flex flex-wrap items-center justify-between gap-3 shadow-sm transition duration-150 ${
            banner.type === "success"
              ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200"
              : banner.type === "error"
                ? "border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200"
                : "border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : banner.type === "error" ? (
              <XCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            ) : (
              <Sparkles className="w-4 h-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
            )}
            <span>{banner.text}</span>
          </div>

          {substitutePrompt?.substitute && (
            <button
              type="button"
              onClick={() => handleSwapSubstitute(substitutePrompt)}
              className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-xs shadow-sm transition"
            >
              Swap to {substitutePrompt.substitute.name} (₹{substitutePrompt.substitute.price})
            </button>
          )}
        </div>
      )}

      {/* Hero Outlet Selector & Kitchen Status */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Select Kitchen Counter
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Choose an active canteen outlet to browse freshly prepared items.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {outlets.map((o) => {
              const active = o.id === activeOutletId;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => handleSelectOutlet(o.id)}
                  className={`px-4 py-2.5 rounded-2xl text-xs font-semibold transition-all shadow-sm flex items-center gap-2 ${
                    active
                      ? "bg-indigo-600 text-white shadow-indigo-600/25 ring-2 ring-indigo-600/30"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${o.status === "OPEN" ? "bg-emerald-400" : "bg-amber-400"}`} />
                  <span>{o.name}</span>
                  <span className="text-[10px] opacity-80">
                    {o.status === "CLOSED" ? "(Closed)" : `(~${o.avg_prep_minutes}m prep)`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Search, Dietary & Filter Toolbar */}
        <div className="mt-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search dishes, snacks, coffee, meals..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
            />
          </div>

          {/* Filters: Category Pills + Veg Toggle + Sort */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Category Pills */}
            <div className="flex flex-wrap gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    selectedCategory === cat
                      ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm font-semibold"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Veg Only Switch */}
            <button
              type="button"
              onClick={() => setVegOnly(!vegOnly)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
                vegOnly
                  ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 text-emerald-700 dark:text-emerald-300 font-semibold"
                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300"
              }`}
            >
              <Leaf className="w-3.5 h-3.5 text-emerald-500" />
              <span>Veg Only</span>
            </button>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-transparent border-none text-xs focus:outline-none cursor-pointer text-slate-700 dark:text-slate-200"
              >
                <option value="popular">Popular</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="prep_asc">Prep Time: Quickest</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Menu Cards (Left) + Cart & Pass (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Menu Cards Column */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-slate-800 dark:text-slate-200">
              Available Dishes ({filteredItems.length})
            </div>
            {activeOutlet && (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Counter: <strong className="text-slate-700 dark:text-slate-300">{activeOutlet.name}</strong> • Location: {activeOutlet.location}
              </div>
            )}
          </div>

          {filteredItems.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-12 text-center text-slate-500 dark:text-slate-400">
              <UtensilsCrossed className="w-10 h-10 mx-auto text-slate-400 mb-3 opacity-60" />
              <p className="text-sm font-semibold">No food items found matching your filter.</p>
              <p className="text-xs mt-1">Try clearing your search query or dietary filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {filteredItems.map((item) => {
                const outOfStock = item.stock_qty <= 0 || !item.is_available;
                const inCartItem = cart.find((c) => c.id === item.id);
                const subObj = outOfStock
                  ? menuItems.find((m) => m.id === item.substitute_item_id)
                  : null;

                return (
                  <div
                    key={item.id}
                    className={`group rounded-3xl border overflow-hidden flex flex-col justify-between transition-all duration-200 ${
                      outOfStock
                        ? "border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/40 opacity-80"
                        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:shadow-lg hover:border-indigo-200 dark:hover:border-indigo-900/60"
                    }`}
                  >
                    {/* Food Photography Container */}
                    <div className="relative h-44 w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                      <img
                        src={resolveImageUrl(item.image_url) || FALLBACK_FOOD_IMG}
                        alt={item.name}
                        loading="lazy"
                        className={`w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 ${
                          outOfStock ? "grayscale contrast-75" : ""
                        }`}
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = FALLBACK_FOOD_IMG;
                        }}
                      />

                      {/* Top Badges: Veg indicator & Category */}
                      <div className="absolute top-3 left-3 flex items-center gap-1.5">
                        <span
                          className={`flex items-center justify-center w-6 h-6 rounded-lg bg-white/95 dark:bg-slate-900/95 backdrop-blur shadow-sm border ${
                            item.is_veg ? "border-emerald-500" : "border-rose-500"
                          }`}
                          title={item.is_veg ? "Vegetarian" : "Non-Vegetarian"}
                        >
                          <span
                            className={`w-2.5 h-2.5 rounded-full ${
                              item.is_veg ? "bg-emerald-600" : "bg-rose-600"
                            }`}
                          />
                        </span>
                        <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-lg bg-white/90 dark:bg-slate-900/90 text-slate-800 dark:text-slate-200 backdrop-blur shadow-sm">
                          {item.category}
                        </span>
                      </div>

                      {/* Prep Time Pill */}
                      <div className="absolute bottom-3 left-3 inline-flex items-center gap-1 text-[11px] font-medium bg-black/60 text-white backdrop-blur px-2 py-0.5 rounded-md">
                        <Clock className="w-3 h-3 text-amber-300" />
                        <span>~{item.prep_minutes} mins</span>
                      </div>

                      {/* Stock availability indicator */}
                      <div className="absolute top-3 right-3">
                        {outOfStock ? (
                          <span className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-bold text-[10px] uppercase tracking-wider shadow">
                            Out of Stock
                          </span>
                        ) : item.stock_qty <= 5 ? (
                          <span className="px-2 py-0.5 rounded-lg bg-amber-500 text-white font-bold text-[10px] uppercase tracking-wider shadow">
                            Only {item.stock_qty} left
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* Food Details */}
                    <div className="p-4 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className="font-bold text-slate-900 dark:text-white text-base leading-snug">
                            {item.name}
                          </h3>
                          <span className="text-base font-extrabold text-indigo-600 dark:text-indigo-400 shrink-0">
                            ₹{item.price.toFixed(2)}
                          </span>
                        </div>

                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                          {item.description || "Freshly prepared campus canteen favorite cooked with premium ingredients."}
                        </p>
                      </div>

                      {/* Action Button / Quantity Controls */}
                      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                        {outOfStock ? (
                          <div className="w-full flex items-center justify-between gap-2">
                            <span className="text-xs text-slate-400 font-medium">Currently Unavailable</span>
                            {subObj && (
                              <button
                                type="button"
                                onClick={() => addToCart(subObj)}
                                className="px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-700 dark:text-amber-300 text-xs font-semibold hover:bg-amber-500/25 transition"
                              >
                                Try {subObj.name} (₹{subObj.price})
                              </button>
                            )}
                          </div>
                        ) : inCartItem ? (
                          <div className="w-full flex items-center justify-between bg-slate-50 dark:bg-slate-800/80 p-1 rounded-2xl border border-slate-200 dark:border-slate-700">
                            <button
                              type="button"
                              onClick={() => updateQty(item.id, -1)}
                              className="w-8 h-8 rounded-xl bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center hover:bg-rose-50 hover:text-rose-600 transition shadow-sm"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-sm font-bold text-slate-900 dark:text-white px-3">
                              {inCartItem.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateQty(item.id, 1)}
                              className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 transition shadow-sm"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={activeOutlet?.status === "CLOSED"}
                            onClick={() => addToCart(item)}
                            className="w-full py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-sm shadow-indigo-600/20 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>{activeOutlet?.status === "CLOSED" ? "Kitchen Closed" : "Add to Order"}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Sidebar: Cart & Checkout Form */}
        <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-20">
          {/* Cart Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-bold text-slate-900 dark:text-white">Your Tray</h3>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                {cart.reduce((n, i) => n + i.quantity, 0)} items
              </span>
            </div>

            {cart.length === 0 ? (
              <div className="py-8 text-center text-slate-400 dark:text-slate-500 text-xs">
                Your tray is currently empty.
                <br />
                Add delicious food items to place an order!
              </div>
            ) : (
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {cart.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-xs text-slate-900 dark:text-white truncate">
                        {c.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        ₹{c.price} × {c.quantity} = ₹{(c.price * c.quantity).toFixed(2)}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => updateQty(c.id, -1)}
                        className="p-1 rounded-lg bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 shadow-xs"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-xs font-bold w-5 text-center">{c.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQty(c.id, 1)}
                        className="p-1 rounded-lg bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 shadow-xs"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Checkout Form */}
            <form onSubmit={handleCheckout} className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Student Name
                </label>
                <input
                  type="text"
                  required
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Group Code (Opt)
                  </label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      placeholder="e.g. GRP-101"
                      value={groupCode}
                      onChange={(e) => setGroupCode(e.target.value)}
                      className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={handleLookupGroup}
                      title="View Group Combined Orders"
                      className="px-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 hover:bg-slate-200"
                    >
                      <Users className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Pickup Slot
                  </label>
                  <select
                    value={scheduledSlot}
                    onChange={(e) => setScheduledSlot(e.target.value)}
                    className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {SLOTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {groupInfo && (
                <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 p-2.5 text-xs text-indigo-900 dark:text-indigo-200">
                  Group <strong>{groupInfo.group_code}</strong>: {groupInfo.member_count} orders, combined ₹{groupInfo.combined_total}
                </div>
              )}

              <label className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-3 py-2 cursor-pointer text-xs">
                <span className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-medium">
                  <CreditCard className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  Simulate Payment Gateway
                </span>
                <input
                  type="checkbox"
                  checked={simulateSuccess}
                  onChange={(e) => setSimulateSuccess(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
              </label>

              {/* Kitchen Prep Time Estimate */}
              {cart.length > 0 && (
                <div className="flex items-center justify-between text-xs py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                  <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 font-medium">
                    <Clock className="w-3.5 h-3.5 text-amber-500" />
                    <span>Est. Kitchen Prep Time</span>
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    ~{maxCartPrep} mins
                  </span>
                </div>
              )}

              {/* Closed Kitchen Warning */}
              {activeOutlet?.status === "CLOSED" && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs text-amber-700 dark:text-amber-300 font-medium text-center">
                  {activeOutlet.name} is currently closed and not accepting orders.
                </div>
              )}

              {/* Total & Checkout Button */}
              <div className="pt-2 flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-slate-500">Total Payable</div>
                  <div className="text-xl font-extrabold text-slate-900 dark:text-white">
                    ₹{cartTotal.toFixed(2)}
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={cart.length === 0 || submitting || activeOutlet?.status === "CLOSED"}
                  className="px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md shadow-indigo-600/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting
                    ? "Placing Order..."
                    : activeOutlet?.status === "CLOSED"
                    ? "Kitchen Closed"
                    : "Confirm & Pay"}
                </button>
              </div>
            </form>
          </div>

          {/* Digital QR Meal Pass (If order just placed) */}
          {latestPass && (
            <div className="rounded-3xl border-2 border-indigo-500/40 bg-gradient-to-br from-indigo-500/5 to-indigo-600/10 p-6 space-y-4 shadow-sm animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-extrabold text-xs uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                    Active Digital Pass
                  </span>
                </div>
                <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                  {latestPass.order_code}
                </span>
              </div>

              {/* Scannable QR Code Image */}
              <div className="p-4 bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 text-center space-y-3 shadow-inner">
                {latestPass.qr_image ? (
                  <div className="flex flex-col items-center justify-center p-2 bg-white rounded-xl border border-slate-200 shadow-sm mx-auto w-fit">
                    <img
                      src={latestPass.qr_image}
                      alt={`Digital QR Pass for ${latestPass.order_code}`}
                      className="w-44 h-44 object-contain rounded-lg"
                    />
                    <div className="text-[10px] font-bold text-slate-500 tracking-wider uppercase mt-1">
                      Scan at Counter Scanner
                    </div>
                  </div>
                ) : (
                  <div className="w-44 h-44 mx-auto flex items-center justify-center bg-slate-50 text-slate-400 text-xs rounded-xl">
                    Generating QR code...
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">One-Time QR Token</div>
                  <div className="text-base font-mono font-bold tracking-widest text-indigo-600 dark:text-indigo-400 break-all select-all">
                    {latestPass.qr_token}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToken(latestPass.qr_token)}
                    className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 transition"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copiedToken ? "Copied to Clipboard!" : "Copy Token for Scanner"}</span>
                  </button>
                </div>
              </div>

              {/* Kitchen, Prep Time & Order Details */}
              <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1.5 bg-white/60 dark:bg-slate-900/60 p-3.5 rounded-2xl border border-indigo-100 dark:border-indigo-900/30">
                <div className="flex items-center justify-between">
                  <span>Kitchen Outlet:</span>
                  <strong className="text-slate-900 dark:text-white">{latestPass.outlet_name}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>Pickup Slot:</span>
                  <strong className="text-slate-900 dark:text-white">{latestPass.scheduled_slot}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Est. Kitchen Prep / Wait:</span>
                  </span>
                  <strong className="text-amber-600 dark:text-amber-400">
                    ~{latestPass.estimated_wait_minutes ?? maxCartPrep ?? 8} mins
                  </strong>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                  <span>Status:</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider text-[11px]">
                    {latestPass.order_status}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Orders History & Live Queue */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">Your Orders & Collection Status</h3>
            <p className="text-xs text-slate-500">Track preparation stage, view QR tokens, or cancel for instant refund.</p>
          </div>
          <button
            type="button"
            onClick={onDataChanged}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>

        {refundOutcome && (
          <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 p-4 text-xs text-indigo-900 dark:text-indigo-200 space-y-1">
            <div className="font-bold">Cancellation & Refund Response:</div>
            <div>Reason: {refundOutcome.reason}</div>
            <div>
              Refund: {refundOutcome.refund_approved ? "Approved" : "Declined"} (₹{refundOutcome.refund_amount.toFixed(2)})
            </div>
          </div>
        )}

        {orders.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs">
            No past or active orders recorded.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-3">Order Code</th>
                  <th className="py-3 px-3">Outlet</th>
                  <th className="py-3 px-3">Items</th>
                  <th className="py-3 px-3">Total</th>
                  <th className="py-3 px-3">Est. Prep</th>
                  <th className="py-3 px-3">Slot</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {orders.map((o) => {
                  const statusVal = o.order_status || o.status || "PLACED";
                  const totalVal = Number(o.total_amount ?? o.total_price ?? 0);
                  return (
                    <tr key={o.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                      <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-white">
                        {o.order_code}
                      </td>
                      <td className="py-3 px-3 font-medium text-slate-700 dark:text-slate-300">
                        {o.outlet_name}
                      </td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-400 max-w-xs truncate">
                        {o.items?.map((i) => `${i.item_name} ×${i.quantity}`).join(", ") || "Order items"}
                      </td>
                      <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">
                        ₹{totalVal.toFixed(2)}
                      </td>
                      <td className="py-3 px-3">
                        <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400 font-medium">
                          <Clock className="w-3 h-3 text-amber-500" />
                          <span>~{o.estimated_wait_minutes || 7}m</span>
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-500">{o.scheduled_slot || "ASAP"}</td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            statusVal === "COLLECTED"
                              ? "bg-slate-100 dark:bg-slate-800 text-slate-500"
                              : statusVal === "READY"
                                ? "bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300"
                                : statusVal === "PREPARING"
                                  ? "bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300"
                                  : statusVal === "CANCELLED"
                                    ? "bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300"
                                    : "bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300"
                          }`}
                        >
                          {statusVal}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {o.qr_token && statusVal !== "CANCELLED" && (
                            <button
                              type="button"
                              onClick={() => setViewingQrPass(o)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 font-semibold text-[11px] transition"
                            >
                              <QrCode className="w-3 h-3" />
                              <span>QR Pass</span>
                            </button>
                          )}
                          {["PAID", "PLACED"].includes(statusVal) && (
                            <button
                              type="button"
                              onClick={() => handleCancelOrder(o.id)}
                              className="px-2.5 py-1 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 font-medium transition text-[11px]"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review Submission & AI Dining Assistant */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Student Feedback Card */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <MessageSquarePlus className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-bold text-slate-900 dark:text-white">Canteen Experience Review</h3>
          </div>

          <form onSubmit={handleSubmitReview} className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-500 mb-1 font-semibold uppercase text-[10px]">
                Target Outlet
              </label>
              <select
                value={reviewOutletId}
                onChange={(e) => setReviewOutletId(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white"
              >
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-500 mb-1 font-semibold uppercase text-[10px]">
                Rating (1 to 5 Stars)
              </label>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setReviewRating(star)}
                    className="p-1 rounded-lg hover:scale-110 transition"
                  >
                    <Star
                      className={`w-6 h-6 ${
                        star <= reviewRating
                          ? "fill-amber-400 text-amber-400"
                          : "text-slate-300 dark:text-slate-700"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-slate-500 mb-1 font-semibold uppercase text-[10px]">
                Feedback / Comments
              </label>
              <textarea
                rows={3}
                required
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder="How was the food quality, taste, hygiene, or queue waiting time?"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={reviewSubmitting || !reviewComment.trim()}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition disabled:opacity-50"
            >
              {reviewSubmitting ? "Submitting..." : "Submit Feedback"}
            </button>
          </form>

          {reviewResult && (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-3 text-xs text-emerald-800 dark:text-emerald-200 space-y-1">
              <div className="font-bold">Feedback Recorded!</div>
              <div>Sentiment: {reviewResult.review?.sentiment} ({reviewResult.review?.category})</div>
            </div>
          )}
        </div>

        {/* AI Assistant Column */}
        <div className="lg:col-span-7">
          <AiAssistantPanel onDataChanged={onDataChanged} />
        </div>
      </div>

      {/* View QR Code Pass Modal */}
      {viewingQrPass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl relative">
            <button
              type="button"
              onClick={() => setViewingQrPass(null)}
              className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                Digital Pickup Pass
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Order {viewingQrPass.order_code}
              </h3>
              <p className="text-[11px] text-slate-500">
                Scan this QR code at the canteen pickup counter.
              </p>
            </div>

            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-inner flex flex-col items-center justify-center">
              {viewingQrPass.qr_image ? (
                <img
                  src={viewingQrPass.qr_image}
                  alt={`QR Code Pass for ${viewingQrPass.order_code}`}
                  className="w-48 h-48 object-contain rounded-xl p-1 bg-white"
                />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center bg-slate-50 text-slate-400 text-xs rounded-xl">
                  Loading QR Code...
                </div>
              )}
              <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mt-2">
                Scan at Pickup Counter
              </div>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800 text-center space-y-1.5">
              <div className="text-[10px] uppercase font-bold text-slate-400">One-Time Token</div>
              <div className="text-xs font-mono font-bold tracking-wider text-indigo-600 dark:text-indigo-400 select-all">
                {viewingQrPass.qr_token}
              </div>
              <button
                type="button"
                onClick={() => copyToken(viewingQrPass.qr_token)}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-medium bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedToken ? "Copied!" : "Copy Token"}</span>
              </button>
            </div>

            <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1 pt-1 border-t border-slate-100 dark:border-slate-800">
              <div className="flex justify-between">
                <span>Counter:</span>
                <strong className="text-slate-900 dark:text-white">{viewingQrPass.outlet_name}</strong>
              </div>
              <div className="flex justify-between">
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Est. Prep / Wait:</span>
                </span>
                <strong className="text-amber-600 dark:text-amber-400">
                  ~{viewingQrPass.estimated_wait_minutes || 7} mins
                </strong>
              </div>
              <div className="flex justify-between">
                <span>Status:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400 uppercase text-[11px]">
                  {viewingQrPass.order_status || viewingQrPass.status}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
