import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useAuth } from '@clerk/clerk-react'
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
const isPublicCreatorPage = isCreatorSubmission || isCreatorAgreement || isCreatorApplication
if (!PUB_KEY && !isPublicCreatorPage && !DEV_AUTH_BYPASS) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY')

// Install authenticated API access and verify workspace membership before any
// private application component is mounted.
function AuthenticatedApp() {
  const { getToken, isSignedIn } = useAuth()
  const [access, setAccess] = React.useState(null)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (!isSignedIn) return
    const orig = window.fetch
    let active = true
    const authenticatedFetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url
      if (url && (url.startsWith('/api/') || url.includes('/api/'))) {
        try {
          const token = await getToken()
          if (token) init = { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } }
        } catch {}
      }
      return orig(input, init)
    }
    window.fetch = authenticatedFetch

    authenticatedFetch('/api/app-context')
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not verify workspace access')
        if (active) setAccess(data)
      })
      .catch(err => {
        if (active) setError(err.message)
      })

    return () => {
      active = false
      window.fetch = orig
    }
  }, [isSignedIn, getToken])

  if (error) {
    return (
      <div className="access-denied">
        <img src="/logos/howl-stacked-blk.png" alt="HOWL Campfires" />
        <span className="workspace-kicker">Access check failed</span>
        <h1>We could not verify this account.</h1>
        <p>{error}</p>
        <UserButton afterSignOutUrl="/" />
      </div>
    )
  }

  if (!access) {
    return <div className="access-loading">Verifying workspace access…</div>
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

  return <App appAccess={access} />
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
  <React.Suspense fallback={<div className="creator-submit-page" />}>
    <CreatorSubmissionPage />
  </React.Suspense>
) : isCreatorAgreement ? (
  <React.Suspense fallback={<div className="creator-submit-page" />}>
    <CreatorAgreementPage />
  </React.Suspense>
) : isCreatorApplication ? (
  <React.Suspense fallback={<div className="creator-apply-page" />}>
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
) : (
  <ClerkProvider publishableKey={PUB_KEY} appearance={appearance}>
    <SignedIn>
      <AuthenticatedApp />
    </SignedIn>
    <SignedOut>
      <div style={{ minHeight: '100vh', background: '#f7f6f2', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <SignIn routing="hash" />
      </div>
    </SignedOut>
  </ClerkProvider>
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {app}
  </React.StrictMode>,
)
