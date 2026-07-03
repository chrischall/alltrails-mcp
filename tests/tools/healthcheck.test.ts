import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BridgeProbeResult, FetchproxyTransport } from '@chrischall/mcp-utils/fetchproxy';
import { AllTrailsClient } from '../../src/client.js';
import { registerHealthcheckTools, HEALTHCHECK_PROBE_PATH } from '../../src/tools/healthcheck.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

const PROBE_RESULT: BridgeProbeResult = {
  ok: true,
  elapsed_ms: 42,
  bridge: {
    role: 'host',
    port: 37_149,
    server_version: '0.3.0',
    fetch_timeout_ms: 30_000,
    last_success_at: 1,
    last_failure_at: null,
    last_failure_reason: null,
    consecutive_failures: 0,
  },
};

function setup() {
  const runProbe = vi.fn(async (fetchFn: (path: string) => Promise<unknown>, probePath: string) => {
    await fetchFn(probePath);
    return PROBE_RESULT;
  });
  const status = vi.fn(() => ({ lastExtensionMessageAt: 123 }));
  const transport = { runProbe, status } as unknown as FetchproxyTransport;
  const client = new AllTrailsClient({ transport });
  const requestSpy = vi.spyOn(client, 'request').mockResolvedValue({ trails: [] });

  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, ToolHandler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _cfg: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerHealthcheckTools(server, client);
  return { client, handlers, runProbe, requestSpy };
}

afterEach(() => vi.restoreAllMocks());

describe('alltrails_healthcheck', () => {
  it('registers the tool under the alltrails prefix', () => {
    const { handlers } = setup();
    expect(handlers.has('alltrails_healthcheck')).toBe(true);
  });

  it('probes a real API path through the client (same headers/guards as real tools)', async () => {
    const { handlers, runProbe, requestSpy } = setup();
    const result = await handlers.get('alltrails_healthcheck')!({});
    expect(runProbe).toHaveBeenCalledTimes(1);
    expect(runProbe.mock.calls[0][1]).toBe(HEALTHCHECK_PROBE_PATH);
    expect(requestSpy).toHaveBeenCalledWith('GET', HEALTHCHECK_PROBE_PATH);
    const parsed = JSON.parse(result.content[0].text) as { ok: boolean; bridge: { role: string } };
    expect(parsed.ok).toBe(true);
    expect(parsed.bridge.role).toBe('host');
  });

  it('uses the lazily created client bridge transport (not a fresh one)', async () => {
    const { client, handlers, runProbe } = setup();
    const bridgeSpy = vi.spyOn(client, 'bridge');
    await handlers.get('alltrails_healthcheck')!({});
    expect(bridgeSpy).toHaveBeenCalled();
    expect(runProbe).toHaveBeenCalled();
  });
});
