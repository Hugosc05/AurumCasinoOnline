import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { COSMETICS, COSMETIC_KIND_LABEL, type CosmeticKind, type Rarity } from '@aurum/engine';
import { Spinner } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { cx } from '../../lib/format';
import { invalidateLook } from '../../lib/looks';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';
import { RewardTile } from './RewardItem';

export interface Inventory {
  cases: { id: string; caseId: string; source: string; createdAt: string }[];
  items: { id: string; kind: CosmeticKind; name: string; rarity: Rarity }[];
  equipped: { frame: string | null; nameColor: string | null; cardBack: string | null };
  /** Administradores: todo el catálogo desbloqueado. */
  allUnlocked?: boolean;
}

const KINDS: CosmeticKind[] = ['frame', 'nameColor', 'cardBack'];

/**
 * Inventario de cosméticos: todo el catálogo por tipo, lo conseguido en color
 * y lo que falta apagado; un toque equipa. Se usa en Recompensas y en Perfil.
 */
export function InventoryGrid({ inv, onEquip, tile = 128 }: { inv: Inventory; onEquip: (kind: CosmeticKind, itemId: string | null) => void; tile?: number }) {
  const owned = new Set(inv.items.map((i) => i.id));
  return (
    <div className="space-y-8">
      {inv.allUnlocked && <p className="rounded-xl border border-oro/30 bg-oro/5 px-4 py-2 text-sm text-oro-claro">Como administrador tienes todo el catálogo desbloqueado.</p>}
      {KINDS.map((kind) => {
        const all = COSMETICS.filter((x) => x.kind === kind);
        const equippedId = kind === 'frame' ? inv.equipped.frame : kind === 'nameColor' ? inv.equipped.nameColor : inv.equipped.cardBack;
        return (
          <section key={kind}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-2xl text-marfil">{COSMETIC_KIND_LABEL[kind]}</h2>
              <span className="text-xs text-niebla">{all.filter((x) => owned.has(x.id)).length} de {all.length}</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onEquip(kind, null)}
                className={cx('grid place-items-center rounded-md border px-2 text-center text-sm', equippedId === null ? 'border-oro text-oro-claro' : 'border-white/10 text-niebla hover:border-white/30')}
                style={{ width: tile, height: tile * 0.92 }}
              >
                Sin {COSMETIC_KIND_LABEL[kind].toLowerCase()}
              </button>
              {all.map((x) => {
                const has = owned.has(x.id);
                return (
                  <button
                    key={x.id}
                    type="button"
                    disabled={!has}
                    onClick={() => onEquip(kind, x.id)}
                    className={cx('relative rounded-md transition-transform', has ? 'hover:-translate-y-0.5' : 'opacity-50 saturate-50', equippedId === x.id && 'ring-2 ring-oro-claro ring-offset-2 ring-offset-noche')}
                    title={has ? `Equipar ${x.name}` : `${x.name} (aún no lo tienes)`}
                    data-testid={`item-${x.id}`}
                  >
                    <RewardTile drop={{ kind: 'cosmetic', id: x.id, rarity: x.rarity, weight: 1 }} width={tile} />
                    {equippedId === x.id && <span className="absolute left-1.5 top-1.5 rounded bg-oro px-1.5 text-[10px] font-bold text-noche">EQUIPADO</span>}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Carga el inventario y equipa (para usarlo fuera de Recompensas, p. ej. en Perfil). */
export function useInventory(): { inv: Inventory | null; equip: (kind: CosmeticKind, itemId: string | null) => Promise<void>; reload: () => void } {
  const { user } = useSession();
  const { notify } = useNotify();
  const [inv, setInv] = useState<Inventory | null>(null);
  const reload = useCallback(() => {
    api.get<Inventory>('/api/rewards/inventory').then(setInv).catch(() => {});
  }, []);
  useEffect(reload, [reload]);
  const equip = useCallback(async (kind: CosmeticKind, itemId: string | null) => {
    try {
      setInv(await api.post<Inventory>('/api/rewards/equip', { kind, itemId }));
      if (user) invalidateLook(user.username);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo equipar.');
    }
  }, [user, notify]);
  return { inv, equip, reload };
}

/** Bloque de inventario para el perfil. */
export function ProfileInventory() {
  const { inv, equip } = useInventory();
  if (!inv) return <Spinner />;
  return (
    <div>
      <InventoryGrid inv={inv} onEquip={(k, id) => void equip(k, id)} tile={112} />
      {!inv.allUnlocked && (
        <p className="mt-6 text-sm text-niebla">
          Consigue más en <Link to="/recompensas" className="text-oro-claro hover:underline">Recompensas</Link>: misiones diarias y semanales, y cajas.
        </p>
      )}
    </div>
  );
}
