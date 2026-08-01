import playwright from 'file:///Users/ziye/Library/Mobile%20Documents/com~apple~CloudDocs/wiki/30-39%20Product%20and%20Web%20Builds/w6/product-web-builds-w6/.claude/worktrees/payload-cms-worktree-specs-5b4eb8/payload-cms/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = playwright;
const baseUrl = 'https://ima-queencard-web.zeabur.app';
const outDir = path.dirname(fileURLToPath(import.meta.url));

const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
];

const routes = [
  { name: 'home', path: '/' },
  { name: 'login', path: '/login' },
  { name: 'generate', path: '/generate' },
  { name: 'pricing', path: '/pricing' },
  { name: 'dashboard', path: '/dashboard' },
  { name: 'api-health', path: '/api/health', screenshot: false },
  { name: 'api-auth-session', path: '/api/auth/session', screenshot: false },
];

const browser = await chromium.launch({ headless: true });
const results = [];

for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  const responses = [];

  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleMessages.push({
        type: message.type(),
        text: message.text().slice(0, 500),
      });
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 500)));
  page.on('response', (response) => {
    const url = response.url();
    if (url.startsWith(baseUrl)) {
      responses.push({
        url,
        status: response.status(),
      });
    }
  });

  for (const route of routes) {
    const url = new URL(route.path, baseUrl).toString();
    const startedAt = Date.now();
    let status = null;
    let title = '';
    let finalUrl = '';
    let bodyText = '';
    let screenshotPath = null;
    let error = null;

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2500);
      status = response?.status() ?? null;
      finalUrl = page.url();
      title = await page.title();
      bodyText = (await page.locator('body').innerText({ timeout: 5000 })).slice(0, 4000);
      if (route.screenshot !== false) {
        screenshotPath = path.join(outDir, `${viewport.name}-${route.name}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
      }
    } catch (err) {
      error = err.message;
      try {
        screenshotPath = path.join(outDir, `${viewport.name}-${route.name}-error.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch {}
    }

    results.push({
      viewport,
      route: route.name,
      path: route.path,
      status,
      finalUrl,
      title,
      durationMs: Date.now() - startedAt,
      screenshotPath,
      error,
      bodyText,
      recentConsole: consoleMessages.slice(-10),
      recentPageErrors: pageErrors.slice(-10),
      failedResponses: responses.filter((r) => r.status >= 400).slice(-20),
    });
  }

  await context.close();
}

await browser.close();

await fs.writeFile(
  path.join(outDir, 'live-smoke-results.json'),
  JSON.stringify({ baseUrl, testedAt: new Date().toISOString(), results }, null, 2),
);

const lines = ['# Live Smoke Results', '', `Base URL: ${baseUrl}`, `Tested at: ${new Date().toISOString()}`, ''];
for (const result of results) {
  lines.push(
    `## ${result.viewport.name} ${result.route}`,
    '',
    `- Path: \`${result.path}\``,
    `- Status: ${result.status ?? 'n/a'}`,
    `- Final URL: ${result.finalUrl || 'n/a'}`,
    `- Duration: ${result.durationMs} ms`,
    `- Screenshot: ${result.screenshotPath ? path.basename(result.screenshotPath) : 'n/a'}`,
    `- Error: ${result.error ?? 'none'}`,
    `- Failed same-origin responses: ${result.failedResponses.length}`,
    '',
  );
}
await fs.writeFile(path.join(outDir, 'live-smoke-results.md'), lines.join('\n'));
