import { motion } from 'motion/react';
import { Check, ChevronDown, Gift, Package, ShoppingBag, Sparkles, Target } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CASE_BY_ID, COSMETICS, COSMETIC_KIND_LABEL, RARITY_INFO, RARITIES, type CaseDrop, type CosmeticKind, type Rarity } from '@aurum/engine';
import { Button, Segmented } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { credits, cx } from '../../lib/format';
import { invalidateLook } from '../../lib/looks';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';
import { CaseOpener, type OpenResult } from './CaseOpener';
import { DropIcon, RewardTile, dropTitle } from './RewardItem';
import { emitRewardsChanged } from './summary';

interface Mission { id: string; period: string; scope: 'daily' | 'weekly'; text: string; target: number; progress: number; done: boolean; claimed: boolean; reward: string }
interface Missions { daily: Mission[]; weekly: Mission[]; dailyResetAt: string; weeklyResetAt: string }
interface CaseInfo { id: string; name: string; price: number | null; color: string; drops: CaseDrop[]; odds: Record<Rarity, number>; expectedCredits: number; cosmeticChance: number }
interface Inventory {
  cases: { id: string; caseId: string; source: string; createdAt: string }[];
  items: { id: string; kind: CosmeticKind; name: string; rarity: Rarity }[];
  equipped: { frame: string | null; nameColor: string | null; cardBack: string | null };
}

type Tab = 'misiones' | 'cajas' | 'tienda' | 'inventario';

function untilText(iso: string): string {
  const ms = Math.max(0, Date.parse(iso) - Date.now());
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  return d > 0 ? `${d} d ${h % 24} h` : `${h} h ${Math.floor((ms % 3_600_000) / 60_000)} min`;
}

/** Caja cerrada dibujada en SVG (con el color de la caja). */
function CaseArt({ color, size = 110 }: { color: string; size?: number }) {
  return (
    <svg viewBox="0 0 120 100" width={size} height={size * 0.83} aria-hidden className="drop-shadow-[0_12px_18px_rgba(0,0,0,0.6)]">
      <defs>
        <linearGradient id={`ca-${color}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} /><stop offset="1" stopColor="#11141c" /></linearGradient>
      </defs>
      <path d="M12 34 L60 18 L108 34 L108 80 L60 96 L12 80 Z" fill={`url(#ca-${color})`} stroke="#0b0e16" strokeWidth="2" />
      <path d="M12 34 L60 50 L108 34 M60 50 V96" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
      <path d="M8 30 L60 12 L112 30 L60 47 Z" fill={color} stroke="#0b0e16" strokeWidth="2" />
      <rect x="53" y="52" width="14" height="18" rx="2" fill="#f4d27a" stroke="#6e4a12" />
      <circle cx="60" cy="61" r="2.5" fill="#6e4a12" />
    </svg>
  );
}

export default function RewardsPage() {
  const { user, setBalance, refresh } = useSession();
  const { notify } = useNotify();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'misiones';
  const [missions, setMissions] = useState<Missions | null>(null);
  const [catalog, setCatalog] = useState<CaseInfo[]>([]);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [opening, setOpening] = useState<OpenResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [oddsOpen, setOddsOpen] = useState<string | null>(null);
  const lastOpened = useRef<string | null>(null);

  const load = useCallback(() => {
    api.get<Missions>('/api/rewards/missions').then(setMissions).catch(() => {});
    api.get<Inventory>('/api/rewards/inventory').then(setInv).catch(() => {});
    emitRewardsChanged();
  }, []);
  useEffect(() => {
    load();
    api.get<{ cases: CaseInfo[] }>('/api/rewards/cases').then((r) => setCatalog(r.cases)).catch(() => {});
  }, [load]);

  const claim = async (m: Mission): Promise<void> => {
    setBusy(m.id);
    try {
      await api.post('/api/rewards/missions/claim', { missionId: m.id, period: m.period });
      notify('success', `¡Has ganado una ${CASE_BY_ID[m.reward]?.name.toLowerCase() ?? 'caja'}!`);
      load();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo reclamar.');
    } finally {
      setBusy(null);
    }
  };

  const open = async (id: string): Promise<void> => {
    setBusy(id);
    lastOpened.current = id;
    try {
      const r = await api.post<OpenResult & { balance: { balance: number | null; unlimited: boolean } }>('/api/rewards/cases/open', { id });
      setOpening(r);
      // El saldo se actualiza al terminar la animación (ver onClose).
      window.setTimeout(() => setBalance(r.balance), 100);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo abrir la caja.');
    } finally {
      setBusy(null);
    }
  };

  const buy = async (c: CaseInfo, count: number): Promise<void> => {
    setBusy(`buy-${c.id}`);
    try {
      const r = await api.post<{ ids: string[]; balance: { balance: number | null; unlimited: boolean } }>('/api/rewards/cases/buy', { caseId: c.id, count });
      setBalance(r.balance);
      notify('success', count === 1 ? `Has comprado una ${c.name.toLowerCase()}.` : `Has comprado ${count} cajas.`);
      load();
      if (count === 1) void open(r.ids[0]!);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo comprar.');
    } finally {
      setBusy(null);
    }
  };

  const equip = async (kind: CosmeticKind, itemId: string | null): Promise<void> => {
    try {
      const r = await api.post<Inventory>('/api/rewards/equip', { kind, itemId });
      setInv(r);
      if (user) invalidateLook(user.username);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo equipar.');
    }
  };

  const grouped = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of inv?.cases ?? []) m.set(c.caseId, [...(m.get(c.caseId) ?? []), c.id]);
    return [...m.entries()];
  }, [inv]);
  const claimable = [...(missions?.daily ?? []), ...(missions?.weekly ?? [])].filter((m) => m.done && !m.claimed).length;

  if (!user) return null;
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      <h1 className="flex items-center gap-3 text-5xl text-marfil"><Gift className="h-10 w-10 text-oro" /> Recompensas</h1>
      <p className="mt-2 max-w-2xl text-niebla">Completa misiones, consigue cajas y ábrelas: créditos, dorsos de cartas, marcos para tu foto y colores para tu nombre. Las probabilidades de cada caja están a la vista.</p>
      <div className="mt-6 overflow-x-auto">
        <Segmented<Tab>
          label="Secciones"
          value={tab}
          onChange={(t) => setParams({ tab: t })}
          options={[
            { value: 'misiones', label: `Misiones${claimable ? ` (${claimable})` : ''}` },
            { value: 'cajas', label: `Mis cajas${inv?.cases.length ? ` (${inv.cases.length})` : ''}` },
            { value: 'tienda', label: 'Tienda' },
            { value: 'inventario', label: 'Inventario' },
          ]}
        />
      </div>

      {tab === 'misiones' && missions && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {([['Diarias', missions.daily, missions.dailyResetAt, 'diaria'], ['Semanales', missions.weekly, missions.weeklyResetAt, 'semanal']] as const).map(([title, list, reset, caseId]) => (
            <section key={title} className="panel p-5" aria-label={`Misiones ${title.toLowerCase()}`}>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="flex items-center gap-2 text-2xl text-marfil"><Target className="h-5 w-5 text-oro" /> {title}</h2>
                <span className="text-xs text-niebla">Se renuevan en {untilText(reset)}</span>
              </div>
              <p className="mb-3 text-xs text-niebla">Cada una da una <span className="text-marfil">{CASE_BY_ID[caseId]!.name.toLowerCase()}</span>.</p>
              <ul className="space-y-3">
                {list.map((m) => (
                  <li key={m.id} className={cx('rounded-xl border p-3', m.claimed ? 'border-white/5 opacity-60' : m.done ? 'border-oro/60 bg-oro/5' : 'border-white/10')} data-testid={`mission-${m.id}`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-marfil">{m.text}</p>
                      {m.claimed ? (
                        <span className="flex items-center gap-1 text-xs text-exito"><Check className="h-4 w-4" /> Reclamada</span>
                      ) : m.done ? (
                        <Button size="sm" onClick={() => void claim(m)} loading={busy === m.id} data-testid={`claim-${m.id}`}>Reclamar</Button>
                      ) : (
                        <span className="text-xs tabular-nums text-niebla">{m.progress.toLocaleString('es-ES')} / {m.target.toLocaleString('es-ES')}</span>
                      )}
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
                      <motion.div className="h-full rounded-full bg-gradient-to-r from-oro to-[#ffe08a]" initial={false} animate={{ width: `${Math.min(100, (m.progress / m.target) * 100)}%` }} transition={{ duration: 0.6 }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {tab === 'cajas' && (
        <div className="mt-6">
          {grouped.length === 0 ? (
            <div className="panel p-8 text-center text-niebla">
              <Package className="mx-auto h-10 w-10 text-oro/60" />
              <p className="mt-3">No tienes cajas sin abrir. Complétalas en Misiones o mira la Tienda.</p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {grouped.map(([caseId, ids]) => {
                const def = CASE_BY_ID[caseId]!;
                return (
                  <div key={caseId} className="panel flex flex-col items-center p-6 text-center" data-testid={`owned-${caseId}`}>
                    <CaseArt color={def.color} />
                    <h3 className="mt-3 text-2xl text-marfil">{def.name}</h3>
                    <p className="text-sm text-niebla">Tienes {ids.length}</p>
                    <Button className="mt-4" onClick={() => void open(ids[0]!)} loading={busy === ids[0]} data-testid={`open-${caseId}`}><Sparkles className="h-4 w-4" /> Abrir</Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'tienda' && (
        <div className="mt-6 space-y-5">
          <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-niebla">
            Las cajas se pagan con créditos virtuales sin valor real. De media devuelven en créditos menos de lo que cuestan (el resto son probabilidades de cosméticos): cómpralas por los objetos, no para ganar créditos.
          </p>
          <div className="grid gap-5 lg:grid-cols-3">
            {catalog.filter((c) => c.price !== null).map((c) => (
              <div key={c.id} className="panel flex flex-col p-5" data-testid={`shop-${c.id}`}>
                <div className="flex items-center gap-4">
                  <CaseArt color={c.color} size={90} />
                  <div>
                    <h3 className="text-2xl text-marfil">{c.name}</h3>
                    <p className="font-display text-2xl text-oro-claro">{credits(c.price)}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-niebla">Devolución media en créditos: {credits(c.expectedCredits)} ({Math.round((c.expectedCredits / c.price!) * 100)} %) · cosmético: {(c.cosmeticChance * 100).toFixed(1).replace('.', ',')} %</p>
                <button type="button" className="mt-2 flex items-center gap-1 text-xs text-oro-claro" onClick={() => setOddsOpen(oddsOpen === c.id ? null : c.id)} aria-expanded={oddsOpen === c.id}>
                  Probabilidades <ChevronDown className={cx('h-3 w-3 transition-transform', oddsOpen === c.id && 'rotate-180')} />
                </button>
                {oddsOpen === c.id && <OddsTable c={c} />}
                <div className="mt-auto flex gap-2 pt-4">
                  <Button className="flex-1" onClick={() => void buy(c, 1)} loading={busy === `buy-${c.id}`} data-testid={`buy-${c.id}`}><ShoppingBag className="h-4 w-4" /> Comprar y abrir</Button>
                  <Button variant="outline" onClick={() => void buy(c, 5)} disabled={busy !== null}>×5</Button>
                </div>
              </div>
            ))}
          </div>
          <h2 className="pt-4 text-2xl text-marfil">Cajas de misiones</h2>
          <div className="grid gap-5 lg:grid-cols-2">
            {catalog.filter((c) => c.price === null).map((c) => (
              <div key={c.id} className="panel p-5">
                <div className="flex items-center gap-4"><CaseArt color={c.color} size={70} /><div><h3 className="text-xl text-marfil">{c.name}</h3><p className="text-xs text-niebla">Solo con misiones · media {credits(c.expectedCredits)} créditos · cosmético {(c.cosmeticChance * 100).toFixed(1).replace('.', ',')} %</p></div></div>
                <OddsTable c={c} />
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'inventario' && inv && (
        <div className="mt-6 space-y-8">
          {(['frame', 'nameColor', 'cardBack'] as CosmeticKind[]).map((kind) => {
            const all = COSMETICS.filter((x) => x.kind === kind);
            const owned = new Set(inv.items.map((i) => i.id));
            const equippedId = kind === 'frame' ? inv.equipped.frame : kind === 'nameColor' ? inv.equipped.nameColor : inv.equipped.cardBack;
            return (
              <section key={kind}>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-2xl text-marfil">{COSMETIC_KIND_LABEL[kind]}</h2>
                  <span className="text-xs text-niebla">{all.filter((x) => owned.has(x.id)).length} de {all.length}</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => void equip(kind, null)} className={cx('grid h-[118px] w-[128px] place-items-center rounded-md border text-sm', equippedId === null ? 'border-oro text-oro-claro' : 'border-white/10 text-niebla hover:border-white/30')}>
                    Sin {COSMETIC_KIND_LABEL[kind].toLowerCase()}
                  </button>
                  {all.map((x) => {
                    const has = owned.has(x.id);
                    return (
                      <button key={x.id} type="button" disabled={!has} onClick={() => void equip(kind, x.id)} className={cx('relative rounded-md transition-transform', has ? 'hover:-translate-y-0.5' : 'opacity-50 saturate-50', equippedId === x.id && 'ring-2 ring-oro-claro ring-offset-2 ring-offset-noche')} title={has ? `Equipar ${x.name}` : `${x.name} (aún no lo tienes)`} data-testid={`item-${x.id}`}>
                        <RewardTile drop={{ kind: 'cosmetic', id: x.id, rarity: x.rarity, weight: 1 }} width={128} />
                        {equippedId === x.id && <span className="absolute left-1.5 top-1.5 rounded bg-oro px-1.5 text-[10px] font-bold text-noche">EQUIPADO</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {opening && (
        <CaseOpener
          result={opening}
          onClose={() => {
            setOpening(null);
            load();
            void refresh();
          }}
          onAgain={inv && inv.cases.filter((c) => c.caseId === opening.caseId).length > 1 ? () => {
            const next = inv.cases.find((c) => c.caseId === opening.caseId && c.id !== lastOpened.current);
            setOpening(null);
            load();
            if (next) window.setTimeout(() => void open(next.id), 50);
          } : undefined}
        />
      )}
    </div>
  );
}

function OddsTable({ c }: { c: CaseInfo }) {
  const total = c.drops.reduce((a, d) => a + d.weight, 0);
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {RARITIES.filter((r) => c.odds[r] > 0).map((r) => (
          <span key={r} className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${RARITY_INFO[r].color}26`, color: RARITY_INFO[r].color }}>
            {RARITY_INFO[r].label} {(c.odds[r] * 100).toLocaleString('es-ES', { maximumFractionDigits: 2 })} %
          </span>
        ))}
      </div>
      <ul className="max-h-48 space-y-1 overflow-y-auto pr-1 text-xs">
        {c.drops.map((d, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 truncate">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: RARITY_INFO[d.rarity].color }} />
              <span className="grid h-6 w-6 place-items-center"><DropIcon drop={d} size={22} /></span>
              <span className="truncate text-marfil">{dropTitle(d)}</span>
            </span>
            <span className="tabular-nums text-niebla">{((d.weight / total) * 100).toLocaleString('es-ES', { maximumFractionDigits: 3 })} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
