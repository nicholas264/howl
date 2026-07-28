import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

const DEFAULT_PRODUCT = { id: 'r1', name: 'R1', mapPrice: 374, terms: ['HOWL R1', 'HOWL Campfires R1'] };

function fmtDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtFullDate(value) {
  if (!value) return 'No scan yet';
  return new Date(value).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';
}

function fmtDuration(start, end) {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

function hostLabel(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value || '';
  }
}

function sameHost(a, b) {
  try {
    return new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
}

function scanState(dealer, latestRun) {
  if (!dealer.url) return dealer.resolutionStatus === 'no_public_website' ? 'non-web' : 'missing';
  if (!dealer.lastScannedAt || !latestRun?.started_at) return 'queued';
  return new Date(dealer.lastScannedAt).getTime() >= new Date(latestRun.started_at).getTime() ? 'scanned' : 'stale';
}

function linesToDealers(value) {
  return value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [name, ...urlParts] = line.includes('|') ? line.split('|') : ['', line];
    const url = urlParts.join('|').trim();
    return { name: name.trim() || url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0], url };
  });
}

function dealersToLines(dealers) {
  return (dealers || [])
    .filter(dealer => dealer.url)
    .map(dealer => `${dealer.name || ''} | ${dealer.url || ''}`.trim())
    .join('\n');
}

export default function MapMonitorWorkspace({ canManage = false }) {
  const [data, setData] = useState({ runs: [], findings: [], settings: {} });
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [testingAlert, setTestingAlert] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [dealerDraft, setDealerDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [mapPrice, setMapPrice] = useState(374);
  const [useSearch, setUseSearch] = useState(true);
  const [siteFilter, setSiteFilter] = useState('all');
  const [siteQuery, setSiteQuery] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await apiJson('/api/map-monitor', undefined, 'Could not load MAP monitor');
      setData(result);
      setDealerDraft(dealersToLines(result.settings?.dealers || []));
      setEmailDraft((result.settings?.alertEmails || []).join(', '));
      setMapPrice(Number(result.settings?.mapPrice || 374));
      setUseSearch(result.settings?.useSearch !== false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const latestRun = data.runs?.[0] || null;
  const latestRunId = latestRun?.id;
  const latestFindings = useMemo(
    () => data.findings.filter(finding => !latestRunId || String(finding.run_id) === String(latestRunId)),
    [data.findings, latestRunId],
  );
  const violations = latestFindings.filter(finding => finding.status === 'violation');
  const priceEvidence = latestFindings.filter(finding => finding.status === 'ok');
  const dealerCount = data.settings?.dealers?.length || 0;
  const dealerCoverage = data.settings?.dealerCoverage || {};
  const dealerUrlCount = dealerCoverage.resolved ?? (data.settings?.dealers || []).filter(dealer => dealer.url).length;
  const noWebsiteDealers = (data.settings?.dealers || []).filter(dealer => !dealer.url && dealer.resolutionStatus === 'no_public_website');
  const unresolvedDealers = (data.settings?.dealers || []).filter(dealer => !dealer.url && dealer.resolutionStatus !== 'no_public_website');
  const resolvedDealers = (data.settings?.dealers || []).filter(dealer => dealer.url);
  const latestFindingsByHost = useMemo(() => {
    const map = new Map();
    for (const finding of latestFindings) {
      const key = hostLabel(finding.dealer_url || finding.evidence_url);
      if (key && !map.has(key)) map.set(key, finding);
    }
    return map;
  }, [latestFindings]);
  const siteRows = useMemo(() => {
    const query = siteQuery.trim().toLowerCase();
    return (data.settings?.dealers || []).map(dealer => {
      const url = dealer.productUrl || dealer.websiteUrl || dealer.url;
      const host = hostLabel(url);
      const finding = url
        ? latestFindings.find(item => sameHost(item.evidence_url, url) || sameHost(item.dealer_url, url))
          || latestFindingsByHost.get(host)
        : null;
      const state = scanState({ ...dealer, url }, latestRun);
      return { dealer, url, host, finding, state };
    }).filter(row => {
      if (siteFilter === 'priced' && !row.finding) return false;
      if (siteFilter === 'unpriced' && (!row.url || row.finding)) return false;
      if (siteFilter === 'non-web' && row.state !== 'non-web') return false;
      if (siteFilter === 'missing' && row.state !== 'missing') return false;
      if (siteFilter === 'scannable' && !row.url) return false;
      if (!query) return true;
      return [
        row.dealer.name,
        row.host,
        row.url,
        row.dealer.city,
        row.dealer.region,
        row.dealer.resolutionNote,
      ].filter(Boolean).join(' ').toLowerCase().includes(query);
    });
  }, [data.settings?.dealers, latestFindings, latestFindingsByHost, latestRun, siteFilter, siteQuery]);
  const scannedSiteCount = siteRows.filter(row => row.state === 'scanned').length;
  const unpricedScannableCount = resolvedDealers.length - priceEvidence.length;

  const runNow = async () => {
    setRunning(true);
    setError('');
    setMessage('');
    try {
      const result = await apiJson('/api/map-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run' }),
      }, 'Scan failed');
      setMessage(`Scan finished: ${result.run?.scanned_count || 0} sources checked, ${result.violations?.length || 0} violation${result.violations?.length === 1 ? '' : 's'} found.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const resolveWebsites = async () => {
    setResolving(true);
    setError('');
    setMessage('');
    try {
      const result = await apiJson('/api/map-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', limit: 20 }),
      }, 'Website resolution failed');
      setMessage(`Website resolver checked ${result.attempted || 0} dealer records and resolved ${result.resolved || 0}. Coverage is now ${result.dealerCoverage?.resolved || 0}/${result.dealerCoverage?.total || 0}.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setResolving(false);
    }
  };

  const sendTestAlert = async () => {
    setTestingAlert(true);
    setError('');
    setMessage('');
    try {
      const result = await apiJson('/api/map-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test_alert' }),
      }, 'Test alert failed');
      if (result.alert?.skipped) throw new Error(result.alert.reason || 'Alert provider skipped the test alert');
      setMessage(`Test alert accepted by ${result.alert?.provider || result.settings?.alertProviderLabel || 'alert provider'}.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setTestingAlert(false);
    }
  };

  const saveSettings = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const settings = {
        mapPrice: Number(mapPrice) || 374,
        alertEmails: emailDraft.split(',').map(email => email.trim()).filter(Boolean),
        dealers: linesToDealers(dealerDraft),
        products: [{ ...DEFAULT_PRODUCT, mapPrice: Number(mapPrice) || 374 }],
        useSearch,
      };
      const result = await apiJson('/api/map-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'settings', settings }),
      }, 'Could not save settings');
      setMessage('MAP monitor settings saved.');
      setData(prev => ({ ...prev, settings: result.settings }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="workspace-page map-monitor-workspace">
      <header className="workspace-head">
        <div>
          <span className="workspace-kicker">Dealer MAP Monitor</span>
          <h1>Price Watch</h1>
          <p>Daily R1 dealer scans use the dealer registry, resolve websites automatically, verify product-page pricing, and flag only below-MAP evidence that needs follow-up.</p>
        </div>
        {canManage && (
          <div className="map-actions">
            <button type="button" className="secondary-action" onClick={resolveWebsites} disabled={resolving || running || testingAlert}>{resolving ? 'Resolving...' : 'Resolve websites'}</button>
            <button type="button" className="secondary-action" onClick={sendTestAlert} disabled={testingAlert || running || resolving}>{testingAlert ? 'Testing...' : 'Test alert'}</button>
            <button type="button" className="primary-action" onClick={runNow} disabled={running || resolving || testingAlert}>{running ? 'Scanning...' : 'Scan now'}</button>
          </div>
        )}
      </header>

      {error && <div className="app-error">{error}</div>}
      {message && <div className="map-message">{message}</div>}

      <section className={`map-daily ${violations.length ? 'risk' : ''}`}>
        <div>
          <span>Latest Daily Scan</span>
          <strong>{latestRun ? fmtFullDate(latestRun.started_at) : 'Waiting for first scan'}</strong>
          <small>{latestRun?.status || 'not started'} / {fmtDuration(latestRun?.started_at, latestRun?.finished_at)} / run #{latestRun?.id || '—'}</small>
        </div>
        <div>
          <span>Outcome</span>
          <strong>{violations.length ? `${violations.length} below MAP` : 'Clear'}</strong>
          <small>{latestRun?.scanned_count || 0} unique sources checked, {priceEvidence.length} price pages verified</small>
        </div>
        <div>
          <span>Registry Coverage</span>
          <strong>{dealerCoverage.coveragePct || 0}%</strong>
          <small>{dealerUrlCount} websites, {dealerCoverage.noWebsite || noWebsiteDealers.length} non-web, {unresolvedDealers.length} missing</small>
        </div>
      </section>

      <div className="map-scorecard">
        <div className={violations.length ? 'risk' : ''}><span>Active violations</span><strong>{violations.length}</strong><small>latest run below MAP</small></div>
        <div><span>MAP threshold</span><strong>{fmtMoney(data.settings?.mapPrice || mapPrice)}</strong><small>R1 minimum advertised price</small></div>
        <div><span>Dealer registry</span><strong>{dealerCount}</strong><small>source-of-truth records</small></div>
        <div className={dealerCoverage.unresolved || dealerCoverage.failed ? 'warning' : ''}><span>Registry classified</span><strong>{(dealerUrlCount + (dealerCoverage.noWebsite || noWebsiteDealers.length)) || 0}</strong><small>{dealerUrlCount} websites, {dealerCoverage.noWebsite || noWebsiteDealers.length} non-web records</small></div>
        <div><span>Sources checked</span><strong>{latestRun?.scanned_count || 0}</strong><small>{latestRun ? fmtDate(latestRun.started_at) : 'No scan yet'}</small></div>
        <div className={data.settings?.emailConfigured ? '' : 'warning'}><span>Alert sender</span><strong>{data.settings?.emailConfigured ? 'Ready' : 'Sender needed'}</strong><small>{data.settings?.alertProviderLabel || 'Not configured'} / {(data.settings?.alertEmails || []).length || 0} recipients</small></div>
      </div>

      <div className="map-layout">
        <div className="map-main">
          <section className="map-panel map-sites-panel">
            <header>
              <strong>Daily Site Scan</strong>
              <small>{siteRows.length} records shown / {resolvedDealers.length} scannable sites / {scannedSiteCount} scanned in the latest run</small>
            </header>
            <div className="map-site-toolbar">
              <input value={siteQuery} onChange={event => setSiteQuery(event.target.value)} placeholder="Search dealer, site, city, status..." />
              <div className="map-segments" aria-label="Site filter">
                {[
                  ['all', 'All'],
                  ['scannable', 'Sites'],
                  ['priced', 'Priced'],
                  ['unpriced', 'No price'],
                  ['non-web', 'Non-web'],
                  ['missing', 'Missing'],
                ].map(([value, label]) => (
                  <button key={value} type="button" className={siteFilter === value ? 'active' : ''} onClick={() => setSiteFilter(value)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="map-site-table">
              <div className="map-site-head"><span>Dealer / site</span><span>Latest scan</span><span>Price</span><span>Evidence</span></div>
              {siteRows.map(({ dealer, url, host, finding, state }) => {
                const rowClass = finding?.status === 'violation' ? 'violation' : state;
                const evidenceUrl = finding?.evidence_url || url;
                return (
                  <a key={dealer.id} className={`map-site-row ${rowClass}`} href={evidenceUrl || undefined} target={evidenceUrl ? '_blank' : undefined} rel="noreferrer">
                    <span><strong>{dealer.name}</strong><small>{url || dealer.resolutionNote || [dealer.city, dealer.region].filter(Boolean).join(', ') || 'No public website'}</small></span>
                    <span><b>{state.replace('-', ' ')}</b><small>{dealer.lastScannedAt ? fmtDate(dealer.lastScannedAt) : dealer.resolutionStatus || 'not scanned'}</small></span>
                    <span><b>{finding ? fmtMoney(finding.observed_price) : '—'}</b><small>{finding ? `${finding.product_name} / MAP ${fmtMoney(finding.map_price)}` : host || dealer.resolutionSource || 'not applicable'}</small></span>
                    <i>{finding ? 'Open price' : url ? 'Open site' : state === 'missing' ? 'Needs site' : 'N/A'}</i>
                  </a>
                );
              })}
              {!loading && !siteRows.length && <div className="map-empty">No dealer records match this filter.</div>}
            </div>
          </section>

          <section className="map-panel">
            <header><strong>Violations</strong><small>{violations.length ? 'Evidence needing dealer follow-up' : 'No below-MAP prices in the latest scan'}</small></header>
            <div className="map-table">
              <div className="map-table-head"><span>Dealer</span><span>Product</span><span>Observed</span><span>MAP</span><span>Evidence</span></div>
              {violations.map(finding => (
                <a key={finding.id} className="map-row violation" href={finding.evidence_url} target="_blank" rel="noreferrer">
                  <span><strong>{finding.dealer_name || 'Unknown dealer'}</strong><small>{finding.dealer_url}</small></span>
                  <span>{finding.product_name}</span>
                  <b>{fmtMoney(finding.observed_price)}</b>
                  <span>{fmtMoney(finding.map_price)}</span>
                  <i>Open</i>
                </a>
              ))}
              {!loading && !violations.length && <div className="map-empty">No MAP violations found in the latest scan.</div>}
            </div>
          </section>

          <section className="map-panel">
            <header><strong>Verified Price Evidence</strong><small>{priceEvidence.length} product page{priceEvidence.length === 1 ? '' : 's'} at or above MAP, {Math.max(0, unpricedScannableCount)} scannable records without price evidence</small></header>
            <div className="map-table compact">
              <div className="map-table-head"><span>Dealer</span><span>Product</span><span>Observed</span><span>Evidence</span></div>
              {priceEvidence.slice(0, 60).map(finding => (
                <a key={finding.id} className="map-row" href={finding.evidence_url} target="_blank" rel="noreferrer">
                  <span><strong>{finding.dealer_name || 'Unknown dealer'}</strong><small>{finding.product_name}</small></span>
                  <span>{finding.product_name}</span>
                  <b>{fmtMoney(finding.observed_price)}</b>
                  <i>Open</i>
                </a>
              ))}
              {!loading && !priceEvidence.length && <div className="map-empty">No product-page prices were verified in the latest scan. The next scan will keep searching the web and known dealer seeds.</div>}
            </div>
          </section>
        </div>

        <aside className="map-side">
          <section className="map-panel">
            <header><strong>Dealer Websites</strong><small>{dealerUrlCount} resolved, {noWebsiteDealers.length} non-web, {unresolvedDealers.length} missing</small></header>
            <div className="map-runs">
              {resolvedDealers.map(dealer => (
                <a key={dealer.id} href={dealer.url} target="_blank" rel="noreferrer">
                  <span><strong>{dealer.name}</strong><small>{dealer.productUrl || dealer.websiteUrl || dealer.url}</small></span>
                  <b>{dealer.lastScannedAt ? 'OK' : 'NEW'}</b>
                </a>
              ))}
              {unresolvedDealers.map(dealer => (
                <div key={dealer.id} className="warning">
                  <span><strong>{dealer.name}</strong><small>{[dealer.city, dealer.region].filter(Boolean).join(', ') || dealer.resolutionStatus || 'missing website'}</small></span>
                  <b>...</b>
                </div>
              ))}
              {noWebsiteDealers.map(dealer => (
                <div key={dealer.id}>
                  <span><strong>{dealer.name}</strong><small>{dealer.resolutionNote || 'No public website to scan'}</small></span>
                  <b>N/A</b>
                </div>
              ))}
              {!data.settings?.dealers?.length && <p>No dealer registry loaded yet.</p>}
            </div>
          </section>

          <section className="map-panel">
            <header><strong>Run History</strong><small>morning cron and manual scans</small></header>
            <div className="map-runs">
              {(data.runs || []).map(run => (
                <div key={run.id} className={run.violation_count ? 'risk' : ''}>
                  <span><strong>{fmtDate(run.started_at)}</strong><small>{run.status}</small></span>
                  <b>{run.violation_count || 0}</b>
                </div>
              ))}
              {!data.runs?.length && <p>No scans have run yet.</p>}
            </div>
          </section>

          {canManage && (
            <form className="map-panel map-settings" onSubmit={saveSettings}>
              <header><strong>Settings</strong><small>automated discovery and alerting</small></header>
              <label>MAP price<input type="number" min="1" step="0.01" value={mapPrice} onChange={event => setMapPrice(event.target.value)} /></label>
              <label>Alert emails<input value={emailDraft} onChange={event => setEmailDraft(event.target.value)} placeholder="ops@howlcampfires.com, sales@howlcampfires.com" /></label>
              <label>Extra website seeds<textarea value={dealerDraft} onChange={event => setDealerDraft(event.target.value)} placeholder={'Optional. Format: Dealer name | https://dealer-site.com'} /></label>
              <label className="map-check"><input type="checkbox" checked={useSearch} onChange={event => setUseSearch(event.target.checked)} /> Include configured web search provider</label>
              <button type="submit" className="primary-action" disabled={saving}>{saving ? 'Saving...' : 'Save settings'}</button>
            </form>
          )}
        </aside>
      </div>
    </section>
  );
}
