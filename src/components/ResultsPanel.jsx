import { useState } from 'react';

function isFavorited(variation, favorites) {
  const key = `${variation.product}__${variation.headline}`;
  return favorites.some(f => `${f.product}__${f.headline}` === key);
}

export default function ResultsPanel({
  variations, filtered, platform, uniqueAngles, uniqueProducts,
  filterAngle, setFilterAngle, filterProduct, setFilterProduct,
  exportCSV, setActiveTab, generate, hasSavedImages, onCreateStatic,
  favorites, toggleFavorite,
}) {
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const displayed = showFavoritesOnly
    ? favorites.filter(f => {
        if (filterAngle !== 'all' && f.angle !== filterAngle) return false;
        if (filterProduct !== 'all' && f.product !== filterProduct) return false;
        return true;
      })
    : filtered;

  const uniqueFavAngles = [...new Set(favorites.map(f => f.angle))];
  const uniqueFavProducts = [...new Set(favorites.map(f => f.product))];
  const angleOptions = showFavoritesOnly ? uniqueFavAngles : uniqueAngles;
  const productOptions = showFavoritesOnly ? uniqueFavProducts : uniqueProducts;

  return (
    <div className="body">
      <div className="srow">
        <div className="sbox"><div className="sv">{variations.length}</div><div className="sl">Variations</div></div>
        <div className="sbox"><div className="sv">{uniqueAngles.length}</div><div className="sl">Angles</div></div>
        <div className="sbox"><div className="sv">{uniqueProducts.length}</div><div className="sl">Products</div></div>
        <div className="sbox"><div className="sv">{platform.label}</div><div className="sl">Platform</div></div>
        <div className="sbox" style={{ cursor: 'pointer' }} onClick={() => setShowFavoritesOnly(v => !v)}>
          <div className="sv" style={{ color: showFavoritesOnly ? '#DC440A' : undefined }}>
            {favorites.length} {showFavoritesOnly ? '★' : '☆'}
          </div>
          <div className="sl">Saved</div>
        </div>
      </div>

      <div className="rhead">
        <div className="filters">
          <span style={{ fontSize: 9, letterSpacing: 2, color: "#8a8270", textTransform: "uppercase", marginRight: 4 }}>Filter:</span>
          <button className={`fbtn ${filterAngle === "all" ? "on" : ""}`} onClick={() => setFilterAngle("all")}>All Angles</button>
          {angleOptions.map((a) => (
            <button key={a} className={`fbtn ${filterAngle === a ? "on" : ""}`} onClick={() => setFilterAngle(a)}>{a}</button>
          ))}
          <span style={{ width: 1, height: 16, background: "#e0d9c4", display: "inline-block", margin: "0 4px" }} />
          <button className={`fbtn ${filterProduct === "all" ? "on" : ""}`} onClick={() => setFilterProduct("all")}>All Products</button>
          {productOptions.map((p) => (
            <button key={p} className={`fbtn ${filterProduct === p ? "on" : ""}`} onClick={() => setFilterProduct(p)}>{p}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className={`fbtn ${showFavoritesOnly ? 'on' : ''}`}
            onClick={() => setShowFavoritesOnly(v => !v)}
            style={{ color: showFavoritesOnly ? '#DC440A' : undefined }}
          >
            {showFavoritesOnly ? '★ Saved' : '☆ Saved'} ({favorites.length})
          </button>
          <button className="xbtn" onClick={exportCSV}>Export CSV</button>
        </div>
      </div>

      <div className="rcnt">
        {showFavoritesOnly
          ? `${displayed.length} saved variation${displayed.length !== 1 ? 's' : ''}`
          : `${displayed.length} of ${variations.length} showing`}
      </div>

      {displayed.length === 0 && showFavoritesOnly && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#8a8270', fontSize: 11 }}>
          No saved variations yet. Star ones you like to save them here.
        </div>
      )}

      <div className="cgrid" style={{ marginTop: 12 }}>
        {displayed.map((v, i) => {
          const faved = isFavorited(v, favorites);
          return (
            <div className="card" key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div className="cnum">#{String(i + 1).padStart(2, "0")}</div>
                <button
                  onClick={() => toggleFavorite(v)}
                  title={faved ? 'Remove from saved' : 'Save this variation'}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 18, color: faved ? '#DC440A' : '#c0b89a',
                    padding: '0 2px', lineHeight: 1,
                  }}
                >
                  {faved ? '★' : '☆'}
                </button>
              </div>
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
          );
        })}
      </div>

      <div style={{ marginTop: 28, display: "flex", gap: 10 }}>
        <button className="xbtn" onClick={exportCSV}>Export CSV</button>
        <button className="xbtn" onClick={() => setActiveTab("config")}>← Configure</button>
        {!showFavoritesOnly && <button className="xbtn" onClick={generate}>↻ Regenerate</button>}
      </div>
    </div>
  );
}
