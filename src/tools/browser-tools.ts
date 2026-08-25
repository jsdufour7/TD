import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { env } from '@/lib/env';
import { defineTool, ok, fail, type ErasedTool, type ToolContext } from './types';

/**
 * Browser / UI verification tools (§14).
 *
 * These are a genuine Playwright implementation, not a stub: when a browser
 * runtime is installed they drive a real Chromium, capture console errors,
 * network failures and screenshots.
 *
 * In this sandbox the browser download is blocked (npm registry only), so the
 * capability check below reports that honestly. No tool here fabricates a
 * successful interaction — §49.
 */

type PlaywrightPage = {
  goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  click(selector: string, opts?: Record<string, unknown>): Promise<unknown>;
  fill(selector: string, value: string, opts?: Record<string, unknown>): Promise<unknown>;
  type(selector: string, text: string, opts?: Record<string, unknown>): Promise<unknown>;
  screenshot(opts: Record<string, unknown>): Promise<Buffer>;
  title(): Promise<string>;
  url(): string;
  content(): Promise<string>;
  evaluate<T>(fn: string): Promise<T>;
  waitForLoadState(state?: string, opts?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  viewportSize(): { width: number; height: number } | null;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
};

type PlaywrightBrowser = {
  newPage(opts?: Record<string, unknown>): Promise<PlaywrightPage>;
  close(): Promise<void>;
};

/**
 * A browser session only ever exists once both a browser and a page are live,
 * so neither field is nullable. That removes every non-null assertion from the
 * tool handlers below.
 */
type BrowserSession = {
  browser: PlaywrightBrowser;
  page: PlaywrightPage;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  lastUrl: string | null;
};

const sessions = new Map<string, BrowserSession>();

type PlaywrightModule = {
  chromium: {
    launch(options: Record<string, unknown>): Promise<PlaywrightBrowser>;
    executablePath?(): string;
  };
};

/**
 * Load Playwright at runtime, deliberately outside the bundler's static graph.
 *
 * Two reasons this is not a normal `import`:
 *  1. Playwright is an optional runtime dependency. AI Core must work — and
 *     report honestly that browser verification is unavailable — when it is not
 *     installed.
 *  2. playwright-core references `chromium-bidi` through a lazy require that the
 *     bundler tries to resolve eagerly and fails on, including during Next's
 *     edge-instrumentation pass.
 *
 * The module name is assembled at runtime so no static analyser follows it.
 */
async function loadPlaywright(): Promise<PlaywrightModule | null> {
  try {
    const { createRequire } = await import('node:module');
    const requireFromHere = createRequire(import.meta.url);
    const moduleName = ['play', 'wright'].join('');
    const mod = requireFromHere(moduleName) as Partial<PlaywrightModule> | undefined;
    return mod?.chromium ? (mod as PlaywrightModule) : null;
  } catch {
    return null;
  }
}

/** Detect whether a browser binary is actually available. */
export async function browserCapability(): Promise<{ available: boolean; reason: string }> {
  const pw = await loadPlaywright();
  if (!pw) {
    return { available: false, reason: 'The playwright package is not installed.' };
  }
  try {
    // executablePath() throws when the browser has not been downloaded.
    const exe = pw.chromium.executablePath?.();
    if (exe) {
      await fs.stat(exe);
      return { available: true, reason: `Chromium at ${exe}` };
    }
  } catch {
    /* fall through */
  }
  return {
    available: false,
    reason:
      'No Chromium runtime installed. Run `npx playwright install chromium` on a machine with access to the Playwright CDN. Browser verification is unavailable until then.',
  };
}

async function withPage(
  ctx: ToolContext,
  work: (page: PlaywrightPage, session: BrowserSession) => Promise<Record<string, unknown>>,
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  const capability = await browserCapability();
  if (!capability.available) {
    return fail(`Browser verification unavailable: ${capability.reason}`, {
      browserAvailable: false,
    });
  }

  let session = sessions.get(ctx.projectId);
  if (!session) {
    const pw = await loadPlaywright();
    if (!pw) return fail('Playwright failed to load');
    const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const created: BrowserSession = {
      browser,
      page,
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      lastUrl: null,
    };
    page.on('console', (message: unknown) => {
      const msg = message as { type(): string; text(): string };
      if (msg.type() === 'error') created.consoleErrors.push(msg.text().slice(0, 500));
    });
    page.on('pageerror', (error: unknown) => {
      created.pageErrors.push(String(error).slice(0, 500));
    });
    page.on('requestfailed', (request: unknown) => {
      const req = request as { url(): string; failure(): { errorText: string } | null };
      created.failedRequests.push(`${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`);
    });
    sessions.set(ctx.projectId, created);
    session = created;
  }

  try {
    const data = await work(session.page, session);
    return ok('Browser action completed', data);
  } catch (error) {
    return fail(`Browser action failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const browserOpenTool = defineTool({
  name: 'browser_open',
  description:
    'Open a URL in the verification browser and report console errors, page errors and failed network requests. Use the dev-server URL.',
  permission: 'network',
  inputSchema: z.object({
    url: z.string().url(),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).default('load'),
    timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  }),
  async execute(input, ctx) {
    return withPage(ctx, async (page, session) => {
      // Reset per navigation so the report describes this page, not history.
      session.consoleErrors = [];
      session.pageErrors = [];
      session.failedRequests = [];
      await page.goto(input.url, { waitUntil: input.waitUntil, timeout: input.timeoutMs });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      session.lastUrl = input.url;
      const title = await page.title();
      return {
        url: page.url(),
        title,
        consoleErrors: session.consoleErrors,
        pageErrors: session.pageErrors,
        failedRequests: session.failedRequests,
        healthy:
          session.consoleErrors.length === 0 &&
          session.pageErrors.length === 0 &&
          session.failedRequests.length === 0,
      };
    });
  },
});

export const browserClickTool = defineTool({
  name: 'browser_click',
  description: 'Click an element by CSS selector and report any resulting errors.',
  permission: 'network',
  inputSchema: z.object({
    selector: z.string().min(1),
    timeoutMs: z.number().int().min(500).max(60000).default(10000),
  }),
  async execute(input, ctx) {
    return withPage(ctx, async (page, session) => {
      session.pageErrors = [];
      await page.click(input.selector, { timeout: input.timeoutMs });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
      return {
        clicked: input.selector,
        url: page.url(),
        pageErrors: session.pageErrors,
        consoleErrors: session.consoleErrors,
      };
    });
  },
});

export const browserTypeTool = defineTool({
  name: 'browser_type',
  description: 'Type text into an input element identified by CSS selector.',
  permission: 'network',
  inputSchema: z.object({
    selector: z.string().min(1),
    text: z.string(),
    clear: z.boolean().default(true),
    submit: z.boolean().default(false),
  }),
  async execute(input, ctx) {
    return withPage(ctx, async (page, session) => {
      if (input.clear) {
        await page.fill(input.selector, '', {});
      }
      await page.type(input.selector, input.text, {});
      if (input.submit) {
        await page.evaluate(`document.querySelector(${JSON.stringify(input.selector)})?.closest('form')?.requestSubmit()`);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
      }
      return {
        selector: input.selector,
        typed: input.text.length,
        submitted: input.submit,
        url: page.url(),
        pageErrors: session.pageErrors,
      };
    });
  },
});

export const browserScreenshotTool = defineTool({
  name: 'browser_screenshot',
  description: 'Capture a screenshot of the current page and store it as a project artifact.',
  permission: 'network',
  inputSchema: z.object({
    fullPage: z.boolean().default(false),
    name: z.string().default('screenshot'),
    viewport: z.enum(['desktop', 'tablet', 'mobile']).default('desktop'),
  }),
  async execute(input, ctx) {
    return withPage(ctx, async (page) => {
      const viewports = { desktop: [1280, 800], tablet: [834, 1112], mobile: [390, 844] } as const;
      const [width, height] = viewports[input.viewport];
      await page.setViewportSize({ width, height });
      const buffer = await page.screenshot({ fullPage: input.fullPage });

      const filename = `${Date.now()}-${input.name}-${input.viewport}.png`;
      const storageKey = `projects/${ctx.projectId}/screenshots/${filename}`;
      const absolute = path.join(env.storage.localDir, storageKey);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, buffer);

      return {
        storageKey,
        bytes: buffer.length,
        viewport: input.viewport,
        url: page.url(),
      };
    });
  },
});

/** Close a project's browser session. Called when a run finishes. */
export async function closeBrowserSession(projectId: string): Promise<void> {
  const session = sessions.get(projectId);
  if (!session) return;
  try {
    await session.page.close();
    await session.browser.close();
  } catch {
    /* best effort — the run is ending and the browser will exit with the worker */
  }
  sessions.delete(projectId);
}

export const BROWSER_TOOLS: ErasedTool[] = [
  browserOpenTool,
  browserClickTool,
  browserTypeTool,
  browserScreenshotTool,
];
