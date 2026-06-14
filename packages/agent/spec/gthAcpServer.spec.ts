import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fake DeepAgentsServer: a base handleNewSession (records the call + returns a result), an
// acpBackends map, and a start() spy. The real connection wiring dispatches
// `this.handleNewSession(params, conn)` dynamically, so our instance-level patch must intercept.
const baseHandleNewSession = vi.fn();
const startMock = vi.fn();

class FakeDeepAgentsServer {
  acpBackends = new Map<string, { cwd?: string }>();

  async handleNewSession(params: any, conn: any) {
    return baseHandleNewSession(params, conn);
  }
  async start() {
    return startMock();
  }
}

vi.mock('deepagents-acp', () => ({
  DeepAgentsServer: FakeDeepAgentsServer,
}));

vi.mock('@gaunt-sloth/core/utils/debugUtils.js', () => ({
  debugLog: vi.fn(),
}));

describe('startGthAcpServer', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    baseHandleNewSession.mockResolvedValue({ sessionId: 's1' });
    startMock.mockResolvedValue(undefined);
  });

  it('starts the underlying server and returns it', async () => {
    const { startGthAcpServer } = await import('#src/core/gthAcpServer.js');
    const server = await startGthAcpServer({ agents: { name: 'x' } } as never);
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(server).toBeInstanceOf(FakeDeepAgentsServer);
  });

  it('re-roots the ACP filesystem backend to the session cwd, then delegates', async () => {
    const { startGthAcpServer } = await import('#src/core/gthAcpServer.js');
    const server = (await startGthAcpServer({ agents: { name: 'x' } } as never)) as unknown as {
      acpBackends: Map<string, { cwd?: string }>;

      handleNewSession: (_params: any, _conn: any) => Promise<any>;
    };
    const backend = { cwd: '/' };
    server.acpBackends.set('x', backend);

    const result = await server.handleNewSession({ cwd: '/home/me/project' }, { conn: true });

    // Base handler still runs and its result propagates.
    expect(baseHandleNewSession).toHaveBeenCalledWith({ cwd: '/home/me/project' }, { conn: true });
    expect(result).toEqual({ sessionId: 's1' });
    // Backend re-rooted to the resolved session cwd.
    expect(backend.cwd).toBe('/home/me/project');
  });

  it('leaves backends untouched when session/new carries no cwd', async () => {
    const { startGthAcpServer } = await import('#src/core/gthAcpServer.js');
    const server = (await startGthAcpServer({ agents: { name: 'x' } } as never)) as unknown as {
      acpBackends: Map<string, { cwd?: string }>;

      handleNewSession: (_params: any, _conn: any) => Promise<any>;
    };
    const backend = { cwd: '/original' };
    server.acpBackends.set('x', backend);

    await server.handleNewSession({}, {});

    expect(backend.cwd).toBe('/original');
  });
});
