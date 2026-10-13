import { expect, test } from '@playwright/test';

test('móvil: portada, menú y tapete vertical sin desbordamiento horizontal', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await expect(page.getByRole('navigation', { name: 'Menú móvil' })).toBeVisible();
});
