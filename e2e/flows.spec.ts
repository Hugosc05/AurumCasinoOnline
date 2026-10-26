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
  await page.getByTestId('roulette-spin').click();
  // Nunca gira sin confirmar: primero aparece el resumen.
  await expect(page.getByTestId('confirm-list').locator('li')).toHaveCount(2);
  await page.getByTestId('confirm-spin').click();
  await expect(page.getByText(/Gana|Sin premio|Recuperas/).first()).toBeVisible({ timeout: 15000 });
  const tx = await page.evaluate(() => fetch('/api/me/transactions').then((x) => x.json()));
  expect(tx.items.some((t: { reason: string; amount: number }) => t.reason === 'bet' && t.amount === -50)).toBe(true);
  expect(await balance(page)).toBeGreaterThanOrEqual(0);
  await page.goto('/perfil?tab=historial');
  await expect(page.getByText('Ruleta').first()).toBeVisible();
});

test('ruleta: pintar apuestas arrastrando, deshacer el trazo, guardar y cargar una formación', async ({ page }) => {
  await register(page);
  await fastMode(page);
  await page.goto('/ruleta');
  const center = async (key: string) => {
    const b = (await page.locator(`[data-zone="${key}"]`).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const a = await center('straight:3');
  const b = await center('straight:12');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.move(a.x, a.y, { steps: 6 }); // volver por encima no duplica
  await page.mouse.up();
  await expect(page.getByText('Apuesta total').locator('..')).toContainText('100'); // 4 plenos × 25
  // Deshacer quita el trazo entero.
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.getByText('Apuesta total').locator('..')).toHaveText(/Apuesta total\s*0\s*$/);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.getByTestId('save-formation').click();
  await page.getByLabel('Nombre').fill('Fila superior');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByTestId('formation-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Limpiar mesa' }).click();
  await expect(page.getByText('Apuesta total').locator('..')).toHaveText(/Apuesta total\s*0\s*$/);
  // Cargar coloca las fichas, pero no apuesta: el saldo no cambia hasta confirmar.
  await page.getByTestId('formation-item').getByRole('button', { name: 'Cargar' }).click();
  await expect(page.getByText('Apuesta total').locator('..')).toContainText('100');
  expect(await balance(page)).toBe(10000);
  await page.reload();
  await expect(page.getByTestId('formation-item')).toContainText('Fila superior');
});

test('blackjack: repartir y jugar una mano completa', async ({ page }) => {
  await register(page);
  await fastMode(page);
  await page.goto('/blackjack/individual');
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

test('blackjack multijugador: elegir mesa, sentarse, apostar y jugar contra el crupier', async ({ page }) => {
  await register(page);
  await fastMode(page);
  await page.goto('/blackjack');
  await expect(page.getByText('Demo con bots').first()).toBeVisible();
  await page.getByTestId('bj-table-nacar').getByRole('button', { name: /Unirse/ }).click();
  await expect(page).toHaveURL(/\/blackjack\/mesa\/nacar/);
  await page.getByTestId('sit-0').click();
  await expect(page.getByTestId('seat-0')).toContainText('TÚ');
  await page.locator('[data-chip="25"]').click();
  await expect(page.getByTestId('pending-bet')).toHaveText('25');
  await page.getByTestId('confirm-bet').click();
  await expect(page.getByLabel(/Saldo: 9\.?975 /)).toBeVisible();
  for (let i = 0; i < 30; i += 1) {
    if ((await page.getByTestId('bj-status').innerText()).includes('terminada')) break;
    const stand = page.getByRole('button', { name: /Plantarse/ });
    if (await stand.isEnabled()) await stand.click();
    await page.waitForTimeout(500);
  }
  await expect(page.getByTestId('bj-status')).toContainText(/terminada|Apuestas/, { timeout: 15000 });
  await page.getByRole('button', { name: /Levantarse/ }).click();
  await expect(page.getByTestId('sit-0')).toBeVisible();
});

test('recompensa diaria: se reclama una vez, muestra la cuenta atrás; sin proveedor no hay anuncios', async ({ page }) => {
  await register(page);
  await page.goto('/promociones');
  await expect(page.getByTestId('ads-card')).toContainText('Los anuncios recompensados no están disponibles en este entorno.');
  await page.getByTestId('claim-daily').click();
  await expect(page.getByText('Reclamada hoy')).toBeVisible();
  await expect(page.getByTestId('daily-countdown')).toHaveText(/^\d\d:\d\d:\d\d$/);
  await expect(page.getByLabel(/Saldo: 11\.000/)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('claim-daily')).toHaveCount(0);
});

test('slots: una tirada cobra la apuesta y muestra el resultado', async ({ page }) => {
  await register(page);
  await fastMode(page);
  await page.goto('/slots/aurum-royale');
  await page.locator('button[aria-label^="Girar por"]').click();
  await expect(page.getByText(/Sin premio esta vez|Línea \d+|estrellas/).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('session-stats')).toContainText(/Apostado\s*20/);
});

test('slots: elegir máquina, ver su tabla de premios y girar sin giros automáticos', async ({ page }) => {
  await register(page);
  await fastMode(page);
  await page.goto('/slots');
  await page.getByTestId('machine-tesoro-arrecife').getByRole('button', { name: 'Jugar' }).click();
  await expect(page).toHaveURL(/\/slots\/tesoro-arrecife/);
  await expect(page.getByText('Bono de cofres').first()).toBeVisible();
  await page.getByRole('button', { name: /Tabla de premios/ }).click();
  await expect(page.getByRole('dialog')).toContainText('RTP teórico exacto');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Giro automático|Detener/ })).toHaveCount(0);
  await page.locator('button[aria-label^="Girar por"]').click();
  await expect(page.getByTestId('slot-history').locator('li')).toHaveCount(1, { timeout: 10000 });
  await expect(page.getByTestId('session-stats')).toContainText('Tiradas');
  // Tras la tirada no empieza otra sola.
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('slot-history').locator('li')).toHaveCount(1);
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

test('plinko: lanzar bolas cobra la apuesta y suma los premios al caer', async ({ page }) => {
  await register(page);
  await fastMode(page);
  await page.goto('/plinko');
  await page.getByTestId('plinko-bet').fill('10');
  await page.getByRole('radio', { name: '5' }).click();
  const before = await balance(page);
  await page.getByTestId('plinko-drop').click();
  await expect(page.getByLabel('Últimos resultados').locator('span')).toHaveCount(5, { timeout: 10000 });
  const r = await page.evaluate(() => fetch('/api/me/history?game=plinko').then((x) => x.json()));
  const paid = (r.items as { payout: number }[]).reduce((a, b) => a + b.payout, 0);
  expect(await balance(page)).toBe(before - 50 + paid);
  await expect(page.getByLabel(/Saldo: /)).toContainText(new Intl.NumberFormat('es-ES').format(before - 50 + paid));
});

test('cohete: apostar en la ronda compartida y ver la apuesta en la lista', async ({ page }) => {
  await register(page);
  await page.goto('/cohete');
  const action = page.getByTestId('crash-action');
  await expect(action).toHaveText(/^Apostar/, { timeout: 30000 });
  await page.getByTestId('crash-amount').fill('25');
  const before = await balance(page);
  await action.click();
  await expect(page.getByTestId('crash-bets').getByText('Tú')).toBeVisible();
  expect(await balance(page)).toBe(before - 25);
  // Al despegar, el botón pasa a cobrar (o la ronda ya terminó si se estrelló enseguida).
  await expect(action).toHaveText(/^(Cobrar|Siguiente|Espera)/, { timeout: 15000 });
});

test('bingo: comprar cartones en una sala pública y verlos con la cuenta atrás', async ({ page }) => {
  await register(page);
  await page.goto('/bingo');
  await page.getByTestId('bingo-room-bingo-luna').getByRole('button', { name: 'Entrar en la sala' }).click();
  await expect(page).toHaveURL(/\/bingo\/bingo-luna/);
  await expect(page.getByTestId('bingo-buy-button')).toBeVisible({ timeout: 15000 });
  const before = await balance(page);
  await page.getByRole('button', { name: 'Más' }).click();
  await page.getByTestId('bingo-buy-button').click();
  await expect(page.getByTestId('bingo-card')).toHaveCount(3);
  await expect(page.getByTestId('bingo-status')).toContainText('empieza en');
  expect(await balance(page)).toBe(before - 150);
  // Cada cartón tiene 15 números.
  const nums = await page.getByTestId('bingo-card').first().locator('.grid > div').evaluateAll((els) => els.filter((e) => /\d/.test(e.textContent ?? '')).length);
  expect(nums).toBe(15);
});

test('recompensas: misiones, compra y apertura de una caja con su animación, y equipar un objeto', async ({ page }) => {
  await register(page);
  await page.goto('/recompensas');
  await expect(page.getByRole('region', { name: 'Misiones diarias' }).locator('li')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Misiones semanales' }).locator('li')).toHaveCount(5);
  await page.goto('/recompensas?tab=tienda');
  const before = await balance(page);
  await page.getByTestId('buy-bronce').click();
  await expect(page.getByTestId('case-opener')).toBeVisible();
  await expect(page.getByTestId('case-result')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('case-close').click();
  const inv = await page.evaluate(() => fetch('/api/rewards/inventory').then((r) => r.json()));
  const tx = await page.evaluate(() => fetch('/api/me/transactions').then((r) => r.json()));
  const reward = (tx.items as { reason: string; amount: number }[]).filter((t) => t.reason === 'case_reward').reduce((a, t) => a + t.amount, 0);
  expect(await balance(page)).toBe(before - 500 + reward);
  if (inv.items.length > 0) {
    const item = inv.items[0];
    await page.goto('/recompensas?tab=inventario');
    await page.getByTestId(`item-${item.id}`).click();
    await expect(page.getByTestId(`item-${item.id}`)).toContainText('EQUIPADO');
  }
});

test('chat de mesa y tarjeta de jugador desde la partida', async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  const nameA = await register(a);
  await register(b);
  for (const p of [a, b]) await p.goto('/cohete');
  await a.getByTestId('chat-open').click();
  await a.getByTestId('chat-input').fill('¡Hola desde el cohete!');
  await a.getByTestId('chat-input').press('Enter');
  await b.getByTestId('chat-open').click();
  await expect(b.getByTestId('table-chat')).toContainText('¡Hola desde el cohete!');
  await b.getByTestId('table-chat').getByRole('button', { name: new RegExp(nameA) }).click();
  await expect(b.getByTestId('player-card')).toContainText(nameA);
  await b.getByTestId('player-add-friend').click();
  await expect(b.getByTestId('player-card')).toContainText('Solicitud enviada');
});
