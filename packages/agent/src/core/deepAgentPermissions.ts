import type { FilesystemPermission } from 'deepagents';
import path from 'node:path';
import { getCurrentWorkDir } from '@gaunt-sloth/core/utils/systemUtils.js';

export type { FilesystemPermission };

/**
 * Tool names deepagents' filesystem middleware registers. This mirrors deepagents'
 * internal `FILESYSTEM_TOOL_NAMES` (which is declared in its types but not exported
 * at runtime). `createDeepAgent` throws on a name collision with any of these, so a
 * gsloth-supplied tool sharing one of these names is superseded by the deep agent's
 * built-in filesystem tool. Kept here as the single place the deep path references it.
 */
export const FILESYSTEM_TOOL_NAMES = [
  'ls',
  'read_file',
  'write_file',
  'edit_file',
  'glob',
  'grep',
  'execute',
] as const;

/** The slice of GthConfig the permission mapping consumes. */
export interface PermissionConfigSlice {
  filesystem: string[] | 'all' | 'read' | 'none';
  aiignore?: { enabled?: boolean; patterns?: string[] };
  /**
   * Extra real filesystem roots to allow (`gth exec --allow-dir`). When present, the backend runs
   * WITHOUT virtualMode, so permission paths are real absolute paths: access is allow-listed to
   * cwd + these dirs and everything else is denied. Undefined/empty keeps the cwd-only sandbox.
   */
  allowDirs?: string[];
}

/**
 * Build allow+deny rules for the widened (`--allow-dir`) sandbox. Because the backend runs
 * without virtualMode, paths are REAL absolute paths, so we anchor allow rules at the resolved
 * absolute cwd and each allowed dir, then deny everything else. First-match-wins, so the allow
 * rules must come before the catch-all deny.
 */
export function allowDirsToPermissions(allowDirs: string[]): FilesystemPermission[] {
  const cwd = getCurrentWorkDir();
  const roots = [cwd, ...allowDirs.map((d) => path.resolve(cwd, d))];
  // De-dupe resolved roots (e.g. an --allow-dir pointing back at cwd).
  const uniqueRoots = Array.from(new Set(roots));
  const allow: FilesystemPermission[] = uniqueRoots.map((root) => ({
    operations: ['read', 'write'],
    paths: [`${root}/**`, root],
    mode: 'allow',
  }));
  return [...allow, { operations: ['read', 'write'], paths: ['/**'], mode: 'deny' }];
}

/**
 * Strip a single leading "./" or "/" and any trailing slashes, using linear string
 * ops rather than regex. The previous `/\/+$/` trailing-slash regex was flagged by
 * CodeQL as a polynomial ReDoS (the `$` anchor makes the greedy `\/+` retry from every
 * start position → quadratic on a long run of slashes); plain slicing is O(n) and safe.
 */
function normalizePathFragment(p: string): string {
  let start = 0;
  if (p.startsWith('./')) start = 2;
  else if (p.startsWith('/')) start = 1;
  let end = p.length;
  while (end > start && p[end - 1] === '/') end--;
  return p.slice(start, end);
}

/**
 * Convert `.aiignore` patterns (relative, .gitignore-ish) into deepagents deny rules.
 *
 * deepagents matches the path argument the model passes to a fs tool against ABSOLUTE
 * globs. EXT-13: the backend now runs WITHOUT virtualMode in both the default and widened
 * cases, so paths are REAL absolute paths and the caller passes the absolute cwd as `base`
 * to anchor these deny rules there.
 *
 * A bare pattern (`*.env`, `secret.txt`) should match at any depth, so we emit both a
 * top-level (`<base>/secret.txt`) and a recursive (`<base>/&#42;&#42;/secret.txt`) rule. A pattern
 * already containing "/" (`config/secrets.json`) is anchored as-is (plus a `/**` subtree rule).
 *
 * `base` defaults to "" (anchoring at the virtual root "/") for legacy callers; gsloth's
 * {@link buildPermissions} always passes the absolute cwd now.
 */
export function aiignoreToPermissions(patterns: string[], base = ''): FilesystemPermission[] {
  const rules: FilesystemPermission[] = [];
  for (const raw of patterns) {
    const clean = normalizePathFragment(raw);
    if (clean.length === 0) continue;
    const paths = clean.includes('/')
      ? [`${base}/${clean}`, `${base}/${clean}/**`]
      : [`${base}/${clean}`, `${base}/**/${clean}`];
    rules.push({ operations: ['read', 'write'], paths, mode: 'deny' });
  }
  return rules;
}

/**
 * Map gsloth's filesystem mode onto deepagents permission rules for the DEFAULT
 * (non-widen) code-mode sandbox.
 *
 * EXT-13: the default backend now runs WITHOUT virtualMode (real absolute paths), so
 * containment can no longer lean on the virtual-root chroot — it is enforced entirely by
 * these globs anchored at the REAL absolute cwd. We therefore allow read+write within
 * `cwd/**` (and `cwd`) and deny everything else (`/**`), mirroring what virtualMode gave
 * for free. An explicit `string[]` allow-list resolves each entry against the real cwd.
 *
 * - `all`  → no extra restriction beyond the cwd sandbox (matches the old virtualMode
 *            behavior, where `/` already meant cwd).
 * - `read` → deny all writes (the cwd sandbox still applies for reads).
 * - `none` → deny all reads and writes.
 * - `string[]` → allow each (cwd-resolved) dir, deny everything else.
 *
 * The `cwd` argument is injected (defaults to {@link getCurrentWorkDir}) so callers/tests
 * can anchor deterministically.
 */
export function filesystemModeToPermissions(
  fs: string[] | 'all' | 'read' | 'none',
  cwd: string = getCurrentWorkDir()
): FilesystemPermission[] {
  if (fs === 'none') return [{ operations: ['read', 'write'], paths: ['/**'], mode: 'deny' }];
  if (fs === 'read') {
    // Deny all writes everywhere; reads are still confined to the cwd sandbox below.
    return [
      { operations: ['write'], paths: ['/**'], mode: 'deny' },
      { operations: ['read'], paths: [`${cwd}/**`, cwd], mode: 'allow' },
      { operations: ['read'], paths: ['/**'], mode: 'deny' },
    ];
  }
  if (fs === 'all') {
    // No allow-list restriction, but the cwd sandbox must still apply by default
    // (allow cwd/**, deny /**) — this is what virtualMode enforced implicitly.
    return [
      { operations: ['read', 'write'], paths: [`${cwd}/**`, cwd], mode: 'allow' },
      { operations: ['read', 'write'], paths: ['/**'], mode: 'deny' },
    ];
  }
  // string[] — explicit allow-list of directories, resolved against the REAL cwd. Allow
  // read+write within each, deny everything else. Allow rules first (first-match-wins),
  // deny catch-all last.
  const allow: FilesystemPermission[] = fs
    .filter((d) => d !== 'all' && d !== 'read')
    .map((d) => {
      const dir = path.resolve(cwd, normalizePathFragment(d));
      return { operations: ['read', 'write'], paths: [`${dir}/**`, dir], mode: 'allow' };
    });
  return [...allow, { operations: ['read', 'write'], paths: ['/**'], mode: 'deny' }];
}

/**
 * Compose the full permission list. `.aiignore` deny rules go FIRST so they win over
 * any allow rule (first-match-wins). Then the filesystem-mode rules. `.aiignore` is
 * skipped when explicitly disabled (`aiignore.enabled === false`) or has no patterns.
 */
export function buildPermissions(config: PermissionConfigSlice): FilesystemPermission[] {
  const cwd = getCurrentWorkDir();
  const widen = Array.isArray(config.allowDirs) && config.allowDirs.length > 0;
  const aiignoreEnabled = config.aiignore?.enabled !== false && !!config.aiignore?.patterns?.length;
  // EXT-13: the backend now uses real absolute paths in BOTH the default and widened cases,
  // so always anchor aiignore deny rules at the absolute cwd (they keep matching
  // project-relative ignore patterns).
  const aiignore = aiignoreEnabled ? aiignoreToPermissions(config.aiignore!.patterns!, cwd) : [];
  // `--allow-dir` widens to the cwd + allowed-dirs allow-list; otherwise the default
  // filesystem-mode rules apply, both anchored at the real absolute cwd.
  const modeRules = widen
    ? allowDirsToPermissions(config.allowDirs!)
    : filesystemModeToPermissions(config.filesystem, cwd);
  return [...aiignore, ...modeRules];
}
