export default function ResultsPanel({
  variations, filtered, platform, uniqueAngles, uniqueProducts,
  filterAngle, setFilterAngle, filterProduct, setFilterProduct,
  exportCSV, setActiveTab, generate, hasSavedImages, onCreateStatic,
}) {
  return (
    <div className="body">
      <div className="srow">
        <div className="sbox"><div className="sv">{variations.length}</div><div className="sl">Variations</div></div>
        <div className="sbox"><div className="sv">{uniqueAngles.length}</div><div className="sl">Angles</div></div>
        <div className="sbox"><div className="sv">{uniqueProducts.length}</div><div className="sl">Products</div></div>
        <div className="sbox"><div className="sv">{platform.label}</div><div className="sl">Platform</div></div>
      </div>

      <div className="rhead">
        <div className="filters">
          <span style={{ fontSize: 9, letterSpacing: 2, color: "#8a8270", textTransform: "uppercase", marginRight: 4 }}>Filter:</span>
          <button className={`fbtn ${filterAngle === "all" ? "on" : ""}`} onClick={() => setFilterAngle("all")}>All Angles</button>
          {uniqueAngles.map((a) => (
            <button key={a} className={`fbtn ${filterAngle === a ? "on" : ""}`} onClick={() => setFilterAngle(a)}>{a}</button>
          ))}
          <span style={{ width: 1, height: 16, background: "#e0d9c4", display: "inline-block", margin: "0 4px" }} />
          <button className={`fbtn ${filterProduct === "all" ? "on" : ""}`} onClick={() => setFilterProduct("all")}>All Products</button>
          {uniqueProducts.map((p) => (
            <button key={p} className={`fbtn ${filterProduct === p ? "on" : ""}`} onClick={() => setFilterProduct(p)}>{p}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="xbtn" onClick={exportCSV}>Export CSV</button>
        </div>
      </div>

      <div className="rcnt">{filtered.length} of {variations.length} showing</div>

      <div className="cgrid" style={{ marginTop: 12 }}>
        {filtered.map((v, i) => (
          <div className="card" key={i}>
            <div className="cnum">#{String(i + 1).padStart(2, "0")}</div>
            <div className="cmeta">
              <span className="ctag prod">{v.product}</span>
              <span className="ctag">{v.angle}</span>
            </div>
            <div className="chl">{v.headline}</div>
            <div className="ccta">{v.cta} →</div>
            <button
              className="static-btn"
              onClick={() => onCreateStatic(v)}
            >
              {hasSavedImages ? 'Create Static Ad' : 'Create Static Ad ↗'}
            </button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 28, display: "flex", gap: 10 }}>
        <button className="xbtn" onClick={exportCSV}>Export CSV</button>
        <button className="xbtn" onClick={() => setActiveTab("config")}>← Configure</button>
        <button className="xbtn" onClick={generate}>↻ Regenerate</button>
      </div>
    </div>
  );
}
