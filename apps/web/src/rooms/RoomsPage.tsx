import { DoorOpen, KeyRound, Plus, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, EmptyState, Field, Modal, Segmented, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useNotify } from '../state/notify';

interface MyRoom {
  id: string;
  name: string;
  game: 'poker' | 'blackjack';
  isHost: boolean;
  members: number;
  maxSeats: number;
  allowBots: boolean;
}

const GAME_LABEL = { poker: "Texas Hold'em", blackjack: 'Blackjack' } as const;

/** Salas privadas: crear una, entrar con un código o volver a las propias. */
export default function RoomsPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { notify } = useNotify();
  const [rooms, setRooms] = useState<MyRoom[] | null>(null);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const invite = params.get('invitar');
  const [create, setCreate] = useState<null | {
    name: string; game: 'poker' | 'blackjack'; maxSeats: number; privacy: 'code' | 'friends'; allowBots: boolean; chipMode: 'wallet' | 'room';
    smallBlind: number; bigBlind: number; startingChips: number; minBet: number; maxBet: number;
  }>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<{ items: MyRoom[] }>('/api/rooms').then((r) => setRooms(r.items)).catch(() => setRooms([]));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const g = params.get('crear');
    if (g === 'poker' || g === 'blackjack') openCreate(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = (game: 'poker' | 'blackjack'): void =>
    setCreate({ name: '', game, maxSeats: game === 'poker' ? 6 : 5, privacy: 'code', allowBots: false, chipMode: 'wallet', smallBlind: 10, bigBlind: 20, startingChips: 2000, minBet: 10, maxBet: 1000 });

  const submit = async (): Promise<void> => {
    if (!create) return;
    setBusy(true);
    try {
      const body = {
        name: create.name.trim(), game: create.game, maxSeats: create.maxSeats, privacy: create.privacy, allowBots: create.allowBots,
        chipMode: create.game === 'poker' ? create.chipMode : 'wallet',
        ...(create.game === 'poker'
          ? { poker: { smallBlind: create.smallBlind, bigBlind: create.bigBlind, minBuyIn: create.bigBlind * 20, maxBuyIn: create.bigBlind * 200, startingChips: create.startingChips } }
          : { blackjack: { minBet: create.minBet, maxBet: create.maxBet } }),
      };
      const room = await api.post<{ id: string }>('/api/rooms', body);
      nav(`/salas/${room.id}`);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo crear la sala.');
    } finally {
      setBusy(false);
    }
  };

  const join = async (): Promise<void> => {
    setJoining(true);
    try {
      const room = await api.post<{ id: string }>('/api/rooms/join', { code });
      nav(`/salas/${room.id}`);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo entrar.');
    } finally {
      setJoining(false);
    }
  };

  const num = (k: 'maxSeats' | 'smallBlind' | 'bigBlind' | 'startingChips' | 'minBet' | 'maxBet') => (e: React.ChangeEvent<HTMLInputElement>) => setCreate((c) => (c ? { ...c, [k]: Number(e.target.value) } : c));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-4xl text-marfil sm:text-5xl">Salas privadas</h1>
      <p className="mt-2 max-w-2xl text-niebla">Mesas de póker o blackjack solo para quien tenga el código o una invitación. Usan el mismo motor y las mismas reglas que las mesas públicas.</p>
      {invite && <p className="mt-4 rounded-xl border border-oro/40 bg-oro/10 p-3 text-sm text-marfil">Abre una de tus salas para invitar a <strong>{invite}</strong>, o crea una nueva.</p>}

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section className="panel p-6" aria-label="Crear sala">
          <DoorOpen className="h-8 w-8 text-oro" />
          <h2 className="mt-3 text-2xl text-marfil">Crear sala privada</h2>
          <p className="mt-1 text-sm text-niebla">Elige el juego, los límites y quién puede entrar. Recibirás un código para compartir.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => openCreate('poker')} data-testid="create-poker"><Plus className="h-4 w-4" /> Sala de póker</Button>
            <Button variant="outline" onClick={() => openCreate('blackjack')} data-testid="create-blackjack"><Plus className="h-4 w-4" /> Sala de blackjack</Button>
          </div>
        </section>
        <section className="panel p-6" aria-label="Entrar con código">
          <KeyRound className="h-8 w-8 text-oro" />
          <h2 className="mt-3 text-2xl text-marfil">Entrar con un código</h2>
          <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void join(); }}>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX" maxLength={12} className="flex-1 rounded-full border border-linea bg-noche px-4 py-2.5 font-mono uppercase tracking-widest text-marfil placeholder:text-niebla focus:border-oro/60 focus:outline-none" aria-label="Código de invitación" data-testid="room-code-input" />
            <Button type="submit" loading={joining} disabled={code.trim().length < 8}>Entrar</Button>
          </form>
          <p className="mt-2 text-xs text-niebla">El código solo da acceso a esa sala.</p>
        </section>
      </div>

      <section className="mt-8" aria-label="Tus salas">
        <h2 className="mb-3 text-2xl text-marfil">Tus salas abiertas</h2>
        {!rooms ? <Spinner /> : rooms.length === 0 ? (
          <EmptyState title="No estás en ninguna sala">Crea una o entra con el código que te hayan pasado.</EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="my-rooms">
            {rooms.map((r) => (
              <li key={r.id}>
                <button onClick={() => nav(`/salas/${r.id}${invite ? `?invitar=${encodeURIComponent(invite)}` : ''}`)} className="panel flex w-full items-center gap-3 p-4 text-left hover:border-oro/50">
                  <div className="flex-1">
                    <p className="text-lg text-marfil">{r.name}</p>
                    <p className="text-xs text-niebla">{GAME_LABEL[r.game]} · <Users className="inline h-3 w-3" /> {r.members}/{r.maxSeats}{r.allowBots ? ' · con bots' : ''}</p>
                  </div>
                  {r.isHost && <Badge tone="gold">Anfitrión</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={!!create} onClose={() => setCreate(null)} title={create?.game === 'poker' ? 'Nueva sala de póker' : 'Nueva sala de blackjack'} wide>
        {create && (
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <Field className="sm:col-span-2" label="Nombre de la sala" value={create.name} maxLength={40} onChange={(e) => setCreate({ ...create, name: e.target.value })} autoFocus data-testid="room-name" />
            <Field label={`Asientos (2–${create.game === 'poker' ? 6 : 7})`} type="number" min={2} max={create.game === 'poker' ? 6 : 7} value={create.maxSeats} onChange={num('maxSeats')} />
            <div>
              <p className="mb-1.5 text-sm text-niebla">Quién puede entrar</p>
              <Segmented label="Privacidad" value={create.privacy} onChange={(v) => setCreate({ ...create, privacy: v })} options={[{ value: 'code', label: 'Con el código' }, { value: 'friends', label: 'Solo mis amigos' }]} />
            </div>
            {create.game === 'poker' ? (
              <>
                <Field label="Ciega pequeña" type="number" min={1} value={create.smallBlind} onChange={num('smallBlind')} />
                <Field label="Ciega grande" type="number" min={2} value={create.bigBlind} onChange={num('bigBlind')} />
                <div className="sm:col-span-2">
                  <p className="mb-1.5 text-sm text-niebla">Fichas</p>
                  <Segmented label="Modo de fichas" value={create.chipMode} onChange={(v) => setCreate({ ...create, chipMode: v })} options={[{ value: 'wallet', label: 'De tu saldo' }, { value: 'room', label: 'Fichas de sala' }]} />
                  <p className="mt-1 text-xs text-niebla">{create.chipMode === 'room' ? 'Todos empiezan con las mismas fichas y el saldo no se toca.' : `Cada uno entra con su saldo, de ${create.bigBlind * 20} a ${create.bigBlind * 200} créditos, y lo recupera al levantarse.`}</p>
                </div>
                {create.chipMode === 'room' && <Field label="Fichas iniciales" type="number" min={create.bigBlind * 10} value={create.startingChips} onChange={num('startingChips')} />}
              </>
            ) : (
              <>
                <Field label="Apuesta mínima" type="number" min={1} value={create.minBet} onChange={num('minBet')} />
                <Field label="Apuesta máxima" type="number" min={1} value={create.maxBet} onChange={num('maxBet')} />
              </>
            )}
            <label className="flex items-start gap-2 text-sm text-niebla sm:col-span-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#cfae6b]" checked={create.allowBots} onChange={(e) => setCreate({ ...create, allowBots: e.target.checked })} />
              <span>Permitir bots para completar la mesa. Siempre se muestran como bots: no son tus amigos.</span>
            </label>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setCreate(null)}>Cancelar</Button>
              <Button type="submit" loading={busy} disabled={create.name.trim().length < 3} data-testid="room-create-submit">Crear sala</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
