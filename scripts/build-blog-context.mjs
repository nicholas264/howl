// Compiles api/_lib/howl-blog-context.md into an importable JS module.
// Run after editing the markdown: node scripts/build-blog-context.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'api/_lib/howl-blog-context.md'), 'utf8');
const module_ = `// Generated from howl-blog-context.md by scripts/build-blog-context.mjs. Do not edit by hand.
export const BLOG_CONTEXT_PACKET = ${JSON.stringify(source)};
`;
writeFileSync(join(root, 'api/_lib/blog-context-packet.js'), module_);
console.log(`Wrote blog-context-packet.js (${source.length} chars)`);
