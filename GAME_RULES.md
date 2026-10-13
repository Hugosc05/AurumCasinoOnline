# Reglas de los juegos

Todos los resultados se generan en el servidor con `crypto.randomInt` (generador criptográficamente seguro del sistema operativo). Ningún resultado depende del saldo, de las rachas ni de lo que haya pasado antes. Los créditos son virtuales.

## Blackjack

| Regla | Valor |
| --- | --- |
| Barajas | 6 (312 cartas) |
| Rebarajado | Al consumir el 75 % del zapato (el zapato se conserva por jugador entre manos) |
| Crupier | Se planta en todos los 17 (S17); configurable a H17 en el motor |
| Peek | Con as o figura descubierta, el crupier comprueba blackjack antes de que juegues |
| Blackjack natural | Paga 3:2 (la fracción se redondea hacia abajo con apuestas impares) |
| Victoria / empate | 1:1 / devolución |
| Doblar | Con las dos primeras cartas, también tras dividir; recibe una sola carta |
| Dividir | Una vez por mano, cartas del mismo valor; los ases divididos reciben una sola carta; 21 tras dividir no es blackjack |
| Seguro / rendición | No disponibles |
| Apuesta | 10 a 5.000 |

Si te pasas de 21 pierdes aunque el crupier también se pase; si todas tus manos se pasan, el crupier no roba.

## Texas Hold'em

- Mesas de hasta 6 asientos con ciega pequeña y grande (Salón Esmeralda 5/10, Mesa Zafiro 25/50, Sala Obsidiana 100/200; configurables por el administrador).
- El botón rota cada mano. En heads-up el botón pone la ciega pequeña y habla primero antes del flop.
- Reparto: una carta a cada jugador desde la izquierda del botón, dos vueltas. Se quema una carta antes del flop, del turn y del river.
- Acciones: retirarse, pasar, igualar, apostar, subir y all-in. La subida mínima es el tamaño de la última subida completa (o la ciega grande).
- Un all-in que no completa una subida no reabre la apuesta a quien ya había actuado.
- La apuesta no igualada se devuelve. Con all-ins de distintos importes se forman botes secundarios y cada jugador solo opta a lo que pudo igualar.
- Showdown: gana la mejor combinación de 5 cartas entre 7. Empates exactos se reparten; la ficha sobrante va al primer ganador a la izquierda del botón.
- Tiempo por turno: 25 s (6 s si estás desconectado). Al agotarse: pasar si es posible, si no retirarse. Tras 3 tiempos agotados seguidos, o 2 minutos desconectado, se te levanta y tus fichas vuelven a tu saldo.

Categorías (de mayor a menor): escalera real, escalera de color, póker, full, color, escalera, trío, doble pareja, pareja, carta alta. A-2-3-4-5 es la escalera más baja; no hay escaleras "circulares" (Q-K-A-2-3).

### Bots

Los bots son programas identificados como tales (nombre «Bot …», distintivo BOT y perfil visible). Solo se sientan para completar mesas y nunca se cuentan como jugadores ni aparecen en la clasificación.

| Perfil | Comportamiento |
| --- | --- |
| Conservador | Umbral de mano inicial alto, apuesta por valor solo con mucha equidad, casi nunca farolea, paga con margen. |
| Agresivo | Juega más manos, apuesta grande y farolea con más frecuencia (también semifaroles con proyectos). |
| Equilibrado | Selección de manos según posición, agresividad moderada. |
| Analítico | Como el equilibrado, pero ajusta cuánto paga según las estadísticas públicas del rival que apuesta (VPIP y factor de agresión observados en la mesa). |

Cómo deciden:

- **Antes del flop**: fórmula de Chen para la fuerza de la mano, ajustada por posición y por si hay subida previa; robos de ciegas ocasionales desde posiciones tardías.
- **Después del flop**: equidad estimada por **Monte Carlo** contra manos aleatorias de los rivales activos (150, 400 o 1.000 iteraciones según dificultad, con un límite de 40 ms). Se compara con las *pot odds* más un margen de perfil; se ajusta si la apuesta es grande respecto al stack.
- **Información**: solo sus dos cartas, el tablero, los importes y las acciones públicas. El servidor no les entrega cartas ajenas (y hay pruebas que lo verifican para la vista de los jugadores).
- **Dificultad**: además de las iteraciones, añade ruido a su lectura de la equidad (±12 %, ±5 %, ±1,5 %).
- **Tiempos**: piensan entre ~0,7 y ~2,5 s, variable, para que no actúen todos igual.

**Limitaciones**: no son estrategias de equilibrio (GTO) ni están resueltas; asumen rangos aleatorios del rival en lugar de rangos condicionados por sus acciones; el modelo de rival es simple y necesita al menos 8 manos de historial; no planifican varias calles. Juegan de forma creíble y castigan errores evidentes, pero son explotables. La banca de cada bot es interna y se repone si se agota (son fichas de demostración, no de usuarios).

## Ruleta europea

37 casillas (0–36) en el orden real de la rueda: 0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26. Rojos: 1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36.

| Apuesta | Cubre | Pago |
| --- | --- | --- |
| Pleno | 1 número | 35:1 |
| Caballo | 2 números contiguos (incluye 0-1, 0-2, 0-3) | 17:1 |
| Transversal | 3 números de una fila (incluye tríos 0-1-2 y 0-2-3) | 11:1 |
| Cuadro | 4 números (incluye 0-1-2-3) | 8:1 |
| Seisena | 6 números (dos transversales contiguas) | 5:1 |
| Docena / Columna | 12 números | 2:1 |
| Rojo/Negro, Par/Impar, Falta (1-18)/Pasa (19-36) | 18 números | 1:1 |

El 0 hace perder todas las apuestas exteriores (no se aplica *la partage*). La ventaja de la casa es 1/37 ≈ 2,70 % en todas las apuestas (verificado en las pruebas).

Límites: mínimo 1 por apuesta; 1.000 por apuesta interior, 10.000 por exterior, 50.000 por giro, 60 apuestas distintas.

**Integridad**: el número se sortea antes de que empiece la animación. La trayectoria de la bola se calcula para terminar en ese bolsillo (función `planSpin`, probada para los 37 bolsillos); la posición final calculada en el navegador nunca decide nada.

## Slots — Aurum Royale

5 rodillos × 3 filas, 20 líneas fijas (se activan 1, 5, 10, 15 o 20, las primeras N). Apuesta por línea: 1 a 100. Apuesta total = apuesta por línea × líneas.

### Pagos de línea (× apuesta por línea, desde el rodillo izquierdo)

| Símbolo | ×3 | ×4 | ×5 |
| --- | ---: | ---: | ---: |
| J | 8 | 20 | 90 |
| Q | 8 | 30 | 110 |
| K | 12 | 40 | 150 |
| A | 15 | 45 | 180 |
| Trébol | 20 | 75 | 300 |
| Campana | 30 | 100 | 450 |
| Diamante | 45 | 150 | 750 |
| Corona | 60 | 225 | 1.000 |
| Siete | 90 | 400 | 2.000 |
| Comodín (WILD) | 150 | 750 | 5.000 |

- El comodín sustituye a cualquier símbolo salvo la estrella. En cada línea se paga solo la combinación de mayor premio (por ejemplo, W-W-W-7-7 paga cinco sietes).
- **Estrella (scatter)**: 3, 4 o 5 visibles en cualquier posición pagan 2×, 10× o 50× la apuesta **total**. Las tiras están construidas para que nunca haya dos estrellas en la misma ventana de un rodillo.

### Composición de los rodillos

| Rodillo | J | Q | K | A | Trébol | Campana | Diamante | Corona | Siete | Comodín | Estrella | Total |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| 1 | 6 | 6 | 5 | 5 | 4 | 3 | 3 | 2 | 2 | 1 | 2 | 39 |
| 2 | 6 | 5 | 5 | 4 | 4 | 3 | 3 | 2 | 2 | 2 | 2 | 38 |
| 3 | 5 | 5 | 5 | 4 | 4 | 3 | 3 | 3 | 2 | 2 | 2 | 38 |
| 4 | 6 | 5 | 5 | 4 | 4 | 3 | 3 | 2 | 2 | 2 | 2 | 38 |
| 5 | 6 | 6 | 5 | 5 | 4 | 3 | 3 | 2 | 2 | 1 | 2 | 39 |

Cada rodillo se detiene en una de sus posiciones con probabilidad uniforme e independiente (83.460.312 combinaciones de paradas).

### RTP teórico (cálculo exacto)

| Componente | Valor |
| --- | ---: |
| Líneas | 86,8404 % |
| Estrellas | 8,4148 % |
| **Total** | **95,2552 %** |
| Frecuencia de premio por línea | 3,0205 % |

Método (`computeRtp` en `packages/engine/src/slots.ts`, ejecutable con `npm run rtp`):

1. En una línea cualquiera, el símbolo de cada rodillo sigue la distribución de su tira y los rodillos son independientes. Se enumeran todas las combinaciones de símbolos ponderadas por su frecuencia y se suma `probabilidad × multiplicador`.
2. Para las estrellas, la probabilidad de ver una en un rodillo es `3 · nº_estrellas / longitud` (gracias a la separación garantizada), y el número total sigue una distribución de Poisson-binomial.
3. El RTP no depende del número de líneas activas porque los pagos de línea van sobre la apuesta por línea y los de estrella sobre la total.

Una prueba compara el valor teórico con una simulación de 200.000 tiradas (tolerancia ±5 puntos, solo como comprobación de coherencia). El RTP es un promedio a muy largo plazo; en sesiones cortas la variación es enorme.

### Categorías de celebración

Según premio total / apuesta total: pequeño (< 4×), medio (4–15×), grande (15–50×) y extraordinario (≥ 50×). Solo cambian la intensidad visual y sonora; no alteran ningún resultado.

## Logros y rachas

Se calculan exclusivamente a partir de rondas liquidadas: primera victoria, rachas de 3/5/10 victorias, blackjack natural, full o mejor en póker, póker o escalera de color, premio de 15× o más en slots, pleno en ruleta, 50 y 250 partidas y nueva mejor marca. Una victoria es recibir más de lo apostado; un empate no rompe la racha. Las rachas describen el pasado y la interfaz lo recuerda: no predicen la siguiente jugada.

## Promociones virtuales

- **Bono diario**: 1.000 créditos, una vez al día (UTC).
- **Recarga de demostración**: 5.000 créditos si el saldo es inferior a 500, una vez al día. Queda registrada como movimiento propio; el historial no se altera.

Importes configurables por el administrador.
