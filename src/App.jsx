import { useState } from "react";
import { PRODUCTS, ANGLES, PLATFORMS } from "./data";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import ConfigPanel from "./components/ConfigPanel";
import ResultsPanel from "./components/ResultsPanel";
import StaticEditor from "./components/StaticEditor";
import "./styles.css";

export default function HowlAdEngine() {
  const [selectedProducts, setSelectedProducts] = useState(["r1", "r4mkii"]);
  const [selectedAngles, setSelectedAngles] = useState(["burn_ban", "skeptic", "heat"]);
  const [selectedPlatform, setSelectedPlatform] = useState("meta");
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [copyCount, setCopyCount] = useState(10);
  const [customContext, setCustomContext] = useState("");
  const [variations, setVariations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("config");
  const [filterAngle, setFilterAngle] = useState("all");
  const [filterProduct, setFilterProduct] = useState("all");
  const [productPhoto, setProductPhoto] = useState(null);
  const [staticVariation, setStaticVariation] = useState(null);

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
    const platform = PLATFORMS.find((p) => p.id === selectedPlatform);

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
      const parsed = JSON.parse(cleaned);
      setVariations(parsed);
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

  const platform = PLATFORMS.find((p) => p.id === selectedPlatform);
  const uniqueAngles = [...new Set(variations.map((v) => v.angle))];
  const uniqueProducts = [...new Set(variations.map((v) => v.product))];

  return (
    <div style={{ minHeight: "100vh", background: "#09090b", color: "#e4dfd6", fontFamily: "'JetBrains Mono', 'SF Mono', monospace" }}>
      <div className="hd">
        <div className="hd-logo"><b>HOWL</b> / Ad Engine</div>
        <div className="hd-sub">938 Reviews × Claude</div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === "config" ? "on" : ""}`} onClick={() => setActiveTab("config")}>Configure</button>
        <button className={`tab ${activeTab === "results" ? "on" : ""}`} onClick={() => setActiveTab("results")} disabled={variations.length === 0}>
          Results {variations.length > 0 && `(${variations.length})`}
        </button>
      </div>

      {activeTab === "config" && (
        <ConfigPanel
          selectedProducts={selectedProducts} toggleProduct={toggleProduct}
          selectedPlatform={selectedPlatform} setSelectedPlatform={setSelectedPlatform}
          selectedAngles={selectedAngles} toggleAngle={toggleAngle}
          selectedAvatar={selectedAvatar} setSelectedAvatar={setSelectedAvatar}
          copyCount={copyCount} setCopyCount={setCopyCount}
          customContext={customContext} setCustomContext={setCustomContext}
          productPhoto={productPhoto} onPhotoChange={setProductPhoto}
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
          productPhoto={productPhoto} onCreateStatic={setStaticVariation}
        />
      )}

      {staticVariation && (
        <StaticEditor
          variation={staticVariation}
          photoUrl={productPhoto}
          onClose={() => setStaticVariation(null)}
        />
      )}
    </div>
  );
}
