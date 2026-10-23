import { test, expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, writeFile } from 'node:fs/promises';
import type { Assignment, Project, SavedDocument } from '../../src/types';

/** Independent assertion oracle: deliberately does not import the solver. */
function assertSchedule(project: Project, schedule: Assignment[]) {
  expect(schedule).toHaveLength(project.teams.length);
  expect(new Set(schedule.map(a => a.teamId)).size).toBe(project.teams.length);
  const rooms = new Set<string>();
  const judges = new Set<string>();
  for (const assignment of schedule) {
    const team = project.teams.find(t => t.id === assignment.teamId);
    const room = project.rooms.find(r => r.id === assignment.roomId);
    expect(team).toBeDefined();
    expect(room).toBeDefined();
    expect(Number.isInteger(assignment.slot)).toBeTruthy();
    expect(assignment.slot).toBeGreaterThanOrEqual(0);
    expect(assignment.slot).toBeLessThan(project.slotCount);
    expect(team!.availableSlots).toContain(assignment.slot);
    expect(room!.availableSlots).toContain(assignment.slot);
    expect(assignment.judgeIds).toHaveLength(team!.judgeCount);
    expect(new Set(assignment.judgeIds).size).toBe(assignment.judgeIds.length);
    for (const id of team!.requiredJudgeIds) expect(assignment.judgeIds).toContain(id);
    for (const id of team!.excludedJudgeIds) expect(assignment.judgeIds).not.toContain(id);
    const roomKey = `${assignment.slot}:${assignment.roomId}`;
    expect(rooms.has(roomKey)).toBeFalsy();
    rooms.add(roomKey);
    for (const id of assignment.judgeIds) {
      const judge = project.judges.find(j => j.id === id);
      expect(judge).toBeDefined();
      expect(judge!.availableSlots).toContain(assignment.slot);
      const judgeKey = `${assignment.slot}:${id}`;
      expect(judges.has(judgeKey)).toBeFalsy();
      judges.add(judgeKey);
    }
  }
  for (const lock of project.locks) {
    const match = schedule.find(a => a.teamId === lock.teamId);
    expect(match).toEqual(lock);
  }
}

async function exportJSON(page: Page): Promise<SavedDocument> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  return JSON.parse(await readFile(path!, 'utf8')) as SavedDocument;
}

async function importJSON(page: Page, value: unknown) {
  await page.getByLabel('Import JSON', { exact: true }).setInputFiles({
    name: 'juryflow-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  });
}

async function solve(page: Page) {
  await page.getByRole('button', { name: 'Generate schedule', exact: true }).click();
  await expect(page.getByTestId('team-card')).toHaveCount(12);
}

async function assertAccessible(page: Page, stage: string, testInfo: TestInfo) {
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await writeFile(testInfo.outputPath(`axe-${stage}.json`), JSON.stringify(scan.violations, null, 2));
  expect(scan.violations.map(v => ({ id: v.id, count: v.nodes.length, selectors: v.nodes.map(n => n.target.join(' ')) }))).toEqual([]);
}

const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('./');
});
test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });

test('real demo, outage replan, independent constraints, persistence and calendar export', async ({ page }) => {
  await solve(page);
  const before = await exportJSON(page);
  expect(before.schemaVersion).toBe(1);
  expect(before.project.teams).toHaveLength(12);
  expect(before.project.judges).toHaveLength(3);
  expect(before.project.rooms).toHaveLength(2);
  assertSchedule(before.project, before.schedule);
  for (const team of before.project.teams) await expect(page.getByTestId('schedule-grid')).toContainText(team.name);

  await page.getByRole('button', { name: 'Simulate judge outage', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm judge outage', exact: true }).click();
  const disrupted = await exportJSON(page);
  expect(disrupted.schedule).toHaveLength(0);
  expect(disrupted.project.judges).not.toEqual(before.project.judges);
  await page.getByRole('button', { name: 'Replan schedule', exact: true }).click();
  await expect(page.getByTestId('team-card')).toHaveCount(12);
  const after = await exportJSON(page);
  assertSchedule(after.project, after.schedule);
  const changes = after.schedule.filter(a => {
    const original = before.schedule.find(b => b.teamId === a.teamId)!;
    return a.slot !== original.slot || a.roomId !== original.roomId ||
      [...a.judgeIds].sort().join() !== [...original.judgeIds].sort().join();
  });
  expect(changes.length).toBeGreaterThan(0);
  expect(changes.length).toBeLessThan(12);
  await page.reload();
  await expect(page.getByTestId('team-card')).toHaveCount(12);
  const restored = await exportJSON(page);
  expect(restored.schedule).toEqual(after.schedule);
  expect(restored.project).toEqual(after.project);

  const calendarPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export calendar', exact: true }).click();
  const calendar = await calendarPending;
  expect(calendar.suggestedFilename()).toMatch(/\.ics$/);
  const ics = await readFile((await calendar.path())!, 'utf8');
  expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(12);
  for (const team of after.project.teams) expect(ics).toContain(team.name);
  expect(ics).toContain('DTSTART:');
});

test('rejects invalid JSON/schema and does not replace the current project', async ({ page }) => {
  const before = await exportJSON(page);
  for (const invalid of ['{broken', { schemaVersion: 99 }, { ...before, project: { ...before.project, slotMinutes: -1 } }]) {
    await importJSON(page, invalid);
    await expect(page.getByRole('alert')).toBeVisible();
    const after = await exportJSON(page);
    expect(after.project).toEqual(before.project);
  }
});

test('imports an unsatisfiable project with an honest infeasibility explanation', async ({ page }) => {
  const doc = await exportJSON(page);
  doc.project.judges.forEach(j => { j.availableSlots = []; });
  doc.schedule = [];
  doc.baseline = [];
  await importJSON(page, doc);
  await page.getByRole('button', { name: 'Generate schedule', exact: true }).click();
  await expect(page.getByTestId('status')).toContainText(/infeasible|no valid|cannot|could not|conflict/i);
  await expect(page.getByTestId('team-card')).toHaveCount(0);
  await expect(page.getByTestId('status')).not.toContainText(/minimal|optimal/i);
});

test('keyboard operation, accessible structure, and narrow agenda without overflow', async ({ page }, testInfo) => {
  await page.keyboard.press('Tab');
  const first = page.locator(':focus');
  await expect(first).toBeVisible();
  await page.getByRole('button', { name: 'Generate schedule', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('team-card')).toHaveCount(12);
  await assertAccessible(page, 'desktop', testInfo);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('schedule-grid')).toBeVisible();
  await expect(page.getByRole('navigation')).toBeHidden();
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('team-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await assertAccessible(page, 'mobile', testInfo);
});

test('valid imported lock remains fixed through generation', async ({ page }) => {
  await solve(page);
  const doc = await exportJSON(page);
  const lock = structuredClone(doc.schedule[0]);
  doc.project.locks = [lock];
  doc.schedule = [];
  doc.baseline = [];
  await importJSON(page, doc);
  await page.getByRole('button', { name: 'Generate schedule', exact: true }).click();
  await expect(page.getByTestId('team-card')).toHaveCount(12);
  const after = await exportJSON(page);
  assertSchedule(after.project, after.schedule);
  expect(after.schedule.find(a => a.teamId === lock.teamId)).toEqual(lock);
});

test('locks through the real UI, edits a constraint, invalidates and replans', async ({ page }) => {
  await solve(page);
  const before = await exportJSON(page);
  const selected = before.schedule.find(a => !before.project.locks.some(l => l.teamId === a.teamId))!;
  const team = before.project.teams.find(t => t.id === selected.teamId)!;
  await page.getByTestId('team-card').filter({ hasText: team.name }).click();
  await page.getByLabel('Lock assignment', { exact: true }).check();
  await expect(page.getByLabel('Lock assignment', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const locked = await exportJSON(page);
  expect(locked.project.locks).toContainEqual(selected);
  assertSchedule(locked.project, locked.schedule);

  await page.getByRole('button', { name: 'Event setup', exact: true }).click();
  await page.getByLabel('Minutes per pitch', { exact: true }).fill('20');
  const edited = await exportJSON(page);
  expect(edited.project.slotMinutes).toBe(20);
  expect(edited.schedule).toEqual([]);
  expect(edited.baseline).toEqual(before.schedule);
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await page.getByRole('button', { name: 'Replan schedule', exact: true }).click();
  await expect(page.getByTestId('team-card')).toHaveCount(12);
  const after = await exportJSON(page);
  assertSchedule(after.project, after.schedule);
  expect(after.schedule.find(a => a.teamId === selected.teamId)).toEqual(selected);
});

test('preserves an unfinished local draft after reload while JSON import stays strict', async ({ page }) => {
  await page.getByRole('button', { name: /^Teams/ }).click();
  await page.getByLabel('Team name 1', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Event setup', exact: true }).click();
  await page.getByLabel('Event name', { exact: true }).fill('');
  await page.getByLabel('Event date', { exact: true }).fill('');
  await page.getByLabel('Start time', { exact: true }).fill('');
  await page.reload();
  await page.getByRole('button', { name: /^Teams/ }).click();
  await expect(page.getByLabel('Team name 1', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Event setup', exact: true }).click();
  await expect(page.getByLabel('Event name', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Event date', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Start time', { exact: true })).toHaveValue('');
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('juryflow.document.v1')!)) as SavedDocument;
  expect(draft.project.teams).toHaveLength(12);
  expect(draft.project.name).toBe('');
  expect(draft.project.teams[0].name).toBe('');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/complete required event fields/i);
  await importJSON(page, draft);
  await expect(page.getByRole('alert')).toBeVisible();
  const stillDraft = await page.evaluate(() => JSON.parse(localStorage.getItem('juryflow.document.v1')!)) as SavedDocument;
  expect(stillDraft.project).toEqual(draft.project);
});

test('all editors and the team dialog are keyboard accessible', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: /^Teams/ }).click();
  await assertAccessible(page, 'teams-editor', testInfo);
  await page.getByRole('button', { name: 'Constraints for Orbit Notes', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await assertAccessible(page, 'team-dialog', testInfo);
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBeTruthy();
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const view of [/^Judges/, /^Rooms/, /^Event setup$/]) {
    await page.getByRole('button', { name: view }).click();
    await assertAccessible(page, view.source.replace(/\W/g, ''), testInfo);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.setViewportSize({ width: 1280, height: 720 });
  }
});

test('print keeps a column for every configured room', async ({ page }) => {
  const doc = await exportJSON(page);
  doc.project.rooms.push({ id: 'room-c', name: 'Forum C', availableSlots: Array.from({ length: doc.project.slotCount }, (_, i) => i) });
  await importJSON(page, doc);
  await solve(page);
  await page.emulateMedia({ media: 'print' });
  const columns = await page.locator('.grid-header').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(4);
  await expect(page.getByTestId('schedule-grid')).toContainText('Forum C');
});

test('Russian language persists on reload, updates the document language and remains usable', async ({ page }) => {
  await page.getByRole('button', { name: 'Switch to Russian', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Идеи');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('button', { name: 'Расписание', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Generate schedule', exact: true }).click();
  await expect(page.getByTestId('team-card')).toHaveCount(12);
  await expect(page.getByTestId('status')).toContainText('Всё готово');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Переключить на английский', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('status')).toContainText('All clear');
});
