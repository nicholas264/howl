import { withHowlScriptwriting } from './howl-scriptwriting.js';

const textField = { type: 'string' };
const objectSchema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const hookSchema = objectSchema({ spoken: textField, next_line: textField, visual: textField, on_screen: textField });
export const STUDIO_OUTPUT_CONFIG = { format: { type: 'json_schema', schema: objectSchema({
  title: textField, angle: textField, strategy: textField, script: textField,
  hooks: objectSchema({ first: hookSchema, second: hookSchema, third: hookSchema }),
  shot_list: { type: 'array', minItems: 1, description: 'Four to eight filmable shots.', items: objectSchema({ time: textField, visual: textField, on_screen: textField }) },
  cta: textField, guardrails: { type: 'array', items: textField },
}) } };

export const STUDIO_PRODUCTS = { r1: 'R1', r3: 'R3', r4mkii: 'R4 MKii', all: 'R1, R3 and R4 MKii' };
export function validateStudioBrief(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A script brief is required.');
  const { product, startingPoint, delivery, duration, creatorId } = value;
  if (!Object.hasOwn(STUDIO_PRODUCTS, product)) throw new Error('Choose a HOWL product.');
  if (!['fresh', 'winner', 'brief'].includes(startingPoint)) throw new Error('Choose a starting point.');
  if (!['founder', 'creator', 'voiceover'].includes(delivery)) throw new Error('Choose who delivers the script.');
  if (![30, 60, 90].includes(Number(duration))) throw new Error('Choose a 30, 60 or 90 second script.');
  if (delivery === 'creator' && (!Number.isSafeInteger(Number(creatorId)) || Number(creatorId) < 1)) throw new Error('Choose a creator.');
  const notes = value.notes ?? '';
  if (typeof notes !== 'string' || notes.length > 6000) throw new Error('Direction must be at most 6,000 characters.');
  if (startingPoint === 'brief' && !notes.trim()) throw new Error('Paste your brief before generating.');
  const references = value.references ?? '';
  if (typeof references !== 'string' || references.length > 40000) throw new Error('Winner references must be at most 40,000 characters.');
  if (startingPoint === 'winner' && !references.trim()) throw new Error('Select a winning ad or paste a reference.');
  const iteration = value.iteration || 'controlled';
  if (!['controlled', 'crossbreed', 'frontier'].includes(iteration)) throw new Error('Choose a valid iteration strategy.');
  return { product, startingPoint, delivery, duration: Number(duration), creatorId: delivery === 'creator' ? Number(creatorId) : null, notes: notes.trim(), references: startingPoint === 'winner' ? references.trim() : '', iteration };
}

export function studioRequest(brief, { creator = null, guidelines = {} } = {}) {
  const b = validateStudioBrief(brief);
  if (b.delivery === 'creator' && !creator) throw new Error('Creator not found.');
  return {
    system: withHowlScriptwriting(`Write one production-ready direct-response video ad for the selected HOWL product and delivery. Apply the shared method automatically. For founder delivery use a natural direct-to-camera brand voice; no invented biography. For creator delivery use only supplied creator evidence. For voiceover use an observer/brand perspective rather than invented personal testimony.
Return ONLY a JSON object with exactly these fields:
{"title":"short title","angle":"specific buying motive","strategy":"2-4 sentences explaining the onramp, mechanism and main objection","script":"complete spoken copy including the primary hook and CTA; no headings or stage directions","hooks":{"first":{"spoken":"alternate opening","next_line":"connecting sentence that transitions into the same body","visual":"opening shot","on_screen":"short header"},"second":"same four fields","third":"same four fields"},"shot_list":[{"time":"approximate range","visual":"filmable action","on_screen":"short caption"}],"cta":"closing action","guardrails":["missing evidence or required assets"]}.
Write three compatible alternate hooks and 4-8 shots. Keep the complete spoken script near ${Math.round(b.duration * 2.2)} words, leaving room for pauses. Product comparison must make an understandable choice, not list every specification. Do not expose internal planning in spoken copy. Use only numerical performance or setup claims established in the supplied product basis or verified brief; never invent a setup time. Keep numerical bounds and units exact: a listed 1,100°F is not over 1,100°F. Do not promise the product fits an unspecified backpack. Default CTA: see the selected model at howlcampfires.com; do not invent a link-in-bio placement or offer. If burn restrictions form any part of the argument, include the local-permission qualification in spoken copy.
For a winner-based request, preserve relevant evidence and distinguish observed results from causal proof. Controlled means change one major variable; crossbreed means combine compatible features of the supplied references; frontier means an adjacent new angle. Never assume reference performance transfers to a new product.
Brand constraints supplied below are mandatory: ${JSON.stringify(guidelines)}`),
    messages: [{ role: 'user', content: JSON.stringify({ product: STUDIO_PRODUCTS[b.product], starting_point: b.startingPoint, delivery: b.delivery, duration_seconds: b.duration, iteration: b.iteration, direction: b.notes, creator, references: b.references }) }],
  };
}

export function parseStudioOutput(raw) {
  const text = typeof raw === 'string' ? raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim() : '';
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('The writer returned an incomplete script. Try generating again.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The writer returned an invalid script.');
  const required = ['title', 'angle', 'strategy', 'script', 'cta'];
  for (const key of required) if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 12000) throw new Error(`The script is missing a valid ${key}. Try generating again.`);
  if (value.hooks && !Array.isArray(value.hooks) && ['first','second','third'].every(k => value.hooks[k])) value.hooks = ['first','second','third'].map(k => value.hooks[k]);
  if (!Array.isArray(value.hooks) || value.hooks.length !== 3 || value.hooks.some(h => !h || ['spoken','next_line','visual','on_screen'].some(k => typeof h[k] !== 'string' || !h[k].trim() || h[k].length > 2000))) throw new Error('The script needs three complete alternate hooks. Try generating again.');
  if (!Array.isArray(value.shot_list) || value.shot_list.length < 4 || value.shot_list.length > 8 || value.shot_list.some(s => !s || ['time','visual','on_screen'].some(k => typeof s[k] !== 'string' || s[k].length > 2000))) throw new Error('The script needs a complete shot list. Try generating again.');
  if (!Array.isArray(value.guardrails) || value.guardrails.length > 20 || value.guardrails.some(s => typeof s !== 'string' || s.length > 2000)) throw new Error('The production notes were invalid. Try generating again.');
  return Object.fromEntries([...required, 'hooks', 'shot_list', 'guardrails'].map(k => [k, value[k]]));
}
