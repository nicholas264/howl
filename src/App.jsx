import React, { useState, useCallback, useEffect, useMemo, Suspense, lazy } from "react";
import { UserButton } from "@clerk/clerk-react";
// Always-visible shell components stay eagerly imported.
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
const LaunchLogTool = lazy(() => import("./components/LaunchLogTool"));
const UgcEditorTool = lazy(() => import("./components/UgcEditorTool"));
const GalleryTab = lazy(() => import("./components/GalleryTab"));
const FromWinnersTool = lazy(() => import("./components/FromWinnersTool"));
const LauncherTool = lazy(() => import("./components/LauncherTool"));
const CreatorWorkspace = lazy(() => import("./components/CreatorWorkspace"));
const CreatorPipelineFunnel = lazy(() => import("./components/CreatorPipelineFunnel"));
const SeedingLedger = lazy(() => import("./components/SeedingLedger"));
const CreativeFlowBoard = lazy(() => import("./components/CreativeFlowBoard"));
const CreativePlanningWorkspace = lazy(() => import("./components/CreativePlanningWorkspace"));
const CreatorCampaignPlanner = lazy(() => import("./components/CreatorCampaignPlanner"));
const AdminWorkspace = lazy(() => import("./components/AdminWorkspace"));
const WorkspaceHub = lazy(() => import("./components/WorkspaceHub"));
import { useDriveAuth } from "./hooks/useDriveAuth";
import { cartGetAll, cartPut, cartDelete } from "./utils/cartDb";
import "./styles.css";

const TabFallback = () => (
  <div style={{ padding: 32, color: '#77746f', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>
    Loading…
  </div>
);

export default function HowlAdEngine({ appAccess }) {
  const driveAuth = useDriveAuth();
  const [variations, setVariations] = useState([]);
  const [activeTab, setActiveTab] = useState("welcome");
  const [filterAngle, setFilterAngle] = useState("all");
  const [filterProduct, setFilterProduct] = useState("all");
  const [videoText, setVideoText] = useState(null);
  const [imageText, setImageText] = useState(null);
  const [editorSessionId, setEditorSessionId] = useState(null);
  const [plannedCreatorId, setPlannedCreatorId] = useState(null);
  const [plannedCreatorTab, setPlannedCreatorTab] = useState(null);
  const [plannedCreatorView, setPlannedCreatorView] = useState(null);
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('howl_favorites') || '[]'); }
    catch { return []; }
  });
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
    setActiveTab(can('assets.write') ? 'video' : 'welcome');
  }, [can]);

  const handleUseOnImage = useCallback((variation) => {
    setImageText(variation.hook);
    setActiveTab(can('assets.write') ? 'image' : 'welcome');
  }, [can]);

  const clearInitialEditorSession = useCallback(() => setEditorSessionId(null), []);

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
    // Refetch when user navigates away from the launcher (likely after launching some files).
    if (activeTab !== 'launcher') refreshUgcCount();
  }, [activeTab, refreshUgcCount]);

  const NAV_SECTIONS = [
    {
      label: 'Workspace',
      items: [
        { key: 'welcome', label: 'Home' },
        { key: 'creators', label: 'Creators', permission: 'creators.read' },
        { key: 'campaign-planner', label: 'Campaign Planner', permission: 'briefs.write' },
        { key: 'creative-plan', label: 'Creative Forecast', permission: 'creators.read' },
      ],
    },
    {
      label: 'Creative',
      items: [
        { key: 'creative-flow', label: 'Flow', permission: 'creators.read' },
        { key: 'creative-pipeline', label: 'Pipeline', permission: 'creators.read' },
        { key: 'seeding-ledger', label: 'Seeding', permission: 'creators.read' },
        { key: 'creative-analytics', label: 'Creative Analytics', permission: 'analytics.read' },
        { key: 'from-winners', label: 'Concept Studio', permission: 'briefs.write' },
        { key: 'ugc-editor', label: 'UGC Editor', permission: 'assets.write' },
        { key: 'image', label: 'Image Ads', permission: 'assets.write' },
        { key: 'callout', label: 'Callout Ads', permission: 'assets.write' },
        { key: 'review', label: 'Review Ads', permission: 'assets.write' },
        { key: 'video', label: 'Video Ads', permission: 'assets.write' },
        { key: 'founder', label: 'Founder Ads', permission: 'assets.write' },
      ],
    },
    {
      label: 'Launch',
      items: [
        {
          key: 'launcher',
          label: 'Launcher',
          permission: 'launch.write',
          count: (ugcCount + cartCount) || null,
          match: ['launcher', 'gallery', 'publish'],
        },
      ],
    },
    {
      label: 'Performance',
      items: [
        { key: 'dashboard-cfo', label: 'Dashboard', permission: 'analytics.read' },
        { key: 'dashboard-forecast', label: 'Forecast', permission: 'analytics.read' },
        { key: 'dashboard-meta', label: 'Meta', permission: 'analytics.read' },
        { key: 'dashboard-shopify', label: 'Shopify', permission: 'analytics.read' },
        { key: 'log', label: 'Launch Log', permission: 'launch.read' },
      ],
    },
    {
      label: 'System',
      items: [
        { key: 'admin', label: 'Admin', permission: 'admin.users' },
      ],
    },
  ].map(section => ({
    ...section,
    items: section.items.filter(item => !item.permission || can(item.permission)),
  })).filter(section => section.items.length);

  const allowedTabs = useMemo(() => {
    const tabs = new Set(['welcome']);
    NAV_SECTIONS.forEach(section => section.items.forEach(item => tabs.add(item.key)));
    if (can('briefs.write') || can('assets.write') || can('analytics.read')) tabs.add('creative');
    if (can('analytics.read') || can('launch.read')) tabs.add('performance');
    if (can('analytics.read')) tabs.add('dashboard-creative');
    if (can('assets.write')) tabs.add('gallery');
    if (can('launch.write')) tabs.add('publish');
    if (can('briefs.write')) tabs.add('results');
    return tabs;
  }, [NAV_SECTIONS, can, variations.length]);

  const navigate = useCallback((tab) => {
    setActiveTab(allowedTabs.has(tab) ? tab : 'welcome');
  }, [allowedTabs]);

  useEffect(() => {
    if (!allowedTabs.has(activeTab)) setActiveTab('welcome');
  }, [activeTab, allowedTabs]);

  const openEditorSession = useCallback((sessionId) => {
    setEditorSessionId(Number(sessionId) || null);
    navigate('ugc-editor');
  }, [navigate]);
  const openPlannedCreator = useCallback((creatorId, detailTab = 'profile') => {
    setPlannedCreatorId(Number(creatorId) || null);
    setPlannedCreatorTab(detailTab || 'profile');
    navigate('creators');
  }, [navigate]);
  const openCreatorWorkspace = useCallback((view = 'operations') => {
    setPlannedCreatorView(view);
    navigate('creators');
  }, [navigate]);

  return (
    <div className="app-shell" style={{ minHeight: "100vh", background: "#f7f6f2", color: "#171717", fontFamily: "'Helvetica Neue', Helvetica, sans-serif" }}>
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar-top">
            <img src="/logos/howl-horizontal-wht.png" alt="HOWL Campfires" />
          </div>
          <nav className="side-nav">
            {NAV_SECTIONS.map(section => (
              <div className="sidebar-nav-group" key={section.label}>
                <div className="sidebar-section">{section.label}</div>
                {section.items.map(item => {
                  const isActive = item.match?.includes(activeTab) || activeTab === item.key;
                  return (
                    <button key={item.key} className={`side-item ${isActive ? 'on' : ''}`} onClick={() => navigate(item.key)}>
                      <span>{item.label}</span>
                      {item.count ? <span className="count">{item.count > 99 ? '99+' : item.count}</span> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="sidebar-foot">
            <UserButton
              afterSignOutUrl="/"
              appearance={{
                variables: { colorPrimary: '#d84a17', colorBackground: '#fff', colorText: '#171717' },
                elements: { userButtonAvatarBox: { width: 26, height: 26 } },
              }}
            />
            <span className="acct-lbl">{appAccess.role || 'Account'}</span>
          </div>
        </aside>

        <main className="main-panel">
      {activeTab === "welcome" && <WelcomeScreen setActiveTab={navigate} can={can} openCreatorWorkspace={openCreatorWorkspace} />}

      {activeTab === "results" && (
        variations.length > 0 ? (
          <ResultsPanel
            variations={variations} filtered={filtered}
            uniqueAngles={uniqueAngles} uniqueProducts={uniqueProducts}
            filterAngle={filterAngle} setFilterAngle={setFilterAngle}
            filterProduct={filterProduct} setFilterProduct={setFilterProduct}
            exportCSV={exportCSV} setActiveTab={navigate}
            onUseInVideo={handleUseInVideo} onUseOnImage={handleUseOnImage}
            favorites={favorites} toggleFavorite={toggleFavorite}
          />
        ) : (
          <div className="workspace-empty">
            <strong>No generated concepts yet.</strong>
            <p>Generate concepts from the Concept Studio, then this results workspace will stay available for review, favorites, and exports.</p>
            <button type="button" className="primary-action" onClick={() => navigate('from-winners')}>Open Concept Studio</button>
          </div>
        )
      )}

      <Suspense fallback={<TabFallback />}>
        {activeTab === "creators" && (
          <CreatorWorkspace
            canManageCreators={can('creators.write')}
            canMergeCreators={can('admin.users')}
            canWriteBriefs={can('briefs.write')}
            canWriteAssets={can('assets.write')}
            onOpenEditor={openEditorSession}
            initialCreatorId={plannedCreatorId}
            initialCreatorTab={plannedCreatorTab}
            initialWorkspaceView={plannedCreatorView}
            onInitialCreatorLoaded={() => {
              setPlannedCreatorId(null);
              setPlannedCreatorTab(null);
            }}
            onInitialWorkspaceViewLoaded={() => setPlannedCreatorView(null)}
            setActiveTab={navigate}
          />
        )}
        {activeTab === "creative-flow" && <CreativeFlowBoard setActiveTab={navigate} onOpenCreator={openPlannedCreator} canManage={can('creators.write')} />}
        {activeTab === "creative-pipeline" && <CreatorPipelineFunnel />}
        {activeTab === "seeding-ledger" && <SeedingLedger canManage={can('creators.write')} />}
        {activeTab === "creative-plan" && <CreativePlanningWorkspace onOpenCreator={openPlannedCreator} />}
        {activeTab === "campaign-planner" && <CreatorCampaignPlanner onOpenCreator={openPlannedCreator} />}
        {activeTab === "creative" && <WorkspaceHub type="creative" setActiveTab={navigate} can={can} />}
        {activeTab === "performance" && <WorkspaceHub type="performance" setActiveTab={navigate} can={can} />}
        {activeTab === "admin" && can('admin.users') && <AdminWorkspace onOpenEditor={openEditorSession} />}
        {activeTab === "from-winners" && <FromWinnersTool setActiveTab={navigate} setVariations={setVariations} onOpenCreator={openPlannedCreator} />}
        {activeTab === "image" && <ImageAdTool initialText={imageText} onTextConsumed={() => setImageText(null)} driveAuth={driveAuth} onAddToCart={addToCart} />}
        {activeTab === "callout" && <CalloutAdTool onAddToCart={addToCart} />}
        {activeTab === "review" && <ReviewAdTool driveAuth={driveAuth} onAddToCart={addToCart} />}
        {activeTab === "video" && <VideoAdTool initialText={videoText} onTextConsumed={() => setVideoText(null)} onAddToCart={addToCart} />}
        {activeTab === "founder" && <FounderAdTool />}
        {activeTab === "gallery" && <GalleryTab cart={cart} />}
        {activeTab === "dashboard-cfo" && <DashboardTool setActiveTab={navigate} view="cfo" />}
        {activeTab === "dashboard-meta" && <DashboardTool setActiveTab={navigate} view="meta" />}
        {activeTab === "dashboard-shopify" && <DashboardTool setActiveTab={navigate} view="shopify" />}
        {activeTab === "dashboard-creative" && <DashboardTool setActiveTab={navigate} view="creative" canManageCreators={can('creators.write')} />}
        {activeTab === "creative-analytics" && <DashboardTool setActiveTab={navigate} view="creative" canManageCreators={can('creators.write')} />}
        {activeTab === "dashboard-forecast" && <DashboardTool setActiveTab={navigate} view="forecast" />}
        {activeTab === "log" && <LaunchLogTool />}
        {activeTab === "ugc-editor" && (
          <UgcEditorTool
            initialSessionId={editorSessionId}
            onInitialSessionLoaded={clearInitialEditorSession}
            onAddToCart={addToCart}
            onNavigate={navigate}
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
