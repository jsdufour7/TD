import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject, requireUser } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { ensureProjectWorkspaceSandbox, resolveSandboxPath, toRelativePath } from '@/lib/sandbox';
import { inspectRepository, summariseInspection } from '@/repo/inspect';
import { runCommand } from '@/engine/command-runner';
import { emitAndNotify } from '@/engine/events';
import { recordAudit } from '@/lib/audit';

const connectSchema = z.object({
  /** 'init' creates a git repository in the sandbox; 'clone' fetches a remote. */
  action: z.enum(['init', 'clone', 'inspect']),
  name: z.string().min(1).max(120).optional(),
  remoteUrl: z.string().max(500).optional(),
  /** Subdirectory inside the sandbox to place the working copy. */
  targetDir: z.string().max(200).default('.'),
});

/**
 * Repository connection and inspection (§11, §36).
 *
 * Inspection is strictly read-only and always runs before any mutation, and its
 * result is stored on the project so later runs inherit the context.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const db = await getDb();

    const repositories = await db
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.projectId, projectId));

    return jsonOk({
      repositories: repositories.map((repo) => ({
        id: repo.id,
        name: repo.name,
        provider: repo.provider,
        remoteUrl: repo.remoteUrl,
        defaultBranch: repo.defaultBranch,
        currentBranch: repo.currentBranch,
        headSha: repo.headSha,
        connectionStatus: repo.connectionStatus,
        connectionError: repo.connectionError,
        inspection: repo.inspection,
        inspectedAt: repo.inspectedAt?.toISOString() ?? null,
        allowPush: repo.allowPush,
        createdAt: repo.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const project = await requireProject(projectId);
    const user = await requireUser();
    const body = await parseBody(request, connectSchema);
    const db = await getDb();

    const sandboxRoot = project.sandboxPath ?? (await ensureProjectWorkspaceSandbox(projectId));
    // The working copy must live inside the sandbox — this call also validates
    // that targetDir cannot escape it.
    const workingCopy = resolveSandboxPath(sandboxRoot, body.targetDir);
    await fs.mkdir(workingCopy, { recursive: true });

    const name = body.name ?? (body.remoteUrl ? repoNameFromUrl(body.remoteUrl) : path.basename(sandboxRoot));

    if (body.action === 'clone') {
      if (!body.remoteUrl) return jsonError(new Error('remoteUrl is required to clone'));
      // Only http(s) and ssh URLs are accepted; anything else could be a local
      // path or a shell payload.
      if (!/^(https:\/\/|git@|ssh:\/\/)/.test(body.remoteUrl)) {
        return jsonError(new Error('Only https or ssh remote URLs are supported'));
      }

      const clone = await runCommand({
        projectId,
        runId: null,
        toolCallId: null,
        command: 'git',
        argv: ['clone', '--depth', '50', body.remoteUrl, '.'],
        cwd: toRelativePath(sandboxRoot, workingCopy),
        label: `Clone ${body.remoteUrl}`,
        timeoutMs: 5 * 60 * 1000,
      });

      if (clone.status !== 'succeeded') {
        const [repo] = await db
          .insert(schema.repositories)
          .values({
            projectId,
            name,
            provider: 'github',
            remoteUrl: body.remoteUrl,
            localPath: toRelativePath(sandboxRoot, workingCopy),
            connectionStatus: 'error',
            connectionError: (clone.stderr || clone.stdout).slice(0, 1000),
          })
          .returning();
        return jsonOk({ repository: repo!, ok: false, error: 'Clone failed — see connectionError' });
      }
    }

    if (body.action === 'init') {
      const hasGit = await fs
        .stat(path.join(workingCopy, '.git'))
        .then(() => true)
        .catch(() => false);
      if (!hasGit) {
        await runCommand({
          projectId,
          runId: null,
          toolCallId: null,
          command: 'git',
          argv: ['init', '-b', 'main'],
          cwd: toRelativePath(sandboxRoot, workingCopy),
          label: 'git init',
          timeoutMs: 30_000,
        });
      }
    }

    // --- Inspection: read-only, always before anything is modified ----------
    const inspection = await inspectRepository(workingCopy);

    const existing = await db
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.projectId, projectId))
      .limit(1);

    const values = {
      projectId,
      name,
      provider: body.remoteUrl ? 'github' : 'local',
      remoteUrl: body.remoteUrl ?? null,
      localPath: toRelativePath(sandboxRoot, workingCopy),
      defaultBranch: inspection.git.branch ?? 'main',
      currentBranch: inspection.git.branch,
      headSha: inspection.git.headSha,
      connectionStatus: inspection.git.isRepository || body.action !== 'clone' ? 'connected' : 'error',
      connectionError: null,
      inspection: inspection as unknown as Record<string, unknown>,
      inspectedAt: new Date(),
      allowPush: false,
    };

    const repository = existing[0]
      ? await db
          .update(schema.repositories)
          .set(values)
          .where(eq(schema.repositories.id, existing[0].id))
          .returning()
          .then((rows) => rows[0]!)
      : (await db.insert(schema.repositories).values(values).returning())[0]!;

    // Store the summary as canonical memory so future runs inherit it (§9).
    // Upsert rather than insert: re-inspecting the same repository must update
    // the existing fact, not accumulate a duplicate on every inspection.
    const memoryTitle = `Repository inspected: ${name}`;
    const existingMemory = await db
      .select()
      .from(schema.memories)
      .where(
        and(
          eq(schema.memories.projectId, projectId),
          eq(schema.memories.kind, 'canonical'),
          eq(schema.memories.title, memoryTitle),
        ),
      )
      .limit(1);

    if (existingMemory[0]) {
      await db
        .update(schema.memories)
        .set({
          content: summariseInspection(inspection, name),
          source: 'repository-inspection',
          updatedAt: new Date(),
        })
        .where(eq(schema.memories.id, existingMemory[0].id));
    } else {
      await db.insert(schema.memories).values({
        projectId,
        kind: 'canonical',
        title: memoryTitle,
        content: summariseInspection(inspection, name),
        source: 'repository-inspection',
        isPinned: true,
        tags: ['repository', 'stack'],
      });
    }

    await db
      .update(schema.projects)
      .set({
        techStack: {
          languages: inspection.languages,
          frameworks: inspection.frameworks,
          packageManager: inspection.packageManager,
          testFrameworks: inspection.testFrameworks,
          conventions: inspection.conventions,
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, projectId));

    await recordAudit({
      action: `repository.${body.action}`,
      projectId,
      userId: user.id,
      entityType: 'repository',
      entityId: repository.id,
      metadata: { name, remoteUrl: body.remoteUrl ?? null },
    });

    return jsonOk({
      repository: {
        id: repository.id,
        name: repository.name,
        connectionStatus: repository.connectionStatus,
        currentBranch: repository.currentBranch,
        headSha: repository.headSha,
        allowPush: repository.allowPush,
      },
      inspection: {
        fileCount: inspection.fileCount,
        languages: inspection.languages,
        frameworks: inspection.frameworks,
        packageManager: inspection.packageManager,
        scripts: Object.keys(inspection.scripts),
        testFrameworks: inspection.testFrameworks,
        conventions: inspection.conventions,
        databaseHints: inspection.databaseHints,
        envTemplates: inspection.envTemplates,
        warnings: inspection.warnings,
        git: inspection.git,
        summary: summariseInspection(inspection, name),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

function repoNameFromUrl(url: string): string {
  const match = /\/([^/]+?)(?:\.git)?$/.exec(url);
  return match?.[1] ?? 'repository';
}

export { emitAndNotify };
