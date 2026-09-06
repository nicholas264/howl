// Keep the legacy key available to decrypt existing Google OAuth records until
// those records are re-encrypted under a dedicated key. Authentication selects
// its production credential independently during the coordinated cutover.
export function clerkSecretKey() {
  const key = process.env.HOWL_USE_PRODUCTION_AUTH==='true'
    ? process.env.CLERK_PRODUCTION_SECRET_KEY : process.env.CLERK_SECRET_KEY;
  if (key && !/^sk_(live|test)_[A-Za-z0-9]+$/.test(key)) {
    throw new Error('Authentication credential is invalid; configure a complete Clerk secret key.');
  }
  return key;
}
