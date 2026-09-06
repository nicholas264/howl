const errors={
  access_denied:'Google access was not granted. Connect again and allow read-only Drive access.',
  invalid_state:'The Google connection attempt expired or was already used. Connect again from this app.',
  no_refresh_token:'Google did not provide an offline connection. Connect again and complete Google’s consent screen.',
  token_exchange:'Google could not complete the connection. Start a new connection attempt.',
  scope_not_granted:'Read-only Drive access was not granted. Connect again and select the Drive permission.',
  save_failed:'The app could not save the Google connection. Please retry.',
};
export function readGoogleConnectionResult(search) {
  const p=new URLSearchParams(search),code=p.get('drive_error');
  return {connectionError:code?(errors[code] || 'Google connection failed. Please connect again.'):null,connectionSucceeded:!code && (p.has('drive_connected') || p.has('gmail_connected'))};
}
export function cleanGoogleConnectionUrl(href) {
  const url=new URL(href);
  for(const key of ['drive_connected','gmail_connected','drive_error','drive_token'])url.searchParams.delete(key);
  return url.pathname+url.search+url.hash;
}
