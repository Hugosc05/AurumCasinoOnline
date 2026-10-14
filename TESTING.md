# Pruebas

```bash
npm test             # unitarias + integración (Vitest)
npm run typecheck    # TypeScript estricto en los tres paquetes (incluye los tests)
npm run test:e2e     # extremo a extremo (Playwright)
```

Para E2E hace falta descargar una vez el navegador: `npx playwright install chromium`. La prueba compila el frontend, arranca el servidor en el puerto 3101 con una base de datos propia (`apps/server/data/e2e.db`, se borra al empezar) y crea un administrador con la CLI.

## Resultado de la última ejecución

Ejecutado el 14/10/2026 en Linux con Node 22.22:

- `npm test`: **16 archivos, 267 pruebas, todas correctas**.
- `npm run test:e2e`: **7 pruebas, todas correctas** (Chromium incluido con Playwright 1.56; escritorio y móvil Pixel 7).
- `npm run typecheck`: sin errores.

No se ha ejecutado todavía en Windows: el código no depende de binarios nativos propios, pero conviene lanzar `npm test` tras la primera instalación.

## Aleatoriedad controlada

Ninguna prueba depende de un resultado aleatorio concreto. Los motores reciben un `Rng`:

- `seededRng(semilla)` para simulaciones reproducibles;
- `sequenceRng([...])` para forzar valores;
- zapatos y mazos preparados (`parseCards`) para fijar exactamente las cartas.

Las pruebas de integración que usan el RNG real comprueban invariantes (el saldo cuadra con el libro mayor, el premio coincide con la cuadrícula) en lugar de resultados.

## Cobertura por área

### Blackjack (`packages/engine/test/blackjack.test.ts`, 17)
Ases blandos y duros, blackjack natural (3:2), blackjack de ambos, peek del crupier, bust sin robo del crupier, victoria del jugador y del crupier, empate, S17 y H17, doblar, acciones ilegales y tras liquidar, división, límites de apuesta, carta tapada oculta en la vista pública, rebarajado por penetración.

### Póker (`packages/engine/test/poker.test.ts`, 36)
Las diez categorías y su orden, rueda A-5, sin escaleras circulares, escalera de color al 5, desempates por kicker, doble pareja, full con dos tríos, color, empate exacto, botes secundarios (incluidos aportes de retirados), apuesta no igualada, rotación del botón y ciegas, heads-up, acciones fuera de turno, subida mínima, saldo insuficiente, mano completa hasta el showdown, all-in con bote secundario y conservación de fichas, reparto automático con todos all-in, all-in corto que no reabre, vista pública sin cartas ajenas, 150 manos de bots con conservación de fichas, fórmula de Chen, equidad Monte Carlo (AA ≈ 85 %), decisiones de bots y que nunca se retiran pudiendo pasar.

### Ruleta (`packages/engine/test/roulette.test.ts`, 24)
37 casillas únicas, alternancia de colores en la rueda, colores, sorteo con RNG inyectado, validez de caballos, transversales, cuadros y seisenas, límites, pago de cada una de las 13 modalidades, apuestas perdedoras, tratamiento del cero, liquidación combinada y ventaja de la casa 1/37 en todas las apuestas.

### Slots (`packages/engine/test/slots.test.ts`, 12)
20 líneas únicas, evaluación de izquierda a derecha, sustitución del comodín y mejor pago, scatter sobre apuesta total, líneas activas, límites de apuesta, coherencia entre paradas, cuadrícula y liquidación (500 tiradas), RNG inyectado, categorías de premio, separación de scatters, RTP exacto y convergencia de una simulación de 200.000 tiradas.

### Seguridad y persistencia (`apps/server/test`, 41)
- `auth.test.ts` (17): registro con hash scrypt y cookie httpOnly/SameSite, duplicados, validación, intento de auto-asignarse rol o saldo, login por usuario y correo, logout, bloqueo tras 5 fallos, usuario inexistente, cookie inventada, CSRF, origen no permitido, JSON mal formado, cabeceras de seguridad, roles (401/403/200), saldo ilimitado del administrador sin alterar el saldo guardado, protección del rol, ajustes auditados y suspensión, limitación de registros.
- `games.test.ts` (17): liquidación de ruleta y libro mayor, rechazo de apuestas inválidas sin cobrar, idempotencia, saldo insuficiente, coherencia premio/cuadrícula en slots, límites, manos completas de blackjack con control de secuencia y carta oculta, una mano a la vez y recuperación, manos ajenas, **doble liquidación imposible**, **concurrencia** (25 tiradas simultáneas con saldo para 5), misma clave en paralelo, promociones, estadísticas y logros, actividad anonimizada, juegos desactivados, diagnóstico.
- `poker.test.ts` (6): lobby real, partida completa por WebSocket sin ver cartas ajenas y con cobro al levantarse, **desconexión que no bloquea la mesa**, acciones fuera de turno y entradas inválidas, WebSocket sin sesión, **reembolso de fichas tras una caída del servidor**.
- `persistence.test.ts` (1): saldo, historial y sesión tras reiniciar el servidor.

### Interfaz (`apps/web/src/**/*.test.ts`, 23)
Secuenciador de animaciones (orden, velocidad, anti doble clic, saltar ejecuta todos los efectos, cancelar, errores, animaciones desactivadas), trayectoria de la ruleta (termina en el bolsillo del servidor para los 37 números, deceleración continua, continuidad), tapete (todas las zonas generan apuestas válidas para el servidor), recorrido de rodillos (empieza y termina en las ventanas correctas siguiendo la tira real), modelos visuales de blackjack y póker.

### Cartas (`apps/web/src/components/cards/cards.test.tsx`, 111)
Para las 52 cartas: rango y palo correctos, color del palo en índices y pips, número de pips, as y figuras, índice inferior girado, ausencia de elementos `<text>` (no dependen de fuentes), variante compacta e identificadores SVG únicos. Una carta boca abajo no expone rango ni palo en el DOM, y la variante compacta se elige según el tamaño real en pantalla.

### Presentación de slots (`apps/web/src/games/slots/presentation.test.ts`, 3)
En 3000 tiradas: las líneas dibujadas son exactamente las del motor (ni inventadas ni omitidas), cada celda resaltada está en el recorrido real de la línea, la suma presentada es el premio liquidado, un único evento de total, celebración según la categoría real y orden de mayor a menor premio.

### Extremo a extremo (`e2e/`, 7)
Registro, cierre e inicio de sesión; ruleta; blackjack; slots; póker contra bots (ver las propias cartas y levantarse); acceso de administración; móvil sin desbordamiento horizontal y menú.

## Comprobaciones manuales realizadas

Con capturas automatizadas en Chromium (escritorio 1440 × 900 y móvil 390 × 844): reparto y volteo de cartas, barajado, giro de ruleta con la bola terminando en el número del servidor, apuestas ganadoras resaltadas y perdedoras retiradas, rodillos con parada escalonada y línea premiada, mesa de póker con bots actuando y controles del jugador, panel de administración. No se ha medido el rendimiento en equipos modestos reales.

Versión 1.1 (14/10/2026), con capturas fotograma a fotograma en Chromium (1440 × 1000 y 412 × 915): galería de las 52 cartas a 96, 64 y 46 px; blackjack (extracción del zapato, vuelo, volteo, revelado dramático, derrota atenuada, recogida a la bandeja, totales sincronizados con las caras); póker (barajado central, reparto privado, cartas de rivales ocultas, retiradas que vuelven al crupier, flop/turn/river, fichas al bote); slots (parada escalonada, línea premiada coincidente con el motor y sus marcadores, atenuación, estados del botón); partículas de destello, ráfaga y fuegos artificiales en un banco de pruebas aislado. No se ha podido provocar un premio grande ni extraordinario real en la aplicación (el cartel correspondiente queda sin comprobar visualmente) ni escuchar el audio (entorno sin altavoces).
