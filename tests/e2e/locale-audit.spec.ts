import { expect, test } from '@playwright/test';
import { demoDocument } from '../../src/demo';

test('changing locale preserves a solver result and localizes its explanation', async ({ page }, testInfo) => {
  const doc = demoDocument();
  doc.project.judges = [];
  doc.project.locks = [];
  for (const team of doc.project.teams) { team.requiredJudgeIds = []; team.excludedJudgeIds = []; }
  doc.schedule = [];
  doc.baseline = [];
  doc.language = 'en';
  await page.addInitScript(value => localStorage.setItem('juryflow.document.v1', JSON.stringify(value)), doc);
  await page.goto('./');
  await page.getByRole('button', { name: /Generate schedule|Replan schedule/ }).click();
  await expect(page.getByTestId('status')).toHaveText('These constraints cannot all be met.');
  await expect(page.getByText('Available judge-slots are fewer', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'EN — Switch to Russian' }).click();
  await expect(page.getByTestId('status')).toContainText('несовместимы');
  await expect(page.getByText('12 КОМАНД. РАСПИСАНИЕ НЕ СОЗДАНО.', { exact: true })).toBeVisible();
  await expect(page.getByText('Доступных судей по слотам меньше', { exact: false })).toBeVisible();
  await expect(page.getByText('Available judge-slots are fewer', { exact: false })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('ru-unsat-after.png'), fullPage: true });
  await page.getByRole('button', { name: 'RU — Переключить на английский' }).click();
  await expect(page.getByTestId('status')).toHaveText('These constraints cannot all be met.');
});

test('locale does not cancel an active worker and explicit cancellation remains usable', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { postMessage() { /* Hold the small request at the worker boundary. */ } };
  });
  await page.goto('./');
  await page.getByRole('button', { name: /Generate schedule|Replan schedule/ }).click();
  await expect(page.getByRole('button', { name: 'Cancel search', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'EN — Switch to Russian' }).click();
  await page.getByRole('button', { name: 'Отменить поиск', exact: true }).click();
  await expect(page.getByTestId('status')).toContainText(/отмен|останов/i);
  await page.screenshot({ path: testInfo.outputPath('cancel-after.png'), fullPage: true });
});

test('worker safety timeout reports unknown rather than infeasible', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { postMessage() { /* Defer response to exercise the existing 5 s deadline. */ } };
  });
  await page.goto('./');
  await page.getByRole('button', { name: /Generate schedule|Replan schedule/ }).click();
  await expect(page.getByTestId('status')).toHaveText('Search limit reached. No conclusion yet.');
  await expect(page.getByText('Search reached its safety limit.', { exact: false })).toBeVisible();
});
