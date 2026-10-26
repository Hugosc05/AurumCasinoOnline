/**
 * Moderación de texto: nombres de usuario y mensajes de chat.
 *
 * El texto se normaliza antes de comparar (minúsculas, sin tildes, «leet»
 * como 4→a o 0→o, sin separadores y sin letras repetidas) para que «P.u.t.4»
 * o «MIERDAAA» no se cuelen. Las listas cubren insultos, odio y contenido
 * sexual explícito en español e inglés; no pretenden ser exhaustivas.
 */

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '€': 'e' };

export function normalize(text: string): string {
  const base = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[01345789@$!|€]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-zñ]/g, '');
  // «puuuuta» → «puta»
  return base.replace(/(.)\1+/g, '$1');
}

/** Raíces que no se admiten en ningún nombre (odio, insultos graves, sexual explícito). */
const BANNED = [
  // español
  'puta', 'puto', 'putit', 'zorra', 'gilipol', 'gilipoy', 'cabron', 'cabrona', 'maricon', 'marica', 'mariquita', 'subnormal', 'retrasad', 'mongolo',
  'polla', 'cojon', 'follar', 'folla', 'chupame', 'chupala', 'mamon', 'mamada', 'pajer', 'hijodeput', 'hdp', 'malparid', 'pendej', 'verga', 'culero',
  'sudaca', 'panchit', 'negrat', 'moro de mierda', 'tortiller', 'bollera', 'travelo', 'violad', 'violar', 'pedofil', 'pederast', 'nazi', 'hitler', 'franco viva', 'kkk',
  'mierda', 'cagon', 'joputa', 'imbecil', 'idiota', 'estupid', 'tonto del culo', 'cerdo asqueroso', 'muerete', 'suicid', 'terroris', 'yihad',
  // inglés
  'fuck', 'fuk', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'nigger', 'nigga', 'fagot', 'faggot', 'retard', 'rapist', 'porn', 'penis', 'vagina', 'dick',
  'cock', 'pussy', 'asshole', 'bastard', 'motherfuck', 'killyourself',
].map(normalize);

/** Palabras que en el chat se tapan con asteriscos (además de las anteriores). */
const MASK_EXTRA = ['joder', 'hostia', 'coñazo', 'capullo', 'payaso', 'basura', 'manco', 'noob'].map(normalize);

/** Excepciones conocidas para no bloquear palabras inocentes («computadora», «Hitchcock»…). */
const ALLOW = ['computa', 'disputa', 'reputa', 'imputa', 'diputad', 'conocer', 'conoc', 'cono de', 'escoces', 'dickens', 'cocker', 'hancock', 'peacock', 'scunthorp', 'polloy', 'pollo', 'nigeria', 'shitake', 'fagot'].map(normalize);

export function isOffensive(text: string): boolean {
  let n = normalize(text);
  for (const a of ALLOW) n = n.split(a).join('_');
  return BANNED.some((w) => w.length >= 3 && n.includes(w)) || (n.length <= 4 && BANNED.includes(n));
}

/** Chat: tapa las palabras malsonantes manteniendo la primera letra («m*****»). */
export function maskProfanity(text: string): string {
  const words = [...BANNED, ...MASK_EXTRA].filter((w) => w.length >= 3);
  return text.replace(/[\p{L}\p{N}@$!|.*_-]+/gu, (tok) => {
    const n = normalize(tok);
    if (ALLOW.some((a) => n.includes(a))) return tok;
    return words.some((w) => n.includes(w)) ? tok[0] + '*'.repeat(Math.max(2, tok.length - 1)) : tok;
  });
}
