import { apiFetch as fetch } from '../lib/apiFetch.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { uploadPublicBlob } from '../utils/blobUpload';

const STATUS_OPTIONS = [
  ['planned', 'Planned'],
  ['ordered', 'Ordered'],
  ['in_transit', 'In transit'],
  ['delivered', 'Delivered'],
  ['blocked', 'Blocked'],
];

const NICHE_OPTIONS = ['Overland', 'Offroad', 'Ski', 'MTB', 'Hunt', 'Fish', 'Van life', 'Jeep', 'Surf', 'Backyard'];
const PRODUCT_TYPE_OPTIONS = ['R1', 'R3', 'R4 MKii', 'R1 HaulBag', 'R3 HaulBag', 'Accessory', 'No product needed'];

const EMPTY_SEED_ITEM = {
  product_key: '',
  product_label: '',
  unit_type: '',
  quantity: '1',
  unit_cogs: '',
  shopify_product_id: '',
  shopify_variant_id: '',
};

const EMPTY_ADD = {
  creator_id: '',
  creator_name: '',
  email: '',
  phone: '',
  instagram_handle: '',
  location: '',
  niche: '',
  niche_tags: [],
  product_type: '',
  seeded_on: '',
  seed_items: [{ ...EMPTY_SEED_ITEM }],
  shipping_cost: '',
  creator_fee: '',
  seeding_status: 'planned',
  engagement_type: 'one_off',
  asset_commitment: '1',
  deliverable_title: '',
  deliverable_due: '',
  usage_rights: '',
  usage_term_months: '',
  whitelisting_monthly_rate: '',
  payment_terms: '',
  engagement_notes: '',
  contract_pdf_url: '',
  contract_file_name: '',
  contract_content_type: '',
  contract_size: '',
  notes: '',
};

const emptyAdd = () => ({ ...EMPTY_ADD, niche_tags: [], seed_items: [{ ...EMPTY_SEED_ITEM }] });

const fmt$ = n => (n || n === 0) ? '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '-';
const fmtMo = m => {
  if (!m) return 'Undated';
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
};
const monthKey = date => date ? String(date).slice(0, 7) : 'undated';
const labelForStatus = value => STATUS_OPTIONS.find(([key]) => key === value)?.[1] || 'Planned';
const optionKey = (productId, variantId) => `${productId}::${variantId}`;

function inferStatus(row) {
  if (row.seeding_status) return row.seeding_status;
  const note = `${row.notes || ''} ${row.usage_rights || ''}`.toLowerCase();
  if (note.includes('delivered')) return 'delivered';
  if (note.includes('transit')) return 'in_transit';
  if (note.includes('blocked') || note.includes('waiting')) return 'blocked';
  if (note.includes('progress')) return 'ordered';
  return 'planned';
}

function rowToForm(row) {
  return {
    id: row.id,
    seeded_on: row.seeded_on || '',
    product_label: row.product_label || '',
    unit_type: row.unit_type || '',
    quantity: String(row.quantity || 1),
    unit_cogs: String(row.unit_cogs || 0),
    shipping_cost: row.shipping_cost ? String(row.shipping_cost) : '',
    creator_fee: row.creator_fee ? String(row.creator_fee) : '',
    seeding_status: inferStatus(row),
    agreed_deliverables: row.agreed_deliverables ? String(row.agreed_deliverables) : '',
    deliverable_due: row.deliverable_due || '',
    usage_rights: row.usage_rights || '',
    notes: row.notes || '',
  };
}

function Score({ label, value, detail, tone = '' }) {
  return (
    <div className={`seed-score ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function IntakeField({ label, className = '', children }) {
  return (
    <label className={`intake-field ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function IntakeInput({ label, className = '', ...props }) {
  return (
    <IntakeField label={label} className={className}>
      <input {...props} />
    </IntakeField>
  );
}

function IntakeTextarea({ label, className = '', ...props }) {
  return (
    <IntakeField label={label} className={`intake-textarea-field ${className}`}>
      <textarea {...props} />
    </IntakeField>
  );
}

function IntakeSelect({ label, className = '', children, ...props }) {
  return (
    <IntakeField label={label} className={`intake-select-field ${className}`}>
      <span className="intake-select">
        <select {...props}>{children}</select>
      </span>
    </IntakeField>
  );
}

export default function SeedingLedger({ canManage = false }) {
  const { getToken } = useAuth();
  const [data, setData] = useState(null);
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(() => emptyAdd());
  const [shopifyProducts, setShopifyProducts] = useState([]);
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [contractFile, setContractFile] = useState(null);
  const [contractUploadProgress, setContractUploadProgress] = useState(0);
  const [fees, setFees] = useState(null);
  const [feeBusy, setFeeBusy] = useState(null);
  const [filters, setFilters] = useState({ month: 'all', status: 'all', search: '' });

  const loadFees = useCallback(async () => {
    try {
      const res = await fetch('/api/creator-fees');
      if (res.ok) setFees(await res.json());
    } catch { /* non-fatal */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ledger, cre, shopify] = await Promise.all([
        fetch('/api/creator-seeding-log').then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load ledger'))),
        fetch('/api/creators').then(r => r.ok ? r.json() : { creators: [] }),
        fetch('/api/shopify-products').then(r => r.ok ? r.json() : { connected: false, products: [] }).catch(() => ({ connected: false, products: [] })),
      ]);
      setData(ledger);
      setCreators((cre.creators || []).map(c => ({ id: c.id, name: c.name })));
      setShopifyProducts(shopify.products || []);
      setShopifyConnected(Boolean(shopify.connected));
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); loadFees(); }, [load, loadFees]);

  async function convertFee(intent) {
    setFeeBusy(intent.creator_name);
    setError('');
    try {
      const response = await fetch('/api/creator-fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_id: intent.suggested_creator_id,
          creator_name: intent.creator_name,
          amount: intent.amount,
          type: intent.type,
          note: intent.note,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not link creator payment');
      await loadFees();
      await load();
    } catch (err) {
      setError(err.message || 'Could not link creator payment');
    } finally {
      setFeeBusy(null);
    }
  }

  const rows = data?.rows || [];
  const units = data?.units || [];
  const openFeeIntents = fees?.intents?.filter(i => !i.converted) || [];

  const months = useMemo(() => {
    const set = new Set(rows.map(r => monthKey(r.seeded_on)).filter(Boolean));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return rows.filter(row => {
      const status = inferStatus(row);
      if (filters.month !== 'all' && monthKey(row.seeded_on) !== filters.month) return false;
      if (filters.status === 'needs_deliverable') {
        const missing = row.agreed_deliverables && !row.deliverable_due;
        if (!missing) return false;
      } else if (filters.status !== 'all' && status !== filters.status) {
        return false;
      }
      if (!q) return true;
      return [
        row.creator_name,
        row.product_label,
        row.unit_type,
        row.usage_rights,
        row.notes,
      ].some(value => String(value || '').toLowerCase().includes(q));
    });
  }, [rows, filters]);

  const totals = useMemo(() => {
    return rows.reduce((a, r) => {
      const status = inferStatus(r);
      const total = Number(r.total_cost) || 0;
      a.units += Number(r.quantity) || 0;
      a.cogs += Number(r.cogs_total) || 0;
      a.shipping += Number(r.shipping_cost) || 0;
      a.fees += Number(r.creator_fee) || 0;
      a.total += total;
      if (status !== 'delivered') a.openShipments += 1;
      if (r.agreed_deliverables && !r.deliverable_due) a.needsDue += 1;
      return a;
    }, { units: 0, cogs: 0, shipping: 0, fees: 0, total: 0, openShipments: 0, needsDue: 0 });
  }, [rows]);

  const catalogCost = ut => units.find(u => u.unit_type === ut)?.cogs || 0;
  const catalogCostForLabel = label => {
    const normalized = String(label || '').toLowerCase();
    const candidates = [...units].sort((a, b) => String(b.unit_type).length - String(a.unit_type).length);
    return candidates.find(u => normalized.includes(String(u.unit_type).toLowerCase()))?.cogs || 0;
  };
  const productOptions = useMemo(() => {
    const shopifyOptions = shopifyProducts.flatMap(product => {
      const variants = product.variants?.length ? product.variants : [{ id: product.id, title: 'Default', sku: '', unit_cost: null }];
      return variants.map(variant => {
        const variantTitle = variant.title && variant.title !== 'Default Title' ? variant.title : '';
        const label = variantTitle ? `${product.title} - ${variantTitle}` : product.title;
        const fallbackCogs = catalogCostForLabel(`${product.title} ${variantTitle} ${variant.sku || ''}`);
        return {
          key: optionKey(product.id, variant.id),
          label,
          detail: variant.sku || (shopifyConnected ? 'Shopify' : 'Catalog'),
          product_id: product.id,
          variant_id: variant.id,
          unit_type: variant.sku || variantTitle || product.title,
          unit_cogs: variant.unit_cost ?? fallbackCogs,
          has_shopify_cogs: variant.unit_cost !== null && variant.unit_cost !== undefined,
        };
      });
    });
    const unitOptions = units.map(unit => ({
      key: `unit:${unit.unit_type}`,
      label: unit.unit_type,
      detail: 'Manual COGS catalog',
      product_id: '',
      variant_id: '',
      unit_type: unit.unit_type,
      unit_cogs: unit.cogs,
      has_shopify_cogs: false,
    }));
    return [...shopifyOptions, ...unitOptions];
  }, [shopifyProducts, shopifyConnected, units]);
  const productOptionByKey = useMemo(() => Object.fromEntries(productOptions.map(option => [option.key, option])), [productOptions]);
  const draftProductCogs = (form.seed_items || []).reduce((sum, item) => {
    const option = productOptionByKey[item.product_key];
    const cogs = Number(item.unit_cogs || option?.unit_cogs || catalogCost(item.unit_type) || 0);
    const quantity = Number(item.quantity) || 1;
    return sum + cogs * quantity;
  }, 0);
  const draftInvestment = {
    product: draftProductCogs,
    shipping: Number(form.shipping_cost) || 0,
    fees: Number(form.creator_fee) || 0,
  };
  draftInvestment.total = draftInvestment.product + draftInvestment.shipping + draftInvestment.fees;

  async function saveUnit(unit_type, cogs) {
    await fetch('/api/creator-seeding-log', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unit', unit_type, cogs: Number(cogs) || 0 }),
    });
    load();
  }

  function updateSeedItem(index, patch) {
    setForm(current => ({
      ...current,
      seed_items: current.seed_items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  }

  function chooseSeedProduct(index, key) {
    const option = productOptionByKey[key];
    setForm(current => ({
      ...current,
      product_type: current.product_type || option?.label || '',
      seed_items: current.seed_items.map((item, itemIndex) => itemIndex === index ? (option ? {
        product_key: key,
        product_label: option.label,
        unit_type: option.unit_type,
        unit_cogs: option.unit_cogs ? String(option.unit_cogs) : '',
        shopify_product_id: option.product_id,
        shopify_variant_id: option.variant_id,
      } : { ...EMPTY_SEED_ITEM }) : item),
    }));
  }

  function addSeedItem() {
    setForm(current => ({ ...current, seed_items: [...current.seed_items, { ...EMPTY_SEED_ITEM }] }));
  }

  function removeSeedItem(index) {
    setForm(current => ({
      ...current,
      seed_items: current.seed_items.length > 1
        ? current.seed_items.filter((_, itemIndex) => itemIndex !== index)
        : [{ ...EMPTY_SEED_ITEM }],
    }));
  }

  function toggleNicheTag(tag) {
    setForm(current => {
      const active = new Set(current.niche_tags || []);
      if (active.has(tag)) active.delete(tag);
      else active.add(tag);
      return { ...current, niche_tags: [...active], niche: [...active].join(', ') };
    });
  }

  function addNicheTag(tag) {
    if (!tag) return;
    setForm(current => {
      const next = [...new Set([...(current.niche_tags || []), tag])];
      return { ...current, niche_tags: next, niche: next.join(', ') };
    });
  }

  function safeFileName(name) {
    return String(name || 'contract.pdf')
      .trim()
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 140) || 'contract.pdf';
  }

  async function uploadContractPdf() {
    if (!contractFile) return {};
    if (contractFile.type && contractFile.type !== 'application/pdf') {
      throw new Error('Contract upload must be a PDF.');
    }
    const token = await getToken?.();
    const pathname = `creator-contracts/${Date.now()}-${safeFileName(contractFile.name)}`;
    setContractUploadProgress(0.01);
    const blob = await uploadPublicBlob(pathname, contractFile, {
      contentType: contractFile.type || 'application/pdf',
      clientPayload: token,
      onUploadProgress: progress => setContractUploadProgress(progress.percentage || 0),
    });
    setContractUploadProgress(1);
    return {
      contract_pdf_url: blob.url,
      contract_file_name: contractFile.name,
      contract_content_type: contractFile.type || 'application/pdf',
      contract_size: contractFile.size,
    };
  }

  async function addRow(e) {
    e.preventDefault();
    if (!form.creator_id && !form.creator_name.trim()) {
      setError('Choose an existing creator or enter a new creator name.');
      return;
    }
    setBusy(true);
    try {
      const contractPayload = await uploadContractPdf();
      const payload = {
        ...form,
        ...contractPayload,
        seed_items: form.seed_items
          .map(item => {
            const option = productOptionByKey[item.product_key];
            return {
              ...item,
              product_label: item.product_label || option?.label || '',
              unit_type: item.unit_type || option?.unit_type || '',
              unit_cogs: item.unit_cogs || option?.unit_cogs || catalogCost(item.unit_type),
            };
          })
          .filter(item => item.product_label || item.unit_type || Number(item.unit_cogs || 0) > 0),
        agreed_deliverables: form.asset_commitment,
      };
      const res = await fetch('/api/creator-investment-intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Could not save intake');
      setForm(emptyAdd());
      setContractFile(null);
      setContractUploadProgress(0);
      setAdding(false);
      await Promise.all([load(), loadFees()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editForm?.id) return;
    setBusy(true);
    try {
      const res = await fetch('/api/creator-seeding-log', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Could not update row');
      setEditingId(null);
      setEditForm(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteRow(id) {
    if (!confirm('Remove this seeding row?')) return;
    await fetch(`/api/creator-seeding-log?id=${id}`, { method: 'DELETE' });
    load();
  }

  if (loading && !data) return <div className="forge"><div className="forge-empty">Loading seeding ledger...</div></div>;
  if (error && !data) return <div className="forge"><div className="forge-empty">{error}</div></div>;

  return (
    <div className="forge seed-page">
      <datalist id="seed-product-types">
        {PRODUCT_TYPE_OPTIONS.map(option => <option key={option} value={option} />)}
      </datalist>
      <div className="forge-head">
        <div>
          <div className="forge-eyebrow">Product Seeding</div>
          <h1>Creator Investment Ledger</h1>
          <p className="forge-sub">
            One place for seeded product, COGS, creator fees, deliverable promises, usage terms, and what still needs a follow-up.
          </p>
        </div>
        {canManage && (
          <button type="button" className="primary-action" onClick={() => setAdding(v => !v)}>
            {adding ? 'Close' : 'Add creator investment'}
          </button>
        )}
      </div>

      {error && <div className="app-error">{error}</div>}

      <div className="seed-scoreboard">
        <Score label="Total invested" value={fmt$(totals.total)} detail={`${totals.units.toLocaleString()} units seeded`} tone="hero" />
        <Score label="Product COGS" value={fmt$(totals.cogs)} detail="Catalog-driven" />
        <Score label="Creator fees" value={fmt$(totals.fees)} detail={`${openFeeIntents.length} fee notes open`} />
        <Score label="Open shipments" value={totals.openShipments.toLocaleString()} detail="Not marked delivered" tone={totals.openShipments ? 'warn' : ''} />
        <Score label="Need due date" value={totals.needsDue.toLocaleString()} detail="Deliverables promised" tone={totals.needsDue ? 'warn' : ''} />
      </div>

      <div className="seed-toolbar">
        <input
          value={filters.search}
          onChange={event => setFilters({ ...filters, search: event.target.value })}
          placeholder="Search creator, product, notes..."
        />
        <select value={filters.month} onChange={event => setFilters({ ...filters, month: event.target.value })}>
          <option value="all">All months</option>
          {months.map(month => <option key={month} value={month}>{month === 'undated' ? 'Undated' : fmtMo(month)}</option>)}
        </select>
        <select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}>
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          <option value="needs_deliverable">Needs due date</option>
        </select>
      </div>

      {adding && canManage && (
        <form className="seed-intake seed-card-panel" onSubmit={addRow}>
          <div className="seed-intake-head">
            <div>
              <span>Creator Investment Intake</span>
              <strong>{fmt$(draftInvestment.total)}</strong>
              <small>{fmt$(draftInvestment.product)} product + {fmt$(draftInvestment.shipping)} shipping + {fmt$(draftInvestment.fees)} fee</small>
            </div>
            <button className="primary-action" disabled={busy}>{busy ? 'Saving...' : 'Save investment'}</button>
          </div>

          <section>
            <h3>Creator</h3>
            <IntakeSelect
              label="Creator record"
              value={form.creator_id}
              onChange={e => {
                const selected = creators.find(c => String(c.id) === e.target.value);
                setForm({ ...form, creator_id: e.target.value, creator_name: selected?.name || form.creator_name });
              }}
            >
              <option value="">Create new creator</option>
              {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </IntakeSelect>
            <IntakeInput label="Creator name" placeholder="Taylor James" value={form.creator_name} onChange={e => setForm({ ...form, creator_name: e.target.value })} />
            <IntakeInput label="Instagram" placeholder="@handle or profile URL" value={form.instagram_handle} onChange={e => setForm({ ...form, instagram_handle: e.target.value })} />
            <IntakeInput label="Contact" placeholder="Email or DM contact" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            <IntakeInput label="Location" placeholder="City, state" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
            <IntakeInput label="Product owned" list="seed-product-types" placeholder="R1, R3, R4 MKii..." value={form.product_type} onChange={e => setForm({ ...form, product_type: e.target.value })} />
            <div className="niche-tag-select span-2">
              <IntakeSelect label="Creator tags" value="" onChange={e => addNicheTag(e.target.value)}>
                <option value="">Add category</option>
                {NICHE_OPTIONS.filter(tag => !(form.niche_tags || []).includes(tag)).map(tag => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </IntakeSelect>
              <div className="niche-selected-tags">
                {(form.niche_tags || []).length ? (form.niche_tags || []).map(tag => (
                  <button key={tag} type="button" onClick={() => toggleNicheTag(tag)}>{tag}</button>
                )) : <span>No tags selected</span>}
              </div>
            </div>
          </section>

          <section className="seed-products-section">
            <h3>Product seeded</h3>
            <IntakeInput label="Seeded on" type="date" value={form.seeded_on} onChange={e => setForm({ ...form, seeded_on: e.target.value })} />
            <IntakeInput label="Shipping" type="number" step="0.01" placeholder="0.00" value={form.shipping_cost} onChange={e => setForm({ ...form, shipping_cost: e.target.value })} />
            <IntakeSelect label="Seed status" value={form.seeding_status} onChange={e => setForm({ ...form, seeding_status: e.target.value })}>
              {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </IntakeSelect>
            <div className="seed-item-list">
              <div className="seed-item-list-head">
                <span>{shopifyConnected ? 'Shopify product catalog' : 'Manual product catalog'}</span>
                <button type="button" onClick={addSeedItem}>Add product</button>
              </div>
              {(form.seed_items || []).map((item, index) => (
                <div className="seed-item-row" key={index}>
                  <IntakeSelect label="Seed item" className="span-2" value={item.product_key} onChange={e => chooseSeedProduct(index, e.target.value)}>
                    <option value="">{productOptions.length ? 'Choose product' : 'No products loaded'}</option>
                    {productOptions.map(option => (
                      <option key={option.key} value={option.key}>
                        {option.label}{option.unit_cogs ? ` (${fmt$(option.unit_cogs)} COGS)` : ''}
                      </option>
                    ))}
                  </IntakeSelect>
                  <IntakeInput label="Qty" type="number" min="1" placeholder="1" value={item.quantity} onChange={e => updateSeedItem(index, { quantity: e.target.value })} />
                  <IntakeInput label="Unit COGS" type="number" step="0.01" placeholder="0.00" value={item.unit_cogs} onChange={e => updateSeedItem(index, { unit_cogs: e.target.value })} />
                  <button type="button" className="seed-item-remove" onClick={() => removeSeedItem(index)}>{form.seed_items.length > 1 ? 'Remove' : 'Clear'}</button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3>Commercial terms</h3>
            <IntakeSelect label="Term type" value={form.engagement_type} onChange={e => setForm({ ...form, engagement_type: e.target.value })}>
              <option value="one_off">One-off paid</option>
              <option value="retainer">Retainer</option>
            </IntakeSelect>
            <IntakeInput label="Compensation" type="number" step="0.01" placeholder="0.00" value={form.creator_fee} onChange={e => setForm({ ...form, creator_fee: e.target.value })} />
            <IntakeInput label="Assets owed" type="number" min="1" placeholder="1" value={form.asset_commitment} onChange={e => setForm({ ...form, asset_commitment: e.target.value })} />
            <IntakeInput label="Due date" type="date" value={form.deliverable_due} onChange={e => setForm({ ...form, deliverable_due: e.target.value })} />
            <IntakeInput label="Usage months" placeholder="12" value={form.usage_term_months} onChange={e => setForm({ ...form, usage_term_months: e.target.value })} />
            <IntakeInput label="Whitelisting / mo" type="number" step="0.01" placeholder="0.00" value={form.whitelisting_monthly_rate} onChange={e => setForm({ ...form, whitelisting_monthly_rate: e.target.value })} />
            <IntakeTextarea label="Usage rights" className="span-2" rows="3" placeholder="Paid social, organic, editing rights, term, territory..." value={form.usage_rights} onChange={e => setForm({ ...form, usage_rights: e.target.value })} />
            <IntakeInput label="Payment terms" className="span-2" placeholder="Net 30 after usable assets received" value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })} />
            <IntakeTextarea label="Internal notes" className="span-2" rows="3" placeholder="Negotiation notes, source context, reminders..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </section>

          <section className="seed-contract-section">
            <h3>Contract proof</h3>
            <label className={`contract-drop ${contractFile ? 'has-file' : ''}`}>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={event => {
                  const file = event.target.files?.[0] || null;
                  setContractFile(file);
                  setContractUploadProgress(0);
                }}
              />
              <strong>{contractFile ? contractFile.name : 'Add signed contract PDF'}</strong>
              <span>
                {contractFile
                  ? `${(contractFile.size / 1024 / 1024).toFixed(2)} MB${contractUploadProgress ? ` · ${Math.round(contractUploadProgress * 100)}% uploaded` : ''}`
                  : 'PDF is stored as an uploaded agreement and linked to this creator engagement.'}
              </span>
            </label>
            {contractFile && <button type="button" className="contract-clear" onClick={() => { setContractFile(null); setContractUploadProgress(0); }}>Remove PDF</button>}
          </section>

          <div className="seed-intake-path">
            <span>Creates/updates creator</span>
            <span>adds IG profile</span>
            <span>logs seeding cost</span>
            <span>creates engagement</span>
            <span>stores contract PDF</span>
            <span>schedules deliverable</span>
          </div>
        </form>
      )}

      <div className="seed-grid">
        <section className="seed-section">
          <div className="seed-section-label">Monthly spend</div>
          <table className="seed-rollup">
            <thead>
              <tr><th>Month</th><th>Creators</th><th>Units</th><th>COGS</th><th>Shipping</th><th>Fees</th><th>Total</th></tr>
            </thead>
            <tbody>
              {data.rollup.map(r => (
                <tr key={r.month}>
                  <td>{fmtMo(r.month)}</td>
                  <td>{r.creators}</td>
                  <td>{r.units}</td>
                  <td>{fmt$(r.cogs)}</td>
                  <td>{fmt$(r.shipping)}</td>
                  <td>{fmt$(r.fees)}</td>
                  <td className="seed-total">{fmt$(r.total)}</td>
                </tr>
              ))}
              {!data.rollup.length && <tr><td colSpan={7} className="seed-empty-cell">No dated rows yet.</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="seed-section">
          <div className="seed-section-label">Unit cost catalog</div>
          <div className="seed-catalog">
            {units.map(u => (
              <div className="seed-unit" key={u.unit_type}>
                <b>{u.unit_type}</b>
                {canManage ? (
                  <input type="number" step="0.01" defaultValue={u.cogs}
                    onBlur={e => { if (Number(e.target.value) !== u.cogs) saveUnit(u.unit_type, e.target.value); }} />
                ) : <span>{fmt$(u.cogs)}</span>}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="seed-section">
        <div className="seed-section-label">Ledger - {filteredRows.length} rows</div>
        <div className="seed-table-wrap">
          <table className="seed-table">
            <thead>
              <tr>
                <th>Status</th><th>Date</th><th>Creator</th><th>Product</th><th>Unit</th><th className="num">Qty</th>
                <th className="num">COGS</th><th className="num">Ship</th><th className="num">Fee</th><th className="num">Total</th>
                <th>Deliverables</th><th>Due</th><th>Usage</th><th>Notes</th>{canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(r => {
                const status = inferStatus(r);
                const isEditing = editingId === r.id;
                return isEditing ? (
                  <tr key={r.id} className="seed-edit-row">
                    <td colSpan={canManage ? 15 : 14}>
                      <form className="seed-edit-form" onSubmit={saveEdit}>
                        <select value={editForm.seeding_status} onChange={e => setEditForm({ ...editForm, seeding_status: e.target.value })}>
                          {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <input type="date" value={editForm.seeded_on} onChange={e => setEditForm({ ...editForm, seeded_on: e.target.value })} />
                        <input placeholder="Product seeded" value={editForm.product_label} onChange={e => setEditForm({ ...editForm, product_label: e.target.value })} />
                        <select value={editForm.unit_type} onChange={e => setEditForm({ ...editForm, unit_type: e.target.value, unit_cogs: String(catalogCost(e.target.value)) })}>
                          {units.map(u => <option key={u.unit_type} value={u.unit_type}>{u.unit_type}</option>)}
                        </select>
                        <input type="number" min="1" value={editForm.quantity} onChange={e => setEditForm({ ...editForm, quantity: e.target.value })} />
                        <input type="number" step="0.01" value={editForm.unit_cogs} onChange={e => setEditForm({ ...editForm, unit_cogs: e.target.value })} />
                        <input type="number" step="0.01" placeholder="Shipping" value={editForm.shipping_cost} onChange={e => setEditForm({ ...editForm, shipping_cost: e.target.value })} />
                        <input type="number" step="0.01" placeholder="Fee" value={editForm.creator_fee} onChange={e => setEditForm({ ...editForm, creator_fee: e.target.value })} />
                        <input type="number" min="0" placeholder="Deliverables" value={editForm.agreed_deliverables} onChange={e => setEditForm({ ...editForm, agreed_deliverables: e.target.value })} />
                        <input type="date" value={editForm.deliverable_due} onChange={e => setEditForm({ ...editForm, deliverable_due: e.target.value })} />
                        <input placeholder="Usage rights" value={editForm.usage_rights} onChange={e => setEditForm({ ...editForm, usage_rights: e.target.value })} />
                        <input className="wide" placeholder="Notes" value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} />
                        <div className="seed-edit-actions">
                          <button className="primary-action" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button>
                          <button type="button" onClick={() => { setEditingId(null); setEditForm(null); }}>Cancel</button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id}>
                    <td><span className={`seed-status ${status}`}>{labelForStatus(status)}</span></td>
                    <td>{r.seeded_on || '-'}</td>
                    <td className="seed-creator">{r.creator_name}</td>
                    <td>{r.product_label || '-'}</td>
                    <td>{r.unit_type ? <span className="seed-unit-pill">{r.unit_type}</span> : '-'}</td>
                    <td className="num">{r.quantity}</td>
                    <td className="num">{fmt$(r.cogs_total)}</td>
                    <td className="num">{r.shipping_cost ? fmt$(r.shipping_cost) : '-'}</td>
                    <td className="num">{r.creator_fee ? fmt$(r.creator_fee) : '-'}</td>
                    <td className="num seed-money">{fmt$(r.total_cost)}</td>
                    <td>{r.agreed_deliverables || '-'}</td>
                    <td className={r.agreed_deliverables && !r.deliverable_due ? 'seed-risk' : ''}>{r.deliverable_due || '-'}</td>
                    <td>{r.usage_rights || '-'}</td>
                    <td className="seed-note-cell">{r.notes || ''}</td>
                    {canManage && (
                      <td className="seed-row-actions">
                        <button type="button" onClick={() => { setEditingId(r.id); setEditForm(rowToForm(r)); }}>Edit</button>
                        <button className="seed-del" title="Remove" onClick={() => deleteRow(r.id)}>x</button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!filteredRows.length && <tr><td colSpan={canManage ? 15 : 14} className="seed-empty-cell">No rows match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {fees?.intents?.length > 0 && (
        <section className="seed-section">
          <div className="seed-section-label">Creator fees to formalize ({openFeeIntents.length} open)</div>
          <div className="seed-fee-list">
            {fees.intents.map(intent => (
              <div className={`seed-fee${intent.converted ? ' done' : ''}`} key={intent.creator_name}>
                <div>
                  <span className="seed-fee-name">{intent.creator_name}</span>
                  <span className="seed-fee-note">{intent.note}</span>
                  {intent.suggested_creator_name && intent.suggested_creator_name.toLowerCase() !== intent.creator_name.toLowerCase() && (
                    <span className="seed-fee-match">{'-> '}{intent.suggested_creator_name}</span>
                  )}
                  {!intent.suggested_creator_id && <span className="seed-fee-match">{'-> '}will create creator</span>}
                </div>
                <div className="seed-fee-actions">
                  <span className="flow-tag">{intent.type === 'retainer' ? 'retainer /mo' : 'one-off'}</span>
                  <span className="seed-fee-amt">{intent.amount ? `$${intent.amount.toLocaleString()}` : 'TBD'}</span>
                  {intent.converted ? (
                    <span className="flow-tag flame">linked</span>
                  ) : canManage ? (
                    <button type="button" className="flow-btn primary" disabled={feeBusy === intent.creator_name} onClick={() => convertFee(intent)}>
                      {feeBusy === intent.creator_name ? 'Linking...' : 'Create engagement'}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
