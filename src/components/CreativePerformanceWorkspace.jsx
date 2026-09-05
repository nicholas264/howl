import React, { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

const METRICS = {
  cpa: { label: 'CPA', format: v => v == null ? '—' : `$${v.toFixed(0)}`, better: 'low' },
  roas: { label: 'ROAS', format: v => `${(v || 0).toFixed(2)}x`, better: 'high' },
  purchases: { label: 'Purchases', format: v => Math.round(v || 0).toLocaleString(), better: 'high' },
  spend: { label: 'Spend', format: v => `$${Math.round(v || 0).toLocaleString()}`, better: 'high' },
  purchaseValue: { label: 'Purchase value', format: v => `$${Math.round(v || 0).toLocaleString()}`, better: 'high' },
  ctr: { label: 'CTR', format: v => `${((v || 0) * 100).toFixed(2)}%`, better: 'high' },
  hookRate: { label: 'Hook rate', format: v => `${((v || 0) * 100).toFixed(1)}%`, better: 'high' },
};

const SOURCE_TAGS = [
  { value: 'founder', label: 'Founder', placeholder: 'Founder name' },
  { value: 'internal_employee', label: 'Internal', placeholder: 'Team member name' },
  { value: 'tool_generated', label: 'Made in tool', placeholder: 'Made in HOWL' },
];

const TASK_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
];

function sourceTypeLabel(type) {
  return ({
    external_creator: 'Creator UGC',
    internal_employee: 'Internal',
    founder: 'Founder',
    tool_generated: 'Made in tool',
  })[type] || (type ? type.replaceAll('_', ' ') : 'Unattributed');
}

function statusFor(g) {
  if ((g.spend || 0) < 50 && !(g.purchases > 0)) return 'Learning';
  if ((g.roas || 0) >= 2 && (g.purchases || 0) >= 2) return 'Winner';
  if ((g.spend || 0) >= 100 && (g.roas || 0) < 1) return 'Stop';
  if ((g.ctr || 0) < 0.008 && (g.spend || 0) >= 75) return 'Hook weak';
  if ((g.hookRate || 0) > 0.25 && (g.roas || 0) < 1.5) return 'Fix offer';
  return 'Watch';
}

function metricRange(groups, key) {
  const values = groups.map(g => g[key]).filter(v => typeof v === 'number' && Number.isFinite(v));
  return { min: Math.min(...values, 0), max: Math.max(...values, 1) };
}

function labelForState(value, fallback = 'Missing') {
  return value ? value.replaceAll('-', ' ') : fallback;
}

function playableStateFor(group) {
  if (group.assetKind !== 'video') return 'N/A';
  if (group.playableUrl || group.playbackEmbedUrl) return 'ready';
  return group.playbackStatus || (group.assetId ? 'missing' : 'no asset');
}

function readinessFor(group) {
  if (group.assetKind === 'video' && !group.playableUrl && !group.playbackEmbedUrl) return 'Needs playback';
  if (group.assetKind === 'video' && group.transcriptStatus !== 'complete') return 'Needs transcript';
  if (!group.isAnalyzed) return 'Needs analysis';
  return 'Ready';
}

function qualityStateFor(group) {
  if (group.assetKind === 'video' && !group.playableUrl && !group.playbackEmbedUrl) {
    return { label: 'Source blocked', tone: 'bad', action: 'Repair playback' };
  }
  if (!group.isAnalyzed) {
    return { label: 'Needs analysis', tone: 'warn', action: 'Analyze creative' };
  }
  if (group.analysisConfidence != null && Number(group.analysisConfidence) < 0.45) {
    return { label: 'Limited evidence', tone: 'warn', action: group.analysisRecommendedNextStep || 'Review source' };
  }
  if (group.assetKind === 'video' && group.transcriptStatus !== 'complete') {
    return { label: 'Transcript missing', tone: 'warn', action: group.analysisRecommendedNextStep || 'Add script when available' };
  }
  return { label: 'Decision ready', tone: 'good', action: group.analysisRecommendedNextStep || 'Review and iterate' };
}

function percent(part, total) {
  if (!total) return 100;
  return Math.round((part / total) * 100);
}

function normalizeMatchKey(value) {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = text || '';
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function csvObjects(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(header => normalizeMatchKey(header).replaceAll(' ', '_'));
  if (!headers.includes('group_key') && !headers.includes('creative_name')) return [];
  return rows.slice(1).map(row => headers.reduce((object, header, index) => {
    object[header] = (row[index] || '').trim();
    return object;
  }, {}));
}

function parseTranscriptIntake(text, transcriptGaps) {
  const byGroupKey = new Map(transcriptGaps.map(group => [String(group.groupKey).toLowerCase(), group]));
  const byName = new Map(transcriptGaps.map(group => [normalizeMatchKey(group.name), group]));
  const entries = [];
  const unmatched = [];
  const csvRows = csvObjects(text);
  if (csvRows.length) {
    for (const row of csvRows) {
      const key = row.group_key || row.creative_name;
      const transcript = row.script_or_transcript || row.transcript || row.script || '';
      if (!transcript || transcript.length < 12) {
        unmatched.push(`${key || row.creative_name || 'CSV row'} -> transcript too short`);
        continue;
      }
      const group = byGroupKey.get(String(key).toLowerCase()) || byName.get(normalizeMatchKey(key));
      if (!group) unmatched.push(key || row.creative_name || 'CSV row');
      else entries.push({ group, transcript });
    }
    return { entries, unmatched };
  }
  for (const rawLine of (text || '').split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.includes('::') ? '::' : (line.includes('\t') ? '\t' : null);
    if (!separator) {
      unmatched.push(line.slice(0, 120));
      continue;
    }
    const [rawKey, ...rest] = line.split(separator);
    const transcript = rest.join(separator).trim();
    const key = rawKey.replace(/^\d+\.\s*/, '').trim();
    if (!key || transcript.length < 12) {
      unmatched.push(line.slice(0, 120));
      continue;
    }
    const group = byGroupKey.get(key.toLowerCase()) || byName.get(normalizeMatchKey(key));
    if (!group) {
      unmatched.push(key);
      continue;
    }
    entries.push({ group, transcript });
  }
  return { entries, unmatched };
}

function parseAttributionIntake(text, sourceReviewGroups, creators) {
  const byGroupKey = new Map(sourceReviewGroups.map(group => [String(group.groupKey).toLowerCase(), group]));
  const byName = new Map(sourceReviewGroups.map(group => [normalizeMatchKey(group.name), group]));
  const creatorsByName = new Map();
  const ambiguousCreatorNames = new Set();
  for (const creator of creators) {
    const key = normalizeMatchKey(creator.name);
    if (!key) continue;
    if (creatorsByName.has(key)) ambiguousCreatorNames.add(key);
    creatorsByName.set(key, creator);
  }
  const entries = [];
  const unmatched = [];
  const addAssignment = (groupKey, assignment) => {
    const group = byGroupKey.get(String(groupKey).toLowerCase()) || byName.get(normalizeMatchKey(groupKey));
    if (!group || !assignment) {
      unmatched.push(groupKey || 'CSV row');
      return;
    }
    const normalizedAssignment = normalizeMatchKey(assignment);
    if (ambiguousCreatorNames.has(normalizedAssignment)) {
      unmatched.push(`${groupKey} -> ${assignment} matches more than one creator`);
      return;
    }
    const creator = creatorsByName.get(normalizedAssignment);
    if (creator) {
      entries.push({ group, creator });
      return;
    }
    const lower = assignment.toLowerCase();
    if (lower === 'made in howl' || lower === 'tool' || lower === 'tool_generated') {
      entries.push({ group, sourceType: 'tool_generated', sourceLabel: 'Made in HOWL' });
      return;
    }
    if (lower.startsWith('founder')) {
      entries.push({ group, sourceType: 'founder', sourceLabel: assignment.split(':').slice(1).join(':').trim() || 'Founder' });
      return;
    }
    if (lower.startsWith('internal')) {
      entries.push({ group, sourceType: 'internal_employee', sourceLabel: assignment.split(':').slice(1).join(':').trim() || 'HOWL team' });
      return;
    }
    unmatched.push(`${groupKey} -> ${assignment || 'missing assignment'}`);
  };
  const csvRows = csvObjects(text);
  if (csvRows.length) {
    for (const row of csvRows) {
      const assignment = row.confirmed_assignment || row.assignment || row.creator_name || row.source || '';
      if (!assignment) {
        unmatched.push(`${row.group_key || row.creative_name || 'CSV row'} -> missing assignment`);
        continue;
      }
      addAssignment(row.group_key || row.creative_name, assignment);
    }
    return { entries, unmatched };
  }
  for (const rawLine of (text || '').split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.includes('::') ? '::' : (line.includes('\t') ? '\t' : null);
    if (!separator) {
      unmatched.push(line.slice(0, 120));
      continue;
    }
    const [rawKey, ...rest] = line.split(separator);
    const groupKey = rawKey.replace(/^\d+\.\s*/, '').trim();
    const assignment = rest.join(separator).trim();
    addAssignment(groupKey, assignment);
  }
  return { entries, unmatched };
}

function ymdLabel(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year}`;
}

function auditEventLabel(type) {
  return ({
    creator_assigned: 'Creator assigned',
    creator_assigned_batch: 'Creator assigned',
    source_tagged: 'Source tagged',
    assignment_removed: 'Assignment removed',
    manual_transcript_analyzed: 'Transcript analyzed',
  })[type] || labelForState(type, 'Activity');
}

function relativeTime(value) {
  if (!value) return '';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function taskStatusLabel(value) {
  return TASK_STATUSES.find(status => status.value === value)?.label || 'Open';
}

function normalizeTaskDate(value) {
  if (!value) return '';
  const text = value.toString();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function taskDueBucket(task, todayKey = localDateKey()) {
  const dueDate = normalizeTaskDate(task?.dueDate);
  const status = task?.status || 'open';
  if (status === 'done') return 'clear';
  if (!dueDate) return 'no_due';
  if (dueDate < todayKey) return 'overdue';
  if (dueDate === todayKey) return 'today';
  return 'future';
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection-based copy path for browsers with stricter permissions.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) throw new Error('Clipboard copy was blocked by the browser.');
  return true;
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadTextFile(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function CreativePerformanceWorkspace({
  creativeTable,
  loading,
  error,
  windowDays,
  setWindowDays,
  syncing,
  syncMessage,
  onSync,
  analysisQueue,
  analysisQueueLoading,
  analysisQueueMessage,
  analysisBatchRunning,
  onProcessAnalysisBatch,
  onRetryAnalysisBatch,
  onRefreshAnalysisQueue,
  onNormalizeAsset,
  onNormalizeAssetBatch,
  playbackRepairRunning,
  playbackRepairMessage,
  onAnalyze,
  onOpenAnalysis,
  onAssignCreator,
  onAssignCreators,
  canManageCreators,
  setActiveTab,
}) {
  const [viewMode, setViewMode] = useState('cards');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('All');
  const [readinessFilter, setReadinessFilter] = useState('All');
  const [creatorFilter, setCreatorFilter] = useState('All');
  const [sortKey, setSortKey] = useState('purchaseValue');
  const [selectedMetrics, setSelectedMetrics] = useState(['cpa', 'roas', 'purchases', 'spend', 'purchaseValue']);
  const [selected, setSelected] = useState(() => new Set());
  const [creators, setCreators] = useState([]);
  const [assigning, setAssigning] = useState('');
  const [assignmentMessage, setAssignmentMessage] = useState('');
  const [assignmentError, setAssignmentError] = useState(false);
  const [batchAssigning, setBatchAssigning] = useState(false);
  const [repairingPlayback, setRepairingPlayback] = useState('');
  const [playbackMessage, setPlaybackMessage] = useState('');
  const [playbackError, setPlaybackError] = useState(false);
  const [conceptMessage, setConceptMessage] = useState('');
  const [transcriptCopyMessage, setTranscriptCopyMessage] = useState('');
  const [transcriptCopyFallback, setTranscriptCopyFallback] = useState('');
  const [attributionCopyMessage, setAttributionCopyMessage] = useState('');
  const [attributionCopyFallback, setAttributionCopyFallback] = useState('');
  const [transcriptIntakeText, setTranscriptIntakeText] = useState('');
  const [transcriptIntakeRunning, setTranscriptIntakeRunning] = useState(false);
  const [transcriptIntakeMessage, setTranscriptIntakeMessage] = useState('');
  const [transcriptIntakeError, setTranscriptIntakeError] = useState(false);
  const [attributionIntakeText, setAttributionIntakeText] = useState('');
  const [attributionIntakeRunning, setAttributionIntakeRunning] = useState(false);
  const [attributionIntakeMessage, setAttributionIntakeMessage] = useState('');
  const [attributionIntakeError, setAttributionIntakeError] = useState(false);
  const [sourceDrafts, setSourceDrafts] = useState({});
  const [pendingIntakeConfirm, setPendingIntakeConfirm] = useState(null);
  const [auditEvents, setAuditEvents] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [taskDrafts, setTaskDrafts] = useState({});
  const [taskSaving, setTaskSaving] = useState('');
  const [taskMessage, setTaskMessage] = useState('');
  const [taskError, setTaskError] = useState(false);
  const [taskStatusFilter, setTaskStatusFilter] = useState('All');
  const [taskOwnerFilter, setTaskOwnerFilter] = useState('All');
  const [taskDueFilter, setTaskDueFilter] = useState('All');

  const rawGroups = creativeTable?.groups || [];

  const loadAuditEvents = async () => {
    setAuditLoading(true);
    try {
      const data = await apiJson('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_creative_operator_audit', limit: 8 }),
      }, 'Creative activity failed');
      setAuditEvents(data.events || []);
    } catch {
      setAuditEvents([]);
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    apiJson('/api/creators', undefined, 'Creators failed')
      .then(data => setCreators(data.creators || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadAuditEvents();
  }, []);

  const taskKeyFor = (group, taskType) => `${taskType}:${group.groupKey}`;
  const taskFromGroup = (group, taskType) => {
    const prefix = taskType === 'transcript' ? 'transcriptTask' : 'sourceTask';
    return {
      status: group[`${prefix}Status`] || 'open',
      owner: group[`${prefix}Owner`] || '',
      note: group[`${prefix}Note`] || '',
      dueDate: normalizeTaskDate(group[`${prefix}DueDate`]),
      updatedAt: group[`${prefix}UpdatedAt`] || '',
    };
  };
  const taskDraftFor = (group, taskType) => {
    const key = taskKeyFor(group, taskType);
    return taskDrafts[key] || taskFromGroup(group, taskType);
  };
  const setTaskDraft = (group, taskType, patch) => {
    const key = taskKeyFor(group, taskType);
    setTaskDrafts(prev => ({ ...prev, [key]: { ...taskFromGroup(group, taskType), ...(prev[key] || {}), ...patch } }));
  };
  const saveEvidenceTask = async (group, taskType, controlsEl = null) => {
    const key = taskKeyFor(group, taskType);
    const domDraft = controlsEl ? {
      status: controlsEl.querySelector('select')?.value || undefined,
      owner: controlsEl.querySelector('input[data-task-field="owner"]')?.value?.trim() || '',
      note: controlsEl.querySelector('textarea')?.value?.trim() || '',
      dueDate: normalizeTaskDate(controlsEl.querySelector('input[data-task-field="dueDate"]')?.value),
    } : {};
    const draft = { ...taskDraftFor(group, taskType), ...domDraft };
    setTaskSaving(key);
    setTaskMessage('');
    setTaskError(false);
    try {
      const data = await apiJson('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_creative_evidence_task',
          groupKey: group.groupKey,
          groupName: group.name,
          taskType,
          status: draft.status || 'open',
          owner: draft.owner || null,
          note: draft.note || null,
          dueDate: draft.dueDate || null,
          spend: group.spend || 0,
        }),
      }, 'Evidence task update failed');
      const saved = data.task || {};
      setTaskDrafts(prev => ({
        ...prev,
        [key]: {
          status: saved.status || draft.status || 'open',
          owner: saved.owner || '',
          note: saved.note || '',
          dueDate: normalizeTaskDate(saved.due_date),
          updatedAt: saved.updated_at || new Date().toISOString(),
        },
      }));
      setTaskMessage(`${taskType === 'transcript' ? 'Transcript' : 'Source'} task saved for ${group.name || 'creative'}.`);
      await loadAuditEvents();
    } catch (err) {
      setTaskMessage(err.message);
      setTaskError(true);
    } finally {
      setTaskSaving('');
    }
  };

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...rawGroups]
      .filter(g => !needle || (g.name || '').toLowerCase().includes(needle))
      .filter(g => status === 'All' || statusFor(g) === status)
      .filter(g => readinessFilter === 'All' || readinessFor(g) === readinessFilter)
      .filter(g => creatorFilter === 'All'
        || (creatorFilter === 'Unassigned' ? !g.creatorId && !g.sourceType
          : creatorFilter === 'Suggested' ? !g.creatorId && !g.sourceType && (!!g.suggestedCreatorId || !!g.suggestedSourceType)
            : creatorFilter.startsWith('source:')
              ? g.sourceType === creatorFilter.replace('source:', '')
              : String(g.creatorId) === creatorFilter))
      .sort((a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0));
  }, [creatorFilter, query, rawGroups, readinessFilter, status, sortKey]);

  const topGroups = groups.slice(0, 12);
  const metricRanges = useMemo(
    () => Object.keys(METRICS).reduce((ranges, key) => {
      ranges[key] = metricRange(groups, key);
      return ranges;
    }, {}),
    [groups],
  );
  const selectedSet = selected;
  const selectedAnalyzedCount = groups.filter(g => selected.has(g.groupKey) && g.isAnalyzed).length;
  const fallbackWinnerCount = topGroups.filter(g => g.isAnalyzed && statusFor(g) === 'Winner').slice(0, 4).length;
  const conceptReferenceCount = selectedAnalyzedCount || fallbackWinnerCount;
  const conceptButtonLabel = selected.size
    ? `Generate from ${selectedAnalyzedCount || 0} selected`
    : `Generate from ${fallbackWinnerCount || 'winners'}`;
  const toggleSelected = (key) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleMetric = (key) => {
    setSelectedMetrics(prev => prev.includes(key)
      ? (prev.length > 1 ? prev.filter(k => k !== key) : prev)
      : [...prev, key]);
  };
  const sendToConcepts = () => {
    const selectedAnalyzed = groups.filter(g => selected.has(g.groupKey) && g.isAnalyzed);
    const fallbackWinners = topGroups
      .filter(g => g.isAnalyzed && statusFor(g) === 'Winner')
      .slice(0, 4);
    if (!selectedAnalyzed.length && !fallbackWinners.length) {
      setConceptMessage('Analyze at least one winning creative before generating scripts from performance.');
      return;
    }
    const keys = (selectedAnalyzed.length ? selectedAnalyzed : fallbackWinners).map(g => g.groupKey);
    sessionStorage.setItem('howl:selected-winners', JSON.stringify(keys));
    setConceptMessage('');
    setActiveTab('from-winners');
  };
  const assignCreator = async (group, creatorId) => {
    setAssigning(group.groupKey);
    setAssignmentMessage('');
    setAssignmentError(false);
    try {
      const result = await onAssignCreator(group.groupKey, creatorId || null);
      setAssignmentMessage(result.creator
        ? `Assigned ${group.name || 'creative'} to ${result.creator.name}.`
        : `Removed creator assignment from ${group.name || 'creative'}.`);
      await loadAuditEvents();
    } catch (err) {
      setAssignmentMessage(err.message);
      setAssignmentError(true);
    } finally {
      setAssigning('');
    }
  };
  const assignSourceTag = async (group, sourceType) => {
    const tag = SOURCE_TAGS.find(item => item.value === sourceType);
    if (!tag) return;
    const draftKey = `${group.groupKey}:${sourceType}`;
    const sourceLabel = sourceType === 'tool_generated'
      ? 'Made in HOWL'
      : (sourceDrafts[draftKey] || group.sourceLabel || '').trim();
    if (sourceType !== 'tool_generated' && !sourceLabel) {
      setAssignmentMessage(`Add a ${tag.placeholder.toLowerCase()} before marking ${group.name || 'this creative'} as ${tag.label}.`);
      setAssignmentError(true);
      return;
    }
    setAssigning(group.groupKey);
    setAssignmentMessage('');
    setAssignmentError(false);
    try {
      const result = await onAssignCreator(group.groupKey, null, { sourceType, sourceLabel });
      setAssignmentMessage(`Marked ${group.name || 'creative'} as ${sourceTypeLabel(result.sourceType)}${result.sourceLabel ? ` · ${result.sourceLabel}` : ''}.`);
      await loadAuditEvents();
    } catch (err) {
      setAssignmentMessage(err.message);
      setAssignmentError(true);
    } finally {
      setAssigning('');
    }
  };
  const applyHighConfidenceSuggestions = async () => {
    const candidates = (creativeTable?.groups || [])
      .filter(group => !group.creatorId && !group.sourceType)
      .filter(group => (group.suggestedCreatorId && group.suggestionConfidence === 'high')
        || (group.suggestedSourceType && group.suggestedSourceConfidence === 'high'))
      .slice(0, 100);
    if (!candidates.length) return;
    const creatorAssignments = candidates
      .filter(group => group.suggestedCreatorId && group.suggestionConfidence === 'high')
      .map(group => ({ groupKey: group.groupKey, creatorId: group.suggestedCreatorId }));
    const sourceAssignments = candidates
      .filter(group => !group.suggestedCreatorId && group.suggestedSourceType && group.suggestedSourceConfidence === 'high');
    setBatchAssigning(true);
    setAssignmentMessage('');
    setAssignmentError(false);
    try {
      let applied = 0;
      if (creatorAssignments.length) {
        const result = await onAssignCreators(creatorAssignments);
        applied += result.assignments?.length || creatorAssignments.length;
      }
      for (const group of sourceAssignments) {
        await onAssignCreator(group.groupKey, null, {
          sourceType: group.suggestedSourceType,
          sourceLabel: group.suggestedSourceLabel,
        });
        applied += 1;
      }
      setAssignmentMessage(`Attributed ${applied} high-confidence creative group${applied === 1 ? '' : 's'}.`);
      await loadAuditEvents();
    } catch (err) {
      setAssignmentMessage(err.message);
      setAssignmentError(true);
    } finally {
      setBatchAssigning(false);
    }
  };
  const repairPlayback = async (group) => {
    if (!onNormalizeAsset) return;
    setRepairingPlayback(group.groupKey);
    setPlaybackMessage('');
    setPlaybackError(false);
    try {
      if (!onNormalizeAsset) throw new Error('Asset repair requires write permission.');
      const result = await onNormalizeAsset(group.groupKey, group.assetId || null);
      setPlaybackMessage(result.ok
        ? `Playback repaired for ${group.name || 'creative'}.`
        : (result.message || result.error || 'Playback source still needs review.'));
      setPlaybackError(!result.ok);
    } catch (err) {
      setPlaybackMessage(err.message);
      setPlaybackError(true);
    } finally {
      setRepairingPlayback('');
    }
  };

  const totalSpend = groups.reduce((sum, g) => sum + (g.spend || 0), 0);
  const totalRevenue = groups.reduce((sum, g) => sum + (g.purchaseValue || 0), 0);
  const winners = groups.filter(g => statusFor(g) === 'Winner').length;
  const playbackGapCount = rawGroups.filter(group => group.assetKind === 'video' && !group.playableUrl && !group.playbackEmbedUrl).length;
  const transcriptGapCount = rawGroups.filter(group => group.assetKind === 'video' && group.transcriptStatus !== 'complete').length;
  const analysisGapCount = rawGroups.filter(group => !group.isAnalyzed).length;
  const assignedCount = rawGroups.filter(group => group.creatorId || group.sourceType).length;
  const suggestedCount = rawGroups.filter(group => !group.creatorId && !group.sourceType && group.suggestedCreatorId).length;
  const sourceSuggestedCount = rawGroups.filter(group => !group.creatorId && !group.sourceType && group.suggestedSourceType).length;
  const highConfidenceCount = rawGroups.filter(group => !group.creatorId && !group.sourceType && (
    group.suggestionConfidence === 'high' || group.suggestedSourceConfidence === 'high'
  )).length;
  const totalGroups = rawGroups.length;
  const playableReadyCount = rawGroups.filter(group => group.assetKind !== 'video' || group.playableUrl || group.playbackEmbedUrl).length;
  const transcriptReadyCount = rawGroups.filter(group => group.assetKind !== 'video' || group.transcriptStatus === 'complete').length;
  const analyzedCount = rawGroups.filter(group => group.isAnalyzed).length;
  const operatorReadyCount = rawGroups.filter(group => qualityStateFor(group).tone === 'good').length;
  const queueFailedCount = analysisQueue?.summary?.failed || 0;
  const queuePendingCount = analysisQueue?.summary?.pending || 0;
  const queueThroughput = analysisQueue?.throughput || {};
  const queueEta = queueThroughput.etaDays
    ? `${queueThroughput.etaDays} day${queueThroughput.etaDays === 1 ? '' : 's'}`
    : (queuePendingCount ? 'calculating' : 'clear');
  const qualityChecks = [
    { label: 'Playback', value: percent(playableReadyCount, totalGroups), detail: `${playbackGapCount} gaps` },
    { label: 'Transcript', value: percent(transcriptReadyCount, totalGroups), detail: `${transcriptGapCount} gaps` },
    { label: 'Analyzed', value: percent(analyzedCount, totalGroups), detail: `${analysisGapCount} gaps` },
    { label: 'Attributed', value: percent(assignedCount, totalGroups), detail: `${Math.max(0, totalGroups - assignedCount)} reviews` },
    { label: 'Decision ready', value: percent(operatorReadyCount, totalGroups), detail: `${operatorReadyCount}/${totalGroups || 0}` },
  ];
  const sourceReviewCount = Math.max(0, totalGroups - assignedCount);
  const trustIssueCount = playbackGapCount + transcriptGapCount + analysisGapCount + sourceReviewCount;
  const transcriptGaps = rawGroups
    .filter(group => group.assetKind === 'video' && group.transcriptStatus !== 'complete')
    .sort((a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0));
  const transcriptGapSpend = transcriptGaps.reduce((sum, group) => sum + (Number(group.spend) || 0), 0);
  const sourceReviewGroups = rawGroups
    .filter(group => !group.creatorId && !group.sourceType)
    .sort((a, b) => {
      const highA = a.suggestionConfidence === 'high' || a.suggestedSourceConfidence === 'high' ? 1 : 0;
      const highB = b.suggestionConfidence === 'high' || b.suggestedSourceConfidence === 'high' ? 1 : 0;
      return (highB - highA) || ((Number(b.spend) || 0) - (Number(a.spend) || 0));
    });
  const evidenceTasks = [
    ...transcriptGaps.map(group => ({ group, taskType: 'transcript', task: taskDraftFor(group, 'transcript') })),
    ...sourceReviewGroups.map(group => ({ group, taskType: 'source_review', task: taskDraftFor(group, 'source_review') })),
  ];
  const taskStatusCounts = evidenceTasks.reduce((counts, item) => {
    const statusKey = item.task.status || 'open';
    counts[statusKey] = (counts[statusKey] || 0) + 1;
    return counts;
  }, {});
  const todayKey = localDateKey();
  const taskDueCounts = evidenceTasks.reduce((counts, item) => {
    const dueKey = taskDueBucket(item.task, todayKey);
    counts[dueKey] = (counts[dueKey] || 0) + 1;
    if (!item.task.owner) counts.unassigned = (counts.unassigned || 0) + 1;
    return counts;
  }, {});
  const taskOwnerOptions = [...new Set(evidenceTasks.map(item => item.task.owner || '').filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const taskMatchesFilter = (group, taskType) => {
    const task = taskDraftFor(group, taskType);
    const owner = task.owner || '';
    const dueBucket = taskDueBucket(task, todayKey);
    return (taskStatusFilter === 'All' || (task.status || 'open') === taskStatusFilter)
      && (taskOwnerFilter === 'All' || (taskOwnerFilter === 'Unassigned' ? !owner : owner === taskOwnerFilter))
      && (taskDueFilter === 'All' || dueBucket === taskDueFilter);
  };
  const filteredTranscriptGaps = transcriptGaps.filter(group => taskMatchesFilter(group, 'transcript'));
  const filteredSourceReviewGroups = sourceReviewGroups.filter(group => taskMatchesFilter(group, 'source_review'));
  const limitedEvidenceGroups = rawGroups
    .filter(group => qualityStateFor(group).tone !== 'good')
    .sort((a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0));
  const trustState = queueFailedCount
    ? {
      label: 'Needs attention',
      detail: `${queueFailedCount} analysis job${queueFailedCount === 1 ? '' : 's'} need review before this can be a trusted operating view.`,
    }
    : queuePendingCount
      ? {
        label: 'Healthy backlog',
        detail: `${queuePendingCount} creative${queuePendingCount === 1 ? '' : 's'} are queued, with no blocking failures.`,
      }
      : trustIssueCount
        ? {
          label: 'Evidence gaps visible',
          detail: `${trustIssueCount} playback, transcript, analysis, or attribution gap${trustIssueCount === 1 ? '' : 's'} remain. The inbox is sorted by spend so the team can clear the highest-impact work first.`,
        }
        : {
          label: 'Motion quality state',
          detail: 'Playback, attribution, analysis, and evidence are ready for operator decisions.',
        };
  const qualityInbox = rawGroups
    .map(group => ({ group, quality: qualityStateFor(group) }))
    .filter(item => item.quality.tone !== 'good' || !item.group.creatorId && !item.group.sourceType)
    .sort((a, b) => {
      const priority = { bad: 0, warn: 1, good: 2 };
      return (priority[a.quality.tone] - priority[b.quality.tone])
        || ((b.group.spend || 0) - (a.group.spend || 0));
    })
    .slice(0, 5);
  const dataWindowLabel = creativeTable?.since && creativeTable?.until
    ? `${ymdLabel(creativeTable.since)} - ${ymdLabel(creativeTable.until)}`
    : `Last ${windowDays}d`;
  const transcriptIntakePreview = useMemo(
    () => parseTranscriptIntake(transcriptIntakeText, transcriptGaps),
    [transcriptIntakeText, transcriptGaps],
  );
  const attributionIntakePreview = useMemo(
    () => parseAttributionIntake(attributionIntakeText, sourceReviewGroups, creators),
    [attributionIntakeText, sourceReviewGroups, creators],
  );
  const copyTranscriptRequests = async () => {
    const queue = filteredTranscriptGaps;
    const lines = queue.slice(0, 25).map((group, index) => {
      const attribution = group.creatorName
        || (group.sourceType ? `${sourceTypeLabel(group.sourceType)}${group.sourceLabel ? `: ${group.sourceLabel}` : ''}` : 'Unattributed');
      return `${index + 1}. ${group.name || group.groupKey} | group_key: ${group.groupKey} | ${attribution} | $${Math.round(group.spend || 0).toLocaleString()} spend | Need exact spoken script/transcript for creative analysis.`;
    });
    const text = [
      `HOWL transcript requests (${dataWindowLabel})`,
      `Priority: ${queue.length} filtered video creative group${queue.length === 1 ? '' : 's'} need scripts; top ${lines.length} below.`,
      '',
      ...lines,
    ].join('\n');
    try {
      await copyTextToClipboard(text);
      setTranscriptCopyMessage(`Copied ${lines.length} transcript request${lines.length === 1 ? '' : 's'}.`);
      setTranscriptCopyFallback('');
    } catch {
      setTranscriptCopyMessage('Copy was blocked by the browser. Open the transcript queue and copy the visible requests manually.');
      setTranscriptCopyFallback(text);
    }
  };
  const downloadTranscriptQueue = () => {
    const queue = filteredTranscriptGaps;
    const rows = [
      ['priority', 'creative_name', 'group_key', 'current_source', 'task_status', 'task_owner', 'task_due_date', 'task_note', 'spend', 'script_or_transcript'],
      ...queue.map((group, index) => {
        const attribution = group.creatorName
          || (group.sourceType ? `${sourceTypeLabel(group.sourceType)}${group.sourceLabel ? `: ${group.sourceLabel}` : ''}` : 'Unattributed');
        const task = taskDraftFor(group, 'transcript');
        return [
          index + 1,
          group.name || '',
          group.groupKey,
          attribution,
          task.status || 'open',
          task.owner || '',
          normalizeTaskDate(task.dueDate),
          task.note || '',
          Math.round(group.spend || 0),
          '',
        ];
      }),
    ].map(row => row.map(csvCell).join(',')).join('\n');
    downloadTextFile(`howl-transcript-queue-${creativeTable?.until || 'current'}.csv`, rows, 'text/csv');
    setTranscriptCopyMessage(`Downloaded ${queue.length} transcript queue row${queue.length === 1 ? '' : 's'}.`);
    setTranscriptCopyFallback('');
  };
  const copyAttributionRequests = async () => {
    const queue = filteredSourceReviewGroups;
    const lines = queue.slice(0, 50).map((group, index) => {
      const suggested = group.suggestedCreatorName
        || (group.suggestedSourceType ? sourceTypeLabel(group.suggestedSourceType) : 'Needs human match');
      return `${index + 1}. ${group.name || group.groupKey} | group_key: ${group.groupKey} | ${suggested} | $${Math.round(group.spend || 0).toLocaleString()} spend | Confirm creator or source tag.`;
    });
    const text = [
      `HOWL source attribution review (${dataWindowLabel})`,
      `Priority: ${queue.length} filtered creative group${queue.length === 1 ? '' : 's'} need source attribution; top ${lines.length} below.`,
      '',
      ...lines,
      '',
      'Paste confirmed mappings back as: Creative name :: Creator Name, group_key :: Made in HOWL, group_key :: Founder: Name, or group_key :: Internal: Name.',
    ].join('\n');
    try {
      await copyTextToClipboard(text);
      setAttributionCopyMessage(`Copied ${lines.length} source review request${lines.length === 1 ? '' : 's'}.`);
      setAttributionCopyFallback('');
    } catch {
      setAttributionCopyMessage('Copy was blocked by the browser. The source review list is shown below for manual copy.');
      setAttributionCopyFallback(text);
    }
  };
  const downloadAttributionQueue = () => {
    const queue = filteredSourceReviewGroups;
    const rows = [
      ['priority', 'creative_name', 'group_key', 'suggested_match', 'task_status', 'task_owner', 'task_due_date', 'task_note', 'spend', 'confirmed_assignment'],
      ...queue.map((group, index) => {
        const suggested = group.suggestedCreatorName
          || (group.suggestedSourceType ? sourceTypeLabel(group.suggestedSourceType) : 'Needs human match');
        const task = taskDraftFor(group, 'source_review');
        return [
          index + 1,
          group.name || '',
          group.groupKey,
          suggested,
          task.status || 'open',
          task.owner || '',
          normalizeTaskDate(task.dueDate),
          task.note || '',
          Math.round(group.spend || 0),
          '',
        ];
      }),
    ].map(row => row.map(csvCell).join(',')).join('\n');
    downloadTextFile(`howl-source-review-${creativeTable?.until || 'current'}.csv`, rows, 'text/csv');
    setAttributionCopyMessage(`Downloaded ${queue.length} source review row${queue.length === 1 ? '' : 's'}.`);
    setAttributionCopyFallback('');
  };
  const loadIntakeFile = async (event, type) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      if (type === 'transcript') {
        setTranscriptIntakeText(text);
        setTranscriptIntakeMessage(`Loaded ${file.name}. Review matched rows before running analysis.`);
        setTranscriptIntakeError(false);
      } else {
        setAttributionIntakeText(text);
        setAttributionIntakeMessage(`Loaded ${file.name}. Review matched rows before applying sources.`);
        setAttributionIntakeError(false);
      }
    } catch (err) {
      if (type === 'transcript') {
        setTranscriptIntakeMessage(`Could not load ${file.name}: ${err.message}`);
        setTranscriptIntakeError(true);
      } else {
        setAttributionIntakeMessage(`Could not load ${file.name}: ${err.message}`);
        setAttributionIntakeError(true);
      }
    }
  };
  const requestTranscriptIntakeConfirm = () => {
    const { entries } = transcriptIntakePreview;
    if (!entries.length) {
      setTranscriptIntakeMessage('Paste lines as “Creative name :: exact spoken script” or “group_key :: exact spoken script”.');
      setTranscriptIntakeError(true);
      return;
    }
    setPendingIntakeConfirm({ type: 'transcript' });
  };
  const requestAttributionIntakeConfirm = () => {
    const { entries } = attributionIntakePreview;
    if (!entries.length) {
      setAttributionIntakeMessage('Paste lines as “Creative name :: Creator Name”, “Creative name :: Made in HOWL”, “Creative name :: Founder: Alex”, or “Creative name :: Internal: Name”.');
      setAttributionIntakeError(true);
      return;
    }
    setPendingIntakeConfirm({ type: 'attribution' });
  };
  const runTranscriptIntake = async () => {
    const { entries, unmatched } = transcriptIntakePreview;
    const toRun = entries.slice(0, 10);
    if (!toRun.length) {
      setTranscriptIntakeMessage('Paste lines as “Creative name :: exact spoken script” or “group_key :: exact spoken script”.');
      setTranscriptIntakeError(true);
      return;
    }
    setTranscriptIntakeRunning(true);
    setTranscriptIntakeMessage(`Re-analyzing ${toRun.length} creative${toRun.length === 1 ? '' : 's'} with pasted scripts...`);
    setTranscriptIntakeError(false);
    let completed = 0;
    try {
      for (const item of toRun) {
        if (!onAnalyze) throw new Error('Analysis requires write permission.');
        await onAnalyze(item.group.groupKey, item.group.name, item.transcript, item.group.assetId || null);
        completed += 1;
      }
      const ranKeys = new Set(toRun.map(item => item.group.groupKey));
      const remainingLines = transcriptIntakeText.split(/\n+/).filter(line => {
        const key = line.split(line.includes('::') ? '::' : '\t')[0]?.replace(/^\d+\.\s*/, '').trim();
        const group = transcriptGaps.find(item => item.groupKey === key || normalizeMatchKey(item.name) === normalizeMatchKey(key));
        return !group || !ranKeys.has(group.groupKey);
      });
      setTranscriptIntakeText(remainingLines.join('\n'));
      setTranscriptIntakeMessage(`Re-analyzed ${completed} creative${completed === 1 ? '' : 's'} with transcript evidence${unmatched.length ? `; ${unmatched.length} line${unmatched.length === 1 ? '' : 's'} still need a matching name or group key.` : '.'}`);
      await loadAuditEvents();
    } catch (err) {
      setTranscriptIntakeMessage(`Stopped after ${completed} successful re-analysis${completed === 1 ? '' : 'es'}: ${err.message}`);
      setTranscriptIntakeError(true);
    } finally {
      setTranscriptIntakeRunning(false);
      setPendingIntakeConfirm(null);
    }
  };
  const runAttributionIntake = async () => {
    const { entries, unmatched } = attributionIntakePreview;
    const toRun = entries.slice(0, 25);
    if (!toRun.length) {
      setAttributionIntakeMessage('Paste lines as “Creative name :: Creator Name”, “Creative name :: Made in HOWL”, “Creative name :: Founder: Alex”, or “Creative name :: Internal: Name”.');
      setAttributionIntakeError(true);
      return;
    }
    setAttributionIntakeRunning(true);
    setAttributionIntakeMessage(`Applying ${toRun.length} source assignment${toRun.length === 1 ? '' : 's'}...`);
    setAttributionIntakeError(false);
    let completed = 0;
    try {
      for (const item of toRun) {
        if (item.creator) await onAssignCreator(item.group.groupKey, item.creator.id);
        else await onAssignCreator(item.group.groupKey, null, { sourceType: item.sourceType, sourceLabel: item.sourceLabel });
        completed += 1;
      }
      const ranKeys = new Set(toRun.map(item => item.group.groupKey));
      const remainingLines = attributionIntakeText.split(/\n+/).filter(line => {
        const separator = line.includes('::') ? '::' : '\t';
        const key = line.split(separator)[0]?.replace(/^\d+\.\s*/, '').trim();
        const group = sourceReviewGroups.find(item => item.groupKey === key || normalizeMatchKey(item.name) === normalizeMatchKey(key));
        return !group || !ranKeys.has(group.groupKey);
      });
      setAttributionIntakeText(remainingLines.join('\n'));
      setAttributionIntakeMessage(`Applied ${completed} source assignment${completed === 1 ? '' : 's'}${unmatched.length ? `; ${unmatched.length} line${unmatched.length === 1 ? '' : 's'} still need a matching creative and creator/source.` : '.'}`);
      await loadAuditEvents();
    } catch (err) {
      setAttributionIntakeMessage(`Stopped after ${completed} assignment${completed === 1 ? '' : 's'}: ${err.message}`);
      setAttributionIntakeError(true);
    } finally {
      setAttributionIntakeRunning(false);
      setPendingIntakeConfirm(null);
    }
  };
  const renderSourceControls = (group) => (
    <div className="motion-source-controls">
      <span>Other source</span>
      {SOURCE_TAGS.map(tag => {
        const draftKey = `${group.groupKey}:${tag.value}`;
        const value = sourceDrafts[draftKey] ?? (group.sourceType === tag.value ? group.sourceLabel || '' : '');
        return (
          <div className={group.sourceType === tag.value ? 'active' : ''} key={tag.value}>
            {tag.value !== 'tool_generated' ? (
              <input
                aria-label={`${tag.label} label for ${group.name || 'creative'}`}
                placeholder={tag.placeholder}
                value={value}
                disabled={!canManageCreators || assigning === group.groupKey}
                onChange={event => setSourceDrafts(prev => ({ ...prev, [draftKey]: event.target.value }))}
              />
            ) : null}
            <button
              type="button"
              disabled={!canManageCreators || assigning === group.groupKey}
              onClick={() => assignSourceTag(group, tag.value)}
            >
              {tag.label}
            </button>
          </div>
        );
      })}
    </div>
  );
  const applySourceSuggestion = async (group) => {
    if (!group.suggestedSourceType) return;
    setAssigning(group.groupKey);
    setAssignmentMessage('');
    setAssignmentError(false);
    try {
      const result = await onAssignCreator(group.groupKey, null, {
        sourceType: group.suggestedSourceType,
        sourceLabel: group.suggestedSourceLabel,
      });
      setAssignmentMessage(`Marked ${group.name || 'creative'} as ${sourceTypeLabel(result.sourceType)}${result.sourceLabel ? ` · ${result.sourceLabel}` : ''}.`);
      await loadAuditEvents();
    } catch (err) {
      setAssignmentMessage(err.message);
      setAssignmentError(true);
    } finally {
      setAssigning('');
    }
  };
  const renderMedia = (group, { compact = false } = {}) => {
    const poster = group.previewUrl || group.thumbnailUrl || '';
    if (group.assetKind === 'video' && group.playableUrl) {
      return (
        <video
          src={group.playableUrl}
          poster={poster || undefined}
          controls
          playsInline
          preload="metadata"
          className={compact ? 'motion-media-video compact' : 'motion-media-video'}
        />
      );
    }
    if (group.assetKind === 'video' && group.playbackEmbedUrl) {
      return (
        <iframe
          src={group.playbackEmbedUrl}
          title={`${group.name || 'Creative'} playback`}
          className={compact ? 'motion-media-video compact' : 'motion-media-video'}
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
          allowFullScreen
        />
      );
    }
    if (poster) return <img src={poster} alt="" />;
    return <div className="motion-media-empty">No preview</div>;
  };
  const openGroupAnalysis = (group) => onOpenAnalysis(group.groupKey, group.name, {
    assetId: group.assetId,
    assetKind: group.assetKind,
    mimeType: group.mimeType,
    playableUrl: group.playableUrl,
    playbackEmbedUrl: group.playbackEmbedUrl,
    previewUrl: group.previewUrl || group.thumbnailUrl,
    playbackStatus: group.playbackStatus,
    playbackError: group.playbackError,
    transcriptStatus: group.transcriptStatus,
    transcriptError: group.transcriptError,
    analyzedAt: group.analyzedAt,
  });
  const renderPreflight = (preview, type) => {
    if (!preview.entries.length && !preview.unmatched.length) return null;
    return (
      <div className="motion-intake-preview">
        {preview.entries.slice(0, 4).map((entry, index) => (
          <div className="ok" key={`${type}-${entry.group.groupKey}-${index}`}>
            <strong>{entry.group.name || entry.group.groupKey}</strong>
            <span>
              {type === 'transcript'
                ? `${entry.transcript.length} chars · $${Math.round(entry.group.spend || 0).toLocaleString()} spend`
                : `${entry.creator?.name || sourceTypeLabel(entry.sourceType)} · $${Math.round(entry.group.spend || 0).toLocaleString()} spend`}
            </span>
          </div>
        ))}
        {preview.entries.length > 4 ? <em>{preview.entries.length - 4} more matched row{preview.entries.length - 4 === 1 ? '' : 's'}</em> : null}
        {preview.unmatched.slice(0, 3).map((item, index) => (
          <div className="bad" key={`${type}-unmatched-${index}`}>
            <strong>Unmatched</strong>
            <span>{item}</span>
          </div>
        ))}
        {preview.unmatched.length > 3 ? <em>{preview.unmatched.length - 3} more unmatched row{preview.unmatched.length - 3 === 1 ? '' : 's'}</em> : null}
      </div>
    );
  };
  const renderTaskControls = (group, taskType) => {
    const key = taskKeyFor(group, taskType);
    const draft = taskDraftFor(group, taskType);
    const savedAt = draft.updatedAt ? new Date(draft.updatedAt) : null;
    const savedLabel = savedAt && !Number.isNaN(savedAt.getTime())
      ? savedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : null;
    return (
      <form
        className="motion-task-controls"
        onClick={event => event.stopPropagation()}
        onSubmit={event => {
          event.preventDefault();
          event.stopPropagation();
          saveEvidenceTask(group, taskType, event.currentTarget);
        }}
      >
        <div className="motion-task-editor">
          <select
            aria-label={`${taskType} status for ${group.name || 'creative'}`}
            value={draft.status || 'open'}
            onChange={event => setTaskDraft(group, taskType, { status: event.target.value })}
          >
            {TASK_STATUSES.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
          <input
            aria-label={`${taskType} owner for ${group.name || 'creative'}`}
            data-task-field="owner"
            placeholder="Owner"
            value={draft.owner || ''}
            onChange={event => setTaskDraft(group, taskType, { owner: event.target.value })}
          />
          <input
            aria-label={`${taskType} due date for ${group.name || 'creative'}`}
            data-task-field="dueDate"
            type="date"
            value={draft.dueDate || ''}
            onChange={event => setTaskDraft(group, taskType, { dueDate: event.target.value })}
          />
          <button
            type="submit"
            disabled={taskSaving === key}
          >
            {taskSaving === key ? 'Saving...' : 'Save'}
          </button>
        </div>
        <textarea
          aria-label={`${taskType} note for ${group.name || 'creative'}`}
          placeholder={taskType === 'transcript' ? 'Next step: request raw script, audio, or editor notes' : 'Next step: confirm creator, founder, internal, or made in HOWL'}
          value={draft.note || ''}
          onChange={event => setTaskDraft(group, taskType, { note: event.target.value })}
          rows={2}
        />
        <div className="motion-task-meta">
          <span>{taskStatusLabel(draft.status)}</span>
          {draft.owner ? <span>{draft.owner}</span> : null}
          {draft.dueDate ? <span>Due {normalizeTaskDate(draft.dueDate)}</span> : null}
          {savedLabel ? <span>Saved {savedLabel}</span> : null}
        </div>
      </form>
    );
  };
  const renderIntakeConfirmation = () => {
    if (!pendingIntakeConfirm) return null;
    const isTranscript = pendingIntakeConfirm.type === 'transcript';
    const preview = isTranscript ? transcriptIntakePreview : attributionIntakePreview;
    const limit = isTranscript ? 10 : 25;
    const toRun = preview.entries.slice(0, limit);
    const running = isTranscript ? transcriptIntakeRunning : attributionIntakeRunning;
    const title = isTranscript ? 'Run transcript analysis?' : 'Apply source assignments?';
    const detail = isTranscript
      ? `${toRun.length} creative${toRun.length === 1 ? '' : 's'} will be re-analyzed with pasted script evidence.`
      : `${toRun.length} source assignment${toRun.length === 1 ? '' : 's'} will be written to the creator attribution table.`;
    const confirmLabel = isTranscript ? 'Run analysis' : 'Apply sources';
    return (
      <div className="motion-confirm-backdrop" role="presentation">
        <section className="motion-confirm-dialog" role="dialog" aria-modal="true" aria-label={title}>
          <div>
            <span>Confirm batch action</span>
            <strong>{title}</strong>
            <p>{detail} {preview.unmatched.length ? `${preview.unmatched.length} unmatched row${preview.unmatched.length === 1 ? '' : 's'} will be skipped.` : 'No unmatched rows were found.'}</p>
          </div>
          <div className="motion-confirm-list">
            {toRun.slice(0, 6).map((entry, index) => (
              <div key={`${pendingIntakeConfirm.type}-${entry.group.groupKey}-${index}`}>
                <strong>{entry.group.name || entry.group.groupKey}</strong>
                <span>{isTranscript
                  ? `${entry.transcript.length} transcript chars`
                  : (entry.creator?.name || `${sourceTypeLabel(entry.sourceType)} · ${entry.sourceLabel || 'source tagged'}`)}
                </span>
              </div>
            ))}
            {toRun.length > 6 ? <em>{toRun.length - 6} more row{toRun.length - 6 === 1 ? '' : 's'} in this batch</em> : null}
          </div>
          <footer>
            <button type="button" onClick={() => setPendingIntakeConfirm(null)} disabled={running}>Cancel</button>
            <button
              type="button"
              className="motion-danger-action"
              onClick={isTranscript ? runTranscriptIntake : runAttributionIntake}
              disabled={running}
            >
              {running ? 'Working...' : confirmLabel}
            </button>
          </footer>
        </section>
      </div>
    );
  };

  return (
    <section className="motion-workspace">
      <header className="motion-report-head">
        <div>
          <div className="motion-kicker">Creative intelligence</div>
          <h1>Top creatives</h1>
          <p>See where HOWL is spending money, making money, and finding repeatable creative patterns. Data window: {dataWindowLabel}.</p>
        </div>
        <div className="motion-summary">
          <div><span>Spend</span><strong>${Math.round(totalSpend).toLocaleString()}</strong></div>
          <div><span>Purchase value</span><strong>${Math.round(totalRevenue).toLocaleString()}</strong></div>
          <div><span>Winners</span><strong>{winners}</strong></div>
          <div><span>Playback gaps</span><strong>{playbackGapCount}</strong></div>
          <div><span>Transcript gaps</span><strong>{transcriptGapCount}</strong></div>
          <div><span>Analysis gaps</span><strong>{analysisGapCount}</strong></div>
        </div>
      </header>

      <div className="motion-quality-strip">
        <div className="motion-quality-copy">
          <span>Operator trust</span>
          <strong>{trustState.label}</strong>
          <p>{trustState.detail}</p>
        </div>
        <div className="motion-quality-meters">
          {qualityChecks.map(check => (
            <div key={check.label}>
              <span>{check.label}</span>
              <strong>{check.value}%</strong>
              <i><b style={{ width: `${check.value}%` }} /></i>
              <small>{check.detail}</small>
            </div>
          ))}
        </div>
      </div>

      {qualityInbox.length ? (
        <div className="motion-quality-inbox">
          <header>
            <div>
              <span>Quality inbox</span>
              <strong>Highest leverage fixes</strong>
            </div>
            <button type="button" onClick={() => setViewMode('table')}>Open table</button>
          </header>
          <div>
            {qualityInbox.map(({ group, quality }) => (
              <article key={group.groupKey} className={quality.tone}>
                <div>
                  <strong>{group.name || 'Untitled creative'}</strong>
                  <span>{quality.label} · ${Math.round(group.spend || 0).toLocaleString()} spend</span>
                </div>
                <p>{quality.action}</p>
                <button
                  type="button"
                  onClick={() => group.isAnalyzed ? openGroupAnalysis(group) : onAnalyze?.(group.groupKey, group.name, '', group.assetId || null)}
                >
                  {group.isAnalyzed ? 'Review' : 'Analyze'}
                </button>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <div className="motion-task-command">
        <div>
          <span>Evidence tasks</span>
          <strong>{evidenceTasks.length} open evidence record{evidenceTasks.length === 1 ? '' : 's'}</strong>
          <p>
            {filteredTranscriptGaps.length} transcript task{filteredTranscriptGaps.length === 1 ? '' : 's'} and {filteredSourceReviewGroups.length} source review task{filteredSourceReviewGroups.length === 1 ? '' : 's'} match the current filters.
            {' '}{taskDueCounts.overdue || 0} overdue · {taskDueCounts.today || 0} due today · {taskDueCounts.unassigned || 0} unassigned.
          </p>
        </div>
        <div className="motion-task-counts">
          {TASK_STATUSES.map(statusItem => (
            <button
              type="button"
              key={statusItem.value}
              className={taskStatusFilter === statusItem.value ? 'active' : ''}
              onClick={() => setTaskStatusFilter(taskStatusFilter === statusItem.value ? 'All' : statusItem.value)}
            >
              <span>{statusItem.label}</span>
              <strong>{taskStatusCounts[statusItem.value] || 0}</strong>
            </button>
          ))}
        </div>
        <div className="motion-task-filters">
          <select aria-label="Filter evidence tasks by status" value={taskStatusFilter} onChange={event => setTaskStatusFilter(event.target.value)}>
            <option>All</option>
            {TASK_STATUSES.map(statusItem => <option key={statusItem.value} value={statusItem.value}>{statusItem.label}</option>)}
          </select>
          <select aria-label="Filter evidence tasks by owner" value={taskOwnerFilter} onChange={event => setTaskOwnerFilter(event.target.value)}>
            <option>All</option>
            <option>Unassigned</option>
            {taskOwnerOptions.map(owner => <option key={owner} value={owner}>{owner}</option>)}
          </select>
          <select aria-label="Filter evidence tasks by due date" value={taskDueFilter} onChange={event => setTaskDueFilter(event.target.value)}>
            <option>All</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="future">Future due</option>
            <option value="no_due">No due date</option>
          </select>
        </div>
      </div>

      <div className="motion-evidence-workbench">
        <section>
          <div>
            <span>Transcript recovery</span>
            <strong>{transcriptGapCount} scripts needed</strong>
            <p>${Math.round(transcriptGapSpend).toLocaleString()} of spend is analyzed without spoken-hook proof. Copy the top asks, then paste scripts into each review drawer to re-run analysis with full evidence.</p>
          </div>
          <div className="motion-evidence-actions">
            <button type="button" onClick={copyTranscriptRequests} disabled={!filteredTranscriptGaps.length}>
              Copy request list
            </button>
            <button type="button" onClick={downloadTranscriptQueue} disabled={!filteredTranscriptGaps.length}>
              Download CSV
            </button>
          </div>
          <div className="motion-evidence-list">
            {filteredTranscriptGaps.slice(0, 4).map(group => (
              <div className="motion-evidence-task-row" key={group.groupKey}>
                <button type="button" onClick={() => openGroupAnalysis(group)}>
                  <span>{group.name || 'Untitled creative'}</span>
                  <small>${Math.round(group.spend || 0).toLocaleString()} spend · {group.creatorName || group.sourceLabel || 'Unattributed'}</small>
                </button>
                {renderTaskControls(group, 'transcript')}
              </div>
            ))}
            {transcriptGaps.length && !filteredTranscriptGaps.length ? <em>No transcript tasks match the current filters.</em> : null}
            {!transcriptGaps.length ? <em>All video scripts are captured.</em> : null}
          </div>
        </section>
        <section>
          <div>
            <span>Source review</span>
            <strong>{sourceReviewCount} need attribution</strong>
            <p>Creator attribution drives the match, brief, and iteration loop. High-confidence tags can be applied in bulk; ambiguous names stay in review.</p>
          </div>
          <div className="motion-evidence-actions">
            <button type="button" onClick={copyAttributionRequests} disabled={!filteredSourceReviewGroups.length}>
              Copy review list
            </button>
            <button type="button" onClick={downloadAttributionQueue} disabled={!filteredSourceReviewGroups.length}>
              Download CSV
            </button>
            <button type="button" onClick={() => { setCreatorFilter('Suggested'); setViewMode('table'); }}>
              Review matches
            </button>
          </div>
          <div className="motion-evidence-list">
            {filteredSourceReviewGroups.slice(0, 4).map(group => (
              <div className="motion-evidence-task-row" key={group.groupKey}>
                <button type="button" onClick={() => openGroupAnalysis(group)}>
                  <span>{group.name || 'Untitled creative'}</span>
                  <small>{group.suggestedCreatorName || (group.suggestedSourceType ? sourceTypeLabel(group.suggestedSourceType) : 'Needs human match')} · ${Math.round(group.spend || 0).toLocaleString()} spend</small>
                </button>
                {renderTaskControls(group, 'source_review')}
              </div>
            ))}
            {sourceReviewGroups.length && !filteredSourceReviewGroups.length ? <em>No source review tasks match the current filters.</em> : null}
            {!sourceReviewGroups.length ? <em>All active spend is source-attributed.</em> : null}
          </div>
        </section>
        <section>
          <div>
            <span>Decision coverage</span>
            <strong>{operatorReadyCount}/{totalGroups || 0} ready</strong>
            <p>Only creatives with playback, evidence, analysis, and source attribution should feed confident iteration decisions.</p>
          </div>
          <button type="button" onClick={() => { setReadinessFilter('Needs transcript'); setViewMode('table'); }}>
            Open gaps
          </button>
          <div className="motion-evidence-list">
            {limitedEvidenceGroups.slice(0, 4).map(group => {
              const quality = qualityStateFor(group);
              return (
                <button type="button" key={group.groupKey} onClick={() => openGroupAnalysis(group)}>
                  <span>{group.name || 'Untitled creative'}</span>
                  <small>{quality.label} · {quality.action}</small>
                </button>
              );
            })}
            {!limitedEvidenceGroups.length ? <em>Every active creative is decision-ready.</em> : null}
          </div>
        </section>
      </div>
      {transcriptCopyMessage ? <div className="motion-notice">{transcriptCopyMessage}</div> : null}
      {transcriptCopyFallback ? <pre className="motion-copy-fallback">{transcriptCopyFallback}</pre> : null}
      {attributionCopyMessage ? <div className="motion-notice">{attributionCopyMessage}</div> : null}
      {attributionCopyFallback ? <pre className="motion-copy-fallback">{attributionCopyFallback}</pre> : null}
      {taskMessage ? <div className={taskError ? 'motion-error' : 'motion-notice'}>{taskMessage}</div> : null}

      <div className="motion-audit-ledger">
        <header>
          <div>
            <span>Recent activity</span>
            <strong>{auditEvents.length ? `${auditEvents.length} latest operator event${auditEvents.length === 1 ? '' : 's'}` : 'No operator events yet'}</strong>
          </div>
          <button type="button" onClick={loadAuditEvents} disabled={auditLoading}>
            {auditLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </header>
        <div>
          {auditEvents.map(event => (
            <article key={event.id}>
              <div>
                <strong>{auditEventLabel(event.event_type)}</strong>
                <span>{event.group_name || event.group_key || 'Creative group'}</span>
              </div>
              <p>{event.creator_name || event.source_label || (event.source_type ? sourceTypeLabel(event.source_type) : 'Updated evidence')}</p>
              <small>{relativeTime(event.created_at)}{event.user_email ? ` · ${event.user_email}` : ''}</small>
            </article>
          ))}
          {!auditEvents.length ? <em>Batch transcript runs and attribution changes will appear here after they are confirmed.</em> : null}
        </div>
      </div>

      <div className="motion-transcript-intake">
        <div>
          <span>Script intake</span>
          <strong>Paste scripts in batches</strong>
          <p>Paste a filled transcript CSV export, or use one line per creative: <b>Creative name :: exact spoken script</b>. Names or group keys must match the recovery queue.</p>
        </div>
        <textarea
          aria-label="Bulk transcript intake"
          value={transcriptIntakeText}
          onChange={event => {
            setTranscriptIntakeText(event.target.value);
            setTranscriptIntakeMessage('');
            setTranscriptIntakeError(false);
          }}
          placeholder="Paste filled CSV rows, or: Alex R1 Video :: Hey, this is the exact spoken script..."
          rows={4}
        />
        <div className="motion-transcript-intake-actions">
          <label className="motion-upload-button">
            Upload CSV
            <input type="file" accept=".csv,text/csv,text/plain" onChange={event => loadIntakeFile(event, 'transcript')} />
          </label>
          <small>
            {transcriptIntakeText.trim()
              ? `${transcriptIntakePreview.entries.length} matched · ${transcriptIntakePreview.unmatched.length} unmatched · first ${Math.min(10, transcriptIntakePreview.entries.length)} will run`
              : 'Waiting for pasted scripts'}
          </small>
          <button
            type="button"
            disabled={transcriptIntakeRunning || !transcriptIntakePreview.entries.length}
            onClick={requestTranscriptIntakeConfirm}
          >
            {transcriptIntakeRunning ? 'Re-analyzing...' : 'Run matched scripts'}
          </button>
        </div>
      </div>
      {transcriptIntakeMessage ? <div className={transcriptIntakeError ? 'motion-error' : 'motion-notice'}>{transcriptIntakeMessage}</div> : null}
      {renderPreflight(transcriptIntakePreview, 'transcript')}

      <div className="motion-transcript-intake">
        <div>
          <span>Attribution intake</span>
          <strong>Paste confirmed source matches</strong>
          <p>Paste a filled source-review CSV export, or use one line per creative: <b>Creative name :: Creator Name</b>, <b>:: Made in HOWL</b>, <b>:: Founder: Alex</b>, or <b>:: Internal: Name</b>.</p>
        </div>
        <textarea
          aria-label="Bulk attribution intake"
          value={attributionIntakeText}
          onChange={event => {
            setAttributionIntakeText(event.target.value);
            setAttributionIntakeMessage('');
            setAttributionIntakeError(false);
          }}
          placeholder="Paste filled CSV rows, or: Wanderlings_UGC :: Creator Name"
          rows={3}
        />
        <div className="motion-transcript-intake-actions">
          <label className="motion-upload-button">
            Upload CSV
            <input type="file" accept=".csv,text/csv,text/plain" onChange={event => loadIntakeFile(event, 'attribution')} />
          </label>
          <small>
            {attributionIntakeText.trim()
              ? `${attributionIntakePreview.entries.length} matched · ${attributionIntakePreview.unmatched.length} unmatched · first ${Math.min(25, attributionIntakePreview.entries.length)} will apply`
              : 'Waiting for confirmed mappings'}
          </small>
          <button
            type="button"
            disabled={attributionIntakeRunning || !attributionIntakePreview.entries.length}
            onClick={requestAttributionIntakeConfirm}
          >
            {attributionIntakeRunning ? 'Applying...' : 'Apply matched sources'}
          </button>
        </div>
      </div>
      {attributionIntakeMessage ? <div className={attributionIntakeError ? 'motion-error' : 'motion-notice'}>{attributionIntakeMessage}</div> : null}
      {renderPreflight(attributionIntakePreview, 'attribution')}
      {renderIntakeConfirmation()}

      <div className="motion-toolbar">
        <div className="motion-toolbar-group">
          {[7, 14, 30, 90].map(days => (
            <button className={windowDays === days ? 'active' : ''} onClick={() => setWindowDays(days)} key={days}>{days}d</button>
          ))}
          <input aria-label="Search creatives" placeholder="Search creatives" value={query} onChange={e => setQuery(e.target.value)} />
          <select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}>
            {['All', 'Winner', 'Watch', 'Learning', 'Hook weak', 'Fix offer', 'Stop'].map(item => <option key={item}>{item}</option>)}
          </select>
          <select aria-label="Filter by readiness" value={readinessFilter} onChange={e => setReadinessFilter(e.target.value)}>
            {['All', 'Needs playback', 'Needs transcript', 'Needs analysis', 'Ready'].map(item => <option key={item}>{item}</option>)}
          </select>
          <select aria-label="Filter by creator" value={creatorFilter} onChange={e => setCreatorFilter(e.target.value)}>
            <option>All</option>
            <option>Unassigned</option>
            <option>Suggested</option>
            <option value="source:founder">Founder</option>
            <option value="source:internal_employee">Internal</option>
            <option value="source:tool_generated">Made in tool</option>
            {creators.map(creator => <option key={creator.id} value={creator.id}>{creator.name}</option>)}
          </select>
        </div>
        <div className="motion-toolbar-group">
          <button onClick={onSync} disabled={!onSync || syncing}>{syncing ? 'Syncing…' : 'Sync Meta'}</button>
          <button
            className="motion-primary"
            onClick={sendToConcepts}
            title={!conceptReferenceCount ? 'Analyze at least one winning creative first.' : ''}
          >
            {conceptButtonLabel}
          </button>
        </div>
      </div>
      {conceptMessage ? <div className="motion-error">{conceptMessage}</div> : null}

      <div className="motion-attribution">
        <div className="motion-attribution-copy">
          <span>Source attribution</span>
          <strong>{assignedCount} source-attributed · {rawGroups.length - assignedCount} need review</strong>
          <p>External UGC should map to a creator. Founder, internal employee, and in-app generated ads can be source-tagged without forcing a fake creator record.</p>
        </div>
        <div className="motion-attribution-stats">
          <div><span>Creator matches</span><strong>{suggestedCount}</strong></div>
          <div><span>Source tags</span><strong>{sourceSuggestedCount}</strong></div>
          <div><span>High confidence</span><strong>{highConfidenceCount}</strong></div>
        </div>
        <div className="motion-attribution-actions">
          <button onClick={() => { setCreatorFilter('Suggested'); setViewMode('table'); }}>Review matches</button>
          <button className="motion-primary" onClick={applyHighConfidenceSuggestions} disabled={!canManageCreators || batchAssigning || !highConfidenceCount}>
            {batchAssigning ? 'Applying…' : `Apply high confidence (${Math.min(100, highConfidenceCount)})`}
          </button>
        </div>
      </div>

      <div className="motion-queue">
        <div className="motion-queue-copy">
          <span>Batch creative analysis</span>
          <strong>
            {analysisQueueLoading && !analysisQueue
              ? 'Loading queue…'
              : `${analysisQueue?.summary?.pending || 0} waiting · ${analysisQueue?.summary?.processing || 0} running · ${analysisQueue?.summary?.failed || 0} failed`}
          </strong>
          <p>New launches and Meta syncs queue creative analysis automatically. Source-file videos transcribe in the worker; Meta-hosted embeds stay playable and move into the transcript recovery queue for pasted scripts.</p>
        </div>
        <div className="motion-queue-stats">
          {[
            ['Waiting', analysisQueue?.summary?.pending || 0],
            ['Running', analysisQueue?.summary?.processing || 0],
            ['Complete', analysisQueue?.summary?.completed || 0],
            ['Failed', analysisQueue?.summary?.failed || 0],
            ['24h done', queueThroughput.completed24h || 0],
            ['ETA', queueEta],
          ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        <div className="motion-queue-actions">
          <button onClick={onRefreshAnalysisQueue} disabled={analysisQueueLoading}>Refresh</button>
          {onNormalizeAssetBatch ? (
            <button onClick={onNormalizeAssetBatch} disabled={playbackRepairRunning}>
              {playbackRepairRunning ? 'Repairing playback…' : 'Repair playback'}
            </button>
          ) : null}
          {(analysisQueue?.summary?.failed || 0) > 0
            ? <button disabled={!onRetryAnalysisBatch} onClick={onRetryAnalysisBatch}>Retry failed</button>
            : null}
          <button className="motion-primary" onClick={onProcessAnalysisBatch} disabled={!onProcessAnalysisBatch || analysisBatchRunning || !(analysisQueue?.summary?.pending || 0)}>
            {analysisBatchRunning ? 'Analyzing…' : 'Run next 5'}
          </button>
        </div>
      </div>
      {(analysisQueue?.recent || []).some(job => job.status === 'failed') ? (
        <div className="motion-queue-failures">
          {(analysisQueue.recent || []).filter(job => job.status === 'failed').slice(0, 3).map(job => (
            <div key={job.group_key}>
              <strong>{job.name || job.group_key}</strong>
              <span>{job.last_error || 'Analysis failed after all retries.'}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="motion-metric-bar">
        <span>Add metric</span>
        {Object.entries(METRICS).map(([key, metric], index) => (
          <button key={key} className={selectedMetrics.includes(key) ? 'active' : ''} onClick={() => toggleMetric(key)}>
            <i>{index + 1}</i>{metric.label}
          </button>
        ))}
        <div className="motion-view-toggle">
          {['cards', 'chart', 'table'].map(mode => (
            <button key={mode} className={viewMode === mode ? 'active' : ''} onClick={() => setViewMode(mode)}>{mode}</button>
          ))}
        </div>
      </div>

      {syncMessage ? <div className="motion-notice">{syncMessage}</div> : null}
      {analysisQueueMessage ? <div className="motion-notice">{analysisQueueMessage}</div> : null}
      {playbackRepairMessage ? <div className="motion-notice">{playbackRepairMessage}</div> : null}
      {playbackMessage ? <div className={playbackError ? 'motion-error' : 'motion-notice'}>{playbackMessage}</div> : null}
      {assignmentMessage ? <div className={assignmentError ? 'motion-error' : 'motion-notice'}>{assignmentMessage}</div> : null}
      {error ? <div className="motion-error">{error}</div> : null}
      {loading && !creativeTable ? <div className="motion-loading">Loading creative performance…</div> : null}

      {viewMode === 'cards' && (
        <div className="motion-card-grid">
          {topGroups.map(g => {
            const quality = qualityStateFor(g);
            const confidence = g.analysisConfidence == null ? null : Math.round(Number(g.analysisConfidence) * 100);
            return (
            <article className={`motion-creative-card ${selectedSet.has(g.groupKey) ? 'selected' : ''}`} key={g.groupKey}>
              <button className="motion-select" aria-label={`Select ${g.name}`} onClick={() => toggleSelected(g.groupKey)}>
                {selectedSet.has(g.groupKey) ? '✓' : ''}
              </button>
              <div className="motion-media">
                {renderMedia(g)}
                <span>{statusFor(g)}</span>
              </div>
              <div className="motion-card-body">
                <h3>{g.name || 'Untitled creative'}</h3>
                <p>{g.adCount} ad{g.adCount === 1 ? '' : 's'} · {g.firstLaunchDate ? new Date(g.firstLaunchDate).toLocaleDateString() : 'No launch date'}</p>
                <div className={`motion-decision-strip ${quality.tone}`}>
                  <div>
                    <span>{quality.label}</span>
                    <strong>{quality.action}</strong>
                  </div>
                  <em>{confidence == null ? 'No score' : `${confidence}%`}</em>
                </div>
                {g.analysisOperatorSummary ? (
                  <p className="motion-card-summary">{g.analysisOperatorSummary}</p>
                ) : null}
                <div className="motion-readiness">
                  <div className={g.assetKind !== 'video' || g.playableUrl || g.playbackEmbedUrl ? 'ready' : 'warn'}>
                    <span>Playback</span>
                    <strong>{g.playableUrl || g.playbackEmbedUrl ? 'Ready' : labelForState(playableStateFor(g))}</strong>
                  </div>
                  <div className={g.transcriptStatus === 'complete' ? 'ready' : 'warn'}>
                    <span>Transcript</span>
                    <strong>{labelForState(g.transcriptStatus, g.assetKind === 'video' ? 'Needed' : 'N/A')}</strong>
                  </div>
                  <div className={g.isAnalyzed ? 'ready' : 'warn'}>
                    <span>Analysis</span>
                    <strong>{g.isAnalyzed ? 'Complete' : labelForState(g.analysisQueueStatus, 'Not run')}</strong>
                  </div>
                </div>
                {g.assetKind === 'video' && !g.playableUrl && !g.playbackEmbedUrl ? (
                  <button
                    type="button"
                    className="motion-repair-playback"
                    disabled={!onNormalizeAsset || repairingPlayback === g.groupKey}
                    onClick={() => repairPlayback(g)}
                  >
                    {repairingPlayback === g.groupKey ? 'Repairing playback…' : 'Repair playback'}
                  </button>
                ) : null}
                <div className={`motion-creator-assignment ${g.creatorConflict ? 'conflict' : ''}`}>
                  <span>{g.creatorConflict ? 'Creator conflict' : 'Creator'}</span>
                  <select
                    aria-label={`Assign creator to ${g.name || 'creative'}`}
                    value={g.creatorId || ''}
                    disabled={!canManageCreators || assigning === g.groupKey}
                    onChange={event => assignCreator(g, event.target.value ? Number(event.target.value) : null)}
                  >
                    <option value="">Unassigned</option>
                    {creators.map(creator => <option key={creator.id} value={creator.id}>{creator.name}</option>)}
                  </select>
                  {!g.creatorId && g.sourceType ? (
                    <small>{sourceTypeLabel(g.sourceType)} · {g.sourceLabel || 'source tagged'}</small>
                  ) : null}
                </div>
                {renderSourceControls(g)}
                {canManageCreators && !g.creatorId && !g.sourceType && g.suggestedCreatorId ? (
                  <button className="motion-creator-suggestion" title={g.suggestionReason} onClick={() => assignCreator(g, g.suggestedCreatorId)}>
                    <span>{g.suggestionConfidence === 'high' ? 'High confidence' : 'Review match'}</span>
                    Use {g.suggestedCreatorName}
                  </button>
                ) : null}
                {canManageCreators && !g.creatorId && !g.sourceType && !g.suggestedCreatorId && g.suggestedSourceType ? (
                  <button className="motion-creator-suggestion source" title={g.suggestedSourceReason} onClick={() => applySourceSuggestion(g)}>
                    <span>{g.suggestedSourceConfidence === 'high' ? 'High confidence source' : 'Review source'}</span>
                    Mark {sourceTypeLabel(g.suggestedSourceType)}
                  </button>
                ) : null}
                <dl>
                  {selectedMetrics.slice(0, 5).map(key => (
                    <div key={key}><dt>{METRICS[key].label}</dt><dd>{METRICS[key].format(g[key])}</dd></div>
                  ))}
                </dl>
                <button className="motion-analysis-link" onClick={() => g.isAnalyzed ? openGroupAnalysis(g) : onAnalyze?.(g.groupKey, g.name, '', g.assetId || null)}>
                  {g.isAnalyzed
                    ? 'Open review'
                    : g.analysisQueueStatus === 'processing'
                      ? 'Analysis running'
                      : g.analysisQueueStatus === 'pending'
                        ? 'Analyze now'
                        : g.analysisQueueStatus === 'failed'
                          ? 'Retry analysis now'
                      : 'Analyze creative'}
                </button>
              </div>
            </article>
          );
          })}
        </div>
      )}

      {viewMode === 'chart' && (
        <div className="motion-chart">
          <div className="motion-chart-legend">
            <span><i className="cpa" />CPA</span><span><i className="roas" />ROAS</span>
          </div>
          <div className="motion-chart-bars">
            {topGroups.slice(0, 8).map(g => {
              return (
                <div className="motion-chart-item" key={g.groupKey}>
                  <div className="motion-bars">
                    <div className="motion-bar cpa" style={{ height: `${Math.max(8, ((g.cpa || 0) / metricRanges.cpa.max) * 100)}%` }}><span>{METRICS.cpa.format(g.cpa)}</span></div>
                    <div className="motion-bar roas" style={{ height: `${Math.max(8, ((g.roas || 0) / metricRanges.roas.max) * 100)}%` }}><span>{METRICS.roas.format(g.roas)}</span></div>
                  </div>
                  {g.thumbnailUrl ? <img src={g.thumbnailUrl} alt="" /> : <div className="motion-chart-thumb" />}
                  <strong>{g.name}</strong>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {viewMode === 'table' && (
        <div className="motion-table-wrap">
          <table className="motion-table">
            <thead><tr>
              <th>Creative</th><th>Creator</th><th>Launch date</th><th>Status</th>
              {selectedMetrics.map(key => <th key={key}><button onClick={() => setSortKey(key)}>{METRICS[key].label}</button></th>)}
            </tr></thead>
            <tbody>
              {groups.map(g => <tr key={g.groupKey}>
                <td><button className="motion-name" onClick={() => openGroupAnalysis(g)}>
                  {g.previewUrl || g.thumbnailUrl ? <img src={g.previewUrl || g.thumbnailUrl} alt="" /> : null}<span><strong>{g.name}</strong><small>{g.adCount} ads · playback {g.playableUrl || g.playbackEmbedUrl ? 'ready' : labelForState(playableStateFor(g)).toLowerCase()}</small></span>
                </button></td>
                <td>
                  <select
                    className="motion-table-creator"
                    aria-label={`Assign creator to ${g.name || 'creative'}`}
                    value={g.creatorId || ''}
                    disabled={!canManageCreators || assigning === g.groupKey}
                    onChange={event => assignCreator(g, event.target.value ? Number(event.target.value) : null)}
                  >
                    <option value="">Unassigned</option>
                    {creators.map(creator => <option key={creator.id} value={creator.id}>{creator.name}</option>)}
                  </select>
                  {!g.creatorId && g.sourceType ? (
                    <small className="motion-source-tag">{sourceTypeLabel(g.sourceType)} · {g.sourceLabel || 'source tagged'}</small>
                  ) : null}
                  {renderSourceControls(g)}
                  {canManageCreators && !g.creatorId && !g.sourceType && g.suggestedCreatorId ? (
                    <button className="motion-table-suggestion" title={g.suggestionReason} onClick={() => assignCreator(g, g.suggestedCreatorId)}>
                      Use {g.suggestedCreatorName}
                    </button>
                  ) : null}
                  {canManageCreators && !g.creatorId && !g.sourceType && !g.suggestedCreatorId && g.suggestedSourceType ? (
                    <button className="motion-table-suggestion source" title={g.suggestedSourceReason} onClick={() => applySourceSuggestion(g)}>
                      Mark {sourceTypeLabel(g.suggestedSourceType)}
                    </button>
                  ) : null}
                </td>
                <td>{g.firstLaunchDate ? new Date(g.firstLaunchDate).toLocaleDateString() : '—'}</td>
                <td><span className={`motion-status status-${statusFor(g).toLowerCase().replace(' ', '-')}`}>{statusFor(g)}</span></td>
                {selectedMetrics.map(key => {
                  const range = metricRanges[key];
                  const normalized = range.max === range.min ? 0 : ((g[key] || 0) - range.min) / (range.max - range.min);
                  const strength = METRICS[key].better === 'low' ? 1 - normalized : normalized;
                  return <td key={key} style={{ background: `rgba(88, 190, 122, ${Math.max(0, strength) * 0.24})` }}>{METRICS[key].format(g[key])}</td>;
                })}
              </tr>)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
