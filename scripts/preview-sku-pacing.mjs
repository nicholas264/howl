// Local UI fixture: no credentials, production API, or live writes.
import { createServer } from 'vite';
const page = `<html><head><meta charset="UTF-8"></head><body><p>SKU pacing verification · synthetic data</p><div id="root"></div><script type="module" src="/scripts/sku-preview.jsx"></script></body></html>`;
const server = await createServer({ configFile: false, root: process.cwd(), envDir: '/private/tmp/sku-pacing-empty-env', plugins: [{ name: 'sku-fixtures', configureServer(s) {
  s.middlewares.use(async (req, res, next) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname === '/') { res.setHeader('content-type', 'text/html'); return res.end(await s.transformIndexHtml('/', page)); }
    if (pathname.startsWith('/api/')) {
      res.setHeader('content-type', 'application/json');
      if (pathname.includes('monthly-metrics')) return res.end(JSON.stringify({ rows: [] }));
      let body = ''; for await (const chunk of req) body += chunk;
      const { monthKey } = JSON.parse(body || '{}');
      // October intentionally fails to exercise missing-data rendering.
      if (monthKey === '2026-10') { res.statusCode = 503; return res.end(JSON.stringify({ error: 'Fixture feed unavailable' })); }
      const common = { monthKey, since: `${monthKey}-01`, until: `${monthKey}-15`, unmapped: [] };
      if (pathname === '/api/meta') return res.end(JSON.stringify({ ...common, bySku: { 'R1 Campfire': 20902, 'R3 Campfire': 14601, 'R4 Campfire': 12889 }, totalSpend: 48392, mappedSpend: 48392 }));
      if (pathname === '/api/shopify') return res.end(JSON.stringify({ ...common, bySku: { 'R1 Campfire': { units: 145 }, 'R3 Campfire': { units: 131 }, 'R4 Campfire': { units: 91 }, 'R1 HaulBag': { units: 64 } } }));
      res.statusCode = 404; return res.end('{}');
    }
    next();
  });
}}], server: { host: '127.0.0.1', port: 5194, strictPort: true } });
await server.listen();
console.log('Synthetic SKU preview at http://127.0.0.1:5194');
