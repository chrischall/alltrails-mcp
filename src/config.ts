import { parseBoolEnv as parseBoolEnvUtil, readEnvVar, readPortEnv } from '@chrischall/mcp-utils';
import { DEFAULT_CALLER, DEFAULT_LOCALE, DEFAULT_USER_AGENT } from './protocol.js';

/**
 * True when a boolean-shaped env var is set to "1", "true", "yes", or "on"
 * (case-insensitive, trimmed). Anything else — unset, empty, or other values —
 * is false. Used for ALLTRAILS_DISABLE_FETCHPROXY, ALLTRAILS_DEBUG_LOG, etc.
 *
 * Delegates to @chrischall/mcp-utils' `parseBoolEnv`.
 */
export function parseBoolEnv(name: string): boolean {
  return parseBoolEnvUtil(name);
}

/** The `x-at-caller` header. Override with ALLTRAILS_CALLER. */
export function getCaller(): string {
  return readEnvVar('ALLTRAILS_CALLER') ?? DEFAULT_CALLER;
}

/** The `x-language-locale` header. Override with ALLTRAILS_LOCALE. */
export function getLocale(): string {
  return readEnvVar('ALLTRAILS_LOCALE') ?? DEFAULT_LOCALE;
}

/** The browser-like `User-Agent`. Override with ALLTRAILS_USER_AGENT. */
export function getUserAgent(): string {
  return readEnvVar('ALLTRAILS_USER_AGENT') ?? DEFAULT_USER_AGENT;
}

/**
 * Explicit AllTrails numeric user id for the per-user endpoints (saved lists,
 * completed trails, feed). Optional: when unset, those tools resolve the
 * current user's id via `GET /api/alltrails/me`. Set ALLTRAILS_USER_ID to skip
 * that lookup (or to target a public profile other than your own).
 */
export function getConfiguredUserId(): string | undefined {
  return readEnvVar('ALLTRAILS_USER_ID');
}

// Per-request timeout. Overridable via ALLTRAILS_REQUEST_TIMEOUT_MS. The 30s
// default is comfortably above AllTrails' typical latency but low enough that a
// stuck upstream (or a DataDome challenge that never resolves) fails fast
// instead of burning the MCP client-side budget.
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export function getRequestTimeoutMs(): number {
  const raw = process.env.ALLTRAILS_REQUEST_TIMEOUT_MS;
  if (typeof raw !== 'string' || raw.trim().length === 0) return DEFAULT_REQUEST_TIMEOUT_MS;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REQUEST_TIMEOUT_MS;
}

// The fetchproxy concentrator port. The whole fleet (and the Transporter
// extension) shares 37149; override with ALLTRAILS_WS_PORT only for local
// development or test isolation.
const DEFAULT_WS_PORT = 37_149;
export function getWsPort(): number {
  return readPortEnv('ALLTRAILS_WS_PORT', DEFAULT_WS_PORT);
}

// Set ALLTRAILS_DEBUG_LOG=1 (or true/yes/on) to log every request/response to
// stderr. The Cookie header is redacted. Diagnostic only — never in normal use.
export function debugLogEnabled(): boolean {
  return parseBoolEnv('ALLTRAILS_DEBUG_LOG');
}
