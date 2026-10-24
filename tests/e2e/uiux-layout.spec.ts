import { expect, test } from '@playwright/test';

test('empty workspace stays compact at every breakpoint without hiding a solved agenda', async ({ page }) => {
  await page.goto('./');
  for (const width of [320, 390, 844, 1440]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 1000 });
    const grid = page.getByTestId('schedule-grid');
    const box = await grid.boundingBox();
    expect(box?.height).toBeLessThan(550);
    for (const row of await page.locator('.schedule-table.is-empty .schedule-row').all()) await expect(row).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width <= 390) {
      await expect(page.locator('.event-name div > span > b').last()).toBeVisible();
      for (const name of [/^Schedule/, /^Teams/, /^Judges/, /^Rooms/, /^Event setup/]) {
        const button = page.getByRole('button', { name }).first();
        const bounds = await button.boundingBox();
        expect(bounds?.x).toBeGreaterThanOrEqual(0);
        expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width);
      }
    }
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole('button', { name: 'Generate schedule', exact: true }).click();
  await expect(page.getByTestId('team-card')).toHaveCount(12);
  await expect(page.locator('.schedule-row').first()).toBeVisible();
});
