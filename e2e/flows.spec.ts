import { expect, test, type Page } from '@playwright/test';

let n = 0;
async function register(page: Page): Promise<string> {
  n += 1;
  const username = `e2e${Date.now() % 1e7}${n}`;
  await page.goto('/registro');
  await page.getByLabel('Nombre de usuario').fill(username);
  await page.getByLabel('Correo electrónico').fill(`${username}@example.com`);
  await page.getByLabel('Contraseña', { exact: true }).fill('Password1234');
  await page.getByLabel('Repite la contraseña').fill('Password1234');
  await page.getByRole('button', { name: 'Crear cuenta' }).last().click();
  await expect(page).toHaveURL('/');
  await expect(page.getByLabel(/Saldo: 10\.000/)).toBeVisible();
  return username;
}

/** Desactiva animaciones para que las pruebas sean rápidas (preferencia real del usuario). */
async function fastMode(page: Page): Promise<void> {
  await page.evaluate(() =>
    fetch('/api/me/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'aurum' }, body: JSON.stringify({ animations: 'off', sound: false }) }),
  );
}

async function balance(page: Page): Promise<number> {
  const r = await page.evaluate(() => fetch('/api/auth/me').then((x) => x.json()));
  return r.user.balance as number;
}

test('registro, cierre de sesión e inicio de sesión', async ({ page }) => {
  const username = await register(page);
  await page.getByRole('button', { name: 'Menú de la cuenta' }).click();
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.goto('/perfil');
  await expect(page).toHaveURL(/\/entrar/);
  await page.getByLabel('Usuario o correo electrónico').fill(username);
  await page.getByLabel('Contraseña').fill('Password1234');
  await page.getByRole('button', { name: 'Entrar' }).last().click();
  await expect(page).toHaveURL(/\/perfil/);
  await expect(page.getByRole('heading', { name: username })).toBeVisible();
});

test('ruleta: apostar, girar y liquidar', async ({ page }) => {
  await register(page);
  await fastMode(page);
  await page.goto('/ruleta');
  await page.locator('[data-zone="red"]').click();
  await page.locator('[data-zone="straight:17"]').click();
  await page.getByRole('button', { name: /Girar/ }).click();
  await expect(page.getByText(/Gana|Sin premio|Recuperas/).first()).toBeVisible({ timeout: 15000 });
  const tx = await page.evaluate(() => fetch('/api/me/transactions').then((x) => x.json()));
  expect(tx.items.some((t: { reason: string; amount: number }) => t.reason === 'bet' && t.amount === -50)).toBe(true);
  expect(await balance(page)).toBeGreaterThanOrEqual(0);
  await page.goto('/perfil?tab=historial');
  await expect(page.getByText('Ruleta').first()).toBeVisible();
});

test('blackjack: repartir y jugar una mano completa', async ({ page }) => {
  await register(page);
  await fastMode(page);
  await page.goto('/blackjack');
  await page.locator('[data-chip="25"]').click();
  await page.getByRole('button', { name: /Repartir/ }).click();
  for (let i = 0; i < 6; i += 1) {
    const stand = page.getByRole('button', { name: /Plantarse/ });
    if (await page.getByRole('button', { name: /Repetir/ }).isVisible()) break;
    if (await stand.isVisible() && (await stand.isEnabled())) await stand.click();
    await page.waitForTimeout(500);
  }
  await expect(page.getByRole('button', { name: /Repetir 25/ })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('status').filter({ hasText: /Gana|Pierde|Empate|Blackjack|Se pasa/ }).first()).toBeVisible();
});

test('slots: una tirada cobra la apuesta y muestra el resultado', async ({ page }) => {
  await register(page);
  await fastMode(page);
  await page.goto('/slots');
  await page.locator('button[aria-label^="Girar por"]').click();
  await expect(page.getByText(/Sin premio esta vez|Línea \d+|estrellas/).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Apuesta 20')).toBeVisible();
});

test('póker: sentarse contra bots, ver solo las propias cartas y levantarse', async ({ page }) => {
  await register(page);
  await fastMode(page);
  await page.goto('/poker/esmeralda');
  await page.getByRole('button', { name: 'Sentarse' }).first().click();
  await page.getByRole('button', { name: /Sentarme con/ }).click();
  await expect(page.getByRole('button', { name: 'Levantarse' })).toBeVisible();
  await expect(page.getByText('BOT').first()).toBeVisible({ timeout: 15000 });
  // Aparecen dos cartas propias boca arriba en algún momento de la mano.
  await expect.poll(async () => page.getByRole('img', { name: / de (picas|corazones|diamantes|tréboles)/ }).count(), { timeout: 20000 }).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Levantarse' }).click();
  await expect(page.getByRole('button', { name: 'Sentarse' }).first()).toBeVisible({ timeout: 40000 });
});

test('administración: solo accesible para administradores', async ({ page }) => {
  await register(page);
  await page.goto('/admin');
  await expect(page).toHaveURL('/');
  const r = await page.evaluate(() => fetch('/api/admin/overview').then((x) => x.status));
  expect(r).toBe(403);
  await page.getByRole('button', { name: 'Menú de la cuenta' }).click();
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  await page.goto('/entrar');
  await page.getByLabel('Usuario o correo electrónico').fill('e2eadmin');
  await page.getByLabel('Contraseña').fill('AdminE2E2026');
  await page.getByRole('button', { name: 'Entrar' }).last().click();
  await expect(page.getByLabel('Saldo ilimitado de administrador')).toBeVisible();
  await page.goto('/admin');
  await expect(page.getByText('Créditos en circulación')).toBeVisible();
  await page.goto('/admin/diagnostico');
  await page.getByRole('button', { name: 'Comprobar libro mayor' }).click();
  await expect(page.getByText(/todo cuadra/)).toBeVisible();
});
