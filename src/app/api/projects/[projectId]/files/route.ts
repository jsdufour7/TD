import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { requireProject } from '@/auth/guards';
import { jsonError, jsonOk, parseQuery } from '@/lib/api';
import { resolveSandboxPath, toRelativePath, isIgnoredSegment } from '@/lib/sandbox';
import { ensureProjectWorkspaceSandbox } from '@/lib/sandbox';

const querySchema = z.object({
  path: z.string().default('.'),
  /** 'tree' returns entries; 'file' returns content. */
  mode: z.enum(['tree', 'file']).default('tree'),
  maxDepth: z.coerce.number().int().min(1).max(6).default(3),
});

const MAX_FILE_BYTES = 400 * 1024;

/**
 * Repository workspace file access (§11).
 *
 * Every path is resolved through the sandbox guard, so this endpoint cannot be
 * used to read outside the project — including via `..` or symlinks.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const project = await requireProject(projectId);
    const query = parseQuery(new URL(request.url), querySchema);

    const root = project.sandboxPath ?? (await ensureProjectWorkspaceSandbox(projectId));
    const absolute = resolveSandboxPath(root, query.path);

    if (query.mode === 'file') {
      const stat = await fs.stat(absolute).catch(() => null);
      if (!stat?.isFile()) return jsonError(new Error('File not found'));
      if (stat.size > MAX_FILE_BYTES) {
        return jsonOk({
          path: toRelativePath(root, absolute),
          tooLarge: true,
          bytes: stat.size,
          content: null,
        });
      }
      const content = await fs.readFile(absolute, 'utf8');
      return jsonOk({
        path: toRelativePath(root, absolute),
        content,
        bytes: stat.size,
        lines: content.split('\n').length,
      });
    }

    const entries: Array<{ path: string; type: 'file' | 'dir'; bytes?: number }> = [];
    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > query.maxDepth) return;
      const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
        if (isIgnoredSegment(item.name)) continue;
        const full = path.join(dir, item.name);
        const relative = toRelativePath(root, full);
        if (item.isDirectory()) {
          entries.push({ path: relative, type: 'dir' });
          await walk(full, depth + 1);
        } else {
          const stat = await fs.stat(full).catch(() => null);
          entries.push({ path: relative, type: 'file', ...(stat ? { bytes: stat.size } : {}) });
        }
      }
    }
    await walk(absolute, 1);

    return jsonOk({ path: query.path, entries, total: entries.length });
  } catch (error) {
    return jsonError(error);
  }
}
