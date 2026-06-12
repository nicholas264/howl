import React, { useState, useCallback, useEffect, Suspense, lazy } from "react";
import { UserButton } from "@clerk/clerk-react";
import { PRODUCTS, ANGLES, PLATFORMS } from "./data";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
// Always-visible shell components stay eagerly imported.
import ConfigPanel from "./components/ConfigPanel";
import ResultsPanel from "./components/ResultsPanel";
import WelcomeScreen from "./components/WelcomeScreen";
import FeedbackWidget from "./components/FeedbackWidget";
// Heavy tab tools are code-split — only the active tab's bundle is downloaded.
const ReviewAdTool = lazy(() => import("./components/ReviewAdTool"));
const VideoAdTool = lazy(() => import("./components/VideoAdTool"));
const ImageAdTool = lazy(() => import("./components/ImageAdTool"));
const CalloutAdTool = lazy(() => import("./components/CalloutAdTool"));
const FounderAdTool = lazy(() => import("./components/FounderAdTool"));
const MetaPublishTool = lazy(() => import("./components/MetaPublishTool"));
const DashboardTool = lazy(() => import("./components/DashboardTool"));
const InventoryTool = lazy(() => import("./components/InventoryTool"));
const LaunchLogTool = lazy(() => import("./components/LaunchLogTool"));
const UgcEditorTool = lazy(() => import("./components/UgcEditorTool"));
const GalleryTab = lazy(() => import("./components/GalleryTab"));
const FromWinnersTool = lazy(() => import("./components/FromWinnersTool"));
const LauncherTool = lazy(() => import("./components/LauncherTool"));
const CreatorWorkspace = lazy(() => import("./components/CreatorWorkspace"));
const AdminWorkspace = lazy(() => import("./components/AdminWorkspace"));
const WorkspaceHub = lazy(() => import("./components/WorkspaceHub"));
import { useDriveAuth } from "./hooks/useDriveAuth";
import { cartGetAll, cartPut, cartDelete } from "./utils/cartDb";
import "./styles.css";

const TabFallback = () => (
  <div style={{ padding: 32, color: '#8b949e', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>
    Loading…
  </div>
);

export default function HowlAdEngine() {
  const driveAuth = useDriveAuth();
  const [selectedProducts, setSelectedProducts] = useState(["r1", "r4mkii"]);
  const [selectedAngles, setSelectedAngles] = useState(["burn_ban", "skeptic", "heat"]);
  const platform = PLATFORMS[0];
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [copyCount, setCopyCount] = useState(10);
  const [customContext, setCustomContext] = useState("");
  const [variations, setVariations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("welcome");
  const [filterAngle, setFilterAngle] = useState("all");
  const [filterProduct, setFilterProduct] = useState("all");
  const [videoText, setVideoText] = useState(null);
  const [imageText, setImageText] = useState(null);
  const [editorSessionId, setEditorSessionId] = useState(null);
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('howl_favorites') || '[]'); }
    catch { return []; }
  });
  const [appAccess, setAppAccess] = useState({ role: 'viewer', permissions: [] });
  const [accessLoaded, setAccessLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/app-context')
      .then(response => response.ok ? response.json() : Promise.reject(new Error('access unavailable')))
      .then(data => {
        setAppAccess(data);
        setAccessLoaded(true);
      })
      .catch(() => {
        if (import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === 'true') {
          setAppAccess({ role: 'owner', permissions: ['*'] });
          setAccessLoaded(true);
        }
      });
  }, []);

  const can = useCallback((permission) => (
    appAccess.permissions?.includes('*') || appAccess.permissions?.includes(permission)
  ), [appAccess.permissions]);

  // ── Cart state (IndexedDB-backed) ─────────────────────────────────────────
  const [cart, setCart] = useState([]);

  useEffect(() => {
    cartGetAll().then(items => setCart(items.sort((a, b) => b.id - a.id))).catch(() => {});
  }, []);

  const addToCart = useCallback(async (item) => {
    try {
      await cartPut(item);
      setCart(prev => [item, ...prev.filter(x => x.id !== item.id)]);
    } catch (err) {
      console.error('Cart save failed:', err);
    }
  }, []);

  const updateCartItem = useCallback(async (id, patch) => {
    setCart(prev => {
      const next = prev.map(x => x.id === id ? { ...x, ...patch } : x);
      const updated = next.find(x => x.id === id);
      if (updated) cartPut(updated).catch(() => {});
      return next;
    });
  }, []);

  const removeCartItem = useCallback(async (id) => {
    try {
      await cartDelete(id);
      setCart(prev => prev.filter(x => x.id !== id));
    } catch (err) {
      console.error('Cart remove failed:', err);
    }
  }, []);

  const toggleFavorite = useCallback((variation) => {
    setFavorites(prev => {
      const key = `${variation.product}__${variation.hook}`;
      const exists = prev.some(f => `${f.product}__${f.hook}` === key);
      const next = exists
        ? prev.filter(f => `${f.product}__${f.hook}` !== key)
        : [{ ...variation, savedAt: Date.now() }, ...prev].slice(0, 50);
      try { localStorage.setItem('howl_favorites', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const handleUseInVideo = useCallback((variation) => {
    setVideoText(variation.hook);
    setActiveTab('video');
  }, []);

  const handleUseOnImage = useCallback((variation) => {
    setImageText(variation.hook);
    setActiveTab('image');
  }, []);

  const openEditorSession = useCallback((sessionId) => {
    setEditorSessionId(Number(sessionId) || null);
    setActiveTab('ugc-editor');
  }, []);
  const clearInitialEditorSession = useCallback(() => setEditorSessionId(null), []);

  const toggleProduct = (id) => setSelectedProducts((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const toggleAngle = (id) => setSelectedAngles((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  const generate = async () => {
    if (selectedProducts.length === 0 || selectedAngles.length === 0) {
      setError("Select at least one product and one angle.");
      return;
    }
    setLoading(true);
    setError("");
    setVariations([]);
    const products = PRODUCTS.filter((p) => selectedProducts.includes(p.id));
    const angles = ANGLES.filter((a) => selectedAngles.includes(a.id));
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          system: buildSystemPrompt(),
          messages: [{ role: "user", content: buildUserPrompt(products, angles, platform, selectedAvatar, copyCount, customContext) }],
        }),
      });
      const data = await response.json();
      const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      const cleaned = text.replace(/```json|```/g, "").trim();
      setVariations(JSON.parse(cleaned));
      setActiveTab("results");
    } catch (err) {
      console.error(err);
      setError("Generation failed. Try again or reduce variation count.");
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (variations.length === 0) return;
    const keys = Object.keys(variations[0]);
    const header = keys.join(",");
    const rows = variations.map((v) => keys.map((k) => `"${(v[k] || "").replace(/"/g, '""')}"`).join(","));
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `howl_variations_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = variations.filter((v) => {
    if (filterAngle !== "all" && v.angle !== filterAngle) return false;
    if (filterProduct !== "all" && v.product !== filterProduct) return false;
    return true;
  });

  const uniqueAngles = [...new Set(variations.map((v) => v.angle))];
  const uniqueProducts = [...new Set(variations.map((v) => v.product))];
  const cartCount = cart.length;

  if (accessLoaded && !appAccess.user && appAccess.role === 'uninvited') {
    return (
      <div className="access-denied">
        <img src="/logos/howl-horizontal-wht.png" alt="HOWL Campfires" />
        <span className="workspace-kicker">Access required</span>
        <h1>This HOWL workspace is invite-only.</h1>
        <p>Ask a workspace owner to invite your email address from Admin.</p>
        <UserButton afterSignOutUrl="/" />
      </div>
    );
  }

  // UGC Inbox waiting count — single Drive call, refreshed on app mount and when leaving the UGC tab.
  const [ugcCount, setUgcCount] = useState(0);
  const refreshUgcCount = useCallback(async () => {
    try {
      const r = await fetch('/api/drive/ugc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'count' }),
      });
      const d = await r.json();
      if (typeof d.count === 'number') setUgcCount(d.count);
    } catch {}
  }, []);
  useEffect(() => { refreshUgcCount(); }, [refreshUgcCount]);
  useEffect(() => {
    // Refetch when user navigates away from the UGC tab (likely after launching some files).
    if (activeTab !== 'ugc') refreshUgcCount();
  }, [activeTab, refreshUgcCount]);

  const NAV = [
    { key: 'welcome', label: 'Home' },
    { key: 'creators', label: 'Creators', hidden: !can('creators.read') },
    { key: 'creative', label: 'Creative', hidden: !can('briefs.write') && !can('assets.write'), match: ['creative', 'config', 'from-winners', 'results', 'image', 'callout', 'review', 'video', 'founder', 'ugc-editor'] },
    { key: 'launcher', label: 'Launch', hidden: !can('launch.write'), count: (ugcCount + cartCount) || null, match: ['launcher', 'gallery', 'publish'] },
    { key: 'performance', label: 'Performance', hidden: !can('analytics.read'), matchPrefix: 'dashboard-', match: ['performance', 'creative-analytics', 'inventory', 'log'] },
    { key: 'admin', label: 'Admin', hidden: !can('admin.users') },
  ].filter(item => !item.hidden);

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#f0f4f8", fontFamily: "'JetBrains Mono', 'SF Mono', monospace" }}>
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar-top">
            <img src="/logos/howl-horizontal-wht.png" alt="HOWL Campfires" />
            <div className="sidebar-sub">The Campfire</div>
          </div>
          <nav className="side-nav">
            <div className="sidebar-section">Workspace</div>
            {NAV.map(item => {
              const isActive = item.matchPrefix && activeTab.startsWith(item.matchPrefix)
                || item.match?.includes(activeTab)
                || activeTab === item.key;
              return (
                <button key={item.key} className={`side-item ${isActive ? 'on' : ''}`} onClick={() => setActiveTab(item.key)}>
                  <span>{item.label}</span>
                  {item.count ? <span className="count">{item.count > 99 ? '99+' : item.count}</span> : null}
                </button>
              );
            })}
          </nav>
          <div className="sidebar-foot">
            <UserButton
              afterSignOutUrl="/"
              appearance={{
                variables: { colorPrimary: '#DC440A', colorBackground: '#0d1117', colorText: '#f0f4f8' },
                elements: { userButtonAvatarBox: { width: 26, height: 26 } },
              }}
            />
            <span className="acct-lbl">{appAccess.role || 'Account'}</span>
          </div>
        </aside>

        <main className="main-panel">
      {activeTab === "welcome" && <WelcomeScreen setActiveTab={setActiveTab} can={can} />}

      {activeTab === "config" && (
        <ConfigPanel
          selectedProducts={selectedProducts} toggleProduct={toggleProduct}
          selectedAngles={selectedAngles} toggleAngle={toggleAngle}
          selectedAvatar={selectedAvatar} setSelectedAvatar={setSelectedAvatar}
          copyCount={copyCount} setCopyCount={setCopyCount}
          customContext={customContext} setCustomContext={setCustomContext}
          loading={loading} error={error} generate={generate}
        />
      )}

      {activeTab === "results" && variations.length > 0 && (
        <ResultsPanel
          variations={variations} filtered={filtered} platform={platform}
          uniqueAngles={uniqueAngles} uniqueProducts={uniqueProducts}
          filterAngle={filterAngle} setFilterAngle={setFilterAngle}
          filterProduct={filterProduct} setFilterProduct={setFilterProduct}
          exportCSV={exportCSV} setActiveTab={setActiveTab} generate={generate}
          onUseInVideo={handleUseInVideo} onUseOnImage={handleUseOnImage}
          favorites={favorites} toggleFavorite={toggleFavorite}
        />
      )}

      <Suspense fallback={<TabFallback />}>
        {activeTab === "creators" && (
          <CreatorWorkspace
            canManageCreators={can('creators.write')}
            canWriteBriefs={can('briefs.write')}
            canWriteAssets={can('assets.write')}
            onOpenEditor={openEditorSession}
          />
        )}
        {activeTab === "creative" && <WorkspaceHub type="creative" setActiveTab={setActiveTab} can={can} />}
        {activeTab === "performance" && <WorkspaceHub type="performance" setActiveTab={setActiveTab} can={can} />}
        {activeTab === "admin" && can('admin.users') && <AdminWorkspace onOpenEditor={openEditorSession} />}
        {activeTab === "from-winners" && <FromWinnersTool setActiveTab={setActiveTab} setVariations={setVariations} />}
        {activeTab === "image" && <ImageAdTool initialText={imageText} onTextConsumed={() => setImageText(null)} driveAuth={driveAuth} onAddToCart={addToCart} />}
        {activeTab === "callout" && <CalloutAdTool onAddToCart={addToCart} />}
        {activeTab === "review" && <ReviewAdTool driveAuth={driveAuth} onAddToCart={addToCart} />}
        {activeTab === "video" && <VideoAdTool initialText={videoText} onTextConsumed={() => setVideoText(null)} onAddToCart={addToCart} />}
        {activeTab === "founder" && <FounderAdTool />}
        {activeTab === "gallery" && <GalleryTab cart={cart} />}
        {activeTab === "dashboard-cfo" && <DashboardTool setActiveTab={setActiveTab} view="cfo" />}
        {activeTab === "dashboard-meta" && <DashboardTool setActiveTab={setActiveTab} view="meta" />}
        {activeTab === "dashboard-shopify" && <DashboardTool setActiveTab={setActiveTab} view="shopify" />}
        {activeTab === "dashboard-creative" && <DashboardTool setActiveTab={setActiveTab} view="creative" />}
        {activeTab === "creative-analytics" && <DashboardTool setActiveTab={setActiveTab} view="creative" />}
        {activeTab === "dashboard-forecast" && <DashboardTool setActiveTab={setActiveTab} view="forecast" />}
        {activeTab === "inventory" && <InventoryTool />}
        {activeTab === "log" && <LaunchLogTool />}
        {activeTab === "ugc-editor" && (
          <UgcEditorTool
            initialSessionId={editorSessionId}
            onInitialSessionLoaded={clearInitialEditorSession}
            onAddToCart={addToCart}
          />
        )}
        {activeTab === "launcher" && (
          <LauncherTool
            cart={cart}
            onAddToCart={addToCart}
            onUpdateCartItem={updateCartItem}
            onRemoveCartItem={removeCartItem}
          />
        )}
        {/* Legacy publish tool kept reachable at /?tab=publish for the
            Creative Test workflow until that's folded into Launcher. */}
        {activeTab === "publish" && (
          <MetaPublishTool
            cart={cart}
            onAddToCart={addToCart}
            onUpdateCartItem={updateCartItem}
            onRemoveCartItem={removeCartItem}
          />
        )}
      </Suspense>
        </main>
      </div>
      <FeedbackWidget />
    </div>
  );
}
