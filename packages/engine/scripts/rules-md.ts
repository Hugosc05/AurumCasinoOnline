/* Genera en Markdown la sección de slots de GAME_RULES.md a partir de las definiciones del motor. */
import { SLOT_MACHINES, computeMachineRtp } from '../src/slotMachines';

const pct = (x: number): string => `${(x * 100).toFixed(2).replace('.', ',')} %`;
const out: string[] = [];
for (const m of SLOT_MACHINES) {
  const r = computeMachineRtp(m);
  const label = (id: string): string => m.symbols.find((s) => s.id === id)?.label ?? id;
  out.push(`### ${m.name}`, '', `${m.tagline}`, '');
  out.push(`5 × 3, ${m.limits.allowedLines.join(', ')} líneas activables. Apuesta por línea: ${m.limits.minBetPerLine} a ${m.limits.maxBetPerLine}.`, '');
  out.push('| Símbolo | ×3 | ×4 | ×5 |', '| --- | ---: | ---: | ---: |');
  for (const [id, p] of Object.entries(m.linePays)) out.push(`| ${label(id)} | ${p[0]} | ${p[1]} | ${p[2]} |`);
  for (const g of m.groups) out.push(`| ${g.label} | ${g.pays[0]} | ${g.pays[1]} | ${g.pays[2]} |`);
  out.push('');
  if (m.wildMultiplier > 1) out.push(`- El comodín multiplica ×${m.wildMultiplier} las líneas en las que sustituye.`);
  const sc = Object.entries(m.scatterPays);
  if (sc.length) out.push(`- Scatter en cualquier posición: ${sc.map(([n, x]) => `${n} pagan ${x}×`).join(', ')} la apuesta total.`);
  if (m.freeSpins) out.push(`- Giros gratis: ${Object.entries(m.freeSpins.awards).map(([n, g]) => `${n} scatters dan ${g}`).join(', ')}, con premios ×${m.freeSpins.multiplier}. Se juegan con la apuesta de la tirada que los activó, sin cobrar, y no se reactivan.`);
  if (m.bonus) out.push(`- Bono de cofres: ${m.bonus.minCount} símbolos ${label(m.bonus.symbol)} (rodillos ${m.bonus.reels.map((x) => x + 1).join(', ')}) abren ${m.bonus.prizes.length} cofres; eliges ${m.bonus.picks}. Los premios (${m.bonus.prizes.slice().sort((a, b) => a - b).join(', ')} × apuesta total) se fijan y barajan en el servidor al activarse; los cofres sin abrir no se envían al navegador.`);
  out.push('', '| RTP | Valor |', '| --- | ---: |', `| Juego base (líneas${sc.length ? ' + scatter' : ''}) | ${pct(r.baseRtp)} |`);
  if (m.freeSpins) out.push(`| Giros gratis (prob. ${pct(r.freeSpinsChance)} por tirada) | ${pct(r.freeSpinsRtp)} |`);
  if (m.bonus) out.push(`| Bono (prob. ${pct(r.bonusChance)} por tirada) | ${pct(r.bonusRtp)} |`);
  out.push(`| **Total** | **${pct(r.totalRtp)}** |`, '');
}
console.log(out.join('\n'));
