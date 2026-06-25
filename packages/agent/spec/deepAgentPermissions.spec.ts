import { describe, expect, it, vi } from 'vitest';

// Anchor getCurrentWorkDir deterministically for the --allow-dir (real-path) permission tests.
vi.mock('@gaunt-sloth/core/utils/systemUtils.js', () => ({
  getCurrentWorkDir: () => '/work/proj',
}));

import {
  aiignoreToPermissions,
  allowDirsToPermissions,
  buildPermissions,
  filesystemModeToPermissions,
  FILESYSTEM_TOOL_NAMES,
} from '#src/core/deepAgentPermissions.js';

describe('deepAgentPermissions', () => {
  describe('aiignoreToPermissions', () => {
    it('expands a bare pattern to a top-level and a recursive deny rule', () => {
      const rules = aiignoreToPermissions(['*.env']);
      expect(rules).toEqual([
        { operations: ['read', 'write'], paths: ['/*.env', '/**/*.env'], mode: 'deny' },
      ]);
    });

    it('anchors a path-containing pattern as-is plus its subtree', () => {
      const rules = aiignoreToPermissions(['config/secrets.json']);
      expect(rules).toEqual([
        {
          operations: ['read', 'write'],
          paths: ['/config/secrets.json', '/config/secrets.json/**'],
          mode: 'deny',
        },
      ]);
    });

    it('emits one rule per pattern and skips empty/normalized-empty patterns', () => {
      const rules = aiignoreToPermissions(['*.env', 'config/secrets.json', '', './', '/']);
      expect(rules).toHaveLength(2);
    });

    it('strips a leading ./ or / and a trailing slash before anchoring', () => {
      // Both normalize to bare names (no internal slash) → top-level + recursive.
      const rules = aiignoreToPermissions(['./build/', '/dist']);
      expect(rules.map((r) => r.paths)).toEqual([
        ['/build', '/**/build'],
        ['/dist', '/**/dist'],
      ]);
    });

    it('anchors rules at an absolute base when one is supplied (widened real-path mode)', () => {
      const rules = aiignoreToPermissions(['*.env'], '/work/proj');
      expect(rules).toEqual([
        {
          operations: ['read', 'write'],
          paths: ['/work/proj/*.env', '/work/proj/**/*.env'],
          mode: 'deny',
        },
      ]);
    });
  });

  describe('allowDirsToPermissions', () => {
    it('allow-lists cwd + each (resolved) extra dir, then denies everything else', () => {
      const rules = allowDirsToPermissions(['../shared', '/tmp/out']);
      expect(rules).toEqual([
        { operations: ['read', 'write'], paths: ['/work/proj/**', '/work/proj'], mode: 'allow' },
        {
          operations: ['read', 'write'],
          paths: ['/work/shared/**', '/work/shared'],
          mode: 'allow',
        },
        { operations: ['read', 'write'], paths: ['/tmp/out/**', '/tmp/out'], mode: 'allow' },
        { operations: ['read', 'write'], paths: ['/**'], mode: 'deny' },
      ]);
    });

    it('de-dupes a dir that resolves back to cwd', () => {
      const rules = allowDirsToPermissions(['.']);
      // Only one allow rule (cwd) plus the catch-all deny.
      expect(rules).toHaveLength(2);
      expect(rules[0].paths).toEqual(['/work/proj/**', '/work/proj']);
      expect(rules[1].mode).toEqual('deny');
    });
  });

  describe('filesystemModeToPermissions (EXT-13: real-cwd-anchored default sandbox)', () => {
    it('"all" applies the cwd sandbox: allow cwd/**, deny everything else', () => {
      // No virtualMode chroot anymore — the cwd allow + catch-all deny enforce containment.
      expect(filesystemModeToPermissions('all')).toEqual([
        { operations: ['read', 'write'], paths: ['/work/proj/**', '/work/proj'], mode: 'allow' },
        { operations: ['read', 'write'], paths: ['/**'], mode: 'deny' },
      ]);
    });

    it('"read" denies all writes and confines reads to the cwd sandbox', () => {
      expect(filesystemModeToPermissions('read')).toEqual([
        { operations: ['write'], paths: ['/**'], mode: 'deny' },
        { operations: ['read'], paths: ['/work/proj/**', '/work/proj'], mode: 'allow' },
        { operations: ['read'], paths: ['/**'], mode: 'deny' },
      ]);
    });

    it('"none" denies all reads and writes', () => {
      expect(filesystemModeToPermissions('none')).toEqual([
        { operations: ['read', 'write'], paths: ['/**'], mode: 'deny' },
      ]);
    });

    it('an allow-list resolves each dir against the real cwd then denies everything else', () => {
      const rules = filesystemModeToPermissions(['src', './docs/']);
      expect(rules).toEqual([
        {
          operations: ['read', 'write'],
          paths: ['/work/proj/src/**', '/work/proj/src'],
          mode: 'allow',
        },
        {
          operations: ['read', 'write'],
          paths: ['/work/proj/docs/**', '/work/proj/docs'],
          mode: 'allow',
        },
        { operations: ['read', 'write'], paths: ['/**'], mode: 'deny' },
      ]);
    });

    it('accepts an explicit cwd argument (overrides getCurrentWorkDir)', () => {
      expect(filesystemModeToPermissions('all', '/custom/root')).toEqual([
        {
          operations: ['read', 'write'],
          paths: ['/custom/root/**', '/custom/root'],
          mode: 'allow',
        },
        { operations: ['read', 'write'], paths: ['/**'], mode: 'deny' },
      ]);
    });
  });

  describe('buildPermissions', () => {
    it('puts .aiignore deny rules first so they win over allow rules (real-cwd anchored)', () => {
      const rules = buildPermissions({
        filesystem: ['src'],
        aiignore: { enabled: true, patterns: ['*.env'] },
      });
      // EXT-13: aiignore + allow-list now anchor at the real cwd in the default case too.
      expect(rules[0]).toEqual({
        operations: ['read', 'write'],
        paths: ['/work/proj/*.env', '/work/proj/**/*.env'],
        mode: 'deny',
      });
      expect(rules[rules.length - 1]).toEqual({
        operations: ['read', 'write'],
        paths: ['/**'],
        mode: 'deny',
      });
    });

    it('filesystem "all" + two ignore patterns: aiignore denies first, then the cwd sandbox', () => {
      const rules = buildPermissions({
        filesystem: 'all',
        aiignore: { enabled: true, patterns: ['*.env', 'config/secrets.json'] },
      });
      // 2 aiignore deny rules + (cwd allow, catch-all deny) from the "all" sandbox.
      expect(rules).toHaveLength(4);
      expect(rules[0]).toEqual({
        operations: ['read', 'write'],
        paths: ['/work/proj/*.env', '/work/proj/**/*.env'],
        mode: 'deny',
      });
      // The cwd sandbox allow rule is present and the last rule is the catch-all deny.
      expect(rules).toContainEqual({
        operations: ['read', 'write'],
        paths: ['/work/proj/**', '/work/proj'],
        mode: 'allow',
      });
      expect(rules[rules.length - 1]).toEqual({
        operations: ['read', 'write'],
        paths: ['/**'],
        mode: 'deny',
      });
    });

    it('skips .aiignore when explicitly disabled (but keeps the cwd sandbox)', () => {
      const rules = buildPermissions({
        filesystem: 'all',
        aiignore: { enabled: false, patterns: ['*.env'] },
      });
      expect(rules).toEqual([
        { operations: ['read', 'write'], paths: ['/work/proj/**', '/work/proj'], mode: 'allow' },
        { operations: ['read', 'write'], paths: ['/**'], mode: 'deny' },
      ]);
    });

    it('skips .aiignore when there are no patterns or no aiignore block (cwd sandbox remains)', () => {
      const expected = [
        { operations: ['read', 'write'], paths: ['/work/proj/**', '/work/proj'], mode: 'allow' },
        { operations: ['read', 'write'], paths: ['/**'], mode: 'deny' },
      ];
      expect(buildPermissions({ filesystem: 'all' })).toEqual(expected);
      expect(buildPermissions({ filesystem: 'all', aiignore: { patterns: [] } })).toEqual(expected);
    });

    it('allowDirs replaces filesystem-mode rules with the cwd + dirs allow-list (real paths)', () => {
      const rules = buildPermissions({ filesystem: 'all', allowDirs: ['/tmp/out'] });
      expect(rules).toEqual([
        { operations: ['read', 'write'], paths: ['/work/proj/**', '/work/proj'], mode: 'allow' },
        { operations: ['read', 'write'], paths: ['/tmp/out/**', '/tmp/out'], mode: 'allow' },
        { operations: ['read', 'write'], paths: ['/**'], mode: 'deny' },
      ]);
    });

    it('with allowDirs, .aiignore deny rules are anchored at the absolute cwd and come first', () => {
      const rules = buildPermissions({
        filesystem: 'all',
        allowDirs: ['/tmp/out'],
        aiignore: { enabled: true, patterns: ['*.env'] },
      });
      expect(rules[0]).toEqual({
        operations: ['read', 'write'],
        paths: ['/work/proj/*.env', '/work/proj/**/*.env'],
        mode: 'deny',
      });
      // allow-list follows, catch-all deny last.
      expect(rules[rules.length - 1]).toEqual({
        operations: ['read', 'write'],
        paths: ['/**'],
        mode: 'deny',
      });
    });
  });

  describe('FILESYSTEM_TOOL_NAMES', () => {
    it('mirrors the deepagents reserved filesystem tool names', () => {
      expect([...FILESYSTEM_TOOL_NAMES]).toEqual([
        'ls',
        'read_file',
        'write_file',
        'edit_file',
        'glob',
        'grep',
        'execute',
      ]);
    });
  });
});
