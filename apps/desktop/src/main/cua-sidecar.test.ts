import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/virtual/userData',
    getVersion: () => '0.0.0'
  }
}));

import { CuaSidecarManager } from './cua-sidecar.js';

describe('CuaSidecarManager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns structured tool errors before the Claude MCP outer timeout', async () => {
    const manager = new CuaSidecarManager('D:\\OpenMagicPointer');
    manager.configure({ port: 19771 });
    const state = manager as unknown as {
      proc: { killed: boolean; pid: number };
      endpoint: string;
    };
    state.proc = { killed: false, pid: 12345 };
    state.endpoint = 'http://127.0.0.1:19771/mcp';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const error = new Error('This operation was aborted.');
        error.name = 'AbortError';
        throw error;
      })
    );

    const result = await manager.callTool('click', { pid: 1 });

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('failed before Claude MCP timeout');
    expect(result.structuredContent).toMatchObject({
      openpointerCuaError: {
        tool: 'click',
        method: 'tools/call',
        timeoutMs: 15000,
        endpoint: 'http://127.0.0.1:19771/mcp',
        driverPid: 12345,
        error: 'CUA request timed out after 15000ms.'
      }
    });
  });
});
