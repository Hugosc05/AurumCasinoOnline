import { ROULETTE_BET_LABELS, ROULETTE_PAYOUTS, SLOT_MACHINES } from '@aurum/engine';
import type { ReactNode } from 'react';
import { SlotPaytable } from '../games/slots/SlotPaytable';

type Kind = 'rules' | 'help' | 'privacy' | 'terms' | 'responsible';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-2xl text-marfil">{title}</h2>
      <div className="space-y-3 leading-relaxed text-niebla [&_strong]:text-marfil">{children}</div>
    </section>
  );
}

function Rules() {
  return (
    <>
      <Section title="Blackjack">
        <p>Se juega con un zapato de seis barajas que se rebaraja al consumir el 75 %. El crupier recibe una carta descubierta y otra tapada; si la descubierta es un as o vale 10, comprueba si tiene blackjack antes de que juegues.</p>
        <p>Puedes <strong>pedir</strong>, <strong>plantarte</strong>, <strong>doblar</strong> con tus dos primeras cartas (también tras dividir) y <strong>dividir</strong> una pareja una vez. Los ases divididos reciben una sola carta. El crupier se planta en todos los 17. El blackjack natural paga 3 a 2 (redondeado hacia abajo), una victoria 1 a 1 y el empate devuelve la apuesta.</p>
      </Section>
      <Section title="Texas Hold'em">
        <p>Mesas de hasta seis jugadores con ciegas pequeña y grande. Cada jugador recibe dos cartas privadas; después llegan el flop (tres cartas), el turn y el river, con una ronda de apuestas en cada fase. Gana la mejor combinación de cinco cartas entre las siete disponibles; los empates se reparten.</p>
        <p>Si alguien va all-in por menos, se forman botes secundarios: cada jugador solo puede ganar lo que pudo igualar. Una subida all-in incompleta no reabre la apuesta a quien ya había actuado. Tienes 25 segundos por turno; si se agota, pasas si es posible o te retiras.</p>
        <p>Combinaciones, de mayor a menor: escalera real, escalera de color, póker, full, color, escalera, trío, doble pareja, pareja y carta alta.</p>
      </Section>
      <Section title="Ruleta europea">
        <p>Rueda de 37 casillas (0–36). El número lo sortea el servidor con un generador criptográficamente seguro antes de que empiece la animación. El cero hace perder todas las apuestas exteriores.</p>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full max-w-md text-sm">
            <tbody>
              {(Object.keys(ROULETTE_PAYOUTS) as (keyof typeof ROULETTE_PAYOUTS)[]).map((k) => (
                <tr key={k} className="border-b border-linea/50">
                  <td className="py-1.5 text-marfil">{ROULETTE_BET_LABELS[k]}</td>
                  <td className="py-1.5 text-right">{ROULETTE_PAYOUTS[k]} a 1</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>Ventaja de la casa: 1/37 ≈ 2,70 % en todas las apuestas.</p>
      </Section>
      {SLOT_MACHINES.map((m) => (
        <Section key={m.id} title={`Slots ${m.name}`}>
          <p>Cinco rodillos y tres filas, con 1, 5, 10, 15 o 20 líneas activas. Los pagos de línea multiplican la apuesta por línea; en cada línea se paga solo la mejor combinación. Se calcula el RTP de forma exacta (no por simulación) a partir de las tiras de los rodillos, funciones especiales incluidas; es un valor a largo plazo y en sesiones cortas el resultado varía mucho.</p>
          <SlotPaytable machine={m} />
        </Section>
      ))}
    </>
  );
}

const CONTENT: Record<Kind, { title: string; body: () => ReactNode }> = {
  rules: { title: 'Reglas y pagos', body: Rules },
  help: {
    title: 'Ayuda',
    body: () => (
      <>
        <Section title="Saldo y créditos">
          <p>Al registrarte recibes 10.000 créditos virtuales. Cada día puedes reclamar un bono en Promociones y, si tu saldo baja de 500, una recarga de demostración. Todo queda registrado en tu historial de movimientos.</p>
        </Section>
        <Section title="Si se corta la conexión">
          <p>Las manos de blackjack quedan guardadas: al volver verás la mano en el punto exacto. En póker, si te desconectas, tus turnos se resuelven automáticamente (pasar o retirarse) y, tras dos minutos sin volver, te levantamos de la mesa y tus fichas vuelven a tu saldo.</p>
        </Section>
        <Section title="Animaciones y sonido">
          <p>En tu perfil puedes elegir animaciones completas, reducidas o desactivadas y ajustar el volumen. Si tu sistema pide reducir el movimiento, Aurum lo respeta. Las animaciones largas se pueden saltar con el botón «Saltar» o la tecla Espacio.</p>
        </Section>
        <Section title="Bots">
          <p>Los bots de póker son programas, no personas: su nombre empieza por «Bot» y llevan un distintivo. Deciden con su propia mano, las cartas comunitarias y la información pública de la mesa; nunca ven tus cartas. Son razonablemente sólidos, pero no son invencibles ni juegan de forma óptima.</p>
        </Section>
      </>
    ),
  },
  privacy: {
    title: 'Privacidad',
    body: () => (
      <>
        <Section title="Qué datos guardamos">
          <p>Nombre de usuario, correo, la contraseña transformada con scrypt (nunca en claro), tus preferencias y el historial de partidas y movimientos de créditos virtuales. Todo se guarda en la base de datos local de la instancia donde se ejecuta Aurum.</p>
        </Section>
        <Section title="Qué se muestra públicamente">
          <p>Tu nombre de usuario aparece en la clasificación. En «Últimos premios» se muestra de forma anonimizada (solo algunas letras). Tu correo no se muestra nunca.</p>
        </Section>
        <Section title="Cookies">
          <p>Una única cookie de sesión, httpOnly y SameSite=Strict, imprescindible para mantenerte conectado. No hay cookies de publicidad ni de seguimiento.</p>
        </Section>
      </>
    ),
  },
  terms: {
    title: 'Condiciones de uso',
    body: () => (
      <Section title="Proyecto de demostración">
        <p>Aurum es software de entretenimiento sin dinero real. Los créditos no tienen valor económico, no se pueden comprar, vender, canjear ni transferir fuera del juego. No existen depósitos, retiradas ni premios reales.</p>
        <p>La administración puede ajustar saldos, desactivar juegos o suspender cuentas que abusen del servicio. Cada acción administrativa queda registrada.</p>
      </Section>
    ),
  },
  responsible: {
    title: 'Juego responsable',
    body: () => (
      <>
        <Section title="Cada resultado es independiente">
          <p>Las cartas, la ruleta y los rodillos no tienen memoria. Una racha, buena o mala, no cambia la probabilidad de la siguiente partida. Los indicadores de racha de Aurum describen lo que ya ha pasado, no lo que va a pasar.</p>
        </Section>
        <Section title="Si el juego con dinero real te preocupa">
          <p>Aurum no usa dinero real. Si tú o alguien cercano tiene problemas con el juego, en España puedes consultar los recursos de <a className="text-oro-claro underline" href="https://www.jugarbien.es" target="_blank" rel="noreferrer noopener">jugarbien.es</a>, el portal de juego responsable de la Dirección General de Ordenación del Juego.</p>
        </Section>
      </>
    ),
  },
};

export function InfoPage({ kind }: { kind: Kind }) {
  const c = CONTENT[kind];
  const Body = c.body;
  return (
    <article className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-5xl text-marfil">{c.title}</h1>
      <div className="hairline mt-6 max-w-xs" />
      <Body />
    </article>
  );
}
