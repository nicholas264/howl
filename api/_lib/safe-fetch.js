import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0))
      || (a === 198 && (b === 18 || b === 19))
      || address.startsWith('192.0.2.') || address.startsWith('198.51.100.') || address.startsWith('203.0.113.'));
  }
  // Only global-unicast IPv6; rejects mapped IPv4, loopback, link-local and ULA.
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^(2002:|2001:(db8|0{1,4}|10|20):)/i.test(address);
  return false;
}

export async function resolvePublicUrl(value, resolver = lookup) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || (url.port && !['80', '443'].includes(url.port))) throw new Error('Unsupported source URL');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }]
    : await resolver(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
    throw new Error('Source URL must resolve to a public address');
  }
  return { url, addresses };
}

// DNS is validated once and that exact address is pinned to the socket. Every
// redirect is resolved and checked independently; no second unchecked DNS lookup.
export async function fetchPublicResource(value, { maxBytes = 2 * 1024 * 1024, timeoutMs = 15000, maxRedirects = 4, contentTypes = /^(text\/(html|plain|xml)|application\/(xhtml\+xml|xml))(;|$)/i } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Source fetch timed out');
    let timer;
    const { url, addresses } = await Promise.race([
      resolvePublicUrl(value),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Source DNS timed out')), remaining); }),
    ]).finally(() => clearTimeout(timer));
    const result = await new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const request = transport.get(url, {
        agent: false,
        lookup: (_host, options, callback) => options.all
          ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family),
        headers: { Accept: '*/*', 'User-Agent': 'HOWL/1.0' },
      }, response => {
        const status = response.statusCode;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.destroy();
          resolve({ redirect: new URL(response.headers.location, url).toString() });
          return;
        }
        if (status < 200 || status >= 300) { response.destroy(); reject(new Error(`Source returned ${status}`)); return; }
        if (!contentTypes.test(response.headers['content-type'] || '')) {
          response.destroy(); reject(new Error('Source content type is not permitted')); return;
        }
        let size = 0;
        const chunks = [];
        response.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) request.destroy(new Error('Source exceeds size limit'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => resolve({ bytes: Buffer.concat(chunks), contentType: response.headers['content-type'], url: url.toString() }));
      });
      const timer = setTimeout(() => request.destroy(new Error('Source fetch timed out')), Math.max(1, deadline - Date.now()));
      request.on('error', reject);
      request.on('close', () => clearTimeout(timer));
    });
    if (!result.redirect) return result;
    value = result.redirect;
  }
  throw new Error('Too many source redirects');
}

export async function fetchPublicText(value, options) {
  const result = await fetchPublicResource(value, options);
  return { text: result.bytes.toString('utf8'), url: result.url };
}
