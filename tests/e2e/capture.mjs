import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { URL, fileURLToPath } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const output = new URL('../../docs/screenshots/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173');
  await page.getByRole('button', { name: 'Generate schedule', exact: true }).click();
  await page.getByTestId('team-card').nth(11).waitFor();
  const before = await page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('juryflow.document.v1')));
  await page.screenshot({ path: fileURLToPath(new URL('schedule-desktop.png', output)), fullPage: true });
  await page.getByRole('button', { name: 'Simulate judge outage', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm judge outage', exact: true }).click();
  await page.getByRole('button', { name: 'Replan schedule', exact: true }).click();
  await page.getByTestId('team-card').nth(11).waitFor();
  const after = await page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('juryflow.document.v1')));
  await page.screenshot({ path: fileURLToPath(new URL('replan-desktop.png', output)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: fileURLToPath(new URL('mobile-agenda.png', output)), fullPage: true });
  const changed = after.schedule.filter(a => {
    const b = before.schedule.find(x => x.teamId === a.teamId);
    return a.slot !== b.slot || a.roomId !== b.roomId || [...a.judgeIds].sort().join() !== [...b.judgeIds].sort().join();
  }).map(a => after.project.teams.find(t => t.id === a.teamId).name);
  const evidence = { source: page.url(), capturedAt: new Date().toISOString(), teamCount: after.schedule.length, changedTeams: changed, unchangedCount: after.schedule.length - changed.length, browserErrors: errors };
  await writeFile(new URL('capture-evidence.json', output), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
