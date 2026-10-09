// Invariant: .claude-plugin/plugin.json declares its MCP config under
// `mcpServers` — the key Claude Code reads. A bare `mcp` key is an
// unknown field that Claude Code ignores at load time (`claude plugin
// validate` warns "Unknown field 'mcp'"); it only appeared to work here
// because ./.mcp.json is the default location anyway. Sibling repos that
// copied the `mcp` key with a non-default path shipped broken plugins.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = JSON.parse(
  readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')
) as Record<string, unknown>;

describe('plugin.json packaging', () => {
  it('declares the MCP config under `mcpServers`, not the ignored `mcp` key', () => {
    expect(plugin).not.toHaveProperty('mcp');
    expect(typeof plugin.mcpServers).toBe('string');
  });

  it('points `mcpServers` at a file that exists', () => {
    const ref = plugin.mcpServers as string;
    expect(existsSync(join(ROOT, ref))).toBe(true);
  });
});
