/**
 * @packageDocumentation
 * Resolves the working directory the shell tool (`run_shell_command`) spawns in, keeping it aligned
 * with the deepagents filesystem-backend root so the shell and the fs tools (ls/read_file/write_file/
 * edit_file/glob/grep) share ONE path namespace.
 *
 * DEFAULT (local `code`/`chat` runner + AG-UI): `getCurrentWorkDir()`. On these surfaces the fs
 * backend is rooted at `getCurrentWorkDir()` by `GthDeepAgent.init()` (`rootDir: getCurrentWorkDir()`),
 * so the shell already matches it — this is exactly EXT-22 S4. These surfaces NEVER call
 * {@link setAcpShellWorkDir}, so {@link getShellWorkDir} stays `getCurrentWorkDir()` for them.
 *
 * ACP transport override: unlike the local runner, the ACP server does NOT call `init()`; it re-roots
 * ITS per-session fs backend to each `session/new.cwd` (see `gthAcpServer.ts`). The shell tool
 * instances are built ONCE at startup (`buildDeepAgentParams`), so they cannot themselves see the
 * later session cwd. The ACP server therefore updates this module-level override on every
 * `session/new`; the shell reads it at spawn time so it tracks the session fs root.
 *
 * This also removes the EXT-22 S4 `INIT_CWD` hazard on ACP: `getCurrentWorkDir()` prefers `INIT_CWD`,
 * which is stale in the long-lived ACP subprocess (the reason `acpModule` roots the startup workspace
 * at raw `process.cwd()`). Once the override tracks the session cwd, the ACP shell never consults
 * `INIT_CWD`.
 *
 * Scope note: this mirrors the ACP design, which is ALREADY "latest-session-cwd wins" process-wide —
 * `gthAcpServer` clobbers every backend to the newest session cwd. A single process-wide override has
 * the same semantics. The ACP subprocess is dedicated (never co-hosts a local runner / AG-UI), so the
 * override can never leak into a non-ACP surface.
 */
import { getCurrentWorkDir } from '@gaunt-sloth/core/utils/systemUtils.js';

let acpShellWorkDir: string | undefined;

/**
 * Working directory the shell tool spawns in: the ACP session override when set (ACP transport),
 * otherwise `getCurrentWorkDir()` (local runner + AG-UI, unchanged).
 */
export function getShellWorkDir(): string {
  return acpShellWorkDir ?? getCurrentWorkDir();
}

/**
 * ACP-only: point the shell tool at the current ACP session's fs-backend root (the resolved
 * `session/new.cwd`, or the startup workspace when a session carries no cwd). Pass `undefined` to
 * clear the override and restore the `getCurrentWorkDir()` default (used by tests).
 */
export function setAcpShellWorkDir(cwd: string | undefined): void {
  acpShellWorkDir = cwd;
}
