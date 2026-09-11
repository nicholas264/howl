// Retry only a rejected token request: media has not been uploaded yet.
export async function requestUploadToken(request, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    const response = await request();
    if (response.status !== 429 || attempt >= 3) return response;
    const header = response.headers.get('Retry-After');
    const seconds = Number(header);
    const delay = header && Number.isFinite(seconds)
      ? seconds * 1000
      : header ? Date.parse(header) - Date.now() : 60000;
    await wait(Math.max(1000, Number.isFinite(delay) ? delay : 60000) + 1000);
  }
}
