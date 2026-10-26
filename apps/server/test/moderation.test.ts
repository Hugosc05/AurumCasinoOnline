import { describe, expect, it } from 'vitest';
import { domainAcceptsMail, emailShapeProblem } from '../src/moderation/email';
import { isOffensive, maskProfanity, normalize } from '../src/moderation/words';
import { registerUser, startServer } from './helpers';
import { Client } from './helpers';

describe('moderación de nombres y chat', () => {
  it('detecta insultos aunque estén camuflados', () => {
    for (const bad of ['puta', 'P.u.t.4', 'HijoDePuta99', 'g1l1p0llas', 'MIERDAAAA', 'xX_n1gg4_Xx', 'fuck_you', 'Hitler88', 'subnormal_', 'maric0n']) {
      expect(isOffensive(bad), bad).toBe(true);
    }
  });

  it('no bloquea nombres inocentes', () => {
    for (const ok of ['Hugo', 'computadora', 'Dickens', 'peacock', 'Mongolia', 'Nigeria', 'Diacono', 'grapefruit', 'pollo_loco', 'skyshot', 'Ana_Lucia']) {
      expect(isOffensive(ok), ok).toBe(false);
    }
  });

  it('el chat tapa las palabrotas y deja el resto', () => {
    expect(maskProfanity('qué mierda de mano')).toBe('qué m***** de mano');
    expect(maskProfanity('Buena jugada!')).toBe('Buena jugada!');
    expect(normalize('Ñoño 4ever')).toBe('nonoaever');
  });
});

describe('correos', () => {
  it('rechaza dominios reservados, desechables y patrones inventados', () => {
    expect(emailShapeProblem('a@a.com')).toBe('fake');
    expect(emailShapeProblem('aaa@hotmail.com')).toBe('fake');
    expect(emailShapeProblem('test@gmail.com')).toBe('fake');
    expect(emailShapeProblem('pepe@gmail.com')).toBe('fake'); // Gmail exige 6 caracteres
    expect(emailShapeProblem('juan@example.com')).toBe('reserved');
    expect(emailShapeProblem('juan@empresa.test')).toBe('reserved');
    expect(emailShapeProblem('juan@yopmail.com')).toBe('disposable');
    expect(emailShapeProblem('juan@mail.mailinator.com')).toBe('disposable');
    expect(emailShapeProblem('hugo.sanchez@gmail.com')).toBeNull();
    expect(emailShapeProblem('dev@pulimentosyparquet.es')).toBeNull();
  });

  it('comprueba que el dominio recibe correo (y no bloquea si la red falla)', async () => {
    const err = (code: string) => () => Promise.reject(Object.assign(new Error(code), { code }));
    expect(await domainAcceptsMail('ok.es', { mx: async () => [{ exchange: 'mx.ok.es' }], a: err('ENODATA') })).toBe(true);
    expect(await domainAcceptsMail('solo-a.es', { mx: err('ENODATA'), a: async () => ['1.2.3.4'] })).toBe(true);
    expect(await domainAcceptsMail('noexiste.es', { mx: err('ENOTFOUND'), a: err('ENOTFOUND') })).toBe(false);
    expect(await domainAcceptsMail('sinred.es', { mx: err('ECONNREFUSED'), a: err('ECONNREFUSED') })).toBeNull();
    expect(await domainAcceptsMail('lento.es', { mx: () => new Promise(() => {}), a: () => new Promise(() => {}) }, 50)).toBeNull();
  });

  it('el registro rechaza nombres ofensivos', async () => {
    const s = await startServer();
    try {
      const c = new Client(s.base);
      const r = await c.post('/api/auth/register', { username: 'putamierda', email: 'x1234567@example.com', password: 'Password123' });
      expect(r.status).toBe(400);
      expect(r.body.error.details.fields.username).toMatch(/no está permitido/);
      expect((await registerUser(s.base)).user.username).toBeTruthy();
    } finally {
      await s.stop();
    }
  });

  it('con la comprobación estricta, el registro rechaza correos falsos', async () => {
    const s = await (await import('./helpers')).startServer(undefined, { EMAIL_STRICT: 'true' });
    try {
      const c = new Client(s.base);
      for (const email of ['a@a.com', 'juan@example.com', 'juan@yopmail.com']) {
        const r = await c.post('/api/auth/register', { username: `u${Math.floor(Math.random() * 1e8)}`, email, password: 'Password123' });
        expect(r.status, email).toBe(400);
        expect(r.body.error.details.fields.email).toBeTruthy();
      }
    } finally {
      await s.stop();
    }
  });
});
