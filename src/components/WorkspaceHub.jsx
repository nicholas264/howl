const CREATIVE_TOOLS = [
  { tab: 'from-winners', permission: 'briefs.write', label: 'Concept Studio', description: 'Turn proven creative patterns into grounded concepts and scripts.' },
  { tab: 'config', permission: 'briefs.write', label: 'Copy Generator', description: 'Generate hooks, headlines, and primary text from a clear strategy.' },
  { tab: 'ugc-editor', permission: 'assets.write', label: 'UGC Editor', description: 'Edit creator footage, captions, pacing, and exports.' },
  { tab: 'image', permission: 'assets.write', label: 'Image Ads', description: 'Build static creative from product and lifestyle assets.' },
  { tab: 'callout', permission: 'assets.write', label: 'Callout Ads', description: 'Create product feature callouts with precise visual anchors.' },
  { tab: 'review', permission: 'assets.write', label: 'Review Ads', description: 'Convert customer proof into direct-response ads.' },
  { tab: 'video', permission: 'assets.write', label: 'Video Ads', description: 'Build motion creative and text-led video variants.' },
  { tab: 'founder', permission: 'assets.write', label: 'Founder Ads', description: 'Create founder-led messages and formats.' },
];

const PERFORMANCE_TOOLS = [
  { tab: 'creative-analytics', permission: 'analytics.read', label: 'Creative Analytics', description: 'See winners, performance signals, transcripts, and Creative DNA.' },
  { tab: 'dashboard-cfo', permission: 'analytics.read', label: 'Business Dashboard', description: 'Revenue pace, contribution margin, forecasts, and operating context.' },
  { tab: 'inventory', permission: 'analytics.read', label: 'Inventory', description: 'Monitor product availability and operational constraints.' },
  { tab: 'log', permission: 'launch.read', label: 'Launch Log', description: 'Audit what launched, when, by whom, and with which source asset.' },
];

export default function WorkspaceHub({ type, setActiveTab, can = () => true }) {
  const isCreative = type === 'creative';
  const tools = (isCreative ? CREATIVE_TOOLS : PERFORMANCE_TOOLS)
    .filter(tool => can(tool.permission));
  return (
    <div className="workspace-page">
      <header className="workspace-head">
        <div>
          <span className="workspace-kicker">{isCreative ? 'Creative system' : 'Decision system'}</span>
          <h1>{isCreative ? 'Make the next asset.' : 'Know what is working.'}</h1>
          <p>
            {isCreative
              ? 'Start from performance, build with intent, and keep every asset connected to its source.'
              : 'A focused view of creative, revenue, inventory, and launch activity.'}
          </p>
        </div>
      </header>
      <div className="workspace-tool-grid">
        {tools.map(tool => (
          <button key={tool.tab} className="workspace-tool-card" onClick={() => setActiveTab(tool.tab)}>
            <span>Open</span>
            <strong>{tool.label}</strong>
            <p>{tool.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
