// Invariant: .env.example documents only variables the server actually reads.
// After the bridge became mandatory it still offered ALLTRAILS_COOKIE, which
// nothing read — a user who filled it in got a silently ignored cookie.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

function sourceText(dir: string): string {
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .map((p) => (statSync(p).isDirectory() ? sourceText(p) : p.endsWith('.ts') ? readFileSync(p, 'utf8') : ''))
    .join('\n');
}

describe('.env.example', () => {
  const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
  const declared = [...example.matchAll(/^#?\s*(ALLTRAILS_[A-Z_]+)=/gm)].map((m) => m[1]);
  const src = sourceText(join(ROOT, 'src'));

  it('declares at least one variable', () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it.each(declared)('%s is read by src/', (name) => {
    expect(src).toMatch(new RegExp(`\\b${name}\\b`));
  });
});
