import { useCallback, useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { upload } from '@vercel/blob/client';
import { useAuth } from '@clerk/clerk-react';
import CreatorAcquisitionWorkspace from './CreatorAcquisitionWorkspace';
import CreatorDataHealthWorkspace from './CreatorDataHealthWorkspace';
import CreatorOperationsWorkspace from './CreatorOperationsWorkspace';

const STAGES = [
  ['all', 'All'],
  ['sourced', 'Sourced'],
  ['contacted', 'Contacted'],
  ['interested', 'Interested'],
  ['briefing', 'Briefing'],
  ['producing', 'Producing'],
  ['active', 'Active'],
  ['alumni', 'Alumni'],
];

const EMPTY_CREATOR = {
  name: '', email: '', phone: '', location: '', stage: 'sourced',
  status: 'prospect', activities: '', tags: '', bio: '', rate_notes: '', notes: '',
};

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function displayMetric(value) {
  return value === null || value === undefined ? '—' : compact.format(Number(value));
}

function strongestSocial(accounts = []) {
  return accounts.reduce((best, account) => {
    if (!best) return account;
    return Number(account.followers || 0) > Number(best.followers || 0) ? account : best;
  }, null);
}

function compactText(value, fallback = '—') {
  const text = Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value || '').trim();
  return text || fallback;
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
}

function defaultFollowUpDate(days = 5) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function agreementPreview(value, creator, engagement) {
  const currency = engagement?.fee_currency || 'USD';
  const values = {
    creator_name: creator?.name || '',
    creator_email: creator?.email || '',
    engagement_type: engagement?.engagement_type === 'retainer' ? 'Retainer' : 'One-off',
    approval_date: engagement?.approval_date || '',
    start_date: engagement?.starts_on || '',
    end_date: engagement?.ends_on || '',
    asset_commitment: engagement?.asset_commitment ?? '',
    commitment_period: engagement?.commitment_period || '',
    cadence: engagement?.cadence || '',
    total_fee: engagement?.fee_amount
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(engagement.fee_amount))
      : '',
    usage_term_months: engagement?.usage_term_months ?? '',
    payment_terms: engagement?.payment_terms || '',
    exclusivity_notes: engagement?.exclusivity_notes || 'None',
  };
  return (value || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key.toLowerCase()) ? String(values[key.toLowerCase()]) : match
  ));
}

function CreatorAvatar({ creator, large = false }) {
  return creator.avatar_url
    ? <img className={`creator-avatar ${large ? 'large' : ''}`} src={creator.avatar_url} alt="" />
    : <div className={`creator-avatar fallback ${large ? 'large' : ''}`}>{initials(creator.name)}</div>;
}

export default function CreatorWorkspace({
  canManageCreators = false,
  canMergeCreators = false,
  canWriteBriefs = false,
  canWriteAssets = false,
  onOpenEditor,
  initialCreatorId,
  onInitialCreatorLoaded,
}) {
  const { getToken } = useAuth();
  const [creators, setCreators] = useState([]);
  const [workspaceView, setWorkspaceView] = useState('database');
  const [selected, setSelected] = useState(null);
  const [stage, setStage] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [clickupConfigured, setClickupConfigured] = useState(false);
  const [form, setForm] = useState(EMPTY_CREATOR);
  const [note, setNote] = useState('');
  const [social, setSocial] = useState({ platform: 'instagram', handle: '', profile_url: '', followers: '', avg_views: '', engagement_rate: '' });
  const [detailTab, setDetailTab] = useState('profile');
  const [workflow, setWorkflow] = useState({
    briefs: [], outreach: [], engagements: [], agreements: [], deliverables: [],
    submission_links: [], production_summary: {}, guidance: { milestones: [], next_action: null },
  });
  const [briefForm, setBriefForm] = useState({ product: '', objective: '', angle: '', direction: '', strategy_mode: 'past_performers' });
  const [outreach, setOutreach] = useState({
    channel: 'email', subject: '', body: '', status: 'draft', next_follow_up_at: defaultFollowUpDate(),
  });
  const [engagement, setEngagement] = useState({
    engagement_type: 'one_off', status: 'draft', approval_date: '', starts_on: '', ends_on: '',
    asset_commitment: '', commitment_period: 'total', cadence: '', fee_amount: '', fee_currency: 'USD',
    ugc_video_rate: '', raw_footage_rate: '', hook_rate: '', photo_rate: '', whitelisting_monthly_rate: '',
    usage_term_months: '12', paid_media_included: true, raw_footage_included: false,
    exclusivity_notes: '', payment_terms: 'Net 30', notes: '',
  });
  const [agreement, setAgreement] = useState({
    engagement_id: '', template_id: '', title: 'HOWL Creator Content Usage Agreement',
    agreement_body: '', expires_in_days: '14',
  });
  const [preparedAgreement, setPreparedAgreement] = useState(null);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [deliverable, setDeliverable] = useState({
    title: '', due_at: '', source_url: '', brief_id: '', engagement_id: '', expected_asset_count: '1',
  });
  const [submissionLink, setSubmissionLink] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [syncingSocial, setSyncingSocial] = useState(null);
  const [agreementTemplates, setAgreementTemplates] = useState([]);
  const [shopifyProducts, setShopifyProducts] = useState([]);
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [seeds, setSeeds] = useState([]);
  const [seedForm, setSeedForm] = useState({ product_variant: '', quantity: '1', notes: '' });
  const [creatorIntel, setCreatorIntel] = useState({
    niche: '', strengths: '', audience_demographics: '', audience_psychographics: '',
    shipping_address1: '', shipping_address2: '', shipping_city: '', shipping_region: '',
    shipping_postal_code: '', shipping_country_code: 'US',
  });

  useEffect(() => {
    fetch('/api/creator-email')
      .then(response => response.json())
      .then(data => setGmailConnected(Boolean(data.connected)))
      .catch(() => setGmailConnected(false));
  }, []);

  const connectGmail = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'creator_email' }),
      });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || 'Could not start Gmail connection');
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const loadCreators = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (stage !== 'all') params.set('stage', stage);
      if (search.trim()) params.set('search', search.trim());
      const response = await fetch(`/api/creators?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load creators');
      setCreators(data.creators || []);
      if (selected) {
        const next = data.creators?.find(item => item.id === selected.id);
        if (next) setSelected(prev => ({ ...prev, ...next }));
      }
    } catch (err) {
      if (!(import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === 'true')) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, selected?.id, stage]);

  useEffect(() => {
    const timer = setTimeout(loadCreators, 180);
    return () => clearTimeout(timer);
  }, [loadCreators]);

  useEffect(() => {
    fetch('/api/creators-import')
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => setClickupConfigured(Boolean(data.clickup_configured)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/creator-email')
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => setGmailConnected(Boolean(data.connected)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/agreement-templates')
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => setAgreementTemplates(data.templates || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/shopify-products')
      .then(response => response.json())
      .then(data => {
        setShopifyConnected(Boolean(data.connected));
        setShopifyProducts(data.products || []);
      })
      .catch(() => setShopifyConnected(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setCreatorIntel({
      niche: selected.niche || '',
      strengths: selected.strengths || '',
      audience_demographics: selected.audience_demographics || '',
      audience_psychographics: selected.audience_psychographics || '',
      shipping_address1: selected.shipping_address1 || '',
      shipping_address2: selected.shipping_address2 || '',
      shipping_city: selected.shipping_city || '',
      shipping_region: selected.shipping_region || '',
      shipping_postal_code: selected.shipping_postal_code || '',
      shipping_country_code: selected.shipping_country_code || 'US',
    });
  }, [selected?.id]);

  const counts = useMemo(() => creators.reduce((result, creator) => {
    result[creator.stage] = (result[creator.stage] || 0) + 1;
    return result;
  }, {}), [creators]);
  const selectedEngagement = useMemo(
    () => workflow.engagements?.find(item => String(item.id) === String(agreement.engagement_id)),
    [agreement.engagement_id, workflow.engagements],
  );
  const renderedAgreement = useMemo(() => ({
    title: agreementPreview(agreement.title, selected, selectedEngagement),
    body: agreementPreview(agreement.agreement_body, selected, selectedEngagement),
  }), [agreement.title, agreement.agreement_body, selected, selectedEngagement]);

  const openCreator = async (creator, targetTab = 'profile') => {
    setError('');
    try {
      const response = await fetch(`/api/creators?id=${creator.id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load creator');
      setSelected(data.creator);
      setDetailTab(targetTab);
      setPreparedAgreement(null);
      const workflowResponse = await fetch(`/api/creator-workflow?creator_id=${creator.id}`);
      const workflowData = await workflowResponse.json();
      if (workflowResponse.ok) setWorkflow(workflowData);
      const seedResponse = await fetch(`/api/creator-seeding?creator_id=${creator.id}`);
      const seedData = await seedResponse.json();
      if (seedResponse.ok) setSeeds(seedData.seeds || []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (!initialCreatorId) return;
    openCreator({ id: initialCreatorId }).finally(() => onInitialCreatorLoaded?.());
  }, [initialCreatorId]);

  const refreshWorkflow = async (creatorId = selected?.id) => {
    if (!creatorId) return;
    const response = await fetch(`/api/creator-workflow?creator_id=${creatorId}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load creator workflow');
    setWorkflow(data);
  };

  const generateBrief = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_brief', creator_id: selected.id, ...briefForm }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not generate brief');
      setWorkflow(data.workflow);
      setDetailTab('briefs');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveOutreach = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'outreach', creator_id: selected.id, ...outreach }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save outreach');
      setWorkflow(data.workflow);
      setOutreach({ channel: 'email', subject: '', body: '', status: 'draft', next_follow_up_at: defaultFollowUpDate() });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const sendEmail = async () => {
    if (!selected?.email) {
      setError('Add an email address to this creator before sending.');
      return;
    }
    if (!outreach.subject.trim() || !outreach.body.trim()) {
      setError('Subject and message are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_id: selected.id,
          to: selected.email,
          subject: outreach.subject,
          body: outreach.body,
          next_follow_up_at: outreach.next_follow_up_at,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.reconnect_required) setGmailConnected(false);
        throw new Error(data.error || 'Could not send email');
      }
      setOutreach({ channel: 'email', subject: '', body: '', status: 'draft', next_follow_up_at: defaultFollowUpDate() });
      await refreshWorkflow(selected.id);
      await loadCreators();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const syncOutreachReplies = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', creator_id: selected.id }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.reconnect_required) setGmailConnected(false);
        throw new Error(data.error || 'Could not sync Gmail replies');
      }
      await refreshWorkflow(selected.id);
      await loadCreators();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateOutreach = async (id, patch) => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'outreach', creator_id: selected.id, id, ...patch }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update outreach');
      setWorkflow(data.workflow);
      await loadCreators();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addEngagement = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'engagement', creator_id: selected.id, ...engagement }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save engagement');
      setWorkflow(data.workflow);
      setAgreement(current => ({ ...current, engagement_id: String(data.engagement.id) }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const prepareAgreement = async event => {
    event.preventDefault();
    if (!agreement.agreement_body.trim()) {
      setError('Paste your approved agreement language before preparing it.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_agreement', creator_id: selected.id, ...agreement }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not prepare agreement');
      const url = `${window.location.origin}${data.agreement_path}`;
      setPreparedAgreement({ ...data.agreement, url });
      setWorkflow(data.workflow);
      await navigator.clipboard?.writeText(url).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const chooseAgreementTemplate = templateId => {
    const template = agreementTemplates.find(item => String(item.id) === String(templateId));
    setPreparedAgreement(null);
    setAgreement(current => ({
      ...current,
      template_id: templateId,
      title: template?.title || 'HOWL Creator Content Usage Agreement',
      agreement_body: template?.agreement_body || '',
    }));
  };

  const sendAgreement = async () => {
    if (!preparedAgreement || !selected?.email) {
      setError('Prepare the agreement and add a creator email before sending.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_id: selected.id,
          agreement_id: preparedAgreement.id,
          to: selected.email,
          subject: `${preparedAgreement.title} - review and accept`,
          body: `Hi ${selected.name},\n\nPlease review and accept your HOWL creator agreement using the secure link below:\n\n${preparedAgreement.url}\n\nThis link expires on ${new Date(preparedAgreement.expires_at).toLocaleDateString()}.\n\nThank you,\nHOWL Campfires`,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.reconnect_required) setGmailConnected(false);
        throw new Error(data.error || 'Could not send agreement');
      }
      setPreparedAgreement(null);
      await refreshWorkflow(selected.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const revokeAgreement = async id => {
    setError('');
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke_agreement', creator_id: selected.id, id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not revoke agreement');
      setWorkflow(data.workflow);
      if (preparedAgreement?.id === id) setPreparedAgreement(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const draftOutreach = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_outreach',
          creator_id: selected.id,
          purpose: outreach.body || 'Introduce HOWL and explore a paid creator partnership',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not draft outreach');
      setWorkflow(data.workflow);
      setOutreach(current => ({ ...current, channel: 'email', subject: data.message.subject || '', body: data.message.body || '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addDeliverable = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deliverable', creator_id: selected.id, ...deliverable }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not add deliverable');
      setWorkflow(data.workflow);
      setDeliverable({ title: '', due_at: '', source_url: '', brief_id: '', engagement_id: '', expected_asset_count: '1' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateDeliverable = async (id, patch) => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'deliverable', creator_id: selected.id, id, ...patch }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update deliverable');
      await refreshWorkflow(selected.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const createSubmissionLink = async () => {
    if (!deliverable.title.trim()) {
      setError('Add a deliverable title before creating an upload link.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_submission_link',
          creator_id: selected.id,
          title: deliverable.title,
          brief_id: deliverable.brief_id || null,
          due_at: deliverable.due_at || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create upload link');
      const url = `${window.location.origin}${data.submission_path}`;
      setSubmissionLink(url);
      setWorkflow(data.workflow);
      await navigator.clipboard?.writeText(url).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const revokeSubmissionLink = async id => {
    setError('');
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'revoke_submission_link',
          creator_id: selected.id,
          id,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not revoke upload link');
      setWorkflow(data.workflow);
    } catch (err) {
      setError(err.message);
    }
  };

  const uploadFootage = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setError('Creator footage must be a video file.');
      return;
    }
    setSaving(true);
    setUploadProgress(0);
    setError('');
    try {
      const token = await getToken();
      const blob = await upload(`creator-footage/${selected.id}/${Date.now()}-${file.name}`, file, {
        access: 'public',
        handleUploadUrl: '/api/blob/upload-token',
        clientPayload: token,
        contentType: file.type,
        onUploadProgress: event => {
          if (event?.total) setUploadProgress(Math.round((event.loaded / event.total) * 100));
        },
      });
      const deliverableResponse = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ingest_footage',
          creator_id: selected.id,
          title: deliverable.title || file.name,
          brief_id: deliverable.brief_id || null,
          due_at: deliverable.due_at || null,
          video_url: blob.url,
          file_name: file.name,
          file_size: file.size,
        }),
      });
      const workflowData = await deliverableResponse.json();
      if (!deliverableResponse.ok) throw new Error(workflowData.error || 'Could not connect footage');
      setWorkflow(workflowData.workflow);
      setDeliverable({ title: '', due_at: '', source_url: '', brief_id: '', engagement_id: '', expected_asset_count: '1' });
      setUploadProgress(100);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const importCsv = (file) => {
    if (!file) return;
    setSaving(true);
    setImportResult(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data, errors }) => {
        try {
          if (errors.length && !data.length) throw new Error(errors[0].message);
          const response = await fetch('/api/creators-import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: data }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Import failed');
          setImportResult(result);
          await loadCreators();
        } catch (err) {
          setError(err.message);
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const syncClickup = async () => {
    setSaving(true);
    setImportResult(null);
    setError('');
    try {
      const response = await fetch('/api/creators-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clickup_sync' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'ClickUp sync failed');
      setImportResult(result);
      await loadCreators();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const createCreator = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create creator');
      setShowCreate(false);
      setForm(EMPTY_CREATOR);
      setSelected(data.creator);
      await loadCreators();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateCreator = async (patch) => {
    if (!selected) return;
    const optimistic = { ...selected, ...patch };
    setSelected(optimistic);
    try {
      const response = await fetch('/api/creators', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, ...patch }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update creator');
      setSelected(data.creator);
      await loadCreators();
    } catch (err) {
      setSelected(selected);
      setError(err.message);
    }
  };

  const saveCreatorIntel = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await updateCreator(creatorIntel);
    } finally {
      setSaving(false);
    }
  };

  const seedProduct = async event => {
    event.preventDefault();
    const [productId, variantId] = seedForm.product_variant.split('::');
    const product = shopifyProducts.find(item => item.id === productId);
    const variant = product?.variants?.find(item => item.id === variantId);
    if (!product || !variant) return setError('Choose a Shopify product variant.');
    if (!window.confirm(`Create a free Shopify order for ${seedForm.quantity} × ${product.title} and ship it to ${selected.name}?`)) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-seeding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_id: selected.id,
          product_id: product.id,
          variant_id: variant.id,
          product_title: product.title,
          variant_title: variant.title,
          sku: variant.sku,
          quantity: Number(seedForm.quantity) || 1,
          notes: seedForm.notes,
          request_key: crypto.randomUUID(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create Shopify seed order');
      setSeeds(current => [data.seed, ...current]);
      if (data.warning) setError(data.warning);
      setSeedForm({ product_variant: '', quantity: '1', notes: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const sendBriefAssignment = async brief => {
    if (!selected?.email) return setError('Add the creator email before sending an assignment.');
    if (!gmailConnected) return connectGmail();
    setSaving(true);
    setError('');
    try {
      const linkResponse = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_submission_link',
          creator_id: selected.id,
          brief_id: brief.id,
          title: brief.title,
          expires_in_days: 30,
        }),
      });
      const linkData = await linkResponse.json();
      if (!linkResponse.ok) throw new Error(linkData.error || 'Could not create assignment link');
      const url = `${window.location.origin}${linkData.submission_path}`;
      const emailResponse = await fetch('/api/creator-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_id: selected.id,
          to: selected.email,
          subject: `${brief.title} - HOWL creator assignment`,
          body: `Hi ${selected.name},\n\nYour next HOWL assignment is ready. The concept, script, deliverables, and footage upload are here:\n\n${url}\n\nPlease review the direction before filming and reply with any questions.\n\nThank you,\nHOWL Campfires`,
        }),
      });
      const emailData = await emailResponse.json();
      if (!emailResponse.ok) throw new Error(emailData.error || 'Could not send assignment');
      setWorkflow(linkData.workflow);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addNote = async (event) => {
    event.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    try {
      const response = await fetch('/api/creators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activity', creator_id: selected.id, kind: 'note', summary: note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not add note');
      setSelected(data.creator);
      setNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveSocial = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch('/api/creators', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, action: 'social', ...social }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save social account');
      setSelected(data.creator);
      setSocial({ platform: 'instagram', handle: '', profile_url: '', followers: '', avg_views: '', engagement_rate: '' });
      await loadCreators();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const syncSocial = async (account) => {
    setSyncingSocial(account.id);
    setError('');
    try {
      const response = await fetch('/api/creator-social-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator_id: selected.id, platform: account.platform }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not refresh social metrics');
      await openCreator(selected);
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncingSocial(null);
    }
  };

  return (
    <div className="creator-workspace">
      <header className="creator-head">
        <div>
          <span className="workspace-kicker">Creator operations</span>
          <h1>Creators</h1>
          <p>Source, qualify, brief, produce, and measure creator relationships in one record.</p>
        </div>
        {workspaceView === 'database' && canManageCreators && <div className="creator-head-actions"><button onClick={() => setShowImport(true)}>Import</button><button className="primary-action" onClick={() => setShowCreate(true)}>Add creator</button></div>}
      </header>

      <div className="creator-view-tabs">
        <button className={workspaceView === 'database' ? 'active' : ''} onClick={() => setWorkspaceView('database')}>Database</button>
        <button className={workspaceView === 'operations' ? 'active' : ''} onClick={() => setWorkspaceView('operations')}>Operations</button>
        <button className={workspaceView === 'talent' ? 'active' : ''} onClick={() => setWorkspaceView('talent')}>Talent inbox</button>
        <button className={workspaceView === 'health' ? 'active' : ''} onClick={() => setWorkspaceView('health')}>Data health</button>
      </div>

      {workspaceView === 'database' ? (
      <>
      <div className="creator-toolbar">
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name or email" />
        <div className="creator-stage-tabs">
          {STAGES.map(([key, label]) => (
            <button key={key} className={stage === key ? 'active' : ''} onClick={() => setStage(key)}>
              {label}{key !== 'all' && counts[key] ? ` ${counts[key]}` : ''}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="app-error">{error}</div>}

      <div className={`creator-layout ${selected ? 'detail-open' : ''}`}>
        <section className="creator-list-panel">
          <div className="creator-list-head">
            <span>Creator</span>
            <span>Pipeline</span>
            <span>Audience</span>
            <span>Focus</span>
            <span>Rates</span>
            <span>Location</span>
            <span>Output</span>
          </div>
          {!loading && creators.length === 0 && (
            <div className="creator-empty">
              <strong>No creators here yet.</strong>
              <p>Add the first record or change the current filter.</p>
            </div>
          )}
          {creators.map(creator => {
            const primarySocial = strongestSocial(creator.social_accounts);
            const focus = creator.activities?.length ? creator.activities : creator.tags;
            return (
              <button key={creator.id} className={`creator-row ${selected?.id === creator.id ? 'active' : ''}`} onClick={() => openCreator(creator)}>
                <span className="creator-row-identity">
                  <CreatorAvatar creator={creator} />
                  <span className="creator-row-name">
                    <strong>{creator.name}</strong>
                    <small>{creator.email || creator.phone || 'No contact info'}</small>
                  </span>
                </span>
                <span className="creator-pipeline">
                  <span className={`creator-stage stage-${creator.stage}`}>{creator.stage}</span>
                  <small className={creator.next_follow_up_at && new Date(creator.next_follow_up_at) <= new Date() ? 'follow-up-due' : ''}>
                    {creator.next_follow_up_at
                      ? `${new Date(creator.next_follow_up_at) <= new Date() ? 'Follow up due' : 'Follow up'} ${new Date(creator.next_follow_up_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                      : creator.status}
                  </small>
                </span>
                <span className="creator-reach">
                  <strong>{displayMetric(primarySocial?.followers)}</strong>
                  <small>{primarySocial?.handle ? `@${primarySocial.handle.replace(/^@/, '')}` : primarySocial?.platform || 'No social'}</small>
                </span>
                <span className="creator-focus" title={compactText(focus, 'Not set')}>
                  <strong>{compactText(focus, 'Not set')}</strong>
                  <small>{creator.tags?.length ? compactText(creator.tags) : 'No tags'}</small>
                </span>
                <span className="creator-rates" title={creator.rate_notes || 'No rates recorded'}>
                  <strong>{creator.rate_notes || 'Not set'}</strong>
                  <small>rate notes</small>
                </span>
                <span className="creator-location" title={creator.location || 'No location'}>
                  <strong>{creator.location || 'Not set'}</strong>
                  <small>{creator.timezone || 'location'}</small>
                </span>
                <span className="creator-launches">
                  <strong>{creator.launch_count || 0}</strong>
                  <small>{creator.last_launch_at ? `Last ${new Date(creator.last_launch_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'launches'}</small>
                </span>
              </button>
            );
          })}
        </section>

        {selected && (
          <aside className="creator-detail">
            <button className="detail-close" onClick={() => setSelected(null)} aria-label="Close creator detail">Close</button>
            <div className="creator-identity">
              <CreatorAvatar creator={selected} large />
              <div>
                <h2>{selected.name}</h2>
                <p>{selected.email || 'No email'}{selected.location ? ` · ${selected.location}` : ''}</p>
              </div>
            </div>

            <div className="creator-status-row">
              <label>
                Stage
                <select value={selected.stage} disabled={!canManageCreators} onChange={event => updateCreator({ stage: event.target.value })}>
                  {STAGES.slice(1).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label>
                Status
                <select value={selected.status} disabled={!canManageCreators} onChange={event => updateCreator({ status: event.target.value })}>
                  <option value="prospect">Prospect</option>
                  <option value="qualified">Qualified</option>
                  <option value="contracted">Contracted</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>
            {workflow.guidance?.next_action && (
              <section className={`creator-next-action ${workflow.guidance.next_action.urgent ? 'urgent' : ''} ${workflow.guidance.next_action.waiting ? 'waiting' : ''}`}>
                <div className="creator-lifecycle">
                  {workflow.guidance.milestones.map(item => (
                    <div key={item.key} className={item.status}>
                      <i>{item.status === 'complete' ? '✓' : ''}</i>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
                <div className="next-action-copy">
                  <span>{workflow.guidance.next_action.waiting ? 'Waiting state' : workflow.guidance.next_action.blocker ? 'Needs attention' : 'Next best action'}</span>
                  <strong>{workflow.guidance.next_action.label}</strong>
                  <p>{workflow.guidance.next_action.description}</p>
                </div>
                <div className="next-action-buttons">
                  <button className="primary-action" onClick={() => setDetailTab(workflow.guidance.next_action.tab)}>
                    Open {workflow.guidance.next_action.tab}
                  </button>
                  {canManageCreators
                    && workflow.guidance.next_action.recommended_stage
                    && selected.stage !== workflow.guidance.next_action.recommended_stage && (
                      <button
                        disabled={saving}
                        onClick={() => updateCreator({ stage: workflow.guidance.next_action.recommended_stage })}
                      >
                        Align stage to {workflow.guidance.next_action.recommended_stage}
                      </button>
                    )}
                </div>
              </section>
            )}
            <div className="creator-performance">
              <div><span>Spend · 90d</span><strong>${Number(selected.performance?.spend || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
              <div><span>Revenue · 90d</span><strong>${Number(selected.performance?.revenue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
              <div><span>ROAS</span><strong>{Number(selected.performance?.spend) > 0 ? (Number(selected.performance.revenue) / Number(selected.performance.spend)).toFixed(2) : '—'}</strong></div>
            </div>

            <div className="creator-detail-tabs">
              {['profile', 'products', 'agreements', 'briefs', 'outreach', 'deliverables', 'performance'].map(tab => (
                <button key={tab} className={detailTab === tab ? 'active' : ''} onClick={() => setDetailTab(tab)}>
                  {tab}{tab === 'briefs' && workflow.briefs.length ? ` ${workflow.briefs.length}` : ''}
                </button>
              ))}
            </div>

            {detailTab === 'profile' && <>
            <section className="creator-detail-section">
              <div className="detail-section-head">
                <span>Social intelligence</span>
                <small>{selected.social_accounts?.length || 0} accounts</small>
              </div>
              <div className="social-account-grid">
                {selected.social_accounts?.map(account => (
                  <div key={account.id} className="social-account-wrap">
                  <a href={account.profile_url || undefined} target="_blank" rel="noreferrer" className="social-account">
                    <span>{account.platform}</span>
                    <strong>{account.handle || 'Profile'}</strong>
                    <div><b>{displayMetric(account.followers)}</b><small>followers</small></div>
                    <div><b>{displayMetric(account.avg_views)}</b><small>avg views</small></div>
                    <div><b>{account.engagement_rate == null ? '—' : `${account.engagement_rate}%`}</b><small>engagement</small></div>
                  </a>
                  {canManageCreators && account.platform === 'instagram' && (
                    <button className="social-sync" disabled={syncingSocial === account.id} onClick={() => syncSocial(account)}>
                      {syncingSocial === account.id ? 'Syncing' : 'Refresh'}
                    </button>
                  )}
                  {account.last_synced_at && <small className="social-synced">Synced {new Date(account.last_synced_at).toLocaleDateString()}</small>}
                  </div>
                ))}
              </div>
              {canManageCreators && (
                <details className="inline-editor">
                  <summary>Add or update account</summary>
                  <form onSubmit={saveSocial}>
                    <select value={social.platform} onChange={event => setSocial({ ...social, platform: event.target.value })}>
                      <option value="instagram">Instagram</option>
                      <option value="tiktok">TikTok</option>
                      <option value="youtube">YouTube</option>
                      <option value="facebook">Facebook</option>
                      <option value="other">Other</option>
                    </select>
                    <input placeholder="@handle" value={social.handle} onChange={event => setSocial({ ...social, handle: event.target.value })} />
                    <input placeholder="Profile URL" value={social.profile_url} onChange={event => setSocial({ ...social, profile_url: event.target.value })} />
                    <input type="number" placeholder="Followers" value={social.followers} onChange={event => setSocial({ ...social, followers: event.target.value })} />
                    <input type="number" placeholder="Avg views" value={social.avg_views} onChange={event => setSocial({ ...social, avg_views: event.target.value })} />
                    <input type="number" step="0.01" placeholder="Engagement %" value={social.engagement_rate} onChange={event => setSocial({ ...social, engagement_rate: event.target.value })} />
                    <button disabled={saving}>Save account</button>
                  </form>
                </details>
              )}
            </section>

            <section className="creator-detail-section">
              <div className="detail-section-head"><span>Creator context</span></div>
              <dl className="creator-facts">
                <div><dt>Niche</dt><dd>{selected.niche || 'Not set'}</dd></div>
                <div><dt>Strengths</dt><dd>{selected.strengths || 'Not set'}</dd></div>
                <div><dt>Audience</dt><dd>{selected.audience_demographics || 'Not set'}</dd></div>
                <div><dt>Psychographics</dt><dd>{selected.audience_psychographics || 'Not set'}</dd></div>
                <div><dt>Activities</dt><dd>{selected.activities?.join(', ') || 'Not set'}</dd></div>
                <div><dt>Tags</dt><dd>{selected.tags?.join(', ') || 'Not set'}</dd></div>
                <div><dt>Rates</dt><dd>{selected.rate_notes || 'Not set'}</dd></div>
                <div><dt>Bio</dt><dd>{selected.bio || 'Not set'}</dd></div>
                {selected.source_metadata?.clickup_status && <div><dt>ClickUp status</dt><dd>{selected.source_metadata.clickup_status}</dd></div>}
              </dl>
              {canManageCreators && (
                <details className="inline-editor creator-intel-editor">
                  <summary>Edit creator intelligence and shipping</summary>
                  <form onSubmit={saveCreatorIntel}>
                    <input placeholder="Niche" value={creatorIntel.niche} onChange={event => setCreatorIntel({ ...creatorIntel, niche: event.target.value })} />
                    <input placeholder="On-camera and production strengths" value={creatorIntel.strengths} onChange={event => setCreatorIntel({ ...creatorIntel, strengths: event.target.value })} />
                    <textarea placeholder="Audience demographics" value={creatorIntel.audience_demographics} onChange={event => setCreatorIntel({ ...creatorIntel, audience_demographics: event.target.value })} />
                    <textarea placeholder="Audience psychographics, motivations, objections" value={creatorIntel.audience_psychographics} onChange={event => setCreatorIntel({ ...creatorIntel, audience_psychographics: event.target.value })} />
                    <input placeholder="Shipping address" value={creatorIntel.shipping_address1} onChange={event => setCreatorIntel({ ...creatorIntel, shipping_address1: event.target.value })} />
                    <input placeholder="Address line 2" value={creatorIntel.shipping_address2} onChange={event => setCreatorIntel({ ...creatorIntel, shipping_address2: event.target.value })} />
                    <input placeholder="City" value={creatorIntel.shipping_city} onChange={event => setCreatorIntel({ ...creatorIntel, shipping_city: event.target.value })} />
                    <input placeholder="State / region" value={creatorIntel.shipping_region} onChange={event => setCreatorIntel({ ...creatorIntel, shipping_region: event.target.value })} />
                    <input placeholder="Postal code" value={creatorIntel.shipping_postal_code} onChange={event => setCreatorIntel({ ...creatorIntel, shipping_postal_code: event.target.value })} />
                    <input maxLength="2" placeholder="Country code" value={creatorIntel.shipping_country_code} onChange={event => setCreatorIntel({ ...creatorIntel, shipping_country_code: event.target.value.toUpperCase() })} />
                    <button disabled={saving}>Save creator profile</button>
                  </form>
                </details>
              )}
              {Object.keys(selected.source_metadata?.custom_fields || {}).length > 0 && (
                <details className="inline-editor">
                  <summary>Application details</summary>
                  <dl className="creator-facts">
                    {Object.entries(selected.source_metadata.custom_fields)
                      .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
                      .map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}
                  </dl>
                </details>
              )}
            </section>

            <section className="creator-detail-section">
              <div className="detail-section-head">
                <span>Activity</span>
                <small>{selected.launch_count || 0} launched assets</small>
              </div>
              {canManageCreators && (
                <form className="creator-note-form" onSubmit={addNote}>
                  <input value={note} onChange={event => setNote(event.target.value)} placeholder="Add a useful note" />
                  <button disabled={saving || !note.trim()}>Add</button>
                </form>
              )}
              <div className="creator-timeline">
                {selected.activity?.map(item => (
                  <div key={item.id}>
                    <i />
                    <span><strong>{item.summary}</strong><small>{new Date(item.created_at).toLocaleString()}</small></span>
                  </div>
                ))}
                {!selected.activity?.length && <p>No activity recorded yet.</p>}
              </div>
            </section>
            </>}

            {detailTab === 'products' && (
              <section className="creator-detail-section workflow-section">
                <div className="detail-section-head"><span>Product seeding</span><small>Shopify-backed fulfillment</small></div>
                {canManageCreators && (
                  <form className="workflow-form" onSubmit={seedProduct}>
                    <select required disabled={!shopifyConnected} value={seedForm.product_variant} onChange={event => setSeedForm({ ...seedForm, product_variant: event.target.value })}>
                      <option value="">{shopifyConnected ? 'Choose Shopify product' : 'Connect Shopify in Admin'}</option>
                      {shopifyProducts.flatMap(product => product.variants.map(variant => (
                        <option key={variant.id} value={`${product.id}::${variant.id}`} disabled={!variant.available_for_sale}>
                          {product.title}{variant.title !== 'Default Title' ? ` · ${variant.title}` : ''} · {variant.sku || 'no SKU'} · {variant.inventory_quantity ?? '—'} available
                        </option>
                      )))}
                    </select>
                    <div className="workflow-two">
                      <input type="number" min="1" max="20" value={seedForm.quantity} onChange={event => setSeedForm({ ...seedForm, quantity: event.target.value })} />
                      <input placeholder="Internal note" value={seedForm.notes} onChange={event => setSeedForm({ ...seedForm, notes: event.target.value })} />
                    </div>
                    <div className="seed-address">
                      <span>Ships to</span>
                      <strong>{selected.shipping_address1
                        ? `${selected.shipping_address1}, ${selected.shipping_city}, ${selected.shipping_region} ${selected.shipping_postal_code}`
                        : 'Add a shipping address in Profile first'}</strong>
                    </div>
                    <button className="primary-action" disabled={saving || !shopifyConnected || !selected.shipping_address1}>Create free Shopify order</button>
                  </form>
                )}
                <div className="workflow-list">
                  {seeds.map(seed => (
                    <article className="workflow-card seed-card" key={seed.id}>
                      <header><span><strong>{seed.product_title}</strong><small>{seed.variant_title || seed.sku || 'Shopify product'} · Qty {seed.quantity}</small></span><i>{seed.status}</i></header>
                      <div className="agreement-card-meta">
                        <span>{seed.shopify_order_name || 'Order pending'}</span>
                        <span>{new Date(seed.requested_at).toLocaleDateString()}</span>
                      </div>
                    </article>
                  ))}
                  {!seeds.length && <div className="workflow-empty">No products seeded yet.</div>}
                </div>
              </section>
            )}

            {detailTab === 'agreements' && (
              <section className="creator-detail-section workflow-section">
                {canManageCreators && (
                  <form className="workflow-form" onSubmit={addEngagement}>
                    <div className="detail-section-head"><span>Commercial terms</span><small>Retainer or one-off engagement</small></div>
                    <div className="workflow-two">
                      <select value={engagement.engagement_type} onChange={event => {
                        const engagementType = event.target.value;
                        setEngagement({
                          ...engagement,
                          engagement_type: engagementType,
                          commitment_period: engagementType === 'retainer' ? 'monthly' : 'total',
                        });
                      }}>
                        <option value="one_off">One-off creator</option>
                        <option value="retainer">Retainer creator</option>
                      </select>
                      <select value={engagement.status} onChange={event => setEngagement({ ...engagement, status: event.target.value })}>
                        <option value="draft">Draft</option>
                        <option value="approved">Approved</option>
                        <option value="active">Active</option>
                      </select>
                    </div>
                    <div className="workflow-three">
                      <label>Approval date<input type="date" value={engagement.approval_date} onChange={event => setEngagement({ ...engagement, approval_date: event.target.value })} /></label>
                      <label>Starts<input type="date" value={engagement.starts_on} onChange={event => setEngagement({ ...engagement, starts_on: event.target.value })} /></label>
                      <label>Ends<input type="date" value={engagement.ends_on} onChange={event => setEngagement({ ...engagement, ends_on: event.target.value })} /></label>
                    </div>
                    <div className="workflow-three">
                      <input type="number" min="0" placeholder="Asset commitment" value={engagement.asset_commitment} onChange={event => setEngagement({ ...engagement, asset_commitment: event.target.value })} />
                      <select value={engagement.commitment_period} onChange={event => setEngagement({ ...engagement, commitment_period: event.target.value })}>
                        <option value="total">Assets for full engagement</option>
                        <option value="monthly">Assets per month</option>
                      </select>
                      <input type="number" min="0" step="0.01" placeholder="Total fee" value={engagement.fee_amount} onChange={event => setEngagement({ ...engagement, fee_amount: event.target.value })} />
                    </div>
                    <input placeholder="Cadence notes, e.g. 2 videos every other week" value={engagement.cadence} onChange={event => setEngagement({ ...engagement, cadence: event.target.value })} />
                    <div className="workflow-two">
                      <input type="number" min="0" placeholder="Usage term months" value={engagement.usage_term_months} onChange={event => setEngagement({ ...engagement, usage_term_months: event.target.value })} />
                      <input placeholder="Payment terms" value={engagement.payment_terms} onChange={event => setEngagement({ ...engagement, payment_terms: event.target.value })} />
                    </div>
                    <div className="detail-section-head agreement-rate-head"><span>Rate card</span><small>Optional line-item pricing</small></div>
                    <div className="workflow-rate-grid">
                      <input type="number" min="0" step="0.01" placeholder="UGC video rate" value={engagement.ugc_video_rate} onChange={event => setEngagement({ ...engagement, ugc_video_rate: event.target.value })} />
                      <input type="number" min="0" step="0.01" placeholder="Raw footage rate" value={engagement.raw_footage_rate} onChange={event => setEngagement({ ...engagement, raw_footage_rate: event.target.value })} />
                      <input type="number" min="0" step="0.01" placeholder="Hook rate" value={engagement.hook_rate} onChange={event => setEngagement({ ...engagement, hook_rate: event.target.value })} />
                      <input type="number" min="0" step="0.01" placeholder="Photo rate" value={engagement.photo_rate} onChange={event => setEngagement({ ...engagement, photo_rate: event.target.value })} />
                      <input type="number" min="0" step="0.01" placeholder="Whitelisting / month" value={engagement.whitelisting_monthly_rate} onChange={event => setEngagement({ ...engagement, whitelisting_monthly_rate: event.target.value })} />
                    </div>
                    <div className="agreement-options">
                      <label><input type="checkbox" checked={engagement.paid_media_included} onChange={event => setEngagement({ ...engagement, paid_media_included: event.target.checked })} /> Paid media usage</label>
                      <label><input type="checkbox" checked={engagement.raw_footage_included} onChange={event => setEngagement({ ...engagement, raw_footage_included: event.target.checked })} /> Raw footage included</label>
                    </div>
                    <textarea rows="2" placeholder="Exclusivity notes" value={engagement.exclusivity_notes} onChange={event => setEngagement({ ...engagement, exclusivity_notes: event.target.value })} />
                    <textarea rows="2" placeholder="Internal engagement notes" value={engagement.notes} onChange={event => setEngagement({ ...engagement, notes: event.target.value })} />
                    <button className="primary-action" disabled={saving}>Save engagement</button>
                  </form>
                )}

                {canManageCreators && workflow.engagements?.length > 0 && (
                  <form className="workflow-form agreement-builder" onSubmit={prepareAgreement}>
                    <div className="detail-section-head"><span>Prepare usage agreement</span><small>Use language approved for HOWL</small></div>
                    <select value={agreement.engagement_id} onChange={event => setAgreement({ ...agreement, engagement_id: event.target.value })} required>
                      <option value="">Choose engagement</option>
                      {workflow.engagements.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.engagement_type === 'retainer' ? 'Retainer' : 'One-off'} · {item.asset_commitment || '—'} assets · {item.fee_amount ? `$${Number(item.fee_amount).toLocaleString()}` : 'fee not set'}
                        </option>
                      ))}
                    </select>
                    <select value={agreement.template_id} onChange={event => chooseAgreementTemplate(event.target.value)}>
                      <option value="">Custom approved language</option>
                      {agreementTemplates.map(item => (
                        <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>
                      ))}
                    </select>
                    <input
                      required
                      readOnly={Boolean(agreement.template_id)}
                      placeholder="Agreement title"
                      value={agreement.template_id ? renderedAgreement.title : agreement.title}
                      onChange={event => setAgreement({ ...agreement, title: event.target.value })}
                    />
                    <textarea
                      required
                      readOnly={Boolean(agreement.template_id)}
                      rows="12"
                      placeholder="Choose an approved template or paste approved agreement language. The exact text is locked when prepared."
                      value={agreement.template_id ? renderedAgreement.body : agreement.agreement_body}
                      onChange={event => setAgreement({ ...agreement, agreement_body: event.target.value })}
                    />
                    <div className="workflow-two">
                      <input type="number" min="1" max="60" value={agreement.expires_in_days} onChange={event => setAgreement({ ...agreement, expires_in_days: event.target.value })} />
                      <button className="primary-action" disabled={saving}>Prepare secure link</button>
                    </div>
                    <small className="agreement-legal-note">Use an agreement template approved by your legal counsel. HOWL records workflow and acceptance; it does not provide legal advice.</small>
                    {preparedAgreement && (
                      <div className="agreement-ready">
                        <input readOnly value={preparedAgreement.url} onFocus={event => event.target.select()} />
                        {gmailConnected
                          ? <button type="button" disabled={saving || !selected.email} onClick={sendAgreement}>Send with Gmail</button>
                          : <button type="button" disabled={saving} onClick={connectGmail}>Connect Gmail</button>}
                      </div>
                    )}
                  </form>
                )}

                <div className="workflow-list">
                  {workflow.agreements?.map(item => (
                    <article className="workflow-card agreement-card" key={item.id}>
                      <header>
                        <span>
                          <strong>{item.title}</strong>
                          <small>Version {item.version}{item.sent_at ? ` · Sent ${new Date(item.sent_at).toLocaleDateString()}` : ''}</small>
                        </span>
                        <i>{item.status}</i>
                      </header>
                      <div className="agreement-card-meta">
                        {item.viewed_at && <span>Viewed {new Date(item.viewed_at).toLocaleString()}</span>}
                        {item.accepted_at && <span>Accepted by {item.accepted_name} on {new Date(item.accepted_at).toLocaleString()}</span>}
                        {canManageCreators && ['draft', 'sent'].includes(item.status) && <button onClick={() => revokeAgreement(item.id)}>Revoke</button>}
                      </div>
                    </article>
                  ))}
                  {!workflow.agreements?.length && <div className="workflow-empty">No agreements prepared yet.</div>}
                </div>
              </section>
            )}

            {detailTab === 'briefs' && (
              <section className="creator-detail-section workflow-section">
                {canWriteBriefs && (
                  <form className="workflow-form" onSubmit={generateBrief}>
                    <div className="detail-section-head"><span>Generate from creator context</span><small>AI grounded in this profile and launch history</small></div>
                    <input required placeholder="Product" value={briefForm.product} onChange={event => setBriefForm({ ...briefForm, product: event.target.value })} />
                    <input placeholder="Objective" value={briefForm.objective} onChange={event => setBriefForm({ ...briefForm, objective: event.target.value })} />
                    <input placeholder="Angle or leave open" value={briefForm.angle} onChange={event => setBriefForm({ ...briefForm, angle: event.target.value })} />
                    <select value={briefForm.strategy_mode} onChange={event => setBriefForm({ ...briefForm, strategy_mode: event.target.value })}>
                      <option value="past_performers">Use past performers</option>
                      <option value="net_new">Build net new</option>
                    </select>
                    <textarea rows="3" placeholder="Additional direction" value={briefForm.direction} onChange={event => setBriefForm({ ...briefForm, direction: event.target.value })} />
                    <button className="primary-action" disabled={saving}>{saving ? 'Building brief...' : 'Generate brief + script'}</button>
                  </form>
                )}
                <div className="workflow-list">
                  {workflow.briefs.map(brief => (
                    <details key={brief.id} className="workflow-card" open={workflow.briefs[0]?.id === brief.id}>
                      <summary><span><strong>{brief.title}</strong><small>{brief.product || brief.angle || 'Creator brief'}</small></span><i>{brief.status}</i></summary>
                      <div className="workflow-card-body">
                        <h4>Brief</h4><p className="prewrap">{brief.brief}</p>
                        <h4>Script</h4><p className="prewrap">{brief.script}</p>
                        {!!brief.deliverables?.length && <><h4>Deliverables</h4><ul>{brief.deliverables.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
                        {canWriteBriefs && <button className="brief-send" disabled={saving} onClick={() => sendBriefAssignment(brief)}>Send assignment to creator</button>}
                      </div>
                    </details>
                  ))}
                  {!workflow.briefs.length && <div className="workflow-empty">No briefs yet. Generate one from the creator's actual context.</div>}
                </div>
              </section>
            )}

            {detailTab === 'outreach' && (
              <section className="creator-detail-section workflow-section">
                {canWriteBriefs && (
                  <form className="workflow-form" onSubmit={saveOutreach}>
                    <div className="detail-section-head"><span>Outreach</span><small>Email connection is credential-ready</small></div>
                    <div className="workflow-two">
                      <select value={outreach.channel} onChange={event => setOutreach({ ...outreach, channel: event.target.value })}><option value="email">Email</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="phone">Phone</option></select>
                      <select value={outreach.status} onChange={event => setOutreach({ ...outreach, status: event.target.value })}><option value="draft">Save draft</option><option value="sent">Mark sent</option></select>
                    </div>
                    <input placeholder="Subject" value={outreach.subject} onChange={event => setOutreach({ ...outreach, subject: event.target.value })} />
                    <textarea required rows="5" placeholder="Write the message" value={outreach.body} onChange={event => setOutreach({ ...outreach, body: event.target.value })} />
                    <label className="outreach-follow-up">Next follow-up<input type="datetime-local" value={outreach.next_follow_up_at} onChange={event => setOutreach({ ...outreach, next_follow_up_at: event.target.value })} /></label>
                    <div className="outreach-actions">
                      <button className="primary-action" disabled={saving}>Save outreach</button>
                      <button type="button" disabled={saving} onClick={draftOutreach}>Draft with AI</button>
                      {gmailConnected
                        ? <>
                          <button type="button" disabled={saving || outreach.channel !== 'email'} onClick={sendEmail}>Send with Gmail</button>
                          <button type="button" disabled={saving} onClick={syncOutreachReplies}>Sync replies</button>
                        </>
                        : <button type="button" disabled={saving} onClick={connectGmail}>Connect Gmail</button>}
                    </div>
                  </form>
                )}
                <div className="workflow-list">
                  {workflow.outreach.map(message => (
                    <article className="workflow-card outreach-card" key={message.id}>
                      <header>
                        <span>
                          <strong>{message.direction === 'inbound' ? `Reply: ${message.subject || message.channel}` : message.subject || `${message.channel} outreach`}</strong>
                          <small>
                            {new Date(message.sent_at || message.created_at).toLocaleString()}
                            {message.next_follow_up_at ? ` · follow up ${new Date(message.next_follow_up_at).toLocaleString()}` : ''}
                          </small>
                        </span>
                        <i>{message.outcome || message.status}</i>
                      </header>
                      <p>{message.body}</p>
                      {canWriteBriefs && message.direction === 'outbound' && (
                        <div className="outreach-card-actions">
                          <select value={message.status} disabled={saving} onChange={event => updateOutreach(message.id, {
                            status: event.target.value,
                            next_follow_up_at: event.target.value === 'replied' || event.target.value === 'closed' ? null : undefined,
                          })}>
                            <option value="draft">Draft</option>
                            <option value="sent">Sent</option>
                            <option value="follow_up">Follow up</option>
                            <option value="replied">Replied</option>
                            <option value="closed">Closed</option>
                          </select>
                          <select value={message.outcome || ''} disabled={saving} onChange={event => updateOutreach(message.id, {
                            outcome: event.target.value || null,
                            status: event.target.value ? 'closed' : message.status,
                            next_follow_up_at: event.target.value ? null : undefined,
                          })}>
                            <option value="">No outcome</option>
                            <option value="interested">Interested</option>
                            <option value="contracted">Contracted</option>
                            <option value="not_interested">Not interested</option>
                            <option value="no_response">No response</option>
                          </select>
                          <label>Next action<input type="datetime-local" defaultValue={message.next_follow_up_at ? new Date(new Date(message.next_follow_up_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onBlur={event => updateOutreach(message.id, { next_follow_up_at: event.target.value || null, status: event.target.value ? 'follow_up' : message.status })} /></label>
                        </div>
                      )}
                    </article>
                  ))}
                  {!workflow.outreach.length && <div className="workflow-empty">No outreach recorded.</div>}
                </div>
              </section>
            )}

            {detailTab === 'deliverables' && (
              <section className="creator-detail-section workflow-section">
                <div className="production-summary">
                  <div><span>Due this month</span><strong>{workflow.production_summary?.due_this_month || 0}</strong></div>
                  <div><span>Received</span><strong>{workflow.production_summary?.received || 0}</strong></div>
                  <div><span>Completed</span><strong>{workflow.production_summary?.completed || 0}</strong></div>
                  <div className={Number(workflow.production_summary?.overdue || 0) > 0 ? 'risk' : ''}><span>Overdue</span><strong>{workflow.production_summary?.overdue || 0}</strong></div>
                </div>
                {canWriteAssets && (
                  <form className="workflow-form" onSubmit={addDeliverable}>
                    <div className="detail-section-head"><span>Footage and deliverables</span><small>Connect raw footage to editing and launch</small></div>
                    <input required placeholder="Deliverable title" value={deliverable.title} onChange={event => setDeliverable({ ...deliverable, title: event.target.value })} />
                    <div className="workflow-two">
                      <select value={deliverable.engagement_id} onChange={event => setDeliverable({ ...deliverable, engagement_id: event.target.value })}>
                        <option value="">No linked engagement</option>
                        {workflow.engagements.map(item => <option key={item.id} value={item.id}>{item.engagement_type === 'retainer' ? 'Retainer' : 'One-off'} · {item.asset_commitment || '—'} assets</option>)}
                      </select>
                      <select value={deliverable.brief_id} onChange={event => setDeliverable({ ...deliverable, brief_id: event.target.value })}>
                        <option value="">No linked brief</option>
                        {workflow.briefs.map(brief => <option key={brief.id} value={brief.id}>{brief.title}</option>)}
                      </select>
                    </div>
                    <div className="workflow-two">
                      <input type="datetime-local" value={deliverable.due_at} onChange={event => setDeliverable({ ...deliverable, due_at: event.target.value })} />
                      <input type="number" min="1" max="10000" placeholder="Expected asset count" value={deliverable.expected_asset_count} onChange={event => setDeliverable({ ...deliverable, expected_asset_count: event.target.value })} />
                    </div>
                    <input placeholder="Drive or asset URL" value={deliverable.source_url} onChange={event => setDeliverable({ ...deliverable, source_url: event.target.value })} />
                    <div className="deliverable-actions">
                      <button className="primary-action" disabled={saving}>Add deliverable</button>
                      <button type="button" disabled={saving} onClick={createSubmissionLink}>Create creator upload link</button>
                    </div>
                    {submissionLink && (
                      <div className="submission-link-created">
                        <span>Copied to clipboard</span>
                        <input readOnly value={submissionLink} onFocus={event => event.target.select()} />
                      </div>
                    )}
                  </form>
                )}
                {canWriteAssets && (
                  <label className="creator-footage-upload">
                    <input type="file" accept="video/*" onChange={event => uploadFootage(event.target.files?.[0])} />
                    <strong>{saving && uploadProgress < 100 ? `Uploading ${uploadProgress}%` : 'Upload creator footage'}</strong>
                    <span>Creates a linked UGC Editor session automatically.</span>
                  </label>
                )}
                <div className="workflow-list">
                  {workflow.submission_links?.map(link => (
                    <article className="workflow-card submission-link-card" key={`submission-${link.id}`}>
                      <header>
                        <span>
                          <strong>{link.title}</strong>
                          <small>Expires {new Date(link.expires_at).toLocaleDateString()}</small>
                        </span>
                        <i>{link.status}</i>
                      </header>
                      {canWriteAssets && link.status === 'active' && (
                        <button onClick={() => revokeSubmissionLink(link.id)}>Revoke upload link</button>
                      )}
                    </article>
                  ))}
                  {workflow.deliverables.map(item => (
                    <article className="workflow-card deliverable-card" key={item.id}>
                      <header><span><strong>{item.title}</strong><small>{item.due_at ? `Due ${new Date(item.due_at).toLocaleDateString()}` : 'No due date'} · {item.expected_asset_count || 1} expected</small></span><i>{item.status}</i></header>
                      <div className="deliverable-progress">
                        {[
                          ['Received', item.received_asset_count],
                          ['Approved', item.approved_asset_count],
                          ['Completed', item.completed_asset_count],
                          ['Shipped', item.shipped_asset_count],
                        ].map(([label, count]) => (
                          <div key={label}>
                            <span>{label}</span>
                            <strong>{count || 0}/{item.expected_asset_count || 1}</strong>
                            <i style={{ width: `${Math.min(100, ((Number(count) || 0) / Math.max(1, Number(item.expected_asset_count) || 1)) * 100)}%` }} />
                          </div>
                        ))}
                      </div>
                      {canWriteAssets && (
                        <div className="deliverable-controls">
                          <select value={item.status} disabled={saving} onChange={event => updateDeliverable(item.id, { status: event.target.value })}>
                            <option value="requested">Requested</option>
                            <option value="received">Received</option>
                            <option value="editing">Editing</option>
                            <option value="edited">Edited</option>
                            <option value="approved">Approved</option>
                            <option value="complete">Complete</option>
                            <option value="launched">Launched</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                          <label>Received<input type="number" min="0" max={item.expected_asset_count || 1} defaultValue={item.received_asset_count || 0} onBlur={event => updateDeliverable(item.id, { received_asset_count: event.target.value })} /></label>
                          <label>Approved<input type="number" min="0" max={item.expected_asset_count || 1} defaultValue={item.approved_asset_count || 0} onBlur={event => updateDeliverable(item.id, { approved_asset_count: event.target.value })} /></label>
                          <label>Complete<input type="number" min="0" max={item.expected_asset_count || 1} defaultValue={item.completed_asset_count || 0} onBlur={event => updateDeliverable(item.id, { completed_asset_count: event.target.value })} /></label>
                        </div>
                      )}
                      {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">Open source asset</a>}
                      {item.output_url && <a href={item.output_url} target="_blank" rel="noreferrer">Open finished edit</a>}
                      {canWriteAssets && item.ugc_session_id && (
                        <button className="editor-linked" onClick={() => onOpenEditor?.(item.ugc_session_id)}>
                          Open in UGC Editor
                        </button>
                      )}
                    </article>
                  ))}
                  {!workflow.deliverables.length && <div className="workflow-empty">No deliverables requested or received.</div>}
                </div>
              </section>
            )}

            {detailTab === 'performance' && (
              <section className="creator-detail-section workflow-section creator-performance-detail">
                <div className="detail-section-head">
                  <span>Launched creative · 90 days</span>
                  <small>{selected.performance_assets?.length || 0} attributed ads</small>
                </div>
                <div className="creator-performance-list">
                  {selected.performance_assets?.map(asset => {
                    const spend = Number(asset.spend || 0);
                    const revenue = Number(asset.revenue || 0);
                    const isVideo = asset.mime_type?.startsWith('video/') || /\.mp4(?:$|\?)/i.test(asset.asset_url || '');
                    return (
                      <article key={`${asset.ad_id}-${asset.launched_at}`} className="creator-performance-asset">
                        <a className="performance-asset-preview" href={asset.asset_url || undefined} target="_blank" rel="noreferrer">
                          {asset.thumbnail_url
                            ? <img src={asset.thumbnail_url} alt="" />
                            : isVideo && asset.asset_url
                              ? <video src={asset.asset_url} muted preload="metadata" />
                              : asset.asset_url
                                ? <img src={asset.asset_url} alt="" />
                            : <span>No preview</span>}
                        </a>
                        <div className="performance-asset-copy">
                          <strong>{asset.ad_name || `Meta ad ${asset.ad_id}`}</strong>
                          <small>{asset.deliverable_title || asset.brief_title || 'Unlinked historical asset'}</small>
                          <span>{asset.launched_at ? new Date(asset.launched_at).toLocaleDateString() : 'Launch date unavailable'}</span>
                        </div>
                        <dl>
                          <div><dt>Spend</dt><dd>${spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}</dd></div>
                          <div><dt>Revenue</dt><dd>${revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</dd></div>
                          <div><dt>ROAS</dt><dd>{spend > 0 ? (revenue / spend).toFixed(2) : '—'}</dd></div>
                          <div><dt>Orders</dt><dd>{Number(asset.purchases || 0).toLocaleString()}</dd></div>
                        </dl>
                      </article>
                    );
                  })}
                  {!selected.performance_assets?.length && (
                    <div className="workflow-empty">
                      No attributed launches yet. Finished creator edits will appear here after launch and analytics sync.
                    </div>
                  )}
                </div>
              </section>
            )}
          </aside>
        )}
      </div>
      </>
      ) : workspaceView === 'operations' ? (
        <CreatorOperationsWorkspace
          onOpenCreator={(creator, targetTab) => {
            setWorkspaceView('database');
            openCreator(creator, targetTab);
          }}
        />
      ) : workspaceView === 'talent' ? (
        <CreatorAcquisitionWorkspace
          canManage={canManageCreators}
          onPromoted={creator => {
            setWorkspaceView('database');
            loadCreators().then(() => openCreator(creator));
          }}
        />
      ) : (
        <CreatorDataHealthWorkspace
          canMerge={canMergeCreators}
          onOpenCreator={creator => {
            setWorkspaceView('database');
            openCreator(creator, 'profile');
          }}
        />
      )}

      {showCreate && (
        <div className="app-modal-backdrop" onMouseDown={() => setShowCreate(false)}>
          <form className="app-modal" onSubmit={createCreator} onMouseDown={event => event.stopPropagation()}>
            <header><div><span className="workspace-kicker">New relationship</span><h2>Add creator</h2></div><button type="button" onClick={() => setShowCreate(false)}>Close</button></header>
            <div className="app-form-grid">
              <label className="wide">Name<input autoFocus required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
              <label>Email<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
              <label>Phone<input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
              <label>Location<input value={form.location} onChange={event => setForm({ ...form, location: event.target.value })} /></label>
              <label>Stage<select value={form.stage} onChange={event => setForm({ ...form, stage: event.target.value })}>{STAGES.slice(1).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="wide">Activities<input placeholder="running, hunting, overlanding" value={form.activities} onChange={event => setForm({ ...form, activities: event.target.value })} /></label>
              <label className="wide">Tags<input placeholder="Colorado, truck, technical" value={form.tags} onChange={event => setForm({ ...form, tags: event.target.value })} /></label>
              <label className="wide">Bio<textarea rows="3" value={form.bio} onChange={event => setForm({ ...form, bio: event.target.value })} /></label>
              <label className="wide">Rate notes<textarea rows="2" value={form.rate_notes} onChange={event => setForm({ ...form, rate_notes: event.target.value })} /></label>
            </div>
            <footer><button type="button" onClick={() => setShowCreate(false)}>Cancel</button><button className="primary-action" disabled={saving}>{saving ? 'Adding...' : 'Add creator'}</button></footer>
          </form>
        </div>
      )}
      {showImport && (
        <div className="app-modal-backdrop" onMouseDown={() => setShowImport(false)}>
          <div className="app-modal import-modal" onMouseDown={event => event.stopPropagation()}>
            <header><div><span className="workspace-kicker">ClickUp intake</span><h2>Import creators</h2></div><button onClick={() => setShowImport(false)}>Close</button></header>
            <div className="import-body">
              <p>Export your ClickUp applicant list as CSV. HOWL recognizes common columns including name, email, phone, location, activities, tags, notes, and task ID.</p>
              <label className="import-drop">
                <input type="file" accept=".csv,text/csv" onChange={event => importCsv(event.target.files?.[0])} />
                <strong>{saving ? 'Importing...' : 'Choose ClickUp CSV'}</strong>
                <span>Existing records update by ClickUp task ID or email.</span>
              </label>
              <div className="clickup-sync-row">
                <span>{clickupConfigured ? 'Direct ClickUp sync is connected.' : 'Direct sync needs CLICKUP_API_TOKEN and CLICKUP_CREATOR_LIST_ID.'}</span>
                <button disabled={!clickupConfigured || saving} onClick={syncClickup}>Sync ClickUp</button>
              </div>
              {importResult && <div className="import-result"><strong>{importResult.created} created</strong><strong>{importResult.updated} updated</strong><span>{importResult.skipped?.length || 0} skipped</span></div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
