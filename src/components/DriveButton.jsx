export default function DriveButton({ connected, connect, disconnect }) {
  return connected ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#256b35' }}>
        ● Drive Connected
      </div>
      <button
        onClick={disconnect}
        style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#88857f', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
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
        border: '1px solid #dedbd3',
        borderRadius: 4,
        color: '#77746f',
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
