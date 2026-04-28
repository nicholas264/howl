import { useUser } from "@clerk/clerk-react";

const QUICK_ACTIONS = [
  { tab: 'config',           eyebrow: 'Generate',  title: 'Spark Copy',         sub: 'Hooks, headlines, primary text — Claude-fired.' },
  { tab: 'ugc',              eyebrow: 'Launch',    title: 'UGC Inbox',          sub: 'Whatever the team dropped in Drive, ready to ship.' },
  { tab: 'dashboard-cfo',    eyebrow: 'Insights',  title: 'CFO View',           sub: 'NCAC, CM3, OpEx coverage — real numbers.' },
  { tab: 'dashboard-meta',   eyebrow: 'Insights',  title: 'Meta',               sub: 'Live budget, format mix, monthly velocity.' },
];

export default function WelcomeScreen({ setActiveTab }) {
  const { user } = useUser();
  const firstName = user?.firstName || user?.username || null;

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Late night' : hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : hour < 21 ? 'Evening' : 'Late night';

  return (
    <div style={{ padding: '60px 36px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Hero */}
      <div style={{
        position: 'relative',
        border: '2px dashed #2a3441',
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

        <div className="eyebrow" style={{ marginBottom: 18, color: '#f5a623' }}>
          {firstName ? `${greeting}, ${firstName}` : greeting}
        </div>

        <div className="display-italic" style={{
          fontSize: 80,
          color: '#f0f4f8',
          lineHeight: 1,
          marginBottom: 18,
          letterSpacing: '-0.02em',
          textShadow: '0 0 40px rgba(220,68,10,0.25)',
        }}>
          Welcome to the campfire.
        </div>

        <div className="display-italic" style={{
          fontSize: 18,
          color: '#8b949e',
          maxWidth: 560,
          margin: '0 auto',
          lineHeight: 1.5,
        }}>
          Pull up a stump. Pour something hot. The work is waiting on the other side of this screen.
        </div>

        <div style={{ marginTop: 36, display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveTab('config')}
            style={{
              padding: '12px 28px',
              background: '#DC440A',
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
            Strike a spark
          </button>
          <button
            onClick={() => setActiveTab('dashboard-cfo')}
            style={{
              padding: '12px 28px',
              background: 'transparent',
              border: '1px solid #2a3441',
              color: '#8b949e',
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
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ marginTop: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 14, color: '#6e7681' }}>Where the embers are</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
          {QUICK_ACTIONS.map(a => (
            <button
              key={a.tab}
              onClick={() => setActiveTab(a.tab)}
              style={{
                textAlign: 'left',
                background: '#161b22',
                border: '1px solid #2a3441',
                borderRadius: 6,
                padding: '20px 22px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                color: 'inherit',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(220,68,10,0.4)'; e.currentTarget.style.background = '#1c2330'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a3441'; e.currentTarget.style.background = '#161b22'; }}
            >
              <div className="eyebrow" style={{ marginBottom: 8, color: '#6e7681' }}>{a.eyebrow}</div>
              <div className="display-md" style={{ color: '#f0f4f8', marginBottom: 6 }}>{a.title}</div>
              <div style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.4 }}>{a.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Tagline */}
      <div style={{ marginTop: 48, textAlign: 'center' }}>
        <div className="display-italic" style={{ fontSize: 13, color: '#6e7681' }}>
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
