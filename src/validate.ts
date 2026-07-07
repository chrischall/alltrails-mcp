import { parseLenient } from '@chrischall/mcp-utils';
import type { ZodType } from 'zod';

/**
 * Validate an AllTrails API response against a zod schema at the call site.
 *
 * A thin binding over mcp-utils' shared `parseLenient` (the fleet's
 * degrade-never-break validator) that fixes the log label to this server's name
 * so call sites pass only the schema, the raw value, and a context string.
 *
 * Every AllTrails endpoint is reverse-engineered and undocumented, so a backend
 * change on their side would otherwise flow `undefined` silently into tool
 * output. Schemas are `.looseObject(...)` covering ONLY the fields the code
 * actually reads — cosmetic API additions pass through untouched (and stay
 * present in the parsed output, which matters since most tools return the blob
 * verbatim).
 *
 * Two modes, chosen per call site:
 *  - `'lenient'` (default) — read paths. On mismatch, `parseLenient` logs a
 *    structured warning to stderr naming the context and offending fields, then
 *    returns the RAW response unchanged so the existing `??` fallbacks keep the
 *    tool useful.
 *  - `'strict'` — the rare path where a mistyped field must halt rather than
 *    degrade. On mismatch, `parseLenient` throws an `McpToolError`.
 */
export function parseAllTrails<T>(
  schema: ZodType<T>,
  raw: unknown,
  ctx: string,
  mode: 'strict' | 'lenient' = 'lenient',
): T {
  return parseLenient(schema, raw, { label: 'alltrails-mcp', context: ctx, mode });
}
