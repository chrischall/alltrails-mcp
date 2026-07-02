import type { z } from 'zod';

/**
 * Validate an AllTrails API response against a zod schema at the call site.
 *
 * Every AllTrails endpoint is reverse-engineered and undocumented, so a backend
 * change on their side would otherwise flow `undefined` silently into tool
 * output. Schemas are `.looseObject(...)` covering ONLY the fields the code
 * actually reads — cosmetic API additions pass through untouched (and stay
 * present in the parsed output, which matters since most tools return the blob
 * verbatim).
 *
 * Two modes, chosen per call site:
 *  - `'lenient'` (default) — read paths. On mismatch, log a structured warning
 *    to stderr naming the endpoint and fields, then return the RAW response
 *    unchanged so the existing `??` fallbacks keep the tool useful.
 *  - `'strict'` — the rare path where a mistyped field must halt rather than
 *    degrade. On mismatch, throw.
 *
 * The error/warning text is deliberately precise ("trails.0.id: expected
 * number…") — it's the failure signal a maintainer (human or Claude) fixes in
 * one session, vs. "some trails show the wrong data sometimes".
 */
export function parseAllTrails<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  ctx: string,
  mode: 'strict' | 'lenient' = 'lenient',
): z.output<S> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  const message = `AllTrails response for ${ctx} failed validation: ${issues}`;
  if (mode === 'strict') throw new Error(message);
  console.error(`[alltrails-mcp] WARNING: ${message} — continuing with the raw response; fields derived from it may be missing or wrong.`);
  return raw as z.output<S>;
}
