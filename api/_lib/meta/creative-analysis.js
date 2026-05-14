// AI creative analysis for Meta ads. Extracted from api/meta.js to keep
// that file focused on publishing + insights. Three handlers live here:
//
//   analyzeCreativeGroup({ groupKey, manualTranscript, ctx })
//   getCreativeAnalysis({ groupKey })
//   listAnalyzedWinners({ sinceDays })
//
// `ctx` carries the closure variables the meta handler computed once:
// { BASE, accessToken, adAccountId }.
import { neon } from '@neondatabase/serverless';

export async function analyzeCreativeGroup({ groupKey, manualTranscript = '', ctx }) {
  if (!groupKey) return { status: 400, body: { error: 'groupKey required' } };
  if (!process.env.DATABASE_URL) return { status: 200, body: { error: 'DATABASE_URL not configured' } };
  if (!process.env.ANTHROPIC_API_KEY) return { status: 200, body: { error: 'ANTHROPIC_API_KEY not configured' } };
  const { BASE, accessToken, adAccountId } = ctx;
  const sql = neon(process.env.DATABASE_URL);

  // Pick the top-spend ad in the group as the canonical asset for analysis.
  const [topAd] = await sql`
    SELECT cp.ad_id, cp.ad_name, cp.video_id, cp.image_hash, cp.thumbnail_url, cp.creative_id,
      COALESCE(SUM(i.spend), 0)::float          AS spend,
      COALESCE(SUM(i.purchase_value), 0)::float AS purchase_value,
      COALESCE(SUM(i.purchases), 0)::int        AS purchases,
      COALESCE(SUM(i.impressions), 0)::bigint   AS impressions,
      COALESCE(SUM(i.clicks), 0)::bigint        AS clicks
    FROM creative_performance cp
    LEFT JOIN creative_insights_daily i ON i.ad_id = cp.ad_id
    WHERE cp.group_key = ${groupKey}
    GROUP BY cp.ad_id, cp.ad_name, cp.video_id, cp.image_hash, cp.thumbnail_url, cp.creative_id
    ORDER BY spend DESC
    LIMIT 1
  `;
  if (!topAd) return { status: 404, body: { error: 'No ads found for group' } };

  const isVideo = !!topAd.video_id;
  const assetKind = isVideo ? 'video' : 'image';
  const debug = { videoFieldsResolved: null, videoSourceUrl: null, videoBytes: 0, whisper: null, image: null };

  let imageUrl = topAd.thumbnail_url;
  let videoSource = null;
  if (isVideo) {
    const r = await fetch(`${BASE}/${topAd.video_id}?fields=source,picture,format,permalink_url,embed_html&access_token=${accessToken}`);
    const d = await r.json();
    if (d.error) {
      debug.videoFieldsResolved = `meta error: ${d.error.message}`;
    } else {
      debug.videoFieldsResolved = Object.keys(d).join(',');
      videoSource = d.source || null;
      if (!videoSource && Array.isArray(d.format)) {
        for (const f of d.format) { if (f?.picture) imageUrl = f.picture; }
      }
      if (d.picture) imageUrl = d.picture;
      if (!videoSource && d.embed_html) {
        const m = d.embed_html.match(/src=["']([^"']+\.mp4[^"']*)["']/i)
          || d.embed_html.match(/src=["']([^"']+)["']/i);
        if (m) {
          videoSource = m[1].replace(/&amp;/g, '&');
          debug.videoSourceUrl = 'recovered from embed_html';
        }
      }
      if (!videoSource) {
        try {
          const r2 = await fetch(`${BASE}/${adAccountId}/advideos?ids=${encodeURIComponent(topAd.video_id)}&fields=source&access_token=${accessToken}`);
          const d2 = await r2.json();
          const inner = d2 && d2[topAd.video_id];
          if (inner?.source) {
            videoSource = inner.source;
            debug.videoSourceUrl = 'recovered from advideos endpoint';
          }
        } catch {}
      }
      if (!videoSource) {
        // Final fallback: we may have mirrored the video to Vercel Blob at launch time.
        // Look it up by ad_id (and other ad_ids in this group for safety).
        try {
          const [row] = await sql`
            SELECT lh.source_video_url
            FROM launch_history lh
            JOIN creative_performance cp ON cp.ad_id = lh.ad_id
            WHERE cp.group_key = ${groupKey} AND lh.source_video_url IS NOT NULL
            ORDER BY lh.launched_at DESC
            LIMIT 1
          `;
          if (row?.source_video_url) {
            videoSource = row.source_video_url;
            debug.videoSourceUrl = 'recovered from launch_history (Blob mirror)';
          }
        } catch (err) {
          debug.videoSourceUrl = `launch_history lookup failed: ${err.message}`;
        }
      }
      if (!debug.videoSourceUrl) {
        debug.videoSourceUrl = videoSource ? 'present' : 'missing (Meta restricts source on this video — try Paste transcript)';
      }
    }
  } else if (topAd.image_hash) {
    const hashesParam = encodeURIComponent(JSON.stringify([topAd.image_hash]));
    const r = await fetch(`${BASE}/${adAccountId}/adimages?hashes=${hashesParam}&fields=url&access_token=${accessToken}`);
    const d = await r.json();
    const img = (d.data || [])[0];
    if (img?.url) imageUrl = img.url;
  }

  let transcript = manualTranscript;
  if (manualTranscript) debug.whisper = `manual: ${manualTranscript.length} chars`;
  if (isVideo && !manualTranscript) {
    if (!process.env.OPENAI_API_KEY) {
      debug.whisper = 'skipped: OPENAI_API_KEY missing in this environment';
    } else if (!videoSource) {
      debug.whisper = 'skipped: no video source URL';
    } else {
      try {
        const vr = await fetch(videoSource);
        if (!vr.ok) {
          debug.whisper = `video fetch failed: HTTP ${vr.status}`;
        } else {
          const buf = Buffer.from(await vr.arrayBuffer());
          debug.videoBytes = buf.length;
          if (buf.length > 24 * 1024 * 1024) {
            debug.whisper = `skipped: video is ${(buf.length / 1024 / 1024).toFixed(1)}MB (Whisper limit 25MB)`;
          } else {
            const form = new FormData();
            form.append('file', new Blob([buf], { type: 'video/mp4' }), 'video.mp4');
            form.append('model', 'whisper-1');
            form.append('response_format', 'text');
            const wr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
              method: 'POST',
              headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
              body: form,
            });
            if (wr.ok) {
              transcript = (await wr.text()).trim();
              debug.whisper = `ok: ${transcript.length} chars`;
            } else {
              const errText = await wr.text();
              debug.whisper = `whisper HTTP ${wr.status}: ${errText.slice(0, 200)}`;
            }
          }
        }
      } catch (err) {
        debug.whisper = `exception: ${err.message}`;
      }
    }
  }

  let imageB64 = null;
  let mediaType = 'image/jpeg';
  if (imageUrl) {
    try {
      const ir = await fetch(imageUrl);
      if (!ir.ok) {
        debug.image = `image fetch failed: HTTP ${ir.status}`;
      } else {
        const buf = Buffer.from(await ir.arrayBuffer());
        imageB64 = buf.toString('base64');
        mediaType = ir.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
        debug.image = `ok: ${buf.length} bytes, ${mediaType}`;
      }
    } catch (err) {
      debug.image = `exception: ${err.message}`;
    }
  } else {
    debug.image = 'no image URL';
  }

  const perf = {
    spend: Number(topAd.spend) || 0,
    purchaseValue: Number(topAd.purchase_value) || 0,
    purchases: Number(topAd.purchases) || 0,
    impressions: Number(topAd.impressions) || 0,
    clicks: Number(topAd.clicks) || 0,
  };
  perf.roas = perf.spend > 0 ? perf.purchaseValue / perf.spend : 0;
  perf.cpa = perf.purchases > 0 ? perf.spend / perf.purchases : null;

  const haveTranscript = !!transcript;
  const systemPrompt = `You analyze HOWL Campfires Meta ads. HOWL sells smokeless propane fire pits (R1, R4 MKii, etc.) — outdoor brand, masculine voice, "burn-ban-friendly" angle is recurring.

You will receive ONE still image (either a static ad, or a single thumbnail frame from a video ad) plus optionally a full transcript and performance numbers.

CRITICAL RULES:
- If a transcript is provided, the verbal hook is the FIRST sentence or two of that transcript. Quote it verbatim.
- If NO transcript is provided, you are looking at only a thumbnail frame. You CANNOT know the spoken hook. Set "hook_text_verbatim" to null and note this clearly in why_it_worked. Do not guess the hook from the thumbnail.
- For videos with no transcript, mark hook_type as "unknown" rather than fabricating one.
- Never invent dialogue, on-screen text, or claims that are not visible in the image or written in the transcript.

Return ONLY a single valid JSON object with these exact fields:

{
  "hook_text_verbatim": "the literal opening line from the transcript (<=140 chars), or null if no transcript",
  "hook_type": "one of: question | stat | problem | POV | demo | testimonial | before-after | list | contrarian | founder | unknown | other",
  "format": "one of: ugc-talking-head | ugc-product-demo | studio-product | founder | callout-graphic | review-collage | static-image | other",
  "angle": "short label (<=6 words) for the persuasive angle, e.g. 'burn ban anywhere'",
  "talent_description": "1 sentence on who is on camera (or 'no on-camera talent' for static)",
  "visual_summary": "2-3 sentences on what the eye sees in the image: setting, framing, on-screen text, motion cues",
  "why_it_worked": "3-5 sentences. Concrete reasoning that ties THIS creative's available signals (transcript if present, visual format, performance) to its results. If no transcript, acknowledge the limitation and reason from format/visual/performance only. Avoid generic ad-school platitudes."
}

No prose outside the JSON. No markdown fences.`;

  const userText = `Performance (last 30d, this creative group):
- Spend: $${perf.spend.toFixed(2)}
- Revenue: $${perf.purchaseValue.toFixed(2)}
- Purchases: ${perf.purchases}
- ROAS: ${perf.roas.toFixed(2)}x
${perf.cpa != null ? `- CPA: $${perf.cpa.toFixed(2)}` : ''}

${haveTranscript ? `Transcript (full):\n${transcript}` : (isVideo
  ? 'NO TRANSCRIPT AVAILABLE — only the thumbnail frame is visible to you. You cannot determine the spoken hook. Follow the rule above: hook_text_verbatim must be null.'
  : 'Static image ad, no transcript needed.')}

Analyze this creative.`;

  const claudeContent = [];
  if (imageB64) claudeContent.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } });
  claudeContent.push({ type: 'text', text: userText });

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: claudeContent }],
    }),
  });
  const claudeData = await claudeRes.json();
  if (claudeData.error) return { status: 400, body: { error: claudeData.error.message, step: 'claude' } };

  const text = (claudeData.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed = null;
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return { status: 500, body: { error: 'Failed to parse analysis JSON', raw: text } };
  }

  await sql`
    INSERT INTO creative_analysis
      (group_key, asset_kind, transcript, hook_text_verbatim, hook_type, format, angle, talent_description, visual_summary, why_it_worked, performance_snapshot, model, generated_at)
    VALUES
      (${groupKey}, ${assetKind}, ${transcript || null}, ${parsed.hook_text_verbatim || null}, ${parsed.hook_type || null}, ${parsed.format || null}, ${parsed.angle || null}, ${parsed.talent_description || null}, ${parsed.visual_summary || null}, ${parsed.why_it_worked || null}, ${JSON.stringify(perf)}::jsonb, ${'claude-sonnet-4-20250514'}, NOW())
    ON CONFLICT (group_key) DO UPDATE SET
      asset_kind = EXCLUDED.asset_kind,
      transcript = EXCLUDED.transcript,
      hook_text_verbatim = EXCLUDED.hook_text_verbatim,
      hook_type = EXCLUDED.hook_type,
      format = EXCLUDED.format,
      angle = EXCLUDED.angle,
      talent_description = EXCLUDED.talent_description,
      visual_summary = EXCLUDED.visual_summary,
      why_it_worked = EXCLUDED.why_it_worked,
      performance_snapshot = EXCLUDED.performance_snapshot,
      model = EXCLUDED.model,
      generated_at = NOW()
  `;

  return {
    status: 200,
    body: {
      ok: true,
      analysis: {
        groupKey, assetKind,
        transcript,
        hookTextVerbatim: parsed.hook_text_verbatim,
        hookType: parsed.hook_type,
        format: parsed.format,
        angle: parsed.angle,
        talentDescription: parsed.talent_description,
        visualSummary: parsed.visual_summary,
        whyItWorked: parsed.why_it_worked,
        performance: perf,
        generatedAt: new Date().toISOString(),
      },
      debug,
    },
  };
}

export async function getCreativeAnalysis({ groupKey }) {
  if (!process.env.DATABASE_URL) return { status: 200, body: { error: 'DATABASE_URL not configured' } };
  if (!groupKey) return { status: 400, body: { error: 'groupKey required' } };
  const sql = neon(process.env.DATABASE_URL);
  const [row] = await sql`SELECT * FROM creative_analysis WHERE group_key = ${groupKey}`;
  return { status: 200, body: { analysis: row || null } };
}

export async function listAnalyzedWinners({ sinceDays: rawSince }) {
  if (!process.env.DATABASE_URL) return { status: 200, body: { error: 'DATABASE_URL not configured' } };
  const sinceDays = Math.max(1, Math.min(365, parseInt(rawSince || 30, 10)));
  const sql = neon(process.env.DATABASE_URL);
  const fmtYmd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const tsNow = new Date();
  const tsSince = new Date(tsNow.getTime() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await sql`
    SELECT
      ca.group_key, ca.hook_text_verbatim, ca.hook_type, ca.format, ca.angle,
      ca.talent_description, ca.visual_summary, ca.why_it_worked, ca.transcript,
      ca.asset_kind, ca.generated_at,
      (SELECT thumbnail_url FROM creative_performance cp WHERE cp.group_key = ca.group_key ORDER BY thumbnail_url IS NULL LIMIT 1) AS thumbnail_url,
      (SELECT ad_name FROM creative_performance cp WHERE cp.group_key = ca.group_key ORDER BY created_time ASC LIMIT 1) AS name,
      COALESCE((
        SELECT SUM(i.spend)::float
        FROM creative_performance cp
        JOIN creative_insights_daily i ON i.ad_id = cp.ad_id
        WHERE cp.group_key = ca.group_key
          AND i.date BETWEEN ${fmtYmd(tsSince)} AND ${fmtYmd(tsNow)}
      ), 0) AS spend,
      COALESCE((
        SELECT SUM(i.purchase_value)::float
        FROM creative_performance cp
        JOIN creative_insights_daily i ON i.ad_id = cp.ad_id
        WHERE cp.group_key = ca.group_key
          AND i.date BETWEEN ${fmtYmd(tsSince)} AND ${fmtYmd(tsNow)}
      ), 0) AS purchase_value,
      COALESCE((
        SELECT SUM(i.purchases)::int
        FROM creative_performance cp
        JOIN creative_insights_daily i ON i.ad_id = cp.ad_id
        WHERE cp.group_key = ca.group_key
          AND i.date BETWEEN ${fmtYmd(tsSince)} AND ${fmtYmd(tsNow)}
      ), 0) AS purchases
    FROM creative_analysis ca
    ORDER BY spend DESC NULLS LAST, ca.generated_at DESC
    LIMIT 100
  `;
  return { status: 200, body: { winners: rows, sinceDays } };
}
