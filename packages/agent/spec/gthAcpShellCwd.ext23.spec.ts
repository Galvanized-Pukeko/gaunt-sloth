/**
 * EXT-23: the ACP transport routes and executes gsloth's `run_shell_command` (deepagents-acp hands
 * `agents.tools` — including the GthDevToolkit shell tool — to `createDeepAgent`). The ACP server
 * re-roots its per-session fs backend to `session/new.cwd`, so the shell must spawn there too, not at
 * `getCurrentWorkDir()`. These tests prove:
 *   1. after a `session/new` re-root, the shell tool spawns with `cwd === session/new.cwd`;
 *   2. a session with no cwd falls back to the startup workspace root (not INIT_CWD);
 *   3. with no ACP override in effect (local runner / AG-UI), the shell still spawns at
 *      `getCurrentWorkDir()` — non-ACP surfaces are unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fake DeepAgentsServer so gthAcpServer can patch its `handleNewSession` (mirrors gthAcpServer.spec).
const baseHandleNewSession = vi.fn();
const startMock = vi.fn();

class FakeDeepAgentsServer {
  acpBackends = new Map<string, { cwd?: string; virtualMode?: boolean }>();
  async handleNewSession(params: unknown, conn: unknown) {
    return baseHandleNewSession(params, conn);
  }
  async start() {
    return startMock();
  }
}

vi.mock('deepagents-acp', () => ({ DeepAgentsServer: FakeDeepAgentsServer }));
vi.mock('@gaunt-sloth/core/utils/debugUtils.js', () => ({ debugLog: vi.fn() }));

// Silence tool console output; keep systemUtils real (getCurrentWorkDir is the non-ACP baseline) but
// stub stdout so live-streamed command output does not pollute the test log.
vi.mock('#src/utils/consoleUtils.js', () => ({
  displayInfo: vi.fn(),
  displayError: vi.fn(),
  displayWarning: vi.fn(),
}));
vi.mock('#src/utils/systemUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#src/utils/systemUtils.js')>();
  return { ...actual, stdout: { write: vi.fn() } };
});

// child_process spawn mock: a child that reports a clean exit so executeCommand resolves.
const childProcessMock = { spawn: vi.fn(), spawnSync: vi.fn() };
vi.mock('child_process', () => childProcessMock);

const isPosix = process.platform !== 'win32';
const d = isPosix ? describe : describe.skip;

d('EXT-23 ACP shell cwd alignment', () => {
  let startGthAcpServer: typeof import('#src/core/gthAcpServer.js').startGthAcpServer;
  let GthDevToolkit: typeof import('#src/tools/GthDevToolkit.js').default;
  let getShellWorkDir: typeof import('#src/tools/shell/workDir.js').getShellWorkDir;
  let setAcpShellWorkDir: typeof import('#src/tools/shell/workDir.js').setAcpShellWorkDir;
  let getCurrentWorkDir: typeof import('@gaunt-sloth/core/utils/systemUtils.js').getCurrentWorkDir;

  beforeEach(async () => {
    vi.resetAllMocks();
    baseHandleNewSession.mockResolvedValue({ sessionId: 's1' });
    startMock.mockResolvedValue(undefined);
    // spawn returns a child whose 'close' fires with a clean exit code.
    childProcessMock.spawn.mockImplementation(() => ({
      on: vi.fn((event: string, cb: (_code?: number) => void) => {
        if (event === 'close') cb(0);
      }),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      kill: vi.fn(),
      pid: 1234,
    }));

    ({ startGthAcpServer } = await import('#src/core/gthAcpServer.js'));
    ({ default: GthDevToolkit } = await import('#src/tools/GthDevToolkit.js'));
    ({ getShellWorkDir, setAcpShellWorkDir } = await import('#src/tools/shell/workDir.js'));
    ({ getCurrentWorkDir } = await import('@gaunt-sloth/core/utils/systemUtils.js'));
    setAcpShellWorkDir(undefined);
  });

  afterEach(() => {
    // Never let the ACP override leak into another spec / the non-ACP default.
    setAcpShellWorkDir(undefined);
  });

  // Drive the shell tool's private executeCommand and return the cwd it spawned with.
  const spawnCwd = async (): Promise<string | undefined> => {
    const toolkit = new GthDevToolkit({ shell: { enabled: true } }, 'code');
    await (
      toolkit as unknown as { executeCommand(_c: string, _n: string): Promise<string> }
    ).executeCommand('echo hi', 'run_shell_command');
    const call = childProcessMock.spawn.mock.calls.at(-1);
    return (call?.[1] as { cwd?: string } | undefined)?.cwd;
  };

  // Start the ACP server (patching handleNewSession) and drive one session/new.
  const startSession = async (
    sessionParams: Record<string, unknown>,
    workspaceRoot?: string
  ): Promise<void> => {
    const server = (await startGthAcpServer({
      agents: { name: 'x' },
      ...(workspaceRoot ? { workspaceRoot } : {}),
    } as never)) as unknown as {
      handleNewSession: (_p: unknown, _c: unknown) => Promise<unknown>;
    };
    await server.handleNewSession(sessionParams, {});
  };

  it('spawns the shell at the ACP session cwd after a session re-root', async () => {
    await startSession({ cwd: '/home/me/project' }, '/startup/ws');
    expect(getShellWorkDir()).toBe('/home/me/project');
    expect(await spawnCwd()).toBe('/home/me/project');
  });

  it('falls back to the startup workspace root when session/new carries no cwd (not INIT_CWD)', async () => {
    await startSession({}, '/startup/ws');
    expect(getShellWorkDir()).toBe('/startup/ws');
    expect(await spawnCwd()).toBe('/startup/ws');
  });

  it('non-ACP surfaces (no override) still spawn at getCurrentWorkDir()', async () => {
    // No ACP session started; the override is clear (beforeEach), so the local runner / AG-UI default.
    expect(getShellWorkDir()).toBe(getCurrentWorkDir());
    expect(await spawnCwd()).toBe(getCurrentWorkDir());
  });
});
