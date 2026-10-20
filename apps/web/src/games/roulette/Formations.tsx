import type { RouletteBet, RouletteBetSpec } from '@aurum/engine';
import { Copy, FolderOpen, Pencil, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Field, Modal } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { credits } from '../../lib/format';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';

interface Formation {
  id: string;
  name: string;
  bets: RouletteBet[];
  total: number;
  updatedAt: string;
}

const toWire = (b: { bet: RouletteBetSpec; amount: number }): RouletteBet => ({ ...b.bet, amount: b.amount }) as RouletteBet;
const fromWire = (b: RouletteBet): { bet: RouletteBetSpec; amount: number } => {
  const { amount, ...bet } = b;
  return { bet: bet as RouletteBetSpec, amount };
};

/**
 * Formaciones guardadas: repetir una distribución favorita con comodidad.
 * Cargar una formación solo coloca las fichas en el tapete; el giro siempre
 * se confirma aparte. No cambia la probabilidad de ganar.
 */
export function Formations({ current, disabled, onLoad }: { current: { bet: RouletteBetSpec; amount: number }[]; disabled: boolean; onLoad: (bets: { bet: RouletteBetSpec; amount: number }[]) => boolean }) {
  const { user } = useSession();
  const { notify } = useNotify();
  const [items, setItems] = useState<Formation[] | null>(null);
  const [max, setMax] = useState(30);
  const [dialog, setDialog] = useState<{ mode: 'save' | 'rename'; id?: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Formation | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!user) return;
    api.get<{ items: Formation[]; max: number }>('/api/me/formations').then((r) => {
      setItems(r.items);
      setMax(r.max);
    }).catch(() => setItems([]));
  }, [user]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      if (ok) notify('success', ok);
      load();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo completar la acción.');
    } finally {
      setBusy(false);
    }
  };

  const save = (): void => {
    if (!dialog) return;
    const name = dialog.name.trim();
    if (dialog.mode === 'save') void run(() => api.post('/api/me/formations', { name, bets: current.map(toWire) }), `Formación «${name}» guardada.`).then(() => setDialog(null));
    else void run(() => api.patch(`/api/me/formations/${dialog.id}`, { name }), 'Formación renombrada.').then(() => setDialog(null));
  };

  const use = async (f: Formation): Promise<void> => {
    try {
      // El servidor comprueba que sigue siendo legal y que el saldo alcanza; no apuesta nada.
      const chk = await api.get<{ legal: boolean; reason: string | null; affordable: boolean; total: number }>(`/api/me/formations/${f.id}/check`);
      if (!chk.legal) {
        notify('error', `No se puede usar: ${chk.reason ?? 'apuestas no válidas'}`);
        return;
      }
      if (!chk.affordable) {
        notify('error', `Saldo insuficiente: la formación suma ${credits(chk.total)}.`);
        return;
      }
      if (onLoad(f.bets.map(fromWire))) notify('info', `«${f.name}» colocada en el tapete. Revísala y confirma el giro.`);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo cargar.');
    }
  };

  if (!user) return null;
  return (
    <section className="panel mt-6 p-4 sm:p-5" aria-label="Formaciones guardadas" data-testid="formations">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl text-marfil">Formaciones guardadas</h2>
          <p className="text-xs text-niebla">Guardan una distribución para repetirla cómodamente. No aumentan la probabilidad matemática de ganar.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setDialog({ mode: 'save', name: '' })} disabled={disabled || current.length === 0 || (items?.length ?? 0) >= max} disabledReason={current.length === 0 ? 'Coloca fichas en el tapete para guardarlas' : 'Has llegado al máximo de formaciones'} data-testid="save-formation">
          <Save className="h-4 w-4" /> Guardar el tapete actual
        </Button>
      </div>
      {items && items.length === 0 && <p className="mt-3 text-sm text-niebla">Aún no tienes formaciones. Coloca fichas y guárdalas con un nombre, por ejemplo «Mi sistema» o «Números favoritos».</p>}
      {items && items.length > 0 && (
        <ul className="mt-3 divide-y divide-linea/50">
          {items.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="formation-item">
              <div className="min-w-0 flex-1">
                <p className="truncate text-marfil">{f.name}</p>
                <p className="text-xs text-niebla">{f.bets.length} {f.bets.length === 1 ? 'apuesta' : 'apuestas'} · {credits(f.total)}</p>
              </div>
              <Button size="sm" onClick={() => void use(f)} disabled={disabled || busy}><FolderOpen className="h-4 w-4" /> Cargar</Button>
              <Button size="sm" variant="ghost" aria-label={`Renombrar ${f.name}`} onClick={() => setDialog({ mode: 'rename', id: f.id, name: f.name })}><Pencil className="h-4 w-4" /></Button>
              <Button size="sm" variant="ghost" aria-label={`Duplicar ${f.name}`} onClick={() => void run(() => api.post(`/api/me/formations/${f.id}/duplicate`), 'Formación duplicada.')} disabled={busy || items.length >= max}><Copy className="h-4 w-4" /></Button>
              <Button size="sm" variant="ghost" aria-label={`Eliminar ${f.name}`} onClick={() => setConfirmDelete(f)}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!dialog} onClose={() => setDialog(null)} title={dialog?.mode === 'rename' ? 'Renombrar formación' : 'Guardar formación'}>
        {dialog && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4">
            <Field label="Nombre" value={dialog.name} maxLength={40} autoFocus onChange={(e) => setDialog({ ...dialog, name: e.target.value })} hint={dialog.mode === 'save' ? `${current.length} apuestas, ${credits(current.reduce((a, b) => a + b.amount, 0))}` : undefined} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button>
              <Button type="submit" loading={busy} disabled={dialog.name.trim().length === 0}>Guardar</Button>
            </div>
          </form>
        )}
      </Modal>
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Eliminar formación">
        <p className="text-niebla">¿Eliminar «{confirmDelete?.name}»? No afecta a tu saldo.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => { const f = confirmDelete!; setConfirmDelete(null); void run(() => api.del(`/api/me/formations/${f.id}`), 'Formación eliminada.'); }}>Eliminar</Button>
        </div>
      </Modal>
    </section>
  );
}
