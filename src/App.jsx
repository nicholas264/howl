import { useState, useCallback, useEffect } from "react";
import { PRODUCTS, ANGLES, PLATFORMS } from "./data";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import ConfigPanel from "./components/ConfigPanel";
import ResultsPanel from "./components/ResultsPanel";
import ReviewAdTool from "./components/ReviewAdTool";
import VideoAdTool from "./components/VideoAdTool";
import ImageAdTool from "./components/ImageAdTool";
import FounderAdTool from "./components/FounderAdTool";
import MetaPublishTool from "./components/MetaPublishTool";
import DriveButton from "./components/DriveButton";
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
  const [activeTab, setActiveTab] = useState("config");
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

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#f0f4f8", fontFamily: "'JetBrains Mono', 'SF Mono', monospace" }}>
      <div className="hd">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <img src="/logos/howl-horizontal-wht.png" alt="HOWL Campfires" style={{ height: 32, width: 'auto', objectFit: 'contain' }} />
          <div className="hd-sub">Creative Studio</div>
        </div>
        <DriveButton connected={driveAuth.connected} connect={driveAuth.connect} disconnect={driveAuth.disconnect} />
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === "config" ? "on" : ""}`} onClick={() => setActiveTab("config")}>Configure</button>
        <button className={`tab ${activeTab === "results" ? "on" : ""}`} onClick={() => setActiveTab("results")} disabled={variations.length === 0}>
          Results {variations.length > 0 && `(${variations.length})`}
        </button>
        <button className={`tab ${activeTab === "image" ? "on" : ""}`} onClick={() => setActiveTab("image")}>Image Ads</button>
        <button className={`tab ${activeTab === "review" ? "on" : ""}`} onClick={() => setActiveTab("review")}>Review Ads</button>
        <button className={`tab ${activeTab === "video" ? "on" : ""}`} onClick={() => setActiveTab("video")}>Video Ads</button>
        <button className={`tab ${activeTab === "founder" ? "on" : ""}`} onClick={() => setActiveTab("founder")}>Founder Ads</button>
        <button className={`tab ${activeTab === "publish" ? "on" : ""}`} onClick={() => setActiveTab("publish")} style={{ position: 'relative' }}>
          Publish
          {cartCount > 0 && (
            <span style={{ position: 'absolute', top: 6, right: 6, background: '#DC440A', color: '#fff', borderRadius: '50%', width: 15, height: 15, fontSize: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, lineHeight: 1 }}>
              {cartCount > 99 ? '99+' : cartCount}
            </span>
          )}
        </button>
      </div>

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
      {activeTab === "publish" && (
        <MetaPublishTool
          cart={cart}
          onAddToCart={addToCart}
          onUpdateCartItem={updateCartItem}
          onRemoveCartItem={removeCartItem}
        />
      )}
    </div>
  );
}
