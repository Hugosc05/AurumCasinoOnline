/** Color de la bola según la decena (como en las bolas de las salas). Compartido por el bombo 3D y la interfaz 2D. */
export const BALL_COLORS = ['#d7263d', '#f4a62a', '#1b75bc', '#2a9d4b', '#7b2fbe', '#e05a9b', '#14a3a3', '#f26b1d', '#4a4f5c', '#b8862e'];
export const ballColor = (n: number): string => BALL_COLORS[Math.min(9, Math.floor(n / 10))]!;
