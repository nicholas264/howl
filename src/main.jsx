import { installLoadRecovery, withDeadline } from './lib/loadRecovery.js'
import { AppErrorBoundary, StartupStatus } from './components/StartupStatus.jsx'
import { apiFetch, configureApiSession } from './lib/apiFetch.js'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider, ClerkLoading, SignedIn, SignedOut, SignIn, UserButton, useAuth } from '@clerk/clerk-react'
import App from './App.jsx'
import './styles.css'

const CreatorSubmissionPage = React.lazy(() => import('./components/CreatorSubmissionPage.jsx'))
const CreatorAgreementPage = React.lazy(() => import('./components/CreatorAgreementPage.jsx'))
const CreatorApplicationPage = React.lazy(() => import('./components/CreatorApplicationPage.jsx'))
const PUB_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const DEV_AUTH_BYPASS = import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === 'true'
const isCreatorSubmission = /^\/submit\/?$/.test(window.location.pathname)
const isCreatorAgreement = /^\/agreement\/?$/.test(window.location.pathname)
const isCreatorApplication = /^\/apply\/?$/.test(window.location.pathname)
installLoadRecovery()

// Install authenticated API access and verify workspace membership before any
// private application component is mounted.
function AuthenticatedApp() {
  const { getToken, isSignedIn, userId } = useAuth()
  const [access, setAccess] = React.useState(null)
  const [error, setError] = React.useState('')
  const [attempt, setAttempt] = React.useState(0)
  const tokenGetter = React.useRef(getToken)
  tokenGetter.current = getToken

  React.useEffect(() => {
    if (!isSignedIn) return
    setAccess(null)
    setError('')
    let active = true
    const clearSession = configureApiSession((...args) => tokenGetter.current(...args))
    const controller = new AbortController()

    withDeadline((async () => {
        const response = await apiFetch('/api/app-context', { signal: controller.signal, cache: 'no-store' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not verify workspace access')
        if (data.auth_subject !== userId) throw new Error('Your sign-in changed. Please try again.')
        return data
      })(), 20000, 'The access check timed out. Please try again.')
      .then(data => { if (active) setAccess(data) })
      .catch(err => {
        controller.abort()
        if (active) setError(err.message)
      })

    return () => {
      active = false
      controller.abort()
      clearSession()
    }
  }, [isSignedIn, userId, attempt])

  if (error) {
    return (
      <div className="access-denied">
        <img src="/logos/howl-stacked-blk.png" alt="HOWL Campfires" />
        <span className="workspace-kicker">Access check failed</span>
        <h1>We could not verify this account.</h1>
        <p>{error}</p>
        <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>
        <UserButton afterSignOutUrl="/" />
      </div>
    )
  }

  if (!access || access.auth_subject !== userId) {
    return <StartupStatus message="Verifying workspace access…" />
  }

  if (!access.user || access.user.status !== 'active') {
    return (
      <div className="access-denied">
        <img src="/logos/howl-stacked-blk.png" alt="HOWL Campfires" />
        <span className="workspace-kicker">Access required</span>
        <h1>This HOWL workspace is invite-only.</h1>
        <p>Ask a workspace owner to invite this email address from Admin.</p>
        <UserButton afterSignOutUrl="/" />
      </div>
    )
  }

  return <App key={userId} appAccess={access} />
}

const appearance = {
  variables: {
    colorPrimary: '#d84a17',
    colorBackground: '#fff',
    colorInputBackground: '#f4f1ea',
    colorInputText: '#171717',
    colorText: '#171717',
    colorTextSecondary: '#6f6d68',
    fontFamily: 'Helvetica Neue, Helvetica, sans-serif',
  },
  elements: {
    footerAction: { display: 'none' },
  },
}

const app = isCreatorSubmission ? (
  <React.Suspense fallback={<StartupStatus message="Opening your creator page…" />}>
    <CreatorSubmissionPage />
  </React.Suspense>
) : isCreatorAgreement ? (
  <React.Suspense fallback={<StartupStatus message="Opening your creator page…" />}>
    <CreatorAgreementPage />
  </React.Suspense>
) : isCreatorApplication ? (
  <React.Suspense fallback={<StartupStatus message="Opening your application…" />}>
    <CreatorApplicationPage />
  </React.Suspense>
) : DEV_AUTH_BYPASS ? (
  PUB_KEY ? (
    <ClerkProvider publishableKey={PUB_KEY} appearance={appearance}>
      <App appAccess={{
        user: { status: 'active', display_name: 'Local Developer', email: 'dev@local' },
        role: 'owner',
        permissions: ['*'],
        localAuthBypass: true,
      }} />
    </ClerkProvider>
  ) : (
    <App appAccess={{
      user: { status: 'active', display_name: 'Local Developer', email: 'dev@local' },
      role: 'owner',
      permissions: ['*'],
      localAuthBypass: true,
    }} />
  )
) : !PUB_KEY ? (
  <StartupStatus error message="Sign-in is temporarily unavailable. Please contact the workspace administrator." />
) : (
  <ClerkProvider publishableKey={PUB_KEY} appearance={appearance}>
    <ClerkLoading><StartupStatus /></ClerkLoading>
    <SignedIn>
      <AuthenticatedApp />
    </SignedIn>
    <SignedOut>
      <div style={{ minHeight: '100vh', background: '#f7f6f2', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <SignIn routing="hash" forceRedirectUrl={`${window.location.pathname}${window.location.search}`} />
      </div>
    </SignedOut>
  </ClerkProvider>
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>{app}</AppErrorBoundary>
  </React.StrictMode>,
)
