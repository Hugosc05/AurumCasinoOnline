import { z } from 'zod';
import type { BalanceView } from '../wallet/wallet';
import type { UserRow } from './sessions';

export interface Preferences {
  sound: boolean;
  volume: number;
  music: boolean;
  /** Banda sonora del salón (baja de volumen dentro de los juegos). */
  soundtrack: boolean;
  musicVolume: number;
  animations: 'full' | 'reduced' | 'off';
  effects: 'full' | 'reduced' | 'off';
  /** Asistente de manos de póker. */
  pokerAssist: 'beginner' | 'standard' | 'advanced';
  /** Aparecer como desconectado ante los amigos. */
  invisible: boolean;
  /** Mostrar recordatorio de independencia de resultados. */
  showOddsNotes: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  // El sonido está desactivado hasta que el usuario lo habilite.
  sound: false,
  volume: 0.6,
  music: false,
  soundtrack: true,
  musicVolume: 0.35,
  animations: 'full',
  effects: 'full',
  pokerAssist: 'beginner',
  invisible: false,
  showOddsNotes: true,
};

export const preferencesSchema = z.object({
  sound: z.boolean().optional(),
  volume: z.number().min(0).max(1).optional(),
  music: z.boolean().optional(),
  soundtrack: z.boolean().optional(),
  musicVolume: z.number().min(0).max(1).optional(),
  animations: z.enum(['full', 'reduced', 'off']).optional(),
  effects: z.enum(['full', 'reduced', 'off']).optional(),
  pokerAssist: z.enum(['beginner', 'standard', 'advanced']).optional(),
  invisible: z.boolean().optional(),
  showOddsNotes: z.boolean().optional(),
}).strict();

export function readPrefs(json: string): Preferences {
  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(json));
    return { ...DEFAULT_PREFERENCES, ...(parsed.success ? parsed.data : {}) };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  role: 'player' | 'admin';
  createdAt: string;
  balance: number | null;
  unlimited: boolean;
  preferences: Preferences;
}

export function toPublicUser(u: UserRow): PublicUser {
  const bal: BalanceView = u.role === 'admin' ? { balance: null, unlimited: true } : { balance: u.balance, unlimited: false };
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    createdAt: u.created_at,
    ...bal,
    preferences: readPrefs(u.prefs_json),
  };
}

/** Anonimiza un nombre para la actividad pública: "Valentina" → "Va•••na". */
export function anonymize(username: string): string {
  if (username.length <= 3) return `${username[0] ?? '?'}•••`;
  return `${username.slice(0, 2)}•••${username.slice(-2)}`;
}

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Mínimo 3 caracteres')
  .max(20, 'Máximo 20 caracteres')
  .regex(/^[A-Za-z0-9_.-]+$/, 'Solo letras, números, punto, guion y guion bajo')
  .refine((v) => !/^bot[\s_.-]?/i.test(v), 'Los nombres que empiezan por "bot" están reservados');

export const passwordSchema = z
  .string()
  .min(10, 'Mínimo 10 caracteres')
  .max(128, 'Máximo 128 caracteres')
  .refine((v) => /[A-Za-zÀ-ÿ]/.test(v) && /\d/.test(v), 'Debe incluir letras y números');

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('Correo electrónico no válido'));
