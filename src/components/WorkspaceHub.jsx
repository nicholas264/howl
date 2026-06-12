const CREATIVE_TOOLS = [
  { tab: 'from-winners', label: 'Concept Studio', description: 'Turn proven creative patterns into grounded concepts and scripts.' },
  { tab: 'config', label: 'Copy Generator', description: 'Generate hooks, headlines, and primary text from a clear strategy.' },
  { tab: 'ugc-editor', label: 'UGC Editor', description: 'Edit creator footage, captions, pacing, and exports.' },
  { tab: 'image', label: 'Image Ads', description: 'Build static creative from product and lifestyle assets.' },
  { tab: 'callout', label: 'Callout Ads', description: 'Create product feature callouts with precise visual anchors.' },
  { tab: 'review', label: 'Review Ads', description: 'Convert customer proof into direct-response ads.' },
  { tab: 'video', label: 'Video Ads', description: 'Build motion creative and text-led video variants.' },
  { tab: 'founder', label: 'Founder Ads', description: 'Create founder-led messages and formats.' },
];

const PERFORMANCE_TOOLS = [
  { tab: 'creative-analytics', label: 'Creative Analytics', description: 'See winners, performance signals, transcripts, and Creative DNA.' },
  { tab: 'dashboard-cfo', label: 'Business Dashboard', description: 'Revenue pace, contribution margin, forecasts, and operating context.' },
  { tab: 'inventory', label: 'Inventory', description: 'Monitor product availability and operational constraints.' },
  { tab: 'log', label: 'Launch Log', description: 'Audit what launched, when, by whom, and with which source asset.' },
];

export default function WorkspaceHub({ type, setActiveTab }) {
  const isCreative = type === 'creative';
  const tools = isCreative ? CREATIVE_TOOLS : PERFORMANCE_TOOLS;
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

