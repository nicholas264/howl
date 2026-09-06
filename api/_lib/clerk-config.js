// Keep the legacy key available to decrypt existing Google OAuth records until
// those records are re-encrypted under a dedicated key. Authentication selects
// its production credential independently during the coordinated cutover.
export function clerkSecretKey() {
  return process.env.HOWL_USE_PRODUCTION_AUTH==='true'
    ? process.env.CLERK_PRODUCTION_SECRET_KEY : process.env.CLERK_SECRET_KEY;
}
