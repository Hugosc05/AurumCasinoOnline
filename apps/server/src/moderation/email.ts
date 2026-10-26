import { promises as dns } from 'node:dns';

/**
 * Comprobaciones de correo sin enviar mensajes:
 * - dominios reservados para ejemplos o pruebas (example.com, *.test…);
 * - servicios de correo desechable conocidos;
 * - patrones inventados (a@a.com, aaaa@…, dominios de una letra);
 * - el dominio debe existir y aceptar correo (registro MX, o A según el RFC 5321).
 * Si la consulta DNS falla por la red (sin conexión, tiempo agotado) no se
 * bloquea el registro: solo se rechaza cuando el dominio NO existe.
 */

const RESERVED = /(^|\.)(example\.(com|net|org)|test|invalid|localhost|local|example|lan|internal)$/i;

const DISPOSABLE = new Set([
  'mailinator.com', 'yopmail.com', 'yopmail.fr', '10minutemail.com', '10minutemail.net', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', 'grr.la',
  'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmail.net', 'tempmailo.com', 'tempr.email', 'trashmail.com', 'trashmail.de', 'getnada.com', 'nada.email',
  'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com', 'emailondeck.com', 'mohmal.com', 'mail.tm', 'tmpmail.org', 'tmpmail.net',
  'spamgourmet.com', 'mailnesia.com', 'mytemp.email', 'burnermail.io', 'mailcatch.com', 'inboxkitten.com', 'emailfake.com', 'fakemail.net', 'luxusmail.org',
  'mailpoof.com', 'moakt.com', 'tempinbox.com', 'spambox.us', 'trash-mail.com', 'discard.email', 'harakirimail.com', 'mail7.io', '33mail.com', 'anonaddy.me',
]);

/** Mínimos de longitud de los grandes proveedores (Gmail no admite usuarios de menos de 6). */
const MIN_LOCAL: Record<string, number> = { 'gmail.com': 6, 'googlemail.com': 6, 'yahoo.com': 4, 'yahoo.es': 4 };

export type EmailProblem = null | 'reserved' | 'disposable' | 'fake' | 'domain';

export function emailShapeProblem(email: string): EmailProblem {
  const at = email.lastIndexOf('@');
  if (at < 1) return 'fake';
  const local = email.slice(0, at).toLowerCase();
  const domain = email.slice(at + 1).toLowerCase();
  if (RESERVED.test(domain)) return 'reserved';
  if (DISPOSABLE.has(domain) || [...DISPOSABLE].some((d) => domain.endsWith(`.${d}`))) return 'disposable';
  const labels = domain.split('.');
  const sld = labels.length >= 2 ? labels[labels.length - 2]! : '';
  if (sld.length < 2) return 'fake'; // a.com, x.es…
  if (/^(.)\1*$/.test(local.replace(/[._+-]/g, '')) && local.length < 6) return 'fake'; // a, aa, aaa
  if (/^(test|prueba|asdf|qwerty|fake|falso|nada|none|noreply|no-reply)\d*$/.test(local)) return 'fake';
  if ((MIN_LOCAL[domain] ?? 1) > local.replace(/\+.*$/, '').length) return 'fake';
  return null;
}

export type Resolver = { mx: (d: string) => Promise<unknown[]>; a: (d: string) => Promise<unknown[]> };
const realResolver: Resolver = { mx: (d) => dns.resolveMx(d), a: (d) => dns.resolve4(d) };

/** ¿Existe el dominio y acepta correo? `null` = no se pudo saber (se acepta). */
export async function domainAcceptsMail(domain: string, resolver: Resolver = realResolver, timeoutMs = 3000): Promise<boolean | null> {
  const withTimeout = <T,>(p: Promise<T>): Promise<T> => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), timeoutMs))]);
  const missing = (err: unknown): boolean => ['ENOTFOUND', 'ENODATA', 'ENOTIMP', 'ESERVFAIL'].includes((err as { code?: string }).code ?? '');
  try {
    const mx = await withTimeout(resolver.mx(domain));
    if (mx.length > 0) return true;
  } catch (err) {
    if (!missing(err)) return null;
  }
  try {
    const a = await withTimeout(resolver.a(domain));
    return a.length > 0;
  } catch (err) {
    return missing(err) ? false : null;
  }
}

export const EMAIL_MESSAGES: Record<Exclude<EmailProblem, null>, string> = {
  reserved: 'Usa un correo real: ese dominio es solo para ejemplos',
  disposable: 'No se admiten correos temporales o desechables',
  fake: 'Ese correo no parece real',
  domain: 'El dominio del correo no existe o no recibe correo',
};
