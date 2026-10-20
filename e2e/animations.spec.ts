import { expect, test, type Page } from '@playwright/test';

/**
 * Animaciones reales (sin modo rápido). Se ejecuta contra la versión compilada
 * (`npm run test:e2e`) y contra el servidor de desarrollo con React en modo
 * estricto (`npm run test:e2e:dev`), donde los componentes se montan dos veces:
 * así se detectan errores que solo aparecen al desarrollar, como cartas que se
 * quedaban boca abajo.
 */

let n = 0;
async function register(page: Page): Promise<void> {
  n += 1;
  const username = `anim${Date.now() % 1e7}${n}`;
  await page.goto('/registro');
  await page.getByLabel('Nombre de usuario').fill(username);
  await page.getByLabel('Correo electrónico').fill(`${username}@example.com`);
  await page.getByLabel('Contraseña', { exact: true }).fill('Password1234');
  await page.getByLabel('Repite la contraseña').fill('Password1234');
  await page.getByRole('button', { name: 'Crear cuenta' }).last().click();
  await expect(page.getByLabel(/Saldo: 10\.000/)).toBeVisible();
}

test('blackjack: las cartas repartidas se giran y muestran su valor', async ({ page }) => {
  await register(page);
  await page.goto('/blackjack/individual');
  await page.locator('[data-chip="25"]').click();
  await page.getByRole('button', { name: /Repartir/ }).click();
  // Dos cartas del jugador y la vista del crupier boca arriba (la oculta sigue boca abajo).
  await expect.poll(() => page.locator('[data-face="up"]').count(), { timeout: 8000 }).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole('img', { name: / de (picas|corazones|diamantes|tréboles)$/ }).first()).toBeVisible();
  // Una carta boca arriba contiene la cara dibujada (rango y palo), no el reverso.
  const face = page.locator('[data-face="up"]').first();
  await expect(face.locator('[data-card]')).toHaveCount(1);
  await expect(face.locator('[data-back]')).toHaveCount(0);
});

test('slots: los rodillos arrancan al pulsar, sin esperar, y se puede volver a girar enseguida', async ({ page }) => {
  await register(page);
  await page.goto('/slots/aurum-royale');
  const spin = page.getByRole('button', { name: /Girar por/ });
  await expect(spin).toBeEnabled();
  // En desarrollo, Vite compila módulos al vuelo la primera vez: se espera a que termine.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  // Mide cuánto tarda la primera tira en moverse tras el clic (dentro del navegador).
  await page.evaluate(() => {
    const el = document.querySelector('.reel [style*="translate3d"]') as HTMLElement;
    const start = el.style.transform;
    (window as unknown as { __moved: Promise<number> }).__moved = new Promise((res) => {
      const t0 = performance.now();
      const chk = (): void => {
        if (el.style.transform !== start) res(performance.now() - t0);
        else requestAnimationFrame(chk);
      };
      document.addEventListener('click', () => requestAnimationFrame(chk), { once: true, capture: true });
    });
  });
  await spin.click();
  const moved = await page.evaluate(() => (window as unknown as { __moved: Promise<number> }).__moved);
  expect(moved).toBeLessThan(400);
  // Durante el giro el botón sirve para frenar.
  await expect(page.getByRole('button', { name: 'Frenar los rodillos' })).toBeVisible();
  await page.getByRole('button', { name: 'Frenar los rodillos' }).click();
  await expect(page.getByRole('button', { name: /Girar por/ })).toBeVisible({ timeout: 6000 });
  await expect(page.getByText(/Sin premio esta vez|línea premiada|líneas premiadas|estrellas/).first()).toBeVisible({ timeout: 4000 });
  // Se puede girar otra vez inmediatamente, aunque se esté mostrando el premio.
  await page.getByRole('button', { name: /Girar por/ }).click();
  await expect(page.getByRole('button', { name: 'Frenar los rodillos' })).toBeVisible({ timeout: 1000 });
  await expect(page.getByRole('button', { name: /Girar por/ })).toBeVisible({ timeout: 8000 });
});
