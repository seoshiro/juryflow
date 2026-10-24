// Ready to copy into juryflow/tests/e2e/. Uses the repository's installed runner.
import { test, expect, type Page } from '@playwright/test';

type DocumentValue = {
  project: { name: string; date: string; teams: { name: string; track: string }[]; judges: { name: string; expertise: string }[]; rooms: { name: string }[] };
  schedule: unknown[];
  baseline: unknown[];
};
const stored = (page: Page): Promise<DocumentValue> => page.evaluate(() => JSON.parse(localStorage.getItem('juryflow.document.v1')!));
const nav = (page: Page, name: string) => page.locator('.main-nav button').filter({ hasText: name }).click();

async function expectPlan(page: Page, before: DocumentValue) {
  await expect.poll(async () => (await stored(page)).schedule).toEqual(before.schedule);
  expect((await stored(page)).baseline).toEqual(before.baseline);
}
async function assertReady(page: Page) {
  await nav(page, 'Schedule');
  await expect(page.getByTestId('team-card')).toHaveCount(12);
  await expect(page.getByRole('button', { name: 'Export calendar', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Print schedule', exact: true })).toBeEnabled();
}
test.beforeEach(async ({ page }) => {
  await page.goto('./');
  if ((await page.locator('html').getAttribute('lang')) !== 'en') await page.locator('.language-button').click();
  await page.getByTestId('schedule-action').click();
  await expect(page.getByTestId('team-card')).toHaveCount(12);
});

test('display metadata changes preserve exact assignments and baseline through reload', async ({ page }) => {
  const before = await stored(page);
  await nav(page, 'Event setup');
  await page.getByLabel('Event name', { exact: true }).fill('Renamed operations event');
  await expectPlan(page, before);

  await nav(page, 'Teams');
  await page.getByLabel('Team name 1', { exact: true }).fill('Renamed first team');
  await expectPlan(page, before);
  await page.getByLabel('Track for Renamed first team', { exact: true }).fill('New display track');
  await expectPlan(page, before);
  await page.locator('.constraint-button').first().click();
  await page.getByRole('dialog').getByLabel('Team name', { exact: true }).fill('Renamed in detail dialog');
  await expectPlan(page, before);
  await page.keyboard.press('Escape');

  await nav(page, 'Judges');
  await page.getByLabel('Judge name 1', { exact: true }).fill('Renamed first judge');
  await expectPlan(page, before);
  await page.getByLabel('Expertise for Renamed first judge', { exact: true }).fill('New display expertise');
  await expectPlan(page, before);

  await nav(page, 'Rooms');
  await page.getByLabel('Room name 1', { exact: true }).fill('Renamed first room');
  await expectPlan(page, before);
  await assertReady(page);
  await page.reload();
  await expectPlan(page, before);
  await assertReady(page);
  expect((await stored(page)).project).toMatchObject({
    name: 'Renamed operations event',
    teams: [{ name: 'Renamed in detail dialog', track: 'New display track' }, ...before.project.teams.slice(1)],
    judges: [{ name: 'Renamed first judge', expertise: 'New display expertise' }, ...before.project.judges.slice(1)],
    rooms: [{ name: 'Renamed first room' }, ...before.project.rooms.slice(1)],
  });
});

for (const field of ['event', 'team', 'judge', 'room'] as const) {
  test(`blank ${field} label keeps draft assignments but blocks ready/export until restored`, async ({ page }) => {
    const before = await stored(page);
    const config = {
      event: ['Event setup', 'Event name'],
      team: ['Teams', 'Team name 1'],
      judge: ['Judges', 'Judge name 1'],
      room: ['Rooms', 'Room name 1'],
    }[field];
    await nav(page, config[0]);
    await page.getByLabel(config[1], { exact: true }).fill('');
    await expectPlan(page, before);
    await page.reload();
    await expectPlan(page, before);
    await expect(page.locator('.recovery-banner')).toHaveCount(0);
    await nav(page, 'Schedule');
    await expect(page.getByRole('button', { name: 'Export calendar', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Print schedule', exact: true })).toBeDisabled();
    let downloaded = false;
    page.on('download', () => { downloaded = true; });
    await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/required|valid/i);
    expect(downloaded).toBe(false);
    await nav(page, config[0]);
    await expect(page.getByLabel(config[1], { exact: true })).toHaveValue('');
    await page.getByLabel(config[1], { exact: true }).fill(`Restored ${field} label`);
    await expectPlan(page, before);
    await assertReady(page);
  });
}

test('native five-digit date cannot overwrite the last restorable autosave', async ({ page }) => {
  const before = await stored(page);
  await nav(page, 'Event setup');
  await page.getByLabel('Event date', { exact: true }).fill('10000-01-01');
  await page.getByLabel('Event date', { exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await stored(page)).toEqual(before);
  await page.reload();
  expect(await stored(page)).toEqual(before);
  await expect(page.locator('.recovery-banner')).toHaveCount(0);
  await assertReady(page);
});

test('availability remains an actual constraint and still invalidates the plan', async ({ page }) => {
  const before = await stored(page);
  await nav(page, 'Judges');
  await page.locator('.resource-row').first().getByRole('button', { name: /09:00 available/ }).click();
  await expect.poll(async () => (await stored(page)).schedule).toEqual([]);
  expect((await stored(page)).baseline).toEqual(before.schedule);
  await nav(page, 'Schedule');
  await expect(page.getByRole('button', { name: 'Export calendar', exact: true })).toBeDisabled();
});
