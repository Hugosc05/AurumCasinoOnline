# Guía de animación y dirección artística

Todas las animaciones de Aurum comparten tokens (`apps/web/src/lib/anim/tokens.ts`) y un motor de secuencias (`lib/anim/sequencer.ts`). La regla de oro: **las animaciones representan resultados ya decididos por el servidor; nunca los deciden ni los alteran.**

## Identidad visual

| Token | Valor | Uso |
| --- | --- | --- |
| Noche | `#060A13` | Fondo general |
| Abismo / Marino | `#0D1526` / `#16223D` | Paneles y relieve |
| Oro / Oro claro | `#CFAE6B` / `#EBD9A6` | Grabados, cifras, acciones principales (nunca grandes superficies) |
| Tapete | `#0D4733` | Solo superficies de juego, con textura de ruido |
| Rubí | `#B02A3C` | Números rojos, pérdidas, avisos |
| Marfil / Niebla | `#EEE7D7` / `#8A93A6` | Texto principal / secundario |

Tipografía: **Bodoni Moda** (didona, rótulos y cifras: la estética de la señalética de casino art déco) y **Manrope** (interfaz). Motivo propio: el **arco** (puertas de los juegos en la portada y en promociones). Cada juego tiene su personalidad (madera y metal en la ruleta, mueble con marquesina en las slots, mesa ovalada en el póker, mesa semicircular con crupier en el blackjack) dentro de la misma paleta.

## Duraciones estándar (nivel completo)

| Elemento | ms |
| --- | ---: |
| Microinteracción (pulsación) | 120 |
| Ficha que aparece / selección | 220 |
| Vuelo de carta | 520 |
| Pausa entre cartas | 170 |
| Volteo de carta | 420 |
| Ficha en vuelo | 480 |
| Barajado completo | 2.100 |
| Giro de ruleta | 7.600 |
| Giro base de un rodillo / escalonado | 1.400 / 260 |
| Celebración pequeña / media / grande | 900 / 1.600 / 2.600 |
| Transición de pantalla | 320 |

Niveles: **completo** (×1), **reducido** (×0,35, sin rebotes ni desplazamientos grandes) y **desactivado** (×0: estado final al instante). Si el sistema pide `prefers-reduced-motion`, el nivel mínimo es «reducido».

## Curvas

- `out` `[0.22, 1, 0.36, 1]`: cartas, fichas, paneles (arranque rápido, frenado largo).
- `inOut` `[0.65, 0, 0.35, 1]`: volteos.
- `settle` `[0.34, 1.36, 0.64, 1]`: aterrizajes con asentamiento.
- Muelles (`stiffness` 260–420, `damping` 22–36) para recolocaciones e interfaces.

## Profundidad y sombras

La altura aparente se expresa con escala (máx. +12 %) y una sombra desenfocada que se separa y crece en el punto más alto del arco y se recoge al aterrizar. Solo se animan `transform` y `opacity` (también en la sombra), salvo el desenfoque de movimiento de los rodillos, que se activa únicamente a velocidad de crucero.

## Comportamiento de cartas y fichas

- **Cartas**: salen del zapato o de la bandeja del crupier, recorren un arco con rotación, aterrizan con un pequeño asentamiento y después se voltean. La carta doblada se coloca de lado. Las posiciones se calculan en coordenadas del escenario, así que el destino es el mismo en móvil y escritorio.
- **Fichas**: viajan en arco desde el selector o desde el jugador hasta la mesa o el bote; las pilas se dibujan por denominaciones con desplazamiento vertical. Al ganar, las fichas del crupier llegan a la apuesta; al perder, la apuesta se desliza hacia el crupier.
- **Ruleta**: la rueda decelera exponencialmente; la bola gira en sentido contrario por la pista, frena, desciende con rebotes amortiguados entre separadores y queda solidaria con la rueda en el bolsillo decidido.
- **Rodillos**: anticipación hacia arriba, aceleración, crucero con desenfoque, frenado y asentamiento; los símbolos que pasan son los de la tira real en su orden.

## Cartas

Un único componente (`PlayingCard`) para todos los juegos. Caras en SVG sin fuentes: índices trazados, pips del palo, figuras originales simétricas. Por debajo de 64 px en pantalla se usa la variante compacta (rango y palo grandes). El volteo es en dos fases: gira hasta 90°, cambia de cara y completa el giro, de modo que en el DOM solo existe una cara a la vez y una carta oculta nunca expone su valor.

## Jerarquía de celebración

La intensidad depende solo de la categoría real del premio que devuelve el servidor:

1. Normal (`small`): resaltado de la combinación, contador y destello.
2. Destacado (`medium`/`big`): + partículas con monedas, brillo del marco y luces de la marquesina.
3. Excepcional (`mega`, ≥ 50 × la apuesta): + fuegos artificiales y cartel con el multiplicador.

Las partículas se detienen solas (sin bucles infinitos), están limitadas a 650 a la vez y se pueden reducir o desactivar en **Efectos de celebración**; nunca superan el nivel de animación elegido. Las derrotas no tienen celebración ni sonidos que inviten a seguir.

## Errores, esperas y concurrencia

- Al pulsar una acción, el botón responde de inmediato y entra en estado de carga; el secuenciador bloquea nuevas acciones mientras corre una secuencia (anti doble clic).
- Si la red tarda, el estado intermedio es explícito («No va más», spinner en el botón); si falla, se restaura el saldo mostrado y se avisa con un mensaje que dice qué pasó.
- En póker, si se acumulan actualizaciones (pestaña oculta o red lenta) se saltan las animaciones y se aplica la instantánea del servidor.
- Las secuencias largas se saltan con el botón «Saltar» o con Espacio; saltar ejecuta todos los efectos, así que el estado final siempre coincide con el del servidor.
- Al desmontar un componente se cancelan secuencias, `requestAnimationFrame` y temporizadores.

## Móvil

Blackjack y póker usan una geometría vertical propia por debajo de 640 px; el tapete de la ruleta gira a vertical por debajo de 768 px; los rodillos ajustan su tamaño al ancho y al alto disponibles. Todos los controles son accesibles por teclado y táctiles; el hover nunca es la única pista.

## Sonido

Motor único (`lib/audio.ts`) con sonidos sintetizados: deslizamiento, aterrizaje y volteo de cartas, riffle, fichas, rodadura y golpes de la bola, rodillos, botones, victoria, derrota y logros. **Desactivado por defecto**: no suena nada hasta que el usuario lo activa (icono del altavoz en la cabecera, en la consola de las slots o en Perfil → Ajustes). Volumen y silencio se guardan en la cuenta. Cada sonido tiene una separación mínima y hay un máximo de 16 voces simultáneas, así que los repartos rápidos no saturan. No hay música ni bucles insistentes.
