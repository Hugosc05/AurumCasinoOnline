import { expect, test } from '@playwright/test';

test('móvil: portada, menú y tapete vertical sin desbordamiento horizontal', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await expect(page.getByRole('navigation', { name: 'Menú móvil' })).toBeVisible();
});

test('móvil: salón de blackjack, mesa multijugador y bots sin desbordamiento horizontal', async ({ page }) => {
  for (const url of ['/blackjack', '/blackjack/mesa/rubi', '/bots', '/poker']) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, url).toBeLessThanOrEqual(1);
  }
  // En la mesa, observar sin sesión: los asientos libres invitan a sentarse y los bots llevan su etiqueta.
  await page.goto('/blackjack/mesa/rubi');
  await expect(page.getByText('BOT').first()).toBeVisible({ timeout: 10000 });
});
