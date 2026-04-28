import React, { useState, useCallback, useEffect } from "react";
import { UserButton } from "@clerk/clerk-react";
import { PRODUCTS, ANGLES, PLATFORMS } from "./data";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import ConfigPanel from "./components/ConfigPanel";
import ResultsPanel from "./components/ResultsPanel";
import ReviewAdTool from "./components/ReviewAdTool";
import VideoAdTool from "./components/VideoAdTool";
import ImageAdTool from "./components/ImageAdTool";
import FounderAdTool from "./components/FounderAdTool";
import MetaPublishTool from "./components/MetaPublishTool";
import DashboardTool from "./components/DashboardTool";
import WelcomeScreen from "./components/WelcomeScreen";
import LaunchLogTool from "./components/LaunchLogTool";
import UgcInboxTool from "./components/UgcInboxTool";
import GalleryTab from "./components/GalleryTab";
import { useDriveAuth } from "./hooks/useDriveAuth";
import { cartGetAll, cartPut, cartDelete } from "./utils/cartDb";
import "./styles.css";

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
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('howl_favorites') || '[]'); }
    catch { return []; }
  });

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

  const NAV = [
    { group: 'Home', items: [
      { key: 'welcome', label: 'Campfire' },
    ]},
    { group: 'Generate', items: [
      { key: 'config', label: 'Configure' },
      { key: 'results', label: 'Results', disabled: variations.length === 0, count: variations.length || null },
    ]},
    { group: 'Create', items: [
      { key: 'image', label: 'Image Ads' },
      { key: 'review', label: 'Review Ads' },
      { key: 'video', label: 'Video Ads' },
      { key: 'founder', label: 'Founder Ads' },
    ]},
    { group: 'Launch', items: [
      { key: 'ugc', label: 'UGC Inbox' },
      { key: 'gallery', label: 'Gallery', count: cartCount || null },
      { key: 'publish', label: 'Publish', count: cartCount || null },
    ]},
    { group: 'Insights', items: [
      { key: 'dashboard-cfo',      label: 'Dashboard',         parent: true },
      { key: 'dashboard-cfo',      label: 'CFO View',          indent: true },
      { key: 'dashboard-meta',     label: 'Meta',              indent: true },
      { key: 'dashboard-shopify',  label: 'Shopify',           indent: true },
      { key: 'dashboard-creative', label: 'Creative',          indent: true },
      { key: 'dashboard-forecast', label: 'Forecast',          indent: true },
      { key: 'log', label: 'Launch Log' },
    ]},
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#f0f4f8", fontFamily: "'JetBrains Mono', 'SF Mono', monospace" }}>
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar-top">
            <img src="/logos/howl-horizontal-wht.png" alt="HOWL Campfires" />
            <div className="sidebar-sub">The Campfire</div>
          </div>
          <nav className="side-nav">
            {NAV.map(group => (
              <React.Fragment key={group.group}>
                <div className="sidebar-section">{group.group}</div>
                {group.items.map((item, idx) => (
                  item.parent ? (
                    <div key={`${item.label}-${idx}`} className="side-parent">{item.label}</div>
                  ) : (
                    <button
                      key={`${item.key}-${idx}`}
                      className={`side-item ${item.indent ? 'indent' : ''} ${activeTab === item.key ? 'on' : ''}`}
                      onClick={() => setActiveTab(item.key)}
                      disabled={item.disabled}
                    >
                      <span>{item.label}</span>
                      {item.count ? <span className="count">{item.count > 99 ? '99+' : item.count}</span> : null}
                    </button>
                  )
                ))}
              </React.Fragment>
            ))}
          </nav>
          <div style={{ padding: '14px 16px', borderTop: '1px solid #2a3441', display: 'flex', alignItems: 'center', gap: 10 }}>
            <UserButton
              afterSignOutUrl="/"
              appearance={{
                variables: { colorPrimary: '#DC440A', colorBackground: '#0d1117', colorText: '#f0f4f8' },
                elements: { userButtonAvatarBox: { width: 28, height: 28 } },
              }}
            />
            <span style={{ fontSize: 10, color: '#6e7681', letterSpacing: 1, textTransform: 'uppercase' }}>Account</span>
          </div>
        </aside>

        <main className="main-panel">
      {activeTab === "welcome" && <WelcomeScreen setActiveTab={setActiveTab} />}

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

      {activeTab === "image" && <ImageAdTool initialText={imageText} onTextConsumed={() => setImageText(null)} driveAuth={driveAuth} onAddToCart={addToCart} />}
      {activeTab === "review" && <ReviewAdTool driveAuth={driveAuth} onAddToCart={addToCart} />}
      {activeTab === "video" && <VideoAdTool initialText={videoText} onTextConsumed={() => setVideoText(null)} onAddToCart={addToCart} />}
      {activeTab === "founder" && <FounderAdTool />}
      {activeTab === "gallery" && <GalleryTab cart={cart} />}
      {activeTab === "dashboard-cfo" && <DashboardTool view="cfo" />}
      {activeTab === "dashboard-meta" && <DashboardTool view="meta" />}
      {activeTab === "dashboard-shopify" && <DashboardTool view="shopify" />}
      {activeTab === "dashboard-creative" && <DashboardTool view="creative" />}
      {activeTab === "dashboard-forecast" && <DashboardTool view="forecast" />}
      {activeTab === "log" && <LaunchLogTool />}
      {activeTab === "ugc" && <UgcInboxTool />}
      {activeTab === "publish" && (
        <MetaPublishTool
          cart={cart}
          onAddToCart={addToCart}
          onUpdateCartItem={updateCartItem}
          onRemoveCartItem={removeCartItem}
        />
      )}
        </main>
      </div>
    </div>
  );
}
