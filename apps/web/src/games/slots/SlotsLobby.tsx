import { SLOT_MACHINES, computeMachineRtp, machineStrips } from '@aurum/engine';
import { useNavigate } from 'react-router-dom';
import { GameHeader } from '../../components/GameKit';
import { Badge, Button } from '../../components/ui';
import { cx } from '../../lib/format';
import { machineFeatures } from './SlotPaytable';
import { SlotSymbolArt } from './symbols';

const CARD_THEME: Record<string, string> = {
  'aurum-royale': 'from-[#1c2747] to-[#070b16] border-oro/40',
  'tesoro-arrecife': 'from-[#0b4a5e] to-[#03141e] border-[#7ff0e4]/40',
  'vegas-nights': 'from-[#3a0f3f] to-[#08030c] border-[#ff8be6]/40',
};

/** Selección de máquina: cada una con su temática, símbolos y funciones. */
export default function SlotsLobby() {
  const nav = useNavigate();
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <GameHeader title="Tragaperras" subtitle="Elige máquina. Cada una tiene sus propios símbolos, tabla de premios y funciones especiales." />
      <div className="grid gap-6 md:grid-cols-2">
        {SLOT_MACHINES.map((m) => {
          const rtp = computeMachineRtp(m);
          // Vista previa: los símbolos de mayor premio de la propia máquina.
          const preview = Object.keys(m.linePays).slice(-4).reverse();
          const strip = machineStrips(m)[2]!;
          return (
            <article key={m.id} className={cx('relative overflow-hidden rounded-[32px] border bg-gradient-to-b p-6 shadow-hondo', CARD_THEME[m.id])} data-testid={`machine-${m.id}`}>
              <div className="mx-auto flex w-fit gap-1.5 rounded-2xl border border-white/10 bg-black/30 p-2" aria-hidden>
                {preview.map((sym) => (
                  <div key={sym} className="grid h-16 w-16 place-items-center rounded-xl bg-white/90"><SlotSymbolArt symbol={sym} size={52} /></div>
                ))}
              </div>
              <h2 className="mt-5 text-3xl text-marfil">{m.name}</h2>
              <p className="text-sm text-niebla">{m.theme} · {m.tagline}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">{machineFeatures(m).map((f) => <Badge key={f} tone="muted">{f}</Badge>)}</div>
              <p className="mt-3 text-xs text-niebla">20 líneas · {m.symbols.length} símbolos · tira de {strip.length} posiciones · RTP teórico {(rtp.totalRtp * 100).toFixed(2).replace('.', ',')} %</p>
              <Button className="mt-5 w-full" onClick={() => nav(`/slots/${m.id}`)}>Jugar</Button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
