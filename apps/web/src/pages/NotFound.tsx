import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="font-display text-8xl gold-text">0</p>
      <h1 className="mt-4 text-3xl text-marfil">Esta mesa no existe</h1>
      <p className="mt-3 text-niebla">La dirección no corresponde a ninguna página de Aurum.</p>
      <Link to="/" className="mt-8 inline-block text-oro-claro hover:underline">Volver al salón</Link>
    </div>
  );
}
