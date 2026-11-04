/**
 * `_meta.mint` hints (the mcp-host context-groups contract): which canonical
 * group a tool belongs to, what kind of ask it answers, and the everyday words
 * its name and description lack. Inert data to any other client.
 *
 * Every AllTrails tool is in the `travel` group. AllTrails has no listable set
 * of the person's subjects (no children, properties or accounts — only the one
 * signed-in user), so no hint names a `subject`, and no read takes a date
 * range, so none names `when`.
 */
export type MintIntent =
  | 'whats-new' | 'whats-due' | 'whats-on' | 'lookup' | 'turn-on-off' | 'send' | 'change' | 'other';

export interface MintHint {
  domain: 'travel';
  intent: MintIntent;
  canonical?: true;
  subject?: string;
  when?: { start: string; end: string };
  /** Lowercase, at most 8, each at most 40 chars: words a person says. */
  aliases?: string[];
}

/** `_meta` for an AllTrails tool. */
export function travelMeta(
  intent: MintIntent,
  extra: Omit<MintHint, 'domain' | 'intent'> = {},
): { mint: MintHint } {
  return { mint: { domain: 'travel', intent, ...extra } };
}

/** The words people use when they ask about trails. */
export const TRAIL_ALIASES = ['hike', 'hikes', 'hiking', 'trail', 'trails', 'trailhead', 'walk'];
