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

// Invariant: every variable the server reads is settable from each install
// path. manifest.json (.mcpb) and server.json (MCP registry) previously
// declared only ALLTRAILS_USER_ID, so a desktop or registry install could not
// set the timeout, debug log, locale, caller or bridge port.
describe('install-path env declarations', () => {
  const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
  const declared = [...example.matchAll(/^#?\s*(ALLTRAILS_[A-Z_]+)=/gm)].map((m) => m[1]);
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  const serverJson = JSON.parse(readFileSync(join(ROOT, 'server.json'), 'utf8'));

  it.each(declared)('%s is wired through manifest.json user_config as optional', (name) => {
    const value: string | undefined = manifest.server.mcp_config.env[name];
    expect(value).toMatch(/^\$\{user_config\.([a-z_]+)\}$/);
    const key = value!.slice('${user_config.'.length, -1);
    expect(manifest.user_config[key]?.required).toBe(false);
  });

  it.each(declared)('%s is declared optional in server.json', (name) => {
    const vars: Array<{ name: string; isRequired?: boolean }> = serverJson.packages[0].environmentVariables;
    expect(vars.find((v) => v.name === name)?.isRequired).toBe(false);
  });
});
