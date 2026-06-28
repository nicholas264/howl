import { requirePermission } from './_lib/app-access.js';
import { remotionConfig } from './_lib/ugc-remotion.js';

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'assets.write');
  if (!access) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const lambda = remotionConfig();
  return res.json({
    ok: true,
    configured: lambda.configured,
    missing: lambda.missing,
    region: lambda.region,
    function_name: lambda.configured ? lambda.functionName : '',
    serve_url: lambda.configured ? lambda.serveUrl : '',
  });
}
