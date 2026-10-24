// Ready to copy into juryflow/tests/e2e/ after the review/cancel UI is integrated.
import { test, expect, type Page } from '@playwright/test';
import type { SavedDocument } from '../../src/types';

const stored = (page: Page): Promise<SavedDocument> => page.evaluate(() => JSON.parse(localStorage.getItem('juryflow.document.v1')!));
const nav = (page: Page, text: string) => page.locator('.main-nav button').filter({ hasText: text }).click();

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  if ((await page.locator('html').getAttribute('lang')) !== 'en') await page.locator('.language-button').click();
  await page.getByTestId('schedule-action').click();
  await expect(page.getByTestId('team-card')).toHaveCount(12);
});

test('Reset demo reviews destructive replacement; Cancel/Escape preserve work and confirmation restores demo', async ({ page }) => {
  const original = await stored(page);
  await nav(page, 'Event setup');
  await page.getByLabel('Event name', { exact: true }).fill('Custom event that must survive cancellation');
  await expect.poll(async () => (await stored(page)).project.name).toBe('Custom event that must survive cancellation');
  const before = await stored(page);
  const opener = page.getByRole('button', { name: 'Reset demo', exact: true });
  const dialog = page.getByRole('dialog');

  await opener.focus(); await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  expect(await stored(page)).toEqual(before);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await stored(page)).toEqual(before);

  await opener.click(); await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await stored(page)).toEqual(before);

  await opener.click();
  await dialog.getByRole('button', { name: /^(Restore demo|Reset demo)$/, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).project.name).toBe(original.project.name);
  const after = await stored(page);
  expect(after.project).toEqual(original.project);
  expect(after.schedule).toEqual([]);
  expect(after.baseline).toEqual([]);
  await expect(opener).toBeFocused();
});

for (const kind of ['team', 'judge', 'room'] as const) {
  test(`Delete ${kind} reviews and cancels safely; confirmed removal cleans references and restores useful focus`, async ({ page }) => {
    await page.getByTestId('team-card').first().click();
    await page.getByRole('dialog').getByLabel('Lock assignment', { exact: true }).check();
    await page.keyboard.press('Escape');
    const before = await stored(page);
    const lock = before.project.locks[0];
    expect(lock).toBeDefined();
    const list = kind === 'team' ? before.project.teams : kind === 'judge' ? before.project.judges : before.project.rooms;
    const id = kind === 'team' ? lock.teamId : kind === 'judge' ? lock.judgeIds[0] : lock.roomId;
    const item = list.find(value => value.id === id)!;
    await nav(page, kind === 'team' ? 'Teams' : kind === 'judge' ? 'Judges' : 'Rooms');
    const opener = page.getByRole('button', { name: `Delete ${kind} ${item.name}`, exact: true });
    const dialog = page.getByRole('dialog');
    await opener.focus(); await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(item.name);
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    expect(await stored(page)).toEqual(before);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await stored(page)).toEqual(before);

    await opener.click(); await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    expect(await stored(page)).toEqual(before);

    await opener.click();
    await dialog.getByRole('button', { name: /^Delete(?:\s|$)/ }).click();
    await expect(dialog).toHaveCount(0);
    const after = await stored(page);
    const remaining = kind === 'team' ? after.project.teams : kind === 'judge' ? after.project.judges : after.project.rooms;
    expect(remaining).toHaveLength(list.length - 1);
    expect(remaining.some(value => value.id === id)).toBe(false);
    expect(after.schedule).toEqual([]);
    expect(after.baseline).toEqual(before.schedule);
    expect(after.project.locks.some(value => kind === 'team' ? value.teamId === id : kind === 'judge' ? value.judgeIds.includes(id) : value.roomId === id)).toBe(false);
    if (kind === 'judge') {
      expect(after.project.teams.some(value => [...value.requiredJudgeIds, ...value.excludedJudgeIds].includes(id))).toBe(false);
    }
    await expect(page.locator('#main-content')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('#main-content') !== null)).toBe(true);
  });
}
