import { describe, expect, it, vi } from 'vitest';
import { getDefaultTools } from '#src/builtInToolsConfig.js';
import type { GthConfig } from '#src/config.js';

// Mock the GthFileSystemToolkit
vi.mock('#src/tools/GthFileSystemToolkit.js', () => ({
  default: class MockGthFileSystemToolkit {
    constructor() {}

    getTools() {
      return [
        { name: 'read_file', gthFileSystemType: 'read' },
        { name: 'write_file', gthFileSystemType: 'write' },
        { name: 'list_directory', gthFileSystemType: 'read' },
        { name: 'edit_file', gthFileSystemType: 'write' },
      ];
    }

    getFilteredTools(operations: ('read' | 'write')[]) {
      return this.getTools().filter((tool: any) => operations.includes(tool.gthFileSystemType));
    }
  },
}));

vi.mock('#src/utils/systemUtils.js', () => ({
  getCurrentWorkDir: () => '/test/dir',
  getUseColour: () => false,
}));

describe('Config Tool Functions', () => {
  describe('getDefaultTools', () => {
    it('should return all tools when filesystem is "all"', async () => {
      const result = await getDefaultTools({
        filesystem: 'all',
      } as Partial<GthConfig> as GthConfig);

      expect(result).toHaveLength(4);
      expect(result.map((t) => t.name)).toEqual([
        'read_file',
        'write_file',
        'list_directory',
        'edit_file',
      ]);
    });

    it('should return no tools when filesystem is "none"', async () => {
      const result = await getDefaultTools({
        filesystem: 'none',
      } as Partial<GthConfig> as GthConfig);

      expect(result).toEqual([]);
    });

    it('should return only read tools when filesystem is "read"', async () => {
      const result = await getDefaultTools({
        filesystem: 'read',
      } as Partial<GthConfig> as GthConfig);
      expect(result.map((t) => t.name)).toEqual(['read_file', 'list_directory']);
    });

    it('should work with read in array format', async () => {
      const result = await getDefaultTools({
        filesystem: ['read'],
      } as Partial<GthConfig> as GthConfig);
      expect(result.map((t) => t.name)).toEqual(['read_file', 'list_directory']);
    });

    it('should filter filesystem tools based on specific read-only tool names', async () => {
      const result = await getDefaultTools({
        filesystem: ['read_file'],
      } as Partial<GthConfig> as GthConfig);
      expect(result.map((t) => t.name)).toEqual(['read_file']);
    });

    it('should include built-in tools when specified', async () => {
      const result = await getDefaultTools({
        filesystem: 'none',
        builtInTools: ['gth_status_update'],
      } as Partial<GthConfig> as GthConfig);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('gth_status_update');
    });

    it('should combine filesystem and built-in tools', async () => {
      const result = await getDefaultTools({
        filesystem: 'read',
        builtInTools: ['gth_status_update'],
      } as Partial<GthConfig> as GthConfig);
      expect(result).toHaveLength(3);
      expect(result.map((t) => t.name)).toEqual([
        'read_file',
        'list_directory',
        'gth_status_update',
      ]);
    });
  });
});
