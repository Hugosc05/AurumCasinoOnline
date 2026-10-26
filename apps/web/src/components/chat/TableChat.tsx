import { AnimatePresence, motion } from 'motion/react';
import { MessageCircle, Send, Smile, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { audio } from '../../lib/audio';
import { cx } from '../../lib/format';
import { socket } from '../../lib/ws';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';
import { PlayerName } from '../social/PlayerAvatar';
import { usePlayerCard } from '../social/PlayerCard';
import { isMuted, useMutes } from './mutes';

/**
 * Chat de mesa: panel plegable con mensajes, mensajes rápidos y emojis, y
 * bocadillos sobre el jugador que escribe (en las mesas que los muestran).
 */

export interface ChatMessage {
  id: string;
  channel: string;
  from: string;
  text: string;
  kind: 'text' | 'quick' | 'emoji';
  at: number;
}

interface ChatState {
  messages: ChatMessage[];
  quick: Record<string, string>;
  emojis: string[];
  unread: number;
  /** Último mensaje reciente de cada jugador (para los bocadillos). */
  bubbles: Map<string, ChatMessage>;
  send: (m: { text: string } | { quick: string } | { emoji: string }) => void;
  markRead: () => void;
}

const Ctx = createContext<ChatState | null>(null);

export function ChatProvider({ channel, children }: { channel: string | null; children: ReactNode }) {
  const { notify } = useNotify();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [quick, setQuick] = useState<Record<string, string>>({});
  const [emojis, setEmojis] = useState<string[]>([]);
  const [unread, setUnread] = useState(0);
  const [bubbles, setBubbles] = useState<Map<string, ChatMessage>>(new Map());
  const muteVersion = useMutes();

  useEffect(() => {
    if (!channel) return;
    setMessages([]);
    const offs = [
      socket.onOpen(() => socket.send({ t: 'chat.join', channel })),
      socket.on('chat.history', (m) => {
        if (m.channel !== channel) return;
        setMessages(m.messages as ChatMessage[]);
        setQuick(m.quick as Record<string, string>);
        setEmojis(m.emojis as string[]);
      }),
      socket.on('chat.message', (m) => {
        const msg = m.message as ChatMessage;
        if (msg.channel !== channel || isMuted(msg.from)) return;
        setMessages((list) => [...list.slice(-39), msg]);
        setUnread((n) => n + 1);
        setBubbles((b) => new Map(b).set(msg.from.toLowerCase(), msg));
        audio.play('click');
        window.setTimeout(() => {
          setBubbles((b) => {
            if (b.get(msg.from.toLowerCase())?.id !== msg.id) return b;
            const n = new Map(b);
            n.delete(msg.from.toLowerCase());
            return n;
          });
        }, 4500);
      }),
      socket.on('error', (m) => {
        if (String(m.ref ?? '') === 'chat.send') notify('error', String(m.message));
      }),
    ];
    return () => {
      offs.forEach((o) => o());
      socket.send({ t: 'chat.leave', channel });
    };
  }, [channel, notify]);

  const send = useCallback((m: { text: string } | { quick: string } | { emoji: string }) => {
    if (channel) socket.send({ t: 'chat.send', channel, ...m });
  }, [channel]);

  const visible = useMemo(() => messages.filter((m) => !isMuted(m.from)), [messages, muteVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo<ChatState>(() => ({ messages: visible, quick, emojis, unread, bubbles, send, markRead: () => setUnread(0) }), [visible, quick, emojis, unread, bubbles, send]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useChat = (): ChatState | null => useContext(Ctx);

/** Bocadillo sobre el asiento de un jugador. */
export const ChatBubble = memo(function ChatBubble({ name, className }: { name: string; className?: string }) {
  const chat = useChat();
  const msg = chat?.bubbles.get(name.toLowerCase());
  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          key={msg.id}
          initial={{ opacity: 0, y: 8, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ type: 'spring', stiffness: 420, damping: 24 }}
          className={cx('chat-bubble pointer-events-none absolute z-[80] max-w-[180px] rounded-2xl px-3 py-1.5 text-center text-sm shadow-hondo', msg.kind === 'emoji' ? 'text-3xl leading-none' : '', className)}
        >
          {msg.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

/** Panel del chat (botón flotante que se despliega). */
export function TableChat({ inline = false }: { inline?: boolean }) {
  const chat = useChat();
  const { user } = useSession();
  const openCard = usePlayerCard();
  const [open, setOpen] = useState(inline);
  const [text, setText] = useState('');
  const [tab, setTab] = useState<'quick' | 'emoji' | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) chat?.markRead();
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, chat?.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!chat) return null;
  const submit = (): void => {
    const t = text.trim();
    if (!t) return;
    chat.send({ text: t });
    setText('');
  };

  const panel = (
    <div className={cx('flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#070b14]/95 shadow-hondo backdrop-blur', inline ? 'h-[340px]' : 'h-[min(440px,70vh)] w-[min(340px,calc(100vw-24px))]')} data-testid="table-chat">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm text-marfil"><MessageCircle className="h-4 w-4 text-oro" /> Chat de la mesa</p>
        {!inline && <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar chat" className="text-niebla hover:text-marfil"><X className="h-4 w-4" /></button>}
      </div>
      <div ref={list} className="flex-1 space-y-1.5 overflow-y-auto px-3 py-2 text-sm" aria-live="polite">
        {chat.messages.length === 0 && <p className="py-6 text-center text-xs text-niebla">Todavía no ha escrito nadie. ¡Saluda!</p>}
        {chat.messages.map((m) => (
          <p key={m.id} className={cx('break-words', m.kind === 'emoji' && 'text-2xl leading-tight')}>
            <button type="button" className="mr-1 font-semibold hover:underline" onClick={() => openCard(m.from)}>
              <PlayerName name={m.from} className={m.from === user?.username ? 'text-oro-claro' : 'text-[#9ec5ff]'} />:
            </button>
            <span className="text-marfil">{m.text}</span>
          </p>
        ))}
      </div>
      {user ? (
        <div className="border-t border-white/10 p-2">
          {tab === 'quick' && (
            <div className="mb-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
              {Object.entries(chat.quick).map(([id, label]) => (
                <button key={id} type="button" className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-marfil hover:bg-oro/20" onClick={() => { chat.send({ quick: id }); setTab(null); }}>{label}</button>
              ))}
            </div>
          )}
          {tab === 'emoji' && (
            <div className="mb-2 grid grid-cols-6 gap-1">
              {chat.emojis.map((e) => (
                <button key={e} type="button" className="rounded-lg py-1 text-2xl hover:bg-white/10" onClick={() => { chat.send({ emoji: e }); setTab(null); }}>{e}</button>
              ))}
            </div>
          )}
          <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <button type="button" className={cx('rounded-full px-2 py-1.5 text-xs', tab === 'quick' ? 'bg-oro text-noche' : 'bg-white/5 text-niebla')} onClick={() => setTab(tab === 'quick' ? null : 'quick')} aria-label="Mensajes rápidos">Rápidos</button>
            <button type="button" className={cx('rounded-full p-1.5', tab === 'emoji' ? 'bg-oro text-noche' : 'bg-white/5 text-niebla')} onClick={() => setTab(tab === 'emoji' ? null : 'emoji')} aria-label="Emojis"><Smile className="h-4 w-4" /></button>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={160} placeholder="Escribe…" className="min-w-0 flex-1 rounded-full border border-linea bg-noche px-3 py-1.5 text-sm text-marfil" aria-label="Mensaje" data-testid="chat-input" />
            <button type="submit" className="rounded-full bg-oro p-2 text-noche disabled:opacity-40" disabled={!text.trim()} aria-label="Enviar"><Send className="h-4 w-4" /></button>
          </form>
        </div>
      ) : (
        <p className="border-t border-white/10 p-3 text-center text-xs text-niebla">Inicia sesión para escribir.</p>
      )}
    </div>
  );

  if (inline) return panel;
  // En un portal: las transiciones de página usan transform y romperían el `position: fixed`.
  return createPortal(
    <div className="fixed bottom-3 right-3 z-[70] flex flex-col items-end gap-2 sm:bottom-5 sm:right-5">
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.96 }} transition={{ duration: 0.18 }}>
            {panel}
          </motion.div>
        )}
      </AnimatePresence>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="relative grid h-12 w-12 place-items-center rounded-full bg-oro text-noche shadow-hondo transition-transform hover:scale-105" aria-label="Abrir el chat de la mesa" data-testid="chat-open">
          <MessageCircle className="h-6 w-6" />
          {chat.unread > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rubi px-1 text-[11px] font-bold text-marfil">{chat.unread > 9 ? '9+' : chat.unread}</span>}
        </button>
      )}
    </div>,
    document.body,
  );
}
