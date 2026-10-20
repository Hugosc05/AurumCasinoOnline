import { computeMachineRtp, type SlotMachineDef } from '@aurum/engine';
import { SlotSymbolArt } from './symbols';

const pct = (x: number): string => `${(x * 100).toFixed(2).replace('.', ',')} %`;

/** Etiquetas de las funciones de una máquina (indicadores visibles). */
export function machineFeatures(m: SlotMachineDef): string[] {
  const out: string[] = [];
  const wild = m.symbols.find((s) => s.kind === 'wild');
  if (wild) out.push(m.wildMultiplier > 1 ? `Comodín ×${m.wildMultiplier}` : 'Comodín');
  if (m.symbols.some((s) => s.kind === 'scatter')) out.push('Scatter');
  if (m.freeSpins) out.push(`Giros gratis ×${m.freeSpins.multiplier}`);
  if (m.bonus) out.push('Bono de cofres');
  if (m.groups.length > 0) out.push('Combinación especial');
  return out;
}

/** Tabla de pagos y reglas de una máquina, generada a partir de su definición. */
export function SlotPaytable({ machine: m }: { machine: SlotMachineDef }) {
  const rtp = computeMachineRtp(m);
  const label = (id: string): string => m.symbols.find((s) => s.id === id)?.label ?? id;
  const wild = m.symbols.find((s) => s.kind === 'wild');
  const scatter = m.symbols.find((s) => s.kind === 'scatter');
  return (
    <div className="space-y-4 text-sm text-niebla">
      <table className="w-full">
        <thead><tr className="text-left text-xs"><th className="py-1">Símbolo</th><th className="py-1 text-right">×3</th><th className="py-1 text-right">×4</th><th className="py-1 text-right">×5</th></tr></thead>
        <tbody>
          {Object.entries(m.linePays).slice().reverse().map(([id, pays]) => (
            <tr key={id} className="border-t border-white/5">
              <td className="flex items-center gap-2 py-1"><SlotSymbolArt symbol={id} size={30} /> <span className="text-marfil">{label(id)}</span></td>
              {pays.map((v, i) => <td key={i} className="py-1 text-right tabular-nums text-marfil">{v}</td>)}
            </tr>
          ))}
          {m.groups.map((g) => (
            <tr key={g.id} className="border-t border-white/5">
              <td className="py-1">
                <span className="flex items-center gap-1">{g.symbols.map((sid) => <SlotSymbolArt key={sid} symbol={sid} size={22} />)}</span>
                <span className="text-xs text-marfil">{g.label}</span>
              </td>
              {g.pays.map((v, i) => <td key={i} className="py-1 text-right tabular-nums text-marfil">{v}</td>)}
            </tr>
          ))}
          {scatter && (
            <tr className="border-t border-white/5">
              <td className="flex items-center gap-2 py-1"><SlotSymbolArt symbol={scatter.id} size={30} /> <span className="text-marfil">{scatter.label}</span></td>
              {([3, 4, 5] as const).map((k) => <td key={k} className="py-1 text-right tabular-nums text-marfil">{m.scatterPays[k] ?? 0}× total</td>)}
            </tr>
          )}
        </tbody>
      </table>
      <ul className="list-disc space-y-1 pl-5">
        <li>Pagos por línea sobre la apuesta por línea, de izquierda a derecha y desde el primer rodillo. Se paga la mejor combinación de cada línea.</li>
        {wild && <li>{wild.label}: sustituye a los símbolos normales{m.wildMultiplier > 1 ? ` y multiplica ×${m.wildMultiplier} la línea en la que sustituye` : ''}.</li>}
        {scatter && <li>{scatter.label}: paga en cualquier posición sobre la apuesta total.</li>}
        {m.freeSpins && (
          <li>
            Giros gratis: {Object.entries(m.freeSpins.awards).map(([k, v]) => `${k} estrellas → ${v}`).join(', ')}. Se juegan pulsando el botón, con la misma apuesta y todos los premios ×{m.freeSpins.multiplier}. No se reactivan dentro de los giros gratis.
          </li>
        )}
        {m.bonus && (
          <li>
            Bono de cofres: {m.bonus.minCount} cofres en los rodillos {m.bonus.reels.map((r) => r + 1).join(', ')} abren {m.bonus.prizes.length} cofres; eliges {m.bonus.picks}. Premios de {Math.min(...m.bonus.prizes)} a {Math.max(...m.bonus.prizes)} veces la apuesta total, repartidos por el servidor antes de que elijas.
          </li>
        )}
        <li>Cada tirada es independiente: las rachas anteriores no cambian las probabilidades.</li>
      </ul>
      <p>
        RTP teórico exacto: <span className="text-marfil">{pct(rtp.totalRtp)}</span> (juego base {pct(rtp.baseRtp)}
        {m.freeSpins ? `, giros gratis ${pct(rtp.freeSpinsRtp)}` : ''}{m.bonus ? `, bono ${pct(rtp.bonusRtp)}` : ''}).
        {m.freeSpins && ` Giros gratis en ${pct(rtp.freeSpinsChance)} de las tiradas.`}
        {m.bonus && ` Bono en ${pct(rtp.bonusChance)} de las tiradas.`}
      </p>
    </div>
  );
}
