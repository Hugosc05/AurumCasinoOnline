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

test('salas privadas: crear, entrar con código, ver miembros y cerrar', async ({ browser }) => {
  const host = await newUser(browser, 'salaH');
  const guest = await newUser(browser, 'salaG');

  // Sin código no se ve la sala.
  await host.page.goto('/poker');
  await host.page.getByRole('button', { name: 'Crear sala privada' }).click();
  await expect(host.page).toHaveURL(/\/salas\?crear=poker/);
  await host.page.getByTestId('room-name').fill('Partida del jueves');
  await host.page.getByTestId('room-create-submit').click();
  await expect(host.page).toHaveURL(/\/salas\/[\w-]+$/);
  const roomUrl = new URL(host.page.url()).pathname;
  const code = (await host.page.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  await guest.page.goto(roomUrl);
  await expect(guest.page.getByText('No perteneces a esta sala')).toBeVisible();
  // Un código erróneo no sirve.
  await guest.page.goto('/salas');
  await guest.page.getByTestId('room-code-input').fill('ZZZZ-ZZZZ');
  await guest.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(guest.page).toHaveURL(/\/salas$/);
  await guest.page.getByTestId('room-code-input').fill(code.toLowerCase());
  await guest.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(guest.page).toHaveURL(new RegExp(`${roomUrl}$`));
  await expect(guest.page.getByTestId('room-members')).toContainText(host.name);
  await expect(guest.page.getByTestId('room-members')).toContainText(`${guest.name} (tú)`);

  // El anfitrión ve llegar al invitado y cierra la sala.
  await expect(host.page.getByTestId('room-members')).toContainText(guest.name, { timeout: 10000 });
  await host.page.getByTestId('close-room').click();
  await host.page.getByRole('dialog').getByRole('button', { name: 'Cerrar sala' }).click();
  await expect(host.page.getByTestId('room-closed')).toBeVisible();
  await expect(guest.page.getByTestId('room-closed')).toBeVisible({ timeout: 10000 });
});
