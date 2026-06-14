/**
 * @packageDocumentation
 * Thin wrapper over `deepagents-acp`'s `DeepAgentsServer` that honors the ACP per-session
 * project root.
 *
 * deepagents-acp 0.1.12 roots its filesystem backend once at `workspaceRoot ?? process.cwd()`
 * and IGNORES the `cwd` carried by every ACP `session/new` request. An ACP host (Zed, JetBrains)
 * spawns the agent as a single long-lived subprocess whose process cwd is unrelated to the project
 * (Zed launches it at `/`), and passes the real project root per session via `session/new.cwd`.
 * Without honoring it, filesystem tools default to the wrong root (e.g. `ls` lists `/`).
 *
 * The server's connection handler dispatches `this.handleNewSession(params, conn)` dynamically, so
 * we patch that instance method before `start()` to re-root the (ACP) filesystem backend to the
 * session's `cwd`. If a future deepagents-acp honors session cwd itself, this becomes a harmless
 * no-op (it just re-asserts the same root).
 */

import { DeepAgentsServer, type DeepAgentsServerOptions } from 'deepagents-acp';
import { resolve } from 'node:path';
import { debugLog } from '@gaunt-sloth/core/utils/debugUtils.js';

// deepagents-acp keeps a private `acpBackends: Map<agentName, ACPFilesystemBackend>`; the backend
// roots its local ls/glob/grep at `this.cwd` (deepagents' FilesystemBackend base). We re-root by
// reaching those internals — guarded so a shape change degrades to a no-op rather than throwing.
interface ReRootableBackend {
  cwd?: string;
}
interface AcpServerInternals {
  acpBackends?: Map<string, ReRootableBackend>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleNewSession?: (params: any, conn: any) => Promise<any>;
}

/**
 * Construct and start a deepagents-acp server that re-roots its filesystem backend to each ACP
 * session's `cwd`. Resolves once the stdio transport is listening.
 */
export async function startGthAcpServer(
  options: DeepAgentsServerOptions
): Promise<DeepAgentsServer> {
  const server = new DeepAgentsServer(options);
  const internals = server as unknown as AcpServerInternals;

  const original = internals.handleNewSession;
  if (typeof original === 'function') {
    const bound = original.bind(server);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    internals.handleNewSession = async (params: any, conn: any) => {
      const result = await bound(params, conn);
      const cwd = params?.cwd;
      if (typeof cwd === 'string' && cwd.length > 0) {
        const root = resolve(cwd);
        const backends = internals.acpBackends;
        if (backends && backends.size > 0) {
          for (const backend of backends.values()) {
            if (backend && typeof backend === 'object') {
              backend.cwd = root;
            }
          }
          debugLog(`ACP session re-rooted filesystem backend to ${root}`);
        } else {
          debugLog(`ACP session cwd ${root} (no ACP filesystem backend to re-root)`);
        }
      }
      return result;
    };
  } else {
    debugLog('deepagents-acp handleNewSession not found to patch; session cwd re-rooting disabled');
  }

  await server.start();
  return server;
}
