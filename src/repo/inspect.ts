import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Repository inspection (§36).
 *
 * Runs before any modification: reads manifests, detects the framework,
 * languages, package manager, test setup, environment templates and git state,
 * and stores the result as project context. It only ever reads.
 */

export type RepoInspection = {
  inspectedAt: string;
  languages: Record<string, number>;
  packageManager: string | null;
  frameworks: string[];
  scripts: Record<string, string>;
  testFrameworks: string[];
  hasReadme: boolean;
  readmeExcerpt: string | null;
  envTemplates: string[];
  databaseHints: string[];
  git: {
    isRepository: boolean;
    branch: string | null;
    headSha: string | null;
    dirty: boolean;
    remoteUrl: string | null;
    recentCommits: Array<{ sha: string; message: string; author: string; date: string }>;
  };
  topLevelEntries: string[];
  fileCount: number;
  conventions: string[];
  warnings: string[];
};

const IGNORED = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage',
  '.cache', '.turbo', '.venv', '__pycache__', '.data',
]);

const EXTENSION_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript (React)', '.js': 'JavaScript', '.jsx': 'JavaScript (React)',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.rb': 'Ruby',
  '.php': 'PHP', '.cs': 'C#', '.swift': 'Swift', '.kt': 'Kotlin',
  '.sql': 'SQL', '.css': 'CSS', '.scss': 'SCSS', '.html': 'HTML', '.md': 'Markdown',
};

export async function inspectRepository(root: string): Promise<RepoInspection> {
  const warnings: string[] = [];
  const languages: Record<string, number> = {};
  let fileCount = 0;
  const topLevelEntries: string[] = [];

  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
      topLevelEntries.push(entry.isDirectory() ? `${entry.name}/` : entry.name);
    }
  } catch (error) {
    warnings.push(`Could not read the repository root: ${error instanceof Error ? error.message : String(error)}`);
  }

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6 || fileCount > 20000) return;
    let items;
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (IGNORED.has(item.name)) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full, depth + 1);
      } else {
        fileCount += 1;
        const ext = path.extname(item.name).toLowerCase();
        const language = EXTENSION_LANGUAGE[ext];
        if (language) languages[language] = (languages[language] ?? 0) + 1;
      }
    }
  }
  await walk(root, 0);

  // --- package.json ---------------------------------------------------------
  let pkg: Record<string, unknown> | null = null;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    /* not a node project */
  }

  const scripts = (pkg?.scripts as Record<string, string> | undefined) ?? {};
  const allDeps: Record<string, string> = {
    ...((pkg?.dependencies as Record<string, string>) ?? {}),
    ...((pkg?.devDependencies as Record<string, string>) ?? {}),
  };

  const frameworks: string[] = [];
  const frameworkMap: Array<[string, string]> = [
    ['next', 'Next.js'],
    ['react', 'React'],
    ['vue', 'Vue'],
    ['svelte', 'Svelte'],
    ['@angular/core', 'Angular'],
    ['express', 'Express'],
    ['fastify', 'Fastify'],
    ['nestjs', 'NestJS'],
    ['@nestjs/core', 'NestJS'],
    ['drizzle-orm', 'Drizzle ORM'],
    ['prisma', 'Prisma'],
    ['tailwindcss', 'Tailwind CSS'],
    ['@electric-sql/pglite', 'PGlite'],
  ];
  for (const [dep, label] of frameworkMap) {
    if (allDeps[dep]) frameworks.push(`${label} ${allDeps[dep]}`);
  }

  const testFrameworks: string[] = [];
  for (const [dep, label] of [
    ['vitest', 'Vitest'], ['jest', 'Jest'], ['@playwright/test', 'Playwright'],
    ['cypress', 'Cypress'], ['mocha', 'Mocha'],
  ] as Array<[string, string]>) {
    if (allDeps[dep]) testFrameworks.push(label);
  }

  // --- package manager -------------------------------------------------------
  let packageManager: string | null = null;
  if (pkg?.packageManager && typeof pkg.packageManager === 'string') {
    packageManager = pkg.packageManager;
  } else {
    for (const [lockfile, pm] of [
      ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'],
      ['package-lock.json', 'npm'], ['bun.lockb', 'bun'],
    ] as Array<[string, string]>) {
      try {
        await fs.stat(path.join(root, lockfile));
        packageManager = pm;
        break;
      } catch {
        /* try next */
      }
    }
  }

  // --- README ----------------------------------------------------------------
  let readmeExcerpt: string | null = null;
  let hasReadme = false;
  for (const name of ['README.md', 'readme.md', 'README.MD', 'README']) {
    try {
      const content = await fs.readFile(path.join(root, name), 'utf8');
      hasReadme = true;
      readmeExcerpt = content.slice(0, 3000);
      break;
    } catch {
      /* try next */
    }
  }

  // --- environment templates --------------------------------------------------
  const envTemplates: string[] = [];
  try {
    const entries = await fs.readdir(root);
    for (const entry of entries) {
      if (/^\.env(\..+)?$/.test(entry) && entry !== '.env.local') envTemplates.push(entry);
    }
  } catch {
    /* ignore */
  }

  // --- database hints -----------------------------------------------------------
  const databaseHints: string[] = [];
  if (allDeps['pg'] || allDeps['postgres']) databaseHints.push('PostgreSQL client present');
  if (allDeps['@electric-sql/pglite']) databaseHints.push('PGlite (embedded PostgreSQL)');
  if (allDeps['mysql2']) databaseHints.push('MySQL client present');
  if (allDeps['better-sqlite3'] || allDeps['sqlite3']) databaseHints.push('SQLite client present');
  if (allDeps['mongodb']) databaseHints.push('MongoDB client present');
  try {
    await fs.stat(path.join(root, 'drizzle.config.ts'));
    databaseHints.push('Drizzle migrations configured');
  } catch {
    /* ignore */
  }

  // --- conventions ---------------------------------------------------------------
  const conventions: string[] = [];
  if (pkg?.type === 'module') conventions.push('ES modules ("type": "module")');
  if (allDeps['typescript']) conventions.push('TypeScript');
  try {
    const tsconfig = JSON.parse(await fs.readFile(path.join(root, 'tsconfig.json'), 'utf8')) as {
      compilerOptions?: { strict?: boolean };
    };
    if (tsconfig.compilerOptions?.strict) conventions.push('TypeScript strict mode');
  } catch {
    /* ignore */
  }
  if (allDeps['eslint']) conventions.push('ESLint');
  if (allDeps['prettier']) conventions.push('Prettier');
  try {
    await fs.stat(path.join(root, 'src'));
    conventions.push('Uses a src/ directory layout');
  } catch {
    /* ignore */
  }

  if (!hasReadme) warnings.push('No README found — project intent is not documented in the repository.');
  if (Object.keys(scripts).length === 0) warnings.push('No npm scripts declared, so build/test commands are unknown.');
  if (testFrameworks.length === 0) warnings.push('No test framework detected — verification will be limited to typecheck/build.');

  const git = await inspectGit(root);

  return {
    inspectedAt: new Date().toISOString(),
    languages,
    packageManager,
    frameworks,
    scripts,
    testFrameworks,
    hasReadme,
    readmeExcerpt,
    envTemplates,
    databaseHints,
    git,
    topLevelEntries: topLevelEntries.slice(0, 100),
    fileCount,
    conventions,
    warnings,
  };
}

function gitCommand(root: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd: root, shell: false });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => resolve({ code: 127, stdout: '' }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }));
  });
}

async function inspectGit(root: string): Promise<RepoInspection['git']> {
  const fallback = {
    isRepository: false,
    branch: null,
    headSha: null,
    dirty: false,
    remoteUrl: null,
    recentCommits: [],
  };

  const revParse = await gitCommand(root, ['rev-parse', '--is-inside-work-tree']);
  if (revParse.code !== 0 || !revParse.stdout.includes('true')) return fallback;

  const [branch, head, status, remote, log] = await Promise.all([
    gitCommand(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    gitCommand(root, ['rev-parse', 'HEAD']),
    gitCommand(root, ['status', '--porcelain']),
    gitCommand(root, ['remote', 'get-url', 'origin']),
    gitCommand(root, ['log', '-10', '--pretty=%H%x1f%s%x1f%an%x1f%aI']),
  ]);

  const recentCommits = log.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, message, author, date] = line.split('\x1f');
      return { sha: sha ?? '', message: message ?? '', author: author ?? '', date: date ?? '' };
    });

  return {
    isRepository: true,
    branch: branch.code === 0 ? branch.stdout.trim() : null,
    headSha: head.code === 0 ? head.stdout.trim() : null,
    dirty: status.stdout.trim().length > 0,
    remoteUrl: remote.code === 0 ? remote.stdout.trim() : null,
    recentCommits,
  };
}

/** Compact human-readable summary that goes into agent context. */
export function summariseInspection(inspection: RepoInspection, repoName: string): string {
  const languages = Object.entries(inspection.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => `${name} (${count})`)
    .join(', ');

  const lines = [
    `Repository: ${repoName}`,
    inspection.git.isRepository
      ? `Git: branch ${inspection.git.branch ?? 'unknown'}, ${inspection.git.dirty ? 'has uncommitted changes' : 'clean'}, ${inspection.git.recentCommits.length} recent commits`
      : 'Git: not a git repository',
    languages ? `Languages: ${languages}` : 'Languages: none detected',
    inspection.frameworks.length > 0 ? `Frameworks: ${inspection.frameworks.join(', ')}` : 'Frameworks: none detected',
    inspection.packageManager ? `Package manager: ${inspection.packageManager}` : 'Package manager: unknown',
    Object.keys(inspection.scripts).length > 0
      ? `Scripts: ${Object.keys(inspection.scripts).slice(0, 12).join(', ')}`
      : 'Scripts: none',
    inspection.testFrameworks.length > 0
      ? `Test frameworks: ${inspection.testFrameworks.join(', ')}`
      : 'Test frameworks: none detected',
    inspection.databaseHints.length > 0 ? `Database: ${inspection.databaseHints.join('; ')}` : '',
    inspection.conventions.length > 0 ? `Conventions: ${inspection.conventions.join(', ')}` : '',
    inspection.warnings.length > 0 ? `Warnings: ${inspection.warnings.join(' ')}` : '',
    inspection.readmeExcerpt ? `README excerpt:\n${inspection.readmeExcerpt.slice(0, 800)}` : '',
  ];

  return lines.filter(Boolean).join('\n');
}
