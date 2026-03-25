import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ReviewIgnoreManager } from './ignoreManager';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [
      {
        uri: {
          fsPath: '/test/workspace'
        }
      }
    ]
  }
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn()
}));

describe('ReviewIgnoreManager', () => {
  let manager: ReviewIgnoreManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = ReviewIgnoreManager.getInstance();
    manager.clearCache();
  });

  it('ignores exact matches', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 123 } as any);
    vi.mocked(fs.readFileSync).mockReturnValue('temp/cache.js');

    expect(manager.shouldIgnore('/test/workspace/temp/cache.js')).toBe(true);
  });

  it('ignores directory matches with trailing slash', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 123 } as any);
    vi.mocked(fs.readFileSync).mockReturnValue('node_modules/');

    expect(manager.shouldIgnore('/test/workspace/node_modules/lodash/index.js')).toBe(true);
  });

  it('ignores directory matches without trailing slash', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 123 } as any);
    vi.mocked(fs.readFileSync).mockReturnValue('dist');

    expect(manager.shouldIgnore('/test/workspace/dist/main.js')).toBe(true);
  });

  it('ignores extension matches', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 123 } as any);
    vi.mocked(fs.readFileSync).mockReturnValue('*.log');

    expect(manager.shouldIgnore('/test/workspace/app.log')).toBe(true);
    expect(manager.shouldIgnore('/test/workspace/logs/server.log')).toBe(true);
  });

  it('ignores multi-level wildcards', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 123 } as any);
    vi.mocked(fs.readFileSync).mockReturnValue('**/vendor');

    expect(manager.shouldIgnore('/test/workspace/vendor/lib.js')).toBe(true);
    expect(manager.shouldIgnore('/test/workspace/src/vendor/sublib.js')).toBe(true);
  });

  it('ignores basename matches', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 123 } as any);
    vi.mocked(fs.readFileSync).mockReturnValue('.DS_Store');

    expect(manager.shouldIgnore('/test/workspace/.DS_Store')).toBe(true);
    expect(manager.shouldIgnore('/test/workspace/folder/.DS_Store')).toBe(true);
  });

  it('respects comments and empty lines', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 123 } as any);
    vi.mocked(fs.readFileSync).mockReturnValue(`
# This is a comment
node_modules/

# Another comment
*.log
    `);

    expect(manager.shouldIgnore('/test/workspace/node_modules/lib.js')).toBe(true);
    expect(manager.shouldIgnore('/test/workspace/test.log')).toBe(true);
    expect(manager.shouldIgnore('/test/workspace/src/app.js')).toBe(false);
  });
});
