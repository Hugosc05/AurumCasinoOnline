import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/**
 * Bloque de anuncio de AdSense. No hace nada (ni descarga nada) mientras los
 * anuncios estén desactivados en el panel. Solo se coloca en la portada, los
 * vestíbulos y recompensas: nunca dentro de una mesa o partida.
 */
interface AdsConfig {
  enabled: boolean;
  publisherId?: string;
  slots?: { home: string; lobby: string; rewards: string };
}

let config: Promise<AdsConfig> | null = null;
let scriptAdded = false;

function loadConfig(): Promise<AdsConfig> {
  config ??= api.get<AdsConfig>('/api/ads-display').catch(() => ({ enabled: false }));
  return config;
}

function addScript(publisherId: string): void {
  if (scriptAdded) return;
  scriptAdded = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(publisherId)}`;
  s.crossOrigin = 'anonymous';
  document.head.appendChild(s);
}

export function AdSlot({ placement, className }: { placement: 'home' | 'lobby' | 'rewards'; className?: string }) {
  const [ad, setAd] = useState<{ client: string; slot: string } | null>(null);
  const pushed = useRef(false);
  useEffect(() => {
    let alive = true;
    void loadConfig().then((c) => {
      const slot = c.slots?.[placement];
      if (!alive || !c.enabled || !c.publisherId || !slot) return;
      addScript(c.publisherId);
      setAd({ client: c.publisherId, slot });
    });
    return () => {
      alive = false;
    };
  }, [placement]);
  useEffect(() => {
    if (!ad || pushed.current) return;
    pushed.current = true;
    try {
      const w = window as unknown as { adsbygoogle?: unknown[] };
      (w.adsbygoogle = w.adsbygoogle ?? []).push({});
    } catch {
      /* bloqueador de anuncios u otro problema: el casino sigue igual */
    }
  }, [ad]);
  if (!ad) return null;
  return (
    <aside className={className} aria-label="Publicidad">
      <p className="mb-1 text-center text-[10px] uppercase tracking-widest text-niebla/70">Publicidad</p>
      <ins
        className="adsbygoogle block min-h-[90px] overflow-hidden rounded-xl"
        style={{ display: 'block' }}
        data-ad-client={ad.client}
        data-ad-slot={ad.slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
