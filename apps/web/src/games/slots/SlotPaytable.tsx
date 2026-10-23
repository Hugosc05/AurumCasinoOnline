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
  if (m.extras) out.push('Hold & Win', 'Gran rueda', 'Caja fuerte', 'Botes Mini · Menor · Mayor · Grand');
  return out;
}

/** Tabla de pagos y reglas de una máquina, generada a partir de su definición. */
export function SlotPaytable({ machine: m }: { machine: SlotMachineDef }) {
  const rtp = computeMachineRtp(m);
  const label = (id: string): string => m.symbols.find((s) => s.id === id)?.label ?? id;
  const wild = m.symbols.find((s) => s.kind === 'wild');
  const scatter = m.symbols.find((s) => s.kind === 'scatter');
  const x = m.extras;
  const oneIn = (p: number): string => `1 de cada ${Math.round(1 / p).toLocaleString('es-ES')} tiradas`;
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
          {scatter && Object.keys(m.scatterPays).length > 0 && (
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
        {scatter && Object.keys(m.scatterPays).length > 0 && <li>{scatter.label}: paga en cualquier posición sobre la apuesta total.</li>}
        {x && (
          <>
            <li><SlotSymbolArt symbol={x.holdWin.symbol} size={18} /> <strong className="text-marfil">Hold & Win</strong>: {x.holdWin.trigger} o más billetes visibles. Los billetes se quedan fijos y tienes {x.holdWin.respins} re-giros; cada billete nuevo los devuelve a {x.holdWin.respins}. Cobras la suma de todos los billetes (de 1 a 10 veces la apuesta, o un bote). Si llenas las 15 casillas, ganas además el Grand. Sale en {oneIn(rtp.holdWinChance)}.</li>
            <li><SlotSymbolArt symbol={x.wheel.symbol} size={18} /> <strong className="text-marfil">La gran rueda</strong>: {x.wheel.minCount} ruedas en cualquier posición. El sector ganador se fija al activarse; la rueda solo lo muestra. Sale en {oneIn(rtp.wheelChance)}.</li>
            <li><SlotSymbolArt symbol={x.safe.symbol} size={18} /> <strong className="text-marfil">Caja fuerte</strong>: {x.safe.minCount} cajas en los rodillos {x.safe.reels.map((r) => r + 1).join(', ')}. Abres cajas hasta encontrar tres iguales y ganas ese bote. Sale en {oneIn(rtp.safeChance)}.</li>
            <li><strong className="text-marfil">Botes</strong>: Mini {x.jackpots.mini}×, Menor {x.jackpots.minor}× y Mayor {x.jackpots.major}× la apuesta total. El Grand es progresivo y compartido por todos los jugadores: cada apuesta aporta el {(x.jackpots.grandContribution * 100).toLocaleString('es-ES')} % y se paga entero apostando {x.jackpots.grandRefBet.toLocaleString('es-ES')} o más (con menos, la parte proporcional). Probabilidad de Grand: {oneIn(rtp.grandChance)}.</li>
          </>
        )}
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
        {m.freeSpins ? `, giros gratis ${pct(rtp.freeSpinsRtp)}` : ''}{m.bonus ? `, bono ${pct(rtp.bonusRtp)}` : ''}
        {x ? `, Hold & Win ${pct(rtp.holdWinRtp)}, rueda ${pct(rtp.wheelRtp)}, caja fuerte ${pct(rtp.safeRtp)}; más el Grand` : ''}).
        {m.freeSpins && ` Giros gratis en ${pct(rtp.freeSpinsChance)} de las tiradas.`}
        {m.bonus && ` Bono en ${pct(rtp.bonusChance)} de las tiradas.`}
      </p>
    </div>
  );
}
