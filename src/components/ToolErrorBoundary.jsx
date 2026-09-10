import { isAssetLoadError, recoverAssetLoad } from '../lib/loadRecovery.js';
import React from 'react';

export default class ToolErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('Tool failed', error); recoverAssetLoad(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div role="alert" style={{ padding: 32 }}>
      <h2>This tool could not load.</h2>
      <p>{isAssetLoadError(this.state.error) ? 'A connection problem or workspace update interrupted loading. Your saved work is still available.' : 'This tool encountered an unexpected error. Your saved work is still available.'}</p>
      {!isAssetLoadError(this.state.error) && <button type="button" onClick={() => this.setState({ error: null })}>Try this tool again</button>}
      <p>Reloading will discard any unsaved changes.</p>
      <button type="button" onClick={() => window.location.reload()}>Reload</button>
    </div>;
  }
}
