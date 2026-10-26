import { Camera, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { invalidateLook } from '../../lib/looks';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';
import { Button, Modal } from '../ui';
import { PlayerAvatar } from './PlayerAvatar';

const OUT = 256;

/**
 * Foto de perfil: se elige una imagen, se encuadra (arrastrar y zoom) y se
 * reduce a 256 × 256 en el propio navegador antes de subirla (WebP, o JPEG si
 * el navegador no sabe generar WebP). El servidor nunca recibe la original.
 */
export function AvatarEditor() {
  const { user } = useSession();
  const { notify } = useNotify();
  const input = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (file: File | undefined): void => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) {
      notify('error', 'Elige una imagen PNG, JPEG, WebP o GIF.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      notify('error', 'La imagen es demasiado grande (máximo 15 MB).');
      return;
    }
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      setImg(im);
      setZoom(1);
      setOff({ x: 0, y: 0 });
    };
    im.onerror = () => notify('error', 'No se pudo leer la imagen.');
    im.src = url;
  };

  // Vista previa: recorte cuadrado centrado con zoom y desplazamiento.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const g = c.getContext('2d')!;
    const side = Math.min(img.width, img.height) / zoom;
    const sx = Math.max(0, Math.min(img.width - side, (img.width - side) / 2 - off.x * (side / OUT)));
    const sy = Math.max(0, Math.min(img.height - side, (img.height - side) / 2 - off.y * (side / OUT)));
    g.imageSmoothingQuality = 'high';
    g.clearRect(0, 0, OUT, OUT);
    g.drawImage(img, sx, sy, side, side, 0, 0, OUT, OUT);
  }, [img, zoom, off]);

  const save = async (): Promise<void> => {
    const c = canvas.current;
    if (!c || !user) return;
    setBusy(true);
    try {
      let data = c.toDataURL('image/webp', 0.86);
      if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.86);
      await api.post('/api/profile/avatar', { image: data });
      invalidateLook(user.username);
      setImg(null);
      notify('success', 'Foto de perfil actualizada.');
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo subir la foto.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!user) return;
    await api.del('/api/profile/avatar').catch(() => {});
    invalidateLook(user.username);
    notify('info', 'Foto eliminada.');
  };

  if (!user) return null;
  return (
    <div className="relative">
      <PlayerAvatar name={user.username} size={84} interactive={false} />
      <button type="button" onClick={() => input.current?.click()} className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border border-noche bg-oro text-noche shadow" aria-label="Cambiar foto de perfil" data-testid="avatar-change">
        <Camera className="h-4 w-4" />
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} data-testid="avatar-input" />
      <Modal open={!!img} onClose={() => setImg(null)} title="Tu foto de perfil">
        <p className="text-sm text-niebla">Arrastra para encuadrar y usa el zoom. Se guarda en 256 × 256.</p>
        <div className="mx-auto mt-4 w-fit">
          <canvas
            ref={canvas}
            width={OUT}
            height={OUT}
            className="h-56 w-56 cursor-grab touch-none rounded-full border-2 border-oro/60 bg-noche active:cursor-grabbing"
            onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }; }}
            onPointerMove={(e) => { const d = drag.current; if (d) setOff({ x: d.ox + (e.clientX - d.x) * (OUT / 224), y: d.oy + (e.clientY - d.y) * (OUT / 224) }); }}
            onPointerUp={() => (drag.current = null)}
          />
        </div>
        <label className="mt-4 flex items-center gap-3 text-sm text-niebla">
          Zoom
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="bet-slider flex-1" />
        </label>
        <div className="mt-5 flex justify-between gap-2">
          <Button variant="ghost" onClick={() => { setImg(null); void remove(); }}><Trash2 className="h-4 w-4" /> Quitar la foto</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setImg(null)}>Cancelar</Button>
            <Button onClick={() => void save()} loading={busy} data-testid="avatar-save">Guardar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
