import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { SavedDocument } from '../../src/types';

declare global {
  interface Window {
    releaseAuditImport?: () => void;
    auditImportWaiting?: boolean;
    auditImportFinished?: boolean;
  }
}

const KEY = 'juryflow.document.v1';
const generation = /^(Generate schedule|Replan schedule|Regenerate|Сгенерировать|Перепланировать|Сгенерировать заново)(?:\s*↗)?$/;
const importJSON = (page: Page, value: unknown, name = 'repair-fixture.json') => page.getByLabel('Import JSON', { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });
async function stored(page: Page): Promise<SavedDocument> { return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY); }
async function exportJSON(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await pending;
  const source = await readFile((await download.path())!, 'utf8');
  return { source, value: JSON.parse(source) as SavedDocument };
}
async function solve(page: Page, count = 12) {
  await page.getByRole('button', { name: generation }).click();
  await expect(page.getByTestId('team-card')).toHaveCount(count);
}
async function waitForPaint(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }
const unexpectedErrors = new WeakMap<Page, { page: string[]; console: string[] }>();
test.beforeEach(async ({ page }) => {
  const errors = { page: [] as string[], console: [] as string[] };
  unexpectedErrors.set(page, errors);
  page.on('pageerror', error => errors.page.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.console.push(message.text()); });
  await page.goto('./');
  await expect.poll(async () => page.evaluate(key => !!localStorage.getItem(key), KEY)).toBe(true);
});
test.afterEach(async ({ page }, testInfo) => {
  const errors = unexpectedErrors.get(page) ?? { page: [], console: [] };
  await writeFile(testInfo.outputPath('browser-errors.json'), JSON.stringify(errors, null, 2));
  expect(errors.page).toEqual([]);
  // Worker-network failure below is deliberately induced. Its expected console message
  // is asserted in that test; unrelated errors are never ignored.
  if (!testInfo.title.includes('UI-03')) expect(errors.console).toEqual([]);
});

test('UI-01: sequential numeric typing preserves the intended value and commits on blur or Enter', async ({ page }) => {
  await page.getByRole('button', { name: 'Event setup', exact: true }).click();
  const minutes = page.getByLabel('Minutes per pitch', { exact: true });
  await minutes.focus(); await minutes.press('ControlOrMeta+A'); await minutes.pressSequentially('20');
  await expect(minutes).toHaveValue('20');
  await minutes.press('Tab');
  await expect.poll(async () => (await stored(page)).project.slotMinutes).toBe(20);
  const slots = page.getByLabel('Number of slots', { exact: true });
  await slots.focus(); await slots.press('ControlOrMeta+A'); await slots.pressSequentially('20');
  expect((await stored(page)).project.slotCount).toBe(8);
  await slots.press('Enter');
  await expect.poll(async () => (await stored(page)).project.slotCount).toBe(20);
  await minutes.focus(); await minutes.press('ControlOrMeta+A'); await minutes.pressSequentially('121'); await minutes.press('Enter');
  expect((await stored(page)).project.slotMinutes).toBe(20);
  await expect(minutes).toHaveAttribute('aria-invalid', 'true');
  await minutes.press('ControlOrMeta+A'); await minutes.pressSequentially('25'); await minutes.press('Enter');
  await expect.poll(async () => (await stored(page)).project.slotMinutes).toBe(25);
  await page.reload();
  expect((await stored(page)).project.slotMinutes).toBe(25);
});

test('SEC-01: original 523 KB metadata fixture canonicalizes before replacement and survives export/reload', async ({ page }) => {
  const source = await readFile(new URL('../fixtures/unknown-metadata.json', import.meta.url), 'utf8');
  expect(Buffer.byteLength(source)).toBe(522631);
  await importJSON(page, source);
  await expect(page.getByText('Audit retention fixture', { exact: true })).toBeVisible();
  const imported = await stored(page);
  expect('auditMetadata' in imported.project).toBe(false);
  const exported = await exportJSON(page);
  expect(Buffer.byteLength(exported.source)).toBeLessThanOrEqual(2_000_000);
  expect(exported.value).toEqual(imported);
  await page.reload();
  await expect(page.getByText('Audit retention fixture', { exact: true })).toBeVisible();
  expect(await stored(page)).toEqual(exported.value);
  await importJSON(page, exported.source);
  expect((await exportJSON(page)).value).toEqual(exported.value);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('SEC-01: UTF-8 source byte limit rejects oversized imports before replacing the event', async ({ page }) => {
  const before = await stored(page);
  const tooLarge = { ...before, project: { ...before.project, auditMetadata: 'я'.repeat(1_000_000) } };
  const source = JSON.stringify(tooLarge);
  expect(source.length).toBeLessThan(2_000_000);
  expect(Buffer.byteLength(source)).toBeGreaterThan(2_000_000);
  await importJSON(page, source);
  await expect(page.getByRole('alert')).toContainText(/2 MB|2,000,000|2000000/i);
  expect(await stored(page)).toEqual(before);
});

test('SEC-02: native full quota preserves corrupt raw through reload/edit and provides exact recovery download', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const before = await page.evaluate(key => {
    const value = JSON.parse(localStorage.getItem(key)!); value.project.name = 'Audit recovery failure';
    const raw = JSON.stringify(value, null, 2).slice(0, -1); localStorage.setItem(key, raw);
    let ballast = '';
    try { for (let i = 0; i < 1000; i++) { ballast += 'x'.repeat(10000); localStorage.setItem('audit.ballast', ballast); } } catch { /* Real native quota reached. */ }
    ballast = localStorage.getItem('audit.ballast')!;
    try { for (let i = 0; i < 100; i++) { ballast += 'x'.repeat(100); localStorage.setItem('audit.ballast', ballast); } } catch { /* Fill native remainder. */ }
    let copyError = '';
    try { localStorage.setItem('juryflow.recovery.v1', raw); } catch (e) { copyError = (e as DOMException).name; }
    return { raw, copyError, ballastChars: localStorage.getItem('audit.ballast')!.length };
  }, KEY);
  expect(before.copyError).toBe('QuotaExceededError');
  expect(before.ballastChars).toBeGreaterThan(1_000_000);
  await page.reload();
  await expect(page.locator('.recovery-banner')).toContainText('Your saved data needs recovery');
  const recoveryScan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await writeFile(testInfo.outputPath('axe-recovery.json'), JSON.stringify(recoveryScan.violations, null, 2));
  expect(recoveryScan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(before.raw);
  const downloadPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recovery data', exact: true }).click();
  const download = await downloadPending;
  expect(await readFile((await download.path())!, 'utf8')).toBe(before.raw);
  await page.getByRole('button', { name: 'Event setup', exact: true }).click();
  await page.getByLabel('Event name', { exact: true }).fill('Unsaved editing must not overwrite recovery');
  await waitForPaint(page);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(before.raw);
  await page.reload();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(before.raw);
  const replacement = JSON.parse(await readFile(new URL('../fixtures/comma-panel-replan.json', import.meta.url), 'utf8')) as SavedDocument;
  replacement.project.name = 'Explicit recovery replacement'; replacement.baseline = [];
  page.once('dialog', dialog => dialog.dismiss());
  await importJSON(page, replacement);
  await waitForPaint(page);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(before.raw);
  page.once('dialog', dialog => dialog.accept());
  await importJSON(page, replacement);
  await expect(page.getByText('Explicit recovery replacement', { exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).project.name).toBe('Explicit recovery replacement');
  await page.reload();
  expect((await stored(page)).project.name).toBe('Explicit recovery replacement');
  await expect(page.locator('.recovery-banner')).toHaveCount(0);
  await writeFile(testInfo.outputPath('native-quota.json'), JSON.stringify({ corruptRawChars: before.raw.length, nativeBallastChars: before.ballastChars, actualCopyError: before.copyError, exactRawDownload: true, confirmedReplacementPersists: true }, null, 2));
});

for (const action of ['newer import', 'reset', 'edit'] as const) {
  test(`ALG-01: delayed File.text cannot overwrite a ${action}`, async ({ page }) => {
    await page.evaluate(() => {
      const original = File.prototype.text;
      File.prototype.text = async function () {
        const text = await original.call(this);
        if (this.name === 'slow-a.json') {
          await new Promise<void>(resolve => { window.releaseAuditImport = resolve; window.auditImportWaiting = true; });
          window.auditImportFinished = true;
        }
        return text;
      };
    });
    const original = await stored(page); const slow = structuredClone(original); slow.project.name = 'Slow event A';
    await importJSON(page, slow, 'slow-a.json');
    await page.waitForFunction(() => window.auditImportWaiting === true);
    let expected: string;
    if (action === 'newer import') { const next = structuredClone(original); next.project.name = 'Newer event B'; await importJSON(page, next, 'fast-b.json'); expected = 'Newer event B'; await expect(page.getByText(expected, { exact: true })).toBeVisible(); }
    else if (action === 'reset') { page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Reset demo', exact: true }).click(); expected = 'Frontier / Demo Day'; }
    else { await page.getByRole('button', { name: 'Event setup', exact: true }).click(); await page.getByLabel('Event name', { exact: true }).fill('Newer document edit'); expected = 'Newer document edit'; }
    await page.evaluate(() => window.releaseAuditImport?.());
    await page.waitForFunction(() => window.auditImportFinished === true);
    await waitForPaint(page);
    expect((await stored(page)).project.name).toBe(expected);
    await page.reload();
    expect((await stored(page)).project.name).toBe(expected);
  });
}

for (const close of ['Escape', 'Done', 'Close details'] as const) {
  test(`UI-02: ${close} restores the schedule dialog opener`, async ({ page }) => {
    await solve(page);
    const opener = page.getByTestId('team-card').filter({ hasText: 'Orbit Notes' });
    await opener.focus(); await opener.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    if (close === 'Escape') await page.keyboard.press('Escape'); else await page.getByRole('dialog').getByRole('button', { name: close, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(opener).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await page.locator(':focus').getAttribute('class')).not.toContain('skip-link');
  });
}

test('UI-02: editor dialog restores its opener and a removed schedule opener has a logical focus fallback', async ({ page }) => {
  await page.getByRole('button', { name: /^Teams/ }).click();
  const editorOpener = page.getByRole('button', { name: /constraints for Orbit Notes/i });
  await editorOpener.focus(); await editorOpener.press('Enter'); await page.keyboard.press('Escape');
  await expect(editorOpener).toBeFocused();
  await page.getByRole('button', { name: 'Schedule', exact: true }).click(); await solve(page);
  await page.getByTestId('team-card').filter({ hasText: 'Orbit Notes' }).click();
  await page.getByRole('dialog').getByLabel('Team name', { exact: true }).fill('Edited team');
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('#main-content')).toBeFocused();
});

test('ALG-02: comma-containing valid judge IDs show the changed panel rather than an unchanged assignment', async ({ page }) => {
  const fixture = await readFile(new URL('../fixtures/comma-panel-replan.json', import.meta.url), 'utf8');
  await importJSON(page, fixture); await expect(page.getByText('Synthetic Audit', { exact: true })).toBeVisible(); await solve(page, 1);
  await expect(page.getByRole('tab', { name: /^Changes/ })).toContainText('1');
  await expect(page.locator('.pitch-card.changed')).toHaveCount(1);
  const value = await stored(page);
  expect([...value.schedule[0].judgeIds].sort()).toEqual(['a,b', 'c']);
  await page.getByRole('tab', { name: /^Changes/ }).click();
  await expect(page.getByText('The current plan keeps every previous assignment.', { exact: true })).toHaveCount(0);
  await expect(page.locator('.change-row')).toContainText('Judge 0');
  await expect(page.locator('.change-row')).toContainText('Judge 2');
});

test('UI-04: visible commands and accessible names agree in EN/RU states and the Russian dialog is translated', async ({ page }, testInfo) => {
  await solve(page);
  await expect(page.getByRole('button', { name: /^Regenerate(?:\s*↗)?$/ })).toContainText('Regenerate');
  await page.getByRole('button', { name: /Switch to Russian/ }).click();
  await expect(page.getByRole('button', { name: /^Сгенерировать заново(?:\s*↗)?$/ })).toContainText('Сгенерировать заново');
  await expect(page.getByRole('button', { name: /Судья недоступен/ })).toContainText('Судья недоступен');
  await page.getByTestId('team-card').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).not.toContainText('Changes save on this device.');
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Готово', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Название команды', { exact: true })).toBeVisible();
  const dialogScan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await writeFile(testInfo.outputPath('axe-russian-dialog.json'), JSON.stringify(dialogScan.violations, null, 2));
  expect(dialogScan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Судья недоступен/ }).click();
  await expect(page.getByRole('button', { name: /Подтвердить/ })).toBeVisible();
  await page.getByRole('button', { name: /Подтвердить/ }).click();
  await expect(page.getByRole('button', { name: /^Перепланировать(?:\s*↗)?$/ })).toContainText('Перепланировать');
});

test('UI-03: worker startup failure dismisses and a later successful retry works', async ({ page }, testInfo) => {
  const workerRoute = '**/assets/scheduler.worker-*.js';
  await page.route(workerRoute, route => route.abort());
  await page.getByRole('button', { name: generation }).click();
  await expect(page.getByRole('alert')).toContainText(/worker could not start/i);
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.unroute(workerRoute);
  await solve(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const errors = unexpectedErrors.get(page) ?? { page: [], console: [] };
  expect(errors.console.filter(message => !/^Failed to load resource: net::ERR_FAILED$/.test(message))).toEqual([]);
  expect(errors.page).toEqual([]);
  await writeFile(testInfo.outputPath('induced-worker-error.json'), JSON.stringify({ deliberatelyAbortedWorkerRequest: true, observedErrors: errors, dismissSucceeded: true, retrySucceeded: true }, null, 2));
});

test('UI-05: 320 px status gives text a readable width and places actions on a separate row', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 }); await solve(page);
  const copy = await page.locator('.status-copy').boundingBox(); const action = await page.locator('.status-actions').boundingBox();
  expect(copy!.width).toBeGreaterThanOrEqual(180);
  expect(copy!.height).toBeLessThan(170);
  expect(action!.y).toBeGreaterThanOrEqual(copy!.y + copy!.height - 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('status-320.png'), fullPage: true });
  await writeFile(testInfo.outputPath('status-320.json'), JSON.stringify({ viewport: 320, text: copy, actions: action }, null, 2));
});
