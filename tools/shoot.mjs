/**
 * Screenshot driver.
 *
 * Drives the real application against the real server — no mocked data — and
 * captures both whole screens and individual components. Component shots are
 * taken by locating the element and clipping to it, so what lands in the file
 * is what the app actually renders.
 */

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.env.CONJECTURE_URL ?? 'http://127.0.0.1:4319';
const OUT = process.env.SHOT_DIR ?? 'screenshots';
const SCALE = 2;

async function shoot(page, name, locator, padding = 0) {
  const target = locator ? page.locator(locator).first() : null;
  if (target) {
    await target.waitFor({ state: 'visible', timeout: 15_000 });
    // An element below the fold has a box outside the viewport, and clipping to
    // it silently produces an empty image. Bring it into view first.
    await target.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const box = await target.boundingBox();
    if (!box) throw new Error(`no box for ${locator}`);
    await page.screenshot({
      path: `${OUT}/${name}.png`,
      clip: {
        x: Math.max(0, box.x - padding),
        y: Math.max(0, box.y - padding),
        width: box.width + padding * 2,
        height: box.height + padding * 2,
      },
    });
  } else {
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }
  process.stdout.write(`  ${name}.png\n`);
}

async function settle(page, ms = 450) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(ms);
}

/** Clear toasts so they do not sit on top of the component being captured. */
async function dismissNotices(page) {
  for (let i = 0; i < 6; i += 1) {
    const notice = page.locator('button:has-text("Counterexample found"), button:has-text("candidates")').last();
    if ((await notice.count()) === 0) break;
    await notice.click({ timeout: 1000 }).catch(() => undefined);
    await page.waitForTimeout(80);
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: SCALE,
  });

  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(String(error)));

  // ── workspace ─────────────────────────────────────────────────────────
  await page.goto(`${BASE}/#/`, { waitUntil: 'domcontentloaded' });
  await settle(page, 1200);

  await shoot(page, '01-workspace');
  await shoot(page, 'c-library', '.col:first-child');
  await shoot(page, 'c-chrome', '.bar');
  await shoot(page, 'c-statusbar', '.foot');

  // A claim with a real hole in it: statement, gap count and steps.
  await page.getByRole('button', { name: /Tail bound for f/ }).click();
  await settle(page);
  await shoot(page, '02-workspace-inprogress');
  await shoot(page, 'c-statement', '.col:nth-child(2)');
  await shoot(page, 'c-evidence', '.col:nth-child(3)');

  // A refuted claim.
  await page.getByRole('button', { name: /Euler/ }).click();
  await settle(page);
  await shoot(page, '03-workspace-refuted');
  await shoot(page, 'c-witness', '.card--bad');

  // A claim decided by exhaustion.
  await page.getByRole('button', { name: /Collatz/ }).click();
  await settle(page);
  await shoot(page, '04-workspace-exhaustion');

  // ── command palette ───────────────────────────────────────────────────
  await page.keyboard.press('Control+k');
  await settle(page, 300);
  await shoot(page, 'c-palette', '.palette');
  await page.keyboard.press('Escape');
  await settle(page, 200);

  // ── trust ladder ──────────────────────────────────────────────────────
  await page.goto(`${BASE}/#/trust`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '05-trust');
  await shoot(page, 'c-ladder', '.ladder');
  await shoot(page, 'c-voice', '.grid2');
  await shoot(page, 'c-failures', 'table.tbl');

  // ── dependency graph ──────────────────────────────────────────────────
  await page.goto(`${BASE}/#/graph`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '06-graph');

  // ── bench: run a real search and capture the result ───────────────────
  await page.goto(`${BASE}/#/bench`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '07-bench-empty');

  await page.goto(`${BASE}/#/`, { waitUntil: 'domcontentloaded' });
  await settle(page, 600);
  await page.getByRole('button', { name: /Euler/ }).click();
  await settle(page, 300);
  await page.goto(`${BASE}/#/bench`, { waitUntil: 'domcontentloaded' });
  await settle(page, 800);
  await page.getByRole('button', { name: 'Run the search' }).click();
  await page.waitForSelector('.tbl', { timeout: 30_000 });
  await settle(page, 700);
  await shoot(page, '08-bench-witness');
  await dismissNotices(page);
  await shoot(page, 'c-bench-outcome', '.card--bad');
  await shoot(page, 'c-trace', '.tbl');
  await shoot(page, 'c-search-config', '.page__in > div > div:first-child');

  // ── connect ───────────────────────────────────────────────────────────
  await page.goto(`${BASE}/#/connect`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '09-connect');

  // ── share cards ───────────────────────────────────────────────────────
  // Navigate via the in-app control so the card is for the selected claim; a
  // fresh page load would reset the selection to the first claim in the list.
  for (const [name, claim] of [
    ['10-share', /Tail bound for f/],
    ['11-share-exhaustion', /Collatz/],
  ]) {
    await page.goto(`${BASE}/#/`, { waitUntil: 'domcontentloaded' });
    await settle(page, 700);
    await page.getByRole('button', { name: claim }).click();
    await settle(page, 300);
    await page.getByRole('button', { name: 'Share card' }).click();
    await settle(page, 500);
    await shoot(page, name);
    await shoot(page, `c-sharecard-${name.startsWith('10') ? 'progress' : 'exhaustion'}`, '[data-testid="share-card"]', 8);
  }

  await browser.close();

  if (problems.length > 0) {
    process.stdout.write(`\nconsole problems (${problems.length}):\n`);
    for (const problem of problems.slice(0, 12)) process.stdout.write(`  ${problem}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('\nno console errors\n');
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
