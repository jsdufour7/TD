import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';
import { resolveSandboxPath, toRelativePath, isIgnoredSegment } from '@/lib/sandbox';
import { AppError } from '@/lib/errors';
import { defineTool, ok, fail, type ErasedTool } from './types';

/**
 * File tools. All paths are relative to the project sandbox and every one is
 * validated by resolveSandboxPath before the filesystem is touched.
 */

const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_READ_BYTES = 400 * 1024;

export const readFileTool = defineTool({
  name: 'read_file',
  description:
    'Read a text file from the project workspace. Returns the file content, or a bounded excerpt for very large files. Path is relative to the project root.',
  permission: 'read',
  inputSchema: z.object({
    path: z.string().min(1).describe('File path relative to the project root'),
    startLine: z.number().int().min(1).optional().describe('First line to return (1-based)'),
    endLine: z.number().int().min(1).optional().describe('Last line to return (inclusive)'),
  }),
  async execute(input, ctx) {
    const absolute = resolveSandboxPath(ctx.sandboxRoot, input.path);
    let content: string;
    try {
      const stat = await fs.stat(absolute);
      if (stat.isDirectory()) return fail(`Path is a directory: ${input.path}`);
      content = await fs.readFile(absolute, 'utf8');
    } catch (error) {
      return fail(
        `Could not read ${input.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const truncated = content.length > MAX_READ_BYTES;
    const body = truncated ? content.slice(0, MAX_READ_BYTES) : content;
    const lines = body.split('\n');
    const start = input.startLine ? input.startLine - 1 : 0;
    const end = input.endLine ? Math.min(input.endLine, lines.length) : lines.length;
    const slice = lines.slice(start, end);

    return ok(`Read ${input.path} (${slice.length} lines)`, {
      path: input.path,
      content: slice.join('\n'),
      totalLines: lines.length,
      truncated,
      byteLength: content.length,
    });
  },
});

export const writeFileTool = defineTool({
  name: 'write_file',
  description:
    'Create or overwrite a file in the project workspace. Records the change so it appears in the diff review. Path is relative to the project root.',
  permission: 'write',
  mutatesRepository: true,
  inputSchema: z.object({
    path: z.string().min(1),
    content: z.string().describe('Full file content'),
  }),
  async execute(input, ctx) {
    if (Buffer.byteLength(input.content, 'utf8') > MAX_WRITE_BYTES) {
      return fail('File content exceeds the 2 MB write limit');
    }
    const absolute = resolveSandboxPath(ctx.sandboxRoot, input.path);

    let before: string | null = null;
    let existed = false;
    try {
      before = await fs.readFile(absolute, 'utf8');
      existed = true;
    } catch {
      before = null;
    }

    if (existed && before === input.content) {
      return ok(`No change needed in ${input.path}`, { path: input.path, unchanged: true });
    }

    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, input.content, 'utf8');

    const relative = toRelativePath(ctx.sandboxRoot, absolute);
    await ctx.recordFileChange({
      changeType: existed ? 'modified' : 'added',
      path: relative,
      beforeContent: before,
      afterContent: input.content,
    });

    const additions = existed ? input.content.split('\n').length : input.content.split('\n').length;
    return ok(`${existed ? 'Updated' : 'Created'} ${relative}`, {
      path: relative,
      created: !existed,
      bytes: Buffer.byteLength(input.content, 'utf8'),
      lines: additions,
    });
  },
});

export const patchFileTool = defineTool({
  name: 'patch_file',
  description:
    'Apply a targeted search-and-replace edit to an existing file. Safer than rewriting a whole file. `search` must match exactly once unless `replaceAll` is set.',
  permission: 'write',
  mutatesRepository: true,
  inputSchema: z.object({
    path: z.string().min(1),
    search: z.string().min(1).describe('Exact text to find'),
    replace: z.string().describe('Replacement text'),
    replaceAll: z.boolean().optional().describe('Replace every occurrence'),
  }),
  async execute(input, ctx) {
    const absolute = resolveSandboxPath(ctx.sandboxRoot, input.path);
    let before: string;
    try {
      before = await fs.readFile(absolute, 'utf8');
    } catch (error) {
      return fail(
        `Could not read ${input.path} for patching: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const occurrences = before.split(input.search).length - 1;
    if (occurrences === 0) {
      return fail(`Search text not found in ${input.path}. Re-read the file and match it exactly.`);
    }
    if (occurrences > 1 && !input.replaceAll) {
      return fail(
        `Search text matches ${occurrences} locations in ${input.path}. Provide more surrounding context, or set replaceAll.`,
      );
    }

    const after = input.replaceAll
      ? before.split(input.search).join(input.replace)
      : before.replace(input.search, input.replace);

    if (after === before) {
      return ok(`No change applied to ${input.path}`, { path: input.path, unchanged: true });
    }

    await fs.writeFile(absolute, after, 'utf8');
    const relative = toRelativePath(ctx.sandboxRoot, absolute);
    await ctx.recordFileChange({
      changeType: 'modified',
      path: relative,
      beforeContent: before,
      afterContent: after,
    });

    return ok(`Patched ${relative} (${occurrences} replacement${occurrences > 1 ? 's' : ''})`, {
      path: relative,
      replacements: input.replaceAll ? occurrences : 1,
    });
  },
});

export const deleteFileTool = defineTool({
  name: 'delete_file',
  description:
    'Delete a file from the project workspace. Requires human approval before it runs.',
  permission: 'destructive',
  mutatesRepository: true,
  inputSchema: z.object({
    path: z.string().min(1),
    reason: z.string().min(1).describe('Why this file should be deleted'),
  }),
  async execute(input, ctx) {
    const absolute = resolveSandboxPath(ctx.sandboxRoot, input.path);
    const relative = toRelativePath(ctx.sandboxRoot, absolute);

    let before: string;
    try {
      before = await fs.readFile(absolute, 'utf8');
    } catch {
      return fail(`Cannot delete ${input.path}: file does not exist`);
    }

    const decision = await ctx.requestApproval({
      category: 'file_delete',
      title: `Delete ${relative}`,
      description: `Reason given: ${input.reason}`,
      risk: 'high',
      action: { tool: 'delete_file', path: relative },
    });

    if (decision.status !== 'approved') {
      return fail(`Deletion of ${relative} was ${decision.status} by the user`);
    }

    await fs.rm(absolute, { force: true });
    await ctx.recordFileChange({
      changeType: 'deleted',
      path: relative,
      beforeContent: before,
      afterContent: null,
    });
    return ok(`Deleted ${relative} after approval`, { path: relative });
  },
});

export const listDirectoryTool = defineTool({
  name: 'list_directory',
  description:
    'List the file tree of a directory in the project workspace. Skips node_modules, .git and build output by default.',
  permission: 'read',
  inputSchema: z.object({
    path: z.string().default('.').describe('Directory relative to the project root'),
    maxDepth: z.number().int().min(1).max(8).default(4),
    maxEntries: z.number().int().min(1).max(2000).default(500),
  }),
  async execute(input, ctx) {
    const absolute = resolveSandboxPath(ctx.sandboxRoot, input.path);
    const entries: Array<{ path: string; type: 'file' | 'dir'; bytes?: number }> = [];
    let truncated = false;

    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > input.maxDepth || truncated) return;
      let items;
      try {
        items = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
        if (truncated) return;
        if (isIgnoredSegment(item.name)) continue;
        const full = path.join(dir, item.name);
        const relative = toRelativePath(ctx.sandboxRoot, full);
        if (entries.length >= input.maxEntries) {
          truncated = true;
          return;
        }
        if (item.isDirectory()) {
          entries.push({ path: `${relative}/`, type: 'dir' });
          await walk(full, depth + 1);
        } else {
          let bytes: number | undefined;
          try {
            bytes = (await fs.stat(full)).size;
          } catch {
            /* ignore */
          }
          entries.push({ path: relative, type: 'file', bytes });
        }
      }
    }

    await walk(absolute, 1);
    return ok(
      `Listed ${entries.length} entries in ${input.path}${truncated ? ' (truncated)' : ''}`,
      { path: input.path, entries, truncated, total: entries.length },
    );
  },
});

export const searchFilesTool = defineTool({
  name: 'search_files',
  description:
    'Search file contents across the project workspace using a regular expression. Returns matching lines with file and line number.',
  permission: 'read',
  inputSchema: z.object({
    pattern: z.string().min(1).describe('Regular expression to search for'),
    path: z.string().default('.').describe('Directory to search within'),
    filePattern: z.string().optional().describe('Glob-ish substring filter, e.g. ".tsx"'),
    maxResults: z.number().int().min(1).max(300).default(50),
    caseSensitive: z.boolean().default(true),
  }),
  async execute(input, ctx) {
    let regex: RegExp;
    try {
      regex = new RegExp(input.pattern, input.caseSensitive ? 'g' : 'gi');
    } catch (error) {
      return fail(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
    }

    const root = resolveSandboxPath(ctx.sandboxRoot, input.path);
    const gitignore = await loadGitignore(ctx.sandboxRoot);
    const matches: Array<{ path: string; line: number; text: string }> = [];
    let filesScanned = 0;

    async function walk(dir: string): Promise<void> {
      if (matches.length >= input.maxResults) return;
      let items;
      try {
        items = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const item of items) {
        if (matches.length >= input.maxResults) return;
        const full = path.join(dir, item.name);
        const relative = toRelativePath(ctx.sandboxRoot, full);
        if (isIgnoredSegment(item.name) || gitignore.ignores(relative)) continue;
        if (item.isDirectory()) {
          await walk(full);
          continue;
        }
        if (input.filePattern && !relative.includes(input.filePattern)) continue;
        filesScanned += 1;
        if (filesScanned > 5000) return;

        let content: string;
        try {
          const stat = await fs.stat(full);
          if (stat.size > MAX_READ_BYTES) continue;
          content = await fs.readFile(full, 'utf8');
        } catch {
          continue;
        }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          regex.lastIndex = 0;
          if (regex.test(lines[i]!)) {
            matches.push({
              path: relative,
              line: i + 1,
              text: lines[i]!.trim().slice(0, 300),
            });
            if (matches.length >= input.maxResults) return;
          }
        }
      }
    }

    await walk(root);
    const fileCount = new Set(matches.map((m) => m.path)).size;
    return ok(`Found ${matches.length} matches across ${fileCount} files`, {
      pattern: input.pattern,
      matches,
      filesScanned,
      truncated: matches.length >= input.maxResults,
    });
  },
});

/** Respect .gitignore so searches do not waste time on ignored output. */
async function loadGitignore(root: string): Promise<{ ignores: (p: string) => boolean }> {
  try {
    const content = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
    return ignore().add(content);
  } catch {
    return ignore();
  }
}

export const FILE_TOOLS: ErasedTool[] = [
  readFileTool,
  writeFileTool,
  patchFileTool,
  deleteFileTool,
  listDirectoryTool,
  searchFilesTool,
];

/** Re-exported so tests can exercise the guard directly. */
export { resolveSandboxPath };
export function assertInsideSandbox(root: string, candidate: string): string {
  try {
    return resolveSandboxPath(root, candidate);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('path_escape', 'Path rejected');
  }
}
