import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Códigos de un solo uso basados en tiempo (TOTP, RFC 6238), compatibles con
 * Google Authenticator, Microsoft Authenticator, Authy, 1Password…
 * HMAC-SHA1, 6 dígitos, pasos de 30 s.
 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SEC = 30;

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('Secreto base32 no válido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Secreto nuevo de 160 bits (lo recomendado por el RFC para SHA-1). */
export const generateSecret = (): string => base32Encode(randomBytes(20));

/** Código HOTP para un contador (RFC 4226). */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms: number): number => Math.floor(ms / 1000 / TOTP_STEP_SEC);

export function totp(secretB32: string, ms = Date.now(), digits = 6): string {
  return hotp(base32Decode(secretB32), stepAt(ms), digits);
}

/**
 * Comprueba un código admitiendo ±1 paso de desfase de reloj. Devuelve el paso
 * que coincide (para impedir reutilizar el mismo código) o null.
 * Rechaza pasos <= `lastStep` (código ya usado).
 */
export function verifyTotp(secretB32: string, code: string, lastStep = 0, ms = Date.now()): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const key = base32Decode(secretB32);
  const now = stepAt(ms);
  for (const step of [now, now - 1, now + 1]) {
    if (step <= lastStep) continue;
    const expected = Buffer.from(hotp(key, step));
    if (timingSafeEqual(expected, Buffer.from(clean))) return step;
  }
  return null;
}

/** Dirección otpauth:// que leen las apps al escanear el QR. */
export function otpauthUri(secretB32: string, account: string, issuer = 'Aurum Casino'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SEC}`;
}

/** Códigos de recuperación de un solo uso (formato XXXX-XXXX). Se guardan solo sus hashes. */
export function generateRecoveryCodes(n = 8): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: n }, () => {
    const bytes = randomBytes(8);
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

export const hashRecoveryCode = (code: string): string =>
  createHash('sha256').update(code.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
