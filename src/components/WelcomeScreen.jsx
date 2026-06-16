import { useUser } from "@clerk/clerk-react";

const QUICK_ACTIONS = [
  { tab: 'from-winners', permission: 'briefs.write', eyebrow: 'Create', title: 'Concept Studio', sub: 'Build creator-grounded concepts or iterate proven winners.' },
  { tab: 'launcher', permission: 'launch.write', eyebrow: 'Launch', title: 'UGC Inbox', sub: 'Whatever the team dropped in Drive, ready to ship.' },
  { tab: 'dashboard-cfo', permission: 'analytics.read', eyebrow: 'Insights', title: 'CFO View', sub: 'NCAC, CM3, OpEx coverage — real numbers.' },
  { tab: 'dashboard-meta', permission: 'analytics.read', eyebrow: 'Insights', title: 'Meta', sub: 'Live budget, format mix, monthly velocity.' },
];

export default function WelcomeScreen({ setActiveTab, can = () => true }) {
  const { user } = useUser();
  const firstName = user?.firstName || user?.username || null;
  const availableActions = QUICK_ACTIONS.filter(action => can(action.permission));
  const primaryAction = availableActions.find(action => action.tab === 'from-winners')
    || availableActions.find(action => action.tab === 'launcher')
    || availableActions[0];
  const secondaryAction = availableActions.find(action => action.tab === 'dashboard-cfo' && action.tab !== primaryAction?.tab);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Late night' : hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : hour < 21 ? 'Evening' : 'Late night';

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
