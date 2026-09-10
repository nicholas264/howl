import React from 'react';

export function StartupStatus({ message = 'Connecting to secure sign-in…', error = false, onRetry }) {
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, []);
  return <main className="access-denied" role={error || slow ? 'alert' : 'status'}>
    <img src="/logos/howl-stacked-blk.png" alt="HOWL Campfires" />
    <h1>{error ? 'The workspace could not open.' : 'Opening the campfire'}</h1>
    <p>{message}</p>
    {slow && !error && <p>Sign-in is taking longer than expected. Check your connection and try again.</p>}
    {(error || slow) && <button type="button" onClick={onRetry || (() => window.location.reload())}>Try again</button>}
  </main>;
}

export class AppErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('Workspace startup failed', error); }
  render() {
    if (this.state.error) return <StartupStatus error message="An unexpected error interrupted the workspace. Try opening it again." />;
    return this.props.children;
  }
}
