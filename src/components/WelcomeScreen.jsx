import { useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/clerk-react";

const QUICK_ACTIONS = [
  { tab: 'campaign-planner', permission: 'briefs.write', eyebrow: 'Plan', title: 'Campaign Planner', sub: 'Pick product, allocate creators, and draft performance-led scripts.' },
  { tab: 'from-winners', permission: 'briefs.write', eyebrow: 'Create', title: 'Concept Studio', sub: 'Build creator-grounded concepts or iterate proven winners.' },
  { tab: 'launcher', permission: 'launch.write', eyebrow: 'Launch', title: 'UGC Inbox', sub: 'Whatever the team dropped in Drive, ready to ship.' },
  { tab: 'dashboard-cfo', permission: 'analytics.read', eyebrow: 'Insights', title: 'CFO View', sub: 'NCAC, CM3, OpEx coverage — real numbers.' },
  { tab: 'dashboard-meta', permission: 'analytics.read', eyebrow: 'Insights', title: 'Meta', sub: 'Live budget, format mix, monthly velocity.' },
];

async function loadJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Could not load ${url}`);
  return data;
}

function setupTarget(step) {
  if (step.key === 'duplicates' || step.key === 'profiles') return { type: 'creator-view', value: 'health' };
  if (step.key === 'clickup_email' || step.key === 'clickup_mapping' || step.key === 'clickup_review') return { type: 'creator-view', value: 'operations' };
  if (step.key === 'attribution') return { type: 'tab', value: 'creative-analytics' };
  if (step.key === 'footage_needs_transcript' || step.key === 'footage_ready_to_edit') return { type: 'tab', value: 'ugc-editor' };
  return { type: 'creator-view', value: 'operations' };
}

export default function WelcomeScreen({ setActiveTab, can = () => true, openCreatorWorkspace = () => setActiveTab('creators') }) {
  const { user } = useUser();
  const [operations, setOperations] = useState(null);
  const [health, setHealth] = useState(null);
  const [planner, setPlanner] = useState(null);
  const [loadingActions, setLoadingActions] = useState(true);
  const [actionError, setActionError] = useState('');
  const firstName = user?.firstName || user?.username || null;
  const availableActions = QUICK_ACTIONS.filter(action => can(action.permission));
  const primaryAction = availableActions.find(action => action.tab === 'from-winners')
    || availableActions.find(action => action.tab === 'launcher')
    || availableActions[0];
  const secondaryAction = availableActions.find(action => action.tab === 'dashboard-cfo' && action.tab !== primaryAction?.tab);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Late night' : hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : hour < 21 ? 'Evening' : 'Late night';
  const canSeeCreatorOps = can('creators.read');
  const canSeePlanner = can('briefs.read') || can('briefs.write');

  useEffect(() => {
    let cancelled = false;
    const requests = [];
    if (canSeeCreatorOps) {
      requests.push(['operations', loadJson('/api/creator-operations')]);
      requests.push(['health', loadJson('/api/creator-data-health')]);
    }
    if (canSeePlanner) requests.push(['planner', loadJson('/api/creator-campaign-planner')]);
    if (!requests.length) {
      setLoadingActions(false);
      return () => { cancelled = true; };
    }
    setLoadingActions(true);
    Promise.allSettled(requests.map(([, promise]) => promise)).then(results => {
      if (cancelled) return;
      const failed = [];
      results.forEach((result, index) => {
        const key = requests[index][0];
        if (result.status === 'fulfilled') {
          if (key === 'operations') setOperations(result.value);
          if (key === 'health') setHealth(result.value);
          if (key === 'planner') setPlanner(result.value);
        } else {
          failed.push(key);
        }
      });
      setActionError(failed.length ? `Some action data could not load: ${failed.join(', ')}.` : '');
      setLoadingActions(false);
    });
    return () => { cancelled = true; };
  }, [canSeeCreatorOps, canSeePlanner]);

  const actionCards = useMemo(() => {
    const cards = [];
    for (const step of (operations?.setup?.steps || []).slice(0, 3)) {
      const target = setupTarget(step);
      cards.push({
        key: `setup-${step.key}`,
        eyebrow: step.category === 'creative' || step.category === 'production' ? 'Workflow queue' : 'Setup blocker',
        title: step.title,
        detail: step.detail,
        count: step.count,
        action: step.action,
        target,
        priority: ['clickup_email', 'clickup_mapping', 'draft_briefs', 'approved_unsent_briefs'].includes(step.key) ? 'high' : 'medium',
      });
    }
    if (Number(operations?.summary?.urgent || 0) > 0) {
      cards.push({
        key: 'urgent-creator-work',
        eyebrow: 'Creator queue',
        title: `${operations.summary.urgent} urgent creator action${operations.summary.urgent === 1 ? '' : 's'}`,
        detail: 'Overdue deliverables, follow-ups, or blocked creator work need a decision.',
        count: operations.summary.urgent,
        action: 'Open operations',
        target: { type: 'creator-view', value: 'operations' },
        priority: 'high',
      });
    }
    const workflow = operations?.setup?.workflow || {};
    const draftBriefs = Number(workflow.draft_briefs || 0);
    if (draftBriefs > 0 && !cards.some(card => card.key === 'setup-draft_briefs')) {
      cards.push({
        key: 'draft-briefs',
        eyebrow: 'Approval gate',
        title: `${draftBriefs} draft brief${draftBriefs === 1 ? '' : 's'} need review`,
        detail: 'Scripts are editable and must be approved before assignments can be sent to creators.',
        count: draftBriefs,
        action: 'Review briefs',
        target: { type: 'creator-view', value: 'operations' },
        priority: 'high',
      });
    }
    const approvedUnsent = Number(workflow.approved_unsent_briefs || 0);
    if (approvedUnsent > 0 && !cards.some(card => card.key === 'setup-approved_unsent_briefs')) {
      cards.push({
        key: 'approved-unsent-briefs',
        eyebrow: 'Creator handoff',
        title: `${approvedUnsent} approved brief${approvedUnsent === 1 ? '' : 's'} not assigned`,
        detail: 'Approved scripts are ready to turn into creator assignments and upload links.',
        count: approvedUnsent,
        action: 'Send assignments',
        target: { type: 'creator-view', value: 'operations' },
        priority: 'high',
      });
    }
    const needsTranscript = Number(workflow.footage_needs_transcript || 0);
    if (needsTranscript > 0 && !cards.some(card => card.key === 'setup-footage_needs_transcript')) {
      cards.push({
        key: 'footage-transcript',
        eyebrow: 'UGC editor',
        title: `${needsTranscript} footage session${needsTranscript === 1 ? '' : 's'} need transcript`,
        detail: 'Transcription unlocks captioning, AI cleanup, edit decisions, and launch-ready exports.',
        count: needsTranscript,
        action: 'Open editor',
        target: { type: 'tab', value: 'ugc-editor' },
        priority: 'medium',
      });
    }
    const readyToEdit = Number(workflow.footage_ready_to_edit || 0);
    if (readyToEdit > 0 && !cards.some(card => card.key === 'setup-footage_ready_to_edit')) {
      cards.push({
        key: 'footage-edit',
        eyebrow: 'UGC editor',
        title: `${readyToEdit} footage session${readyToEdit === 1 ? '' : 's'} ready to edit`,
        detail: 'Creator footage has transcript data and needs final edit, captioning, or render approval.',
        count: readyToEdit,
        action: 'Open edit queue',
        target: { type: 'tab', value: 'ugc-editor' },
        priority: 'medium',
      });
    }
    const duplicateGroups = Number(health?.summary?.duplicate_groups || 0);
    if (duplicateGroups > 0 && !cards.some(card => card.key === 'setup-duplicates')) {
      cards.push({
        key: 'duplicate-creators',
        eyebrow: 'Data health',
        title: `${duplicateGroups} duplicate creator group${duplicateGroups === 1 ? '' : 's'}`,
        detail: 'Merge duplicate records so outreach, rates, footage, and performance live in one place.',
        count: duplicateGroups,
        action: 'Open data health',
        target: { type: 'creator-view', value: 'health' },
        priority: 'medium',
      });
    }
    const missingEmail = Number(health?.summary?.missing_email || 0);
    if (missingEmail > 0 && !cards.some(card => card.key === 'setup-clickup_email')) {
      cards.push({
        key: 'missing-emails',
        eyebrow: 'Data health',
        title: `${missingEmail} creator${missingEmail === 1 ? '' : 's'} missing email`,
        detail: 'Email is the gating field for outreach, agreements, brief sends, and follow-ups.',
        count: missingEmail,
        action: 'Open profile gaps',
        target: { type: 'creator-view', value: 'health' },
        priority: 'medium',
      });
    }
    const attribution = planner?.attribution;
    const totalLaunches = Number(attribution?.total_launches || 0);
    const attributedLaunches = Number(attribution?.attributed_launches || 0);
    if (totalLaunches > attributedLaunches) {
      cards.push({
        key: 'planner-attribution',
        eyebrow: 'Performance loop',
        title: `${totalLaunches - attributedLaunches} launch${totalLaunches - attributedLaunches === 1 ? '' : 'es'} need source attribution`,
        detail: 'Match external UGC to creators, or tag founder/internal/tool-generated ads so the planner learns from clean source data.',
        count: totalLaunches - attributedLaunches,
        action: 'Open planner mapping',
        target: { type: 'tab', value: 'campaign-planner' },
        priority: 'medium',
      });
    }
    return cards
      .sort((a, b) => (a.priority === 'high' ? -1 : 1) - (b.priority === 'high' ? -1 : 1))
      .slice(0, 5);
  }, [operations, health, planner]);

  const openAction = card => {
    if (card.target.type === 'creator-view') openCreatorWorkspace(card.target.value);
    else setActiveTab(card.target.value);
  };

  return (
    <div style={{ padding: '60px 36px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Hero */}
      <div style={{
        position: 'relative',
        border: '2px dashed #dedbd3',
        borderRadius: 12,
        padding: '88px 32px 80px',
        textAlign: 'center',
        overflow: 'hidden',
        background: 'radial-gradient(ellipse at center top, rgba(220,68,10,0.12) 0%, rgba(220,68,10,0.04) 35%, transparent 70%)',
      }}>
        {/* Soft ember glow */}
        <div aria-hidden style={{
          position: 'absolute',
          top: '-40%', left: '50%',
          transform: 'translateX(-50%)',
          width: 520, height: 520,
          background: 'radial-gradient(circle, rgba(245,166,35,0.18) 0%, rgba(220,68,10,0.08) 30%, transparent 60%)',
          filter: 'blur(20px)',
          pointerEvents: 'none',
          animation: 'campfire-pulse 6s ease-in-out infinite',
        }} />

        <div className="eyebrow" style={{ marginBottom: 18, color: '#9a6a0a' }}>
          {firstName ? `${greeting}, ${firstName}` : greeting}
        </div>

        <div className="display-italic" style={{
          fontSize: 80,
          color: '#171717',
          lineHeight: 1,
          marginBottom: 18,
          letterSpacing: '-0.02em',
          textShadow: '0 0 40px rgba(220,68,10,0.25)',
        }}>
          Welcome to the campfire.
        </div>

        <div className="display-italic" style={{
          fontSize: 18,
          color: '#77746f',
          maxWidth: 560,
          margin: '0 auto',
          lineHeight: 1.5,
        }}>
          Pull up a stump. Pour something hot. The work is waiting on the other side of this screen.
        </div>

        <div style={{ marginTop: 36, display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          {primaryAction ? (
            <button
              type="button"
              onClick={() => setActiveTab(primaryAction.tab)}
              style={{
                padding: '12px 28px',
                background: '#d84a17',
                border: 'none',
                color: '#fff',
                fontFamily: 'inherit',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 3,
                textTransform: 'uppercase',
                cursor: 'pointer',
                borderRadius: 4,
                boxShadow: '0 6px 24px rgba(220,68,10,0.35)',
              }}
            >
              {primaryAction.tab === 'from-winners' ? 'Strike a spark' : `Open ${primaryAction.title}`}
            </button>
          ) : null}
          {secondaryAction ? (
            <button
              type="button"
              onClick={() => setActiveTab(secondaryAction.tab)}
              style={{
                padding: '12px 28px',
                background: 'transparent',
                border: '1px solid #dedbd3',
                color: '#77746f',
                fontFamily: 'inherit',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 3,
                textTransform: 'uppercase',
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              Check the books
            </button>
          ) : null}
        </div>
      </div>

      <section style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-end', marginBottom: 14 }}>
          <div>
            <div className="eyebrow" style={{ color: '#88857f', marginBottom: 8 }}>Command center</div>
            <div className="display-md" style={{ color: '#171717' }}>What needs your attention</div>
          </div>
          <button
            type="button"
            onClick={() => openCreatorWorkspace('operations')}
            style={{
              padding: '9px 13px',
              background: '#fff',
              border: '1px solid #dedbd3',
              color: '#77746f',
              borderRadius: 5,
              fontFamily: 'inherit',
              fontSize: 9,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Open operations
          </button>
        </div>
        {actionError && <div className="app-error" style={{ marginBottom: 12 }}>{actionError}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12 }}>
          {loadingActions ? (
            <div style={{ gridColumn: '1 / -1', padding: 18, background: '#fff', border: '1px solid #dedbd3', borderRadius: 8, color: '#77746f', fontSize: 11 }}>
              Loading the action queue…
            </div>
          ) : actionCards.length ? actionCards.map(card => (
            <button
              key={card.key}
              type="button"
              onClick={() => openAction(card)}
              style={{
                display: 'grid',
                gridTemplateColumns: '44px 1fr',
                gap: 14,
                textAlign: 'left',
                background: card.priority === 'high' ? '#fff7f1' : '#fff',
                border: `1px solid ${card.priority === 'high' ? 'rgba(216,74,23,0.35)' : '#dedbd3'}`,
                borderRadius: 9,
                padding: '18px 18px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                color: 'inherit',
                boxShadow: card.priority === 'high' ? '0 10px 30px rgba(216,74,23,0.08)' : 'none',
              }}
            >
              <span style={{
                display: 'grid',
                placeItems: 'center',
                width: 42,
                height: 42,
                borderRadius: 7,
                background: card.priority === 'high' ? '#d84a17' : '#f4f1ea',
                color: card.priority === 'high' ? '#fff' : '#171717',
                fontSize: 15,
                fontWeight: 800,
              }}>
                {card.count}
              </span>
              <span>
                <i style={{ display: 'block', marginBottom: 6, color: '#88857f', fontStyle: 'normal', fontSize: 8, letterSpacing: 1.5, textTransform: 'uppercase' }}>{card.eyebrow}</i>
                <strong style={{ display: 'block', marginBottom: 6, color: '#171717', fontSize: 14 }}>{card.title}</strong>
                <small style={{ display: 'block', color: '#77746f', fontSize: 10, lineHeight: 1.45 }}>{card.detail}</small>
                <b style={{ display: 'block', marginTop: 12, color: '#d84a17', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase' }}>{card.action}</b>
              </span>
            </button>
          )) : (
            <div style={{ gridColumn: '1 / -1', padding: 20, background: '#fff', border: '1px solid #dedbd3', borderRadius: 8 }}>
              <strong style={{ display: 'block', marginBottom: 6, color: '#171717', fontSize: 14 }}>No critical work queued.</strong>
              <p style={{ margin: 0, color: '#77746f', fontSize: 11, lineHeight: 1.5 }}>The core action queue is clear. Next best move is planning the next creator campaign or reviewing fresh creative performance.</p>
            </div>
          )}
        </div>
      </section>

      {/* Quick actions */}
      <div style={{ marginTop: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 14, color: '#88857f' }}>Where the embers are</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
          {availableActions.map(a => (
            <button
              key={a.tab}
              type="button"
              onClick={() => setActiveTab(a.tab)}
              style={{
                textAlign: 'left',
                background: '#fff',
                border: '1px solid #dedbd3',
                borderRadius: 6,
                padding: '20px 22px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                color: 'inherit',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(220,68,10,0.4)'; e.currentTarget.style.background = '#f4f1ea'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#dedbd3'; e.currentTarget.style.background = '#fff'; }}
            >
              <div className="eyebrow" style={{ marginBottom: 8, color: '#88857f' }}>{a.eyebrow}</div>
              <div className="display-md" style={{ color: '#171717', marginBottom: 6 }}>{a.title}</div>
              <div style={{ fontSize: 11, color: '#77746f', lineHeight: 1.4 }}>{a.sub}</div>
            </button>
          ))}
          {!availableActions.length && (
            <div style={{
              gridColumn: '1 / -1',
              background: '#fff',
              border: '1px solid #dedbd3',
              borderRadius: 6,
              padding: '20px 22px',
              color: '#77746f',
              fontSize: 11,
              lineHeight: 1.5,
            }}>
              Your account is active, but no product areas are assigned yet. Ask an admin to add creator, launch, or analytics permissions.
            </div>
          )}
        </div>
      </div>

      {/* Tagline */}
      <div style={{ marginTop: 48, textAlign: 'center' }}>
        <div className="display-italic" style={{ fontSize: 13, color: '#88857f' }}>
          Built in Wheat Ridge. Forged in fire.
        </div>
      </div>

      <style>{`
        @keyframes campfire-pulse {
          0%, 100% { opacity: 0.85; transform: translateX(-50%) scale(1); }
          50%      { opacity: 1.00; transform: translateX(-50%) scale(1.06); }
        }
      `}</style>
    </div>
  );
}
