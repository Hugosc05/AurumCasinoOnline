import { PlayingCard } from '../components/PlayingCard';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
const SUITS = ['s', 'h', 'd', 'c'];

/** Galería de control visual (solo en desarrollo): las 52 cartas a varios tamaños y el reverso. */
export default function CardGallery() {
  return (
    <div className="space-y-8 bg-tapete p-6">
      {[96, 62, 44].map((w) => (
        <div key={w}>
          <p className="mb-2 text-sm text-marfil">Ancho {w}px</p>
          {SUITS.map((s) => (
            <div key={s} className="mb-2 flex flex-wrap gap-2">
              {RANKS.map((r) => (
                <PlayingCard key={r + s} card={r + s} width={w} />
              ))}
              <PlayingCard card={null} faceUp={false} width={w} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
