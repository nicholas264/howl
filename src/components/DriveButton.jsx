export default function DriveButton({ connected, connect, disconnect }) {
  return connected ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#3fb950' }}>
        ● Drive Connected
      </div>
      <button
        onClick={disconnect}
        style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#6e7681', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        Disconnect
      </button>
    </div>
  ) : (
    <button
      onClick={connect}
      style={{
        padding: '7px 14px',
        background: 'none',
        border: '1px solid #2a3441',
        borderRadius: 4,
        color: '#8b949e',
        fontFamily: 'inherit',
        fontSize: 9,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        cursor: 'pointer',
      }}
    >
      Connect Drive
    </button>
  );
}
