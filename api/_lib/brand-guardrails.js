export async function loadBrandGuidelines(sql) {
  const [row] = await sql`SELECT * FROM brand_guidelines ORDER BY updated_at DESC LIMIT 1`;
  return row || {
    prohibited_phrases: [],
    prohibited_claims: [],
    required_disclosures: [],
  };
}

export function validateBrandCopy(content, guidelines) {
  const text = (content || '').toString().toLowerCase();
  if (!text.trim()) return [];
  const violations = [];
  const blocked = [
    ...(guidelines?.prohibited_phrases || []),
    ...(guidelines?.prohibited_claims || []),
  ];
  for (const phrase of blocked) {
    const normalized = phrase.toString().trim().toLowerCase();
    if (normalized && text.includes(normalized)) violations.push(`blocked language "${phrase}"`);
  }
  for (const disclosure of guidelines?.required_disclosures || []) {
    const normalized = disclosure.toString().trim().toLowerCase();
    if (normalized && !text.includes(normalized)) violations.push(`missing disclosure "${disclosure}"`);
  }
  return [...new Set(violations)];
}

export async function assertBrandSafe(sql, content) {
  const guidelines = await loadBrandGuidelines(sql);
  const violations = validateBrandCopy(content, guidelines);
  if (violations.length) {
    const error = new Error(`Brand guardrail blocked publish: ${violations.slice(0, 5).join(', ')}`);
    error.code = 'BRAND_GUARDRAIL';
    error.violations = violations;
    throw error;
  }
}
