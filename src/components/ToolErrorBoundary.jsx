import React from 'react';

export default class ToolErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('Tool failed', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div role="alert" style={{ padding: 32 }}>
      <h2>This tool could not load.</h2>
      <p>Your saved work is still available. Reload to try again.</p>
      <button type="button" onClick={() => window.location.reload()}>Reload</button>
    </div>;
  }
}
