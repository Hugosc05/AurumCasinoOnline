import { expect, test, type Browser, type Page } from '@playwright/test';

async function newUser(browser: Browser, prefix: string): Promise<{ page: Page; name: string }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const name = `${prefix}${Date.now() % 1e7}`;
  await page.goto('/');
  const status = await page.evaluate(async (n) => {
    const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'aurum' }, body: JSON.stringify({ username: n, email: `${n}@example.com`, password: 'Password1234' }) });
    return r.status;
  }, name);
  expect(status).toBe(201);
  await page.reload();
  return { page, name };
}

test('amigos: buscar, enviar solicitud, notificación, aceptar y ver la presencia real', async ({ browser }) => {
  const a = await newUser(browser, 'amiA');
  const b = await newUser(browser, 'amiB');
  await a.page.goto('/amigos');
  await a.page.getByTestId('friend-search').fill(b.name);
  await a.page.getByTestId('search-results').getByRole('button', { name: 'Añadir' }).click();
  await expect(a.page.getByTestId('outgoing')).toContainText(b.name);

  // B recibe la notificación en tiempo real y acepta.
  await expect(b.page.getByTestId('notification-bell')).toHaveAttribute('aria-label', /1 sin leer/, { timeout: 10000 });
  await b.page.goto('/amigos');
  await b.page.getByRole('button', { name: `Aceptar a ${a.name}` }).click();
  await expect(b.page.getByTestId('friend-list')).toContainText(a.name);

  // A ve a B conectado (los dos tienen la app abierta).
  await a.page.reload();
  await expect(a.page.getByTestId('friend-list')).toContainText(b.name);
  await expect(a.page.getByTestId('presence').first()).toHaveText('Disponible', { timeout: 10000 });

  // B se hace invisible: A deja de ver su actividad.
  await b.page.getByTestId('invisible-toggle').check();
  await expect(a.page.getByTestId('presence').first()).toHaveText('Desconectado', { timeout: 10000 });
});
