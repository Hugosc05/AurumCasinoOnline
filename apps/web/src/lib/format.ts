const nf = new Intl.NumberFormat('es-ES');

export const credits = (n: number | null | undefined): string => (n === null || n === undefined ? '∞' : nf.format(n));

export const signed = (n: number): string => (n > 0 ? `+${nf.format(n)}` : nf.format(n));

export function relativeTime(iso: string): string {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 45) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.round(diff / 3600)} h`;
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const GAME_NAMES: Record<string, string> = {
  blackjack: 'Blackjack',
  roulette: 'Ruleta',
  slots: 'Slots',
  poker: 'Póker',
};

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
