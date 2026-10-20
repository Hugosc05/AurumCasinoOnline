import { AnimatePresence, motion } from 'motion/react';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../lib/format';
import { useNotifications, type AppNotification } from './useSocial';

function text(n: AppNotification): { body: string; to: string } {
  switch (n.kind) {
    case 'friend_request':
      return { body: `${n.payload.from?.username ?? 'Alguien'} quiere ser tu amigo.`, to: '/amigos' };
    case 'friend_accepted':
      return { body: `${n.payload.by?.username ?? 'Alguien'} ha aceptado tu solicitud de amistad.`, to: '/amigos' };
    case 'room_invite':
      return { body: `${n.payload.from?.username ?? 'Un amigo'} te invita a la sala privada «${n.payload.roomName ?? ''}».`, to: n.payload.roomId ? `/salas/${n.payload.roomId}` : '/salas' };
  }
}

/** Notificaciones dentro de la aplicación (solicitudes de amistad, invitaciones a salas). */
export function NotificationBell() {
  const { items, unread, markAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open && unread > 0) void markAll();
        }}
        className="relative grid h-10 w-10 place-items-center rounded-full border border-linea bg-abismo text-marfil hover:border-oro/50"
        aria-label={unread > 0 ? `Notificaciones: ${unread} sin leer` : 'Notificaciones'}
        aria-expanded={open}
        data-testid="notification-bell"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rubi px-1 text-[10px] font-bold text-marfil">{unread > 9 ? '9+' : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="panel absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] p-2" role="dialog" aria-label="Notificaciones">
            {items.length === 0 ? (
              <p className="px-3 py-4 text-sm text-niebla">No tienes notificaciones.</p>
            ) : (
              <ul className="max-h-96 overflow-y-auto">
                {items.map((n) => {
                  const t = text(n);
                  return (
                    <li key={n.id}>
                      <Link to={t.to} onClick={() => setOpen(false)} className={cx('block rounded-lg px-3 py-2 text-sm hover:bg-white/5', n.readAt ? 'text-niebla' : 'text-marfil')}>
                        {t.body}
                        <span className="block text-[11px] text-niebla">{new Date(n.createdAt).toLocaleString('es-ES')}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
