// Script de control visual: genera un HTML estático con las 52 cartas (npx tsx apps/web/src/dev/renderGallery.tsx salida.html)
import { writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardBackFace, CardFace } from '../components/cards/CardFace';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
const SUITS = ['s', 'h', 'd', 'c'];
const row = (w: number, variant: 'full' | 'compact') =>
  SUITS.map((s) => `<div style="display:flex;gap:6px;margin:6px 0">${RANKS.map((r) => `<div style="width:${w}px;height:${w * 1.4}px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))">${renderToStaticMarkup(<CardFace card={r + s} variant={variant} />)}</div>`).join('')}<div style="width:${w}px;height:${w * 1.4}px">${renderToStaticMarkup(<CardBackFace />)}</div></div>`).join('');
const html = `<!doctype html><html><body style="background:#0d4733;margin:12px;font-family:sans-serif;color:#eee">
<p>Completa 96px</p>${row(96, 'full')}<p>Completa 64px</p>${row(64, 'full')}<p>Compacta 46px</p>${row(46, 'compact')}</body></html>`;
writeFileSync(process.argv[2] ?? 'gallery.html', html);
