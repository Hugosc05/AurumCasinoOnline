"""Genera el banner animado del README (SVG con animaciones SMIL, sin JavaScript).

GitHub muestra los SVG como imagen: no ejecuta scripts ni carga fuentes externas,
pero sí reproduce animaciones SMIL. Se generan dos variantes (oscura y clara)
que el README elige con <picture> según el tema de quien lo lea.

    python3 docs/readme/make_banner.py
"""
import math
from pathlib import Path

W, H = 1280, 400
OUT = Path(__file__).parent

# Orden real de la ruleta europea (un solo cero).
ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]
RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}

THEMES = {
    'dark': dict(bg1='#141d33', bg2='#060a13', text='#eee7d7', sub='#8a93a6', gold1='#8e7340', gold2='#ebd9a6', gold3='#cfae6b',
                 felt='#0d1526', line='#24324f', red='#b02a3c', black='#151a24', green='#1f7a4d', glow='#cfae6b', glowop='0.20', pill='#0d1526', shine='#fff3cc'),
    'light': dict(bg1='#fbf6ea', bg2='#efe6d2', text='#1b2233', sub='#5b6475', gold1='#7a5e2a', gold2='#c9a457', gold3='#9c7a36',
                  felt='#f6efe0', line='#d9cbaa', red='#b02a3c', black='#1f2430', green='#1f7a4d', glow='#c9a457', glowop='0.25', pill='#fffaf0', shine='#f1d58a'),
}


def arc(cx, cy, r1, r2, a0, a1):
    """Sector de corona circular entre los ángulos a0 y a1 (grados)."""
    p = lambda r, a: (cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
    x1, y1 = p(r2, a0); x2, y2 = p(r2, a1); x3, y3 = p(r1, a1); x4, y4 = p(r1, a0)
    return f'M{x1:.2f},{y1:.2f} A{r2},{r2} 0 0,1 {x2:.2f},{y2:.2f} L{x3:.2f},{y3:.2f} A{r1},{r1} 0 0,0 {x4:.2f},{y4:.2f}Z'


def wheel(t, cx, cy):
    step = 360 / 37
    parts = []
    for i, n in enumerate(ORDER):
        a0 = -90 - step / 2 + i * step
        color = t['green'] if n == 0 else t['red'] if n in RED else t['black']
        parts.append(f'<path d="{arc(cx, cy, 104, 150, a0, a0 + step)}" fill="{color}" stroke="{t["gold3"]}" stroke-width="0.8"/>')
        mid = math.radians(a0 + step / 2)
        tx, ty = cx + 129 * math.cos(mid), cy + 129 * math.sin(mid)
        parts.append(f'<text x="{tx:.1f}" y="{ty:.1f}" transform="rotate({a0 + step / 2 + 90:.1f} {tx:.1f} {ty:.1f})" font-size="11" font-family="Georgia, \'Times New Roman\', serif" fill="#f5efe0" text-anchor="middle" dominant-baseline="central">{n}</text>')
    # Separadores metálicos internos y cono central
    inner = []
    for i in range(37):
        a = math.radians(-90 - step / 2 + i * step)
        inner.append(f'<line x1="{cx + 92 * math.cos(a):.1f}" y1="{cy + 92 * math.sin(a):.1f}" x2="{cx + 104 * math.cos(a):.1f}" y2="{cy + 104 * math.sin(a):.1f}" stroke="{t["gold2"]}" stroke-width="1.2"/>')
    spokes = ''.join(f'<rect x="{cx - 3}" y="{cy - 78}" width="6" height="70" rx="3" fill="url(#gold)" transform="rotate({k * 90} {cx} {cy})"/>' for k in range(4))
    return f'''
  <g>
    <animateTransform attributeName="transform" type="rotate" from="0 {cx} {cy}" to="360 {cx} {cy}" dur="18s" repeatCount="indefinite"/>
    <circle cx="{cx}" cy="{cy}" r="150" fill="{t['black']}"/>
    {''.join(parts)}
    <circle cx="{cx}" cy="{cy}" r="104" fill="url(#bowl)" stroke="{t['gold3']}" stroke-width="1.5"/>
    {''.join(inner)}
    <circle cx="{cx}" cy="{cy}" r="92" fill="url(#bowl)" stroke="{t['gold1']}" stroke-width="1"/>
    {spokes}
    <circle cx="{cx}" cy="{cy}" r="22" fill="url(#gold)" stroke="{t['gold1']}" stroke-width="1.5"/>
    <circle cx="{cx}" cy="{cy}" r="8" fill="{t['gold2']}"/>
  </g>'''


def banner(name, t):
    cx, cy = 1040, 200
    chips = ''
    for i, (x, y, c, d, delay) in enumerate([(826, 336, t['red'], 5.5, 0), (820, 92, t['green'], 6.5, 1.2), (690, 120, t['gold3'], 7, 0.6), (1220, 340, t['red'], 6, 2), (1230, 70, t['black'], 7.5, 0.3)]):
        chips += f'''
  <g opacity="0.9">
    <animateTransform attributeName="transform" type="translate" values="0 0; 0 -14; 0 0" dur="{d}s" begin="{delay}s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1; .45 0 .55 1"/>
    <circle cx="{x}" cy="{y}" r="22" fill="{c}" stroke="{t['gold2']}" stroke-width="2"/>
    <circle cx="{x}" cy="{y}" r="22" fill="none" stroke="#f5efe0" stroke-width="5" stroke-dasharray="6 7.8" opacity="0.85"/>
    <circle cx="{x}" cy="{y}" r="13" fill="none" stroke="#f5efe0" stroke-opacity="0.6" stroke-width="1"/>
  </g>'''
    cards = ''
    for x, y, rot, label, suit, col, d in [(712, 292, -14, 'A', '♠', t['black'], 8), (748, 306, 9, 'K', '♥', t['red'], 9)]:
        cards += f'''
  <g transform="rotate({rot} {x} {y})">
    <animateTransform attributeName="transform" type="rotate" additive="sum" values="0 {x} {y}; 4 {x} {y}; 0 {x} {y}" dur="{d}s" repeatCount="indefinite"/>
    <rect x="{x - 26}" y="{y - 37}" width="52" height="74" rx="6" fill="#fffdf7" stroke="{t['gold3']}" stroke-width="1.5"/>
    <text x="{x - 18}" y="{y - 17}" font-family="Georgia, serif" font-size="15" font-weight="bold" fill="{col}">{label}</text>
    <text x="{x}" y="{y + 12}" font-family="Georgia, serif" font-size="28" fill="{col}" text-anchor="middle">{suit}</text>
  </g>'''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="Aurum Casino: casino social con créditos virtuales">
  <title>Aurum Casino</title>
  <defs>
    <radialGradient id="bg" cx="78%" cy="45%" r="85%">
      <stop offset="0" stop-color="{t['bg1']}"/>
      <stop offset="1" stop-color="{t['bg2']}"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{t['gold1']}"/>
      <stop offset="0.5" stop-color="{t['gold2']}"/>
      <stop offset="1" stop-color="{t['gold1']}"/>
    </linearGradient>
    <radialGradient id="bowl" cx="50%" cy="40%" r="60%">
      <stop offset="0" stop-color="#7a5326"/>
      <stop offset="1" stop-color="#3b2510"/>
    </radialGradient>
    <!-- Brillo que recorre el título -->
    <linearGradient id="shine" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="{t['gold3']}"/>
      <stop offset="0.44" stop-color="{t['gold3']}"/>
      <stop offset="0.5" stop-color="{t['shine']}"/>
      <stop offset="0.56" stop-color="{t['gold3']}"/>
      <stop offset="1" stop-color="{t['gold3']}"/>
      <animateTransform attributeName="gradientTransform" type="translate" values="-0.7 0; 0.7 0; 0.7 0" keyTimes="0; 0.6; 1" dur="4s" repeatCount="indefinite"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="{t['glow']}" stop-opacity="{t['glowop']}"/>
      <stop offset="1" stop-color="{t['glow']}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="{W}" height="{H}" fill="url(#bg)"/>
  <circle cx="{cx}" cy="{cy}" r="230" fill="url(#glow)">
    <animate attributeName="r" values="215;240;215" dur="5s" repeatCount="indefinite"/>
  </circle>
  {cards}
  {chips}
  <!-- Ruleta -->
  <circle cx="{cx}" cy="{cy}" r="168" fill="url(#gold)"/>
  <circle cx="{cx}" cy="{cy}" r="160" fill="#3b2510"/>
  {wheel(t, cx, cy)}
  <!-- Bola: gira en sentido contrario y va cayendo hacia los números -->
  <g>
    <animateTransform attributeName="transform" type="rotate" from="360 {cx} {cy}" to="0 {cx} {cy}" dur="3.2s" repeatCount="indefinite"/>
    <circle cx="{cx}" cy="{cy - 156}" r="7" fill="#fdfbf5" stroke="#b9b2a0" stroke-width="1">
      <animate attributeName="cy" values="{cy - 156};{cy - 140};{cy - 156}" dur="9.6s" repeatCount="indefinite"/>
    </circle>
  </g>
  <polygon points="{cx - 9},{cy - 176} {cx + 9},{cy - 176} {cx},{cy - 160}" fill="{t['gold2']}" stroke="{t['gold1']}"/>
  <!-- Texto -->
  <text x="72" y="168" font-family="Georgia, 'Times New Roman', serif" font-size="92" fill="url(#shine)" letter-spacing="1">Aurum</text>
  <text x="76" y="214" font-family="Georgia, 'Times New Roman', serif" font-size="30" fill="{t['text']}" letter-spacing="9">CASINO SOCIAL</text>
  <text x="76" y="262" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="21" fill="{t['sub']}">Póker, blackjack, ruleta, slots, bingo, cohete y plinko</text>
  <text x="76" y="291" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="21" fill="{t['sub']}">en tiempo real, con amigos y créditos virtuales.</text>
  <g font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="15" font-weight="600">
    <rect x="76" y="318" width="214" height="34" rx="17" fill="{t['pill']}" stroke="{t['gold3']}"/>
    <text x="183" y="340" text-anchor="middle" fill="{t['gold3']}">0 € · sin dinero real</text>
    <rect x="302" y="318" width="168" height="34" rx="17" fill="{t['pill']}" stroke="{t['line']}"/>
    <text x="386" y="340" text-anchor="middle" fill="{t['text']}">Código abierto</text>
  </g>
</svg>
'''


for name, theme in THEMES.items():
    (OUT / f'banner-{name}.svg').write_text(banner(name, theme), encoding='utf-8')
    print('ok', name)
