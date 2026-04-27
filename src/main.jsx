import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider, SignedIn, SignedOut, SignIn, useAuth } from '@clerk/clerk-react'
import App from './App.jsx'

const PUB_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!PUB_KEY) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY')

// Patch window.fetch so every /api/* call carries the Clerk session JWT.
function FetchInterceptor() {
  const { getToken, isSignedIn } = useAuth()
  React.useEffect(() => {
    if (!isSignedIn) return
    const orig = window.fetch
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url
      if (url && (url.startsWith('/api/') || url.includes('/api/'))) {
        try {
          const token = await getToken()
          if (token) init = { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } }
        } catch {}
      }
      return orig(input, init)
    }
    return () => { window.fetch = orig }
  }, [isSignedIn, getToken])
  return null
}

const appearance = {
  variables: {
    colorPrimary: '#DC440A',
    colorBackground: '#0d1117',
    colorInputBackground: '#1c2330',
    colorInputText: '#f0f4f8',
    colorText: '#f0f4f8',
    colorTextSecondary: '#8b949e',
    fontFamily: 'JetBrains Mono, monospace',
  },
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUB_KEY} appearance={appearance}>
      <SignedIn>
        <FetchInterceptor />
        <App />
      </SignedIn>
      <SignedOut>
        <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <SignIn routing="hash" />
        </div>
      </SignedOut>
    </ClerkProvider>
  </React.StrictMode>,
)
