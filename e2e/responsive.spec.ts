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
  for (const url of ['/blackjack', '/blackjack/mesa/rubi', '/bots', '/poker', '/bingo', '/bingo/bingo-sol', '/cohete']) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, url).toBeLessThanOrEqual(1);
  }
  // En la mesa, observar sin sesión: los asientos libres invitan a sentarse y los bots llevan su etiqueta.
  await page.goto('/blackjack/mesa/rubi');
  await expect(page.getByText('BOT').first()).toBeVisible({ timeout: 10000 });
});

test('móvil: pintar apuestas con el dedo sobre el tapete vertical', async ({ page }) => {
  const name = `tch${Date.now() % 1e7}`;
  await page.goto('/');
  await page.evaluate(async (n) => {
    await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'aurum' }, body: JSON.stringify({ username: n, email: `${n}@example.com`, password: 'Password1234' }) });
  }, name);
  await page.goto('/ruleta');
  const board = page.getByTestId('roulette-board');
  const c = async (key: string) => {
    const b = (await page.locator(`[data-zone="${key}"]`).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  // En vertical la columna 1, 4, 7… queda en fila: se arrastra a lo largo de ella con eventos táctiles.
  const from = await c('straight:1');
  const to = await c('straight:10');
  const ev = (type: string, p: { x: number; y: number }) => board.dispatchEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true });
  await ev('pointerdown', from);
  for (let i = 1; i <= 10; i += 1) await ev('pointermove', { x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 });
  await ev('pointerup', to);
  await expect(page.getByText('Apuesta total').locator('..')).toContainText('100'); // 1, 4, 7, 10
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
