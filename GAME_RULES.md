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

### Mesas multijugador

Mismas reglas, con varios asientos (hasta 7) contra un crupier común y un zapato de mesa. Cada ronda: ventana de apuestas con tiempo, reparto, turnos en orden de asiento (tiempo límite; al agotarse, te plantas) y liquidación independiente de cada asiento contra la mano del crupier. Hay mesas de demostración con bots y mesas solo para personas; los límites de cada mesa se muestran en el salón y los cambios de la administración se aplican desde la siguiente ronda.

## Texas Hold'em

- Mesas de hasta 6 asientos con ciega pequeña y grande (Salón Esmeralda 5/10, Mesa Zafiro 25/50, Sala Obsidiana 100/200; configurables por el administrador).
- El botón rota cada mano. En heads-up el botón pone la ciega pequeña y habla primero antes del flop.
- Reparto: una carta a cada jugador desde la izquierda del botón, dos vueltas. Se quema una carta antes del flop, del turn y del river.
- Acciones: retirarse, pasar, igualar, apostar, subir y all-in. La subida mínima es el tamaño de la última subida completa (o la ciega grande).
- Un all-in que no completa una subida no reabre la apuesta a quien ya había actuado.
- La apuesta no igualada se devuelve. Con all-ins de distintos importes se forman botes secundarios y cada jugador solo opta a lo que pudo igualar.
- Showdown: gana la mejor combinación de 5 cartas entre 7. Empates exactos se reparten; la ficha sobrante va al primer ganador a la izquierda del botón.
- Tiempo por turno: 25 s (6 s si estás desconectado). Al agotarse: pasar si es posible, si no retirarse. Tras 3 tiempos agotados seguidos, o 2 minutos desconectado, se te levanta y tus fichas vuelven a tu saldo.

**Asistente de manos** (opcional, en Perfil → Ajustes o en la mesa): resalta las cartas que forman tu combinación, explica en palabras qué tienes y, en modo estándar o avanzado, los proyectos de color o escalera y la probabilidad exacta de mejorar en la siguiente carta. Solo usa tus cartas y las comunitarias: no conoce las de nadie más.

Categorías (de mayor a menor): escalera real, escalera de color, póker, full, color, escalera, trío, doble pareja, pareja, carta alta. A-2-3-4-5 es la escalera más baja; no hay escaleras "circulares" (Q-K-A-2-3).

### Bots

Los bots son programas identificados como tales: nombre de fantasía (nunca de personas reales), avatar propio, distintivo BOT siempre visible y perfil público en «Bots del casino». Solo se sientan en mesas de demostración o en salas privadas que lo permitan; nunca se cuentan como personas conectadas, no aparecen en la clasificación ni se pueden añadir como amigos. Un bot no puede estar en dos mesas a la vez.

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

**Pintar apuestas**: con ratón, dedo o lápiz se puede tocar una casilla o arrastrar. Un trazo solo pinta el tipo de casilla en el que empieza (pleno, caballo, cuadro, transversal, seisena o exterior) y no repite ficha en la misma casilla. Hay goma de borrar, deshacer por trazo y limpiar mesa. Antes de girar siempre aparece un resumen para confirmar. Las **formaciones guardadas** solo guardan la distribución; al cargarlas el servidor comprueba que siguen siendo legales y que hay saldo.

**Integridad**: el número se sortea antes de que empiece la animación. La trayectoria de la bola se calcula para terminar en ese bolsillo (función `planSpin`, probada para los 37 bolsillos); la posición final calculada en el navegador nunca decide nada.

## Slots

Dos máquinas de 5 rodillos × 3 filas con 20 líneas (se activan las primeras N). Apuesta total = apuesta por línea × líneas. Las líneas se pagan de izquierda a derecha; en cada línea se paga solo la mejor combinación. El comodín sustituye a cualquier símbolo salvo los especiales (scatter y cofre). Pagos de línea en × apuesta por línea.

No hay giro automático: cada tirada se pide expresamente. La interfaz no muestra mensajes de «casi premio» ni anticipaciones que no correspondan al resultado ya decidido.

### Aurum Royale

Sietes, coronas y estrellas que abren giros gratis.

5 × 3, 1, 5, 10, 15, 20 líneas activables. Apuesta por línea: 1 a 100.

| Símbolo | ×3 | ×4 | ×5 |
| --- | ---: | ---: | ---: |
| J | 5 | 14 | 63 |
| Q | 5 | 18 | 72 |
| K | 7 | 27 | 99 |
| A | 9 | 32 | 126 |
| Trébol | 14 | 50 | 198 |
| Campana | 18 | 68 | 297 |
| Diamante | 27 | 99 | 495 |
| Corona | 41 | 153 | 675 |
| Siete | 63 | 270 | 1350 |
| Comodín | 99 | 495 | 3600 |
| Joyas mezcladas (diamante, corona, siete) | 5 | 15 | 50 |

- Scatter en cualquier posición: 3 pagan 2×, 4 pagan 8×, 5 pagan 40× la apuesta total.
- Giros gratis: 3 scatters dan 5, 4 scatters dan 8, 5 scatters dan 12, con premios ×2. Se juegan con la apuesta de la tirada que los activó, sin cobrar, y no se reactivan.

| RTP | Valor |
| --- | ---: |
| Juego base (líneas + scatter) | 73,01 % |
| Giros gratis (prob. 2,98 % por tirada) | 22,94 % |
| **Total** | **95,95 %** |

### Tesoro del Arrecife

La ola dobla los premios y tres cofres abren el bono de tesoros.

5 × 3, 1, 5, 10, 15, 20 líneas activables. Apuesta por línea: 1 a 100.

| Símbolo | ×3 | ×4 | ×5 |
| --- | ---: | ---: | ---: |
| Concha | 3 | 8 | 33 |
| Estrella de mar | 3 | 10 | 40 |
| Cangrejo | 5 | 17 | 66 |
| Caballito de mar | 7 | 23 | 92 |
| Tortuga | 10 | 33 | 145 |
| Delfín | 17 | 59 | 264 |
| Perla | 33 | 132 | 660 |
| Ola (comodín ×2) | 66 | 330 | 1980 |

- El comodín multiplica ×2 las líneas en las que sustituye.
- Bono de cofres: 3 símbolos Cofre (bono) (rodillos 1, 3, 5) abren 9 cofres; eliges 3. Los premios (2, 3, 4, 5, 6, 8, 10, 15, 25 × apuesta total) se fijan y barajan en el servidor al activarse; los cofres sin abrir no se envían al navegador.

| RTP | Valor |
| --- | ---: |
| Juego base (líneas) | 82,56 % |
| Bono (prob. 0,52 % por tirada) | 13,49 % |
| **Total** | **96,05 %** |

**Método del RTP** (`computeMachineRtp` en `packages/engine/src/slotMachines.ts`; `npm run rtp` lo recalcula y `npm run rules:md -w packages/engine` regenera estas tablas): se enumeran las combinaciones de símbolos de una línea ponderadas por la frecuencia de cada tira (rodillos independientes y parada uniforme); scatter y cofres se calculan con su distribución exacta gracias a la separación garantizada en las tiras; los giros gratis se valoran como su número esperado × RTP del juego base × multiplicador; el bono, como la media de elegir 3 de los 9 premios. Una prueba compara cada valor con una simulación. El RTP es un promedio a muy largo plazo; en sesiones cortas la variación es enorme.

### Categorías de celebración

Según premio total / apuesta total: pequeño (< 4×), medio (4–15×), grande (15–50×) y extraordinario (≥ 50×). Solo cambian la intensidad visual y sonora; no alteran ningún resultado.

## Logros y rachas

Se calculan exclusivamente a partir de rondas liquidadas: primera victoria, rachas de 3/5/10 victorias, blackjack natural, full o mejor en póker, póker o escalera de color, premio de 15× o más en slots, pleno en ruleta, 50 y 250 partidas y nueva mejor marca. Una victoria es recibir más de lo apostado; un empate no rompe la racha. Las rachas describen el pasado y la interfaz lo recuerda: no predicen la siguiente jugada.

## Promociones virtuales

- **Recompensa diaria**: 1.000 créditos por defecto, una vez por día natural en la zona horaria configurada (Europe/Madrid por defecto, con los cambios de hora). Racha amable: +100 por cada uno de los 6 días anteriores en que se reclamó (hasta +600); saltarse un día no reinicia nada, solo deja de sumar ese día. La cuenta atrás muestra cuándo vuelve a estar disponible.
- **Recarga de demostración**: 5.000 créditos si el saldo es inferior a 500, una vez al día. Queda registrada como movimiento propio; el historial no se altera.
- **Anuncios recompensados**: desactivados por defecto. Si se configura un proveedor, cada anuncio completado y confirmado por el proveedor (llamada firmada servidor a servidor) da los créditos configurados, con límite diario.

Importes configurables por el administrador. Nada de esto se puede comprar ni canjear: los créditos no tienen valor económico.

## Salas privadas

Póker y blackjack con las mismas reglas que las mesas públicas, solo para quien tenga el código o una invitación. El anfitrión fija nombre, asientos, límites, privacidad (con código o solo amigos) y si se admiten bots (que siguen marcados como bots). En póker se puede elegir **fichas de sala**: todos empiezan con las mismas fichas y el saldo no cambia. Los límites nuevos se aplican desde la siguiente mano. El código caduca a las 24 h y se puede renovar. Si el anfitrión se desconecta más de 90 s, la sala pasa a otro miembro conectado; sin nadie conectado durante 15 min, la sala se cierra y se devuelven las fichas.
