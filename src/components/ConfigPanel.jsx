import { PRODUCTS, ANGLES, AVATARS, COPY_COUNT_OPTIONS } from '../data';

export default function ConfigPanel({
  selectedProducts, toggleProduct,
  selectedAngles, toggleAngle,
  selectedAvatar, setSelectedAvatar,
  copyCount, setCopyCount,
  customContext, setCustomContext,
  loading, error, generate,
}) {

  return (
    <div className="body">
      {error && <div className="err">{error}</div>}

      <div className="sect">
        <div className="slbl">Products</div>
        <div className="chips">
          {PRODUCTS.map((p) => (
            <div key={p.id} className={`chip ${selectedProducts.includes(p.id) ? "on" : ""}`} onClick={() => toggleProduct(p.id)}>
              <strong>{p.name}</strong> — {p.price}
              <span className="chip-sub">{p.subtitle}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sect">
        <div className="slbl">Creative Angles (from 938 reviews)</div>
        <div className="agrid">
          {ANGLES.map((a) => (
            <div key={a.id} className={`acard ${selectedAngles.includes(a.id) ? "on" : ""}`} onClick={() => toggleAngle(a.id)}>
              <div className="em">{a.icon}</div>
              <div className="nm">{a.label}</div>
              <div className="ds">{a.desc}</div>
              <div className="fn">{a.funnel}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="sect">
        <div className="slbl">Target Avatar (optional)</div>
        <div className="avgrid">
          <div className={`avcard ${selectedAvatar === null ? "on" : ""}`} onClick={() => setSelectedAvatar(null)}>
            All audiences
            <div className="avd">No specific persona targeting</div>
          </div>
          {AVATARS.map((a) => (
            <div key={a.id} className={`avcard ${selectedAvatar === a.id ? "on" : ""}`} onClick={() => setSelectedAvatar(a.id)}>
              {a.label}
              <div className="avd">{a.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="sect">
        <div className="slbl">Variations</div>
        <div className="chips">
          {COPY_COUNT_OPTIONS.map((n) => (
            <button key={n} className={`cntbtn ${copyCount === n ? "on" : ""}`} onClick={() => setCopyCount(n)}>{n}</button>
          ))}
        </div>
      </div>

      <div className="sect">
        <div className="slbl">Additional Context (optional)</div>
        <textarea className="ta" placeholder="e.g. We're running a Memorial Day sale... Focus on the R4 MKii upgrade... Target ski bums in Colorado..." value={customContext} onChange={(e) => setCustomContext(e.target.value)} />
      </div>

      <button className="gobtn" onClick={generate} disabled={loading || selectedProducts.length === 0 || selectedAngles.length === 0}>
        {loading ? "Generating..." : `Generate ${copyCount} Variations`}
      </button>
      {loading && <div className="ldg"><span className="spin" /> Claude is writing your ad copy using real customer language...</div>}
    </div>
  );
}
