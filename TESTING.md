# Pruebas

```bash
npm test             # unitarias + integración (Vitest)
npm run typecheck    # TypeScript estricto en los tres paquetes (incluye los tests)
npm run test:e2e     # extremo a extremo (Playwright)
```

Para E2E hace falta descargar una vez el navegador: `npx playwright install chromium`. La prueba compila el frontend, arranca el servidor en el puerto 3101 con una base de datos propia (`apps/server/data/e2e.db`, se borra al empezar) y crea un administrador con la CLI.

## Resultado de la última ejecución

Ejecutado el 20/10/2026 en Linux con Node 22.22 (versión 1.3.0):

- `npm test`: **26 archivos, 379 pruebas, todas correctas**.
- `npm run test:e2e`: **17 pruebas, todas correctas** (Chromium; escritorio y móvil Pixel 7).
- `npm run typecheck`: sin errores.
- `npm audit --omit=dev`: 0 vulnerabilidades.

`npm run test:e2e:dev` (2 pruebas de animación contra el servidor de desarrollo) pasó en la 1.2.0 y no se ha vuelto a lanzar en esta versión. No se ha ejecutado todavía en Windows.

## Aleatoriedad controlada

Ninguna prueba depende de un resultado aleatorio concreto. Los motores reciben un `Rng`:

- `seededRng(semilla)` para simulaciones reproducibles;
- `sequenceRng([...])` para forzar valores;
- zapatos y mazos preparados (`parseCards`) para fijar exactamente las cartas.

Las pruebas de integración que usan el RNG real comprueban invariantes (el saldo cuadra con el libro mayor, el premio coincide con la cuadrícula) en lugar de resultados.

## Cobertura por área

### Motores (`packages/engine/test`, 134)
- `blackjack.test.ts` (17): ases blandos y duros, blackjack natural (3:2), peek, S17/H17, doblar, dividir, acciones ilegales, límites, carta tapada oculta en la vista pública, rebarajado por penetración.
- `blackjackTable.test.ts` (15): mesa con varios asientos contra un crupier común, turnos en orden, liquidación independiente por asiento, estrategias legales de los bots, vista pública sin la carta tapada.
- `poker.test.ts` (36): categorías y desempates, rueda A-5, botes secundarios, ciegas y botón, all-in, subida mínima, vista pública sin cartas ajenas, 150 manos de bots con conservación de fichas, equidad Monte Carlo.
- `assistant.test.ts` (25): descripción de la mano en cada calle, cartas de la combinación frente a acompañamiento, uso de cartas propias, proyectos de color y escalera y probabilidad exacta de mejorar.
- `roulette.test.ts` (24): casillas, colores, todas las modalidades de apuesta y sus pagos, cero, ventaja de la casa 1/37.
- `slots.test.ts` (17): líneas, comodín y multiplicador, scatter, combinaciones especiales, giros gratis, bono de cofres, RTP exacto calculado desde la definición de cada máquina y convergencia de la simulación.

### Servidor (`apps/server/test`, 84)
- `auth.test.ts` (17): hash, cookies, CSRF, orígenes, cabeceras, roles, bloqueo, saldo ilimitado del administrador, limitación de registros.
- `games.test.ts` (17): liquidación, idempotencia, saldo insuficiente, **doble liquidación imposible**, **concurrencia**, blackjack con secuencia, logros, juegos desactivados.
- `poker.test.ts` (6): partida por WebSocket sin ver cartas ajenas, desconexiones, acciones inválidas, reembolso tras caída.
- `blackjack.test.ts` (11): mesas multijugador con bots y solo personas, carta tapada que no viaja antes de tiempo, validación de apuestas, dos personas en la misma mesa, sin sesión, nombres de bot reservados, perfiles públicos, límites nuevos sin afectar a la ronda abierta, un bot nunca en dos mesas, reembolso tras reinicio, migración de bots.
- `economy.test.ts` (10): periodo diario en Madrid y cambios de hora, reclamación única con peticiones simultáneas, racha, saldo inicial configurable, anuncios sin proveedor, simulación prohibida en producción, tiempo mínimo, idempotencia y límite diario, **el navegador no puede concederse la recompensa**, firmas falsas rechazadas.
- `slots.test.ts` (4): máquinas, giros gratis sin cobro, bono de cofres con premios no enviados y sin repetir cofre.
- `formations.test.ts` (4): CRUD, validación con el motor, comprobación de saldo al cargar, aislamiento por usuario.
- `social.test.ts` (5): solicitudes y permisos de cada parte, sin duplicados, sin datos privados, bots no son usuarios, presencia real y modo invisible, notificaciones por dueño.
- `rooms.test.ts` (9): códigos, acceso solo para miembros, sala fuera del salón público, sala llena, código caducado y renovado, cierre con devolución de fichas, **póker privado con cartas privadas solo para su dueño**, blackjack privado, salas solo para amigos e invitaciones, traspaso de anfitrión y cierre automático, ajustes bloqueados, límite de intentos de código.
- `persistence.test.ts` (1): saldo, historial y sesión tras reiniciar.

### Interfaz (`apps/web/src`, 161)
Cartas SVG (111), secuenciador (7), trayectoria de la ruleta (5), tapete y pintado por arrastre (9), física de rodillos (7), presentación de slots (3), modelos de blackjack individual (4) y multijugador (7), modelo y asistente de póker (2 + 6).

### Extremo a extremo (`e2e/`, 17 + 2 en desarrollo)
Registro, cierre e inicio de sesión; ruleta pintando por arrastre, deshacer y formaciones; blackjack individual y multijugador; recompensa diaria y ausencia de anuncios sin proveedor; slots (cobro, tabla de premios, sin giro automático); póker contra bots viendo solo las propias cartas; administración; **amigos con dos navegadores** (solicitud, notificación en tiempo real, presencia, modo invisible); **salas privadas con dos navegadores** (crear, sin acceso sin código, código erróneo, entrar con código, ver miembros, cierre visto por ambos); móvil sin desbordamiento horizontal y pintado con el dedo; animaciones de cartas y rodillos.

## Comprobaciones manuales realizadas

Con capturas automatizadas en Chromium (escritorio 1440 × 900 y móvil 390 × 844): reparto y volteo de cartas, barajado, giro de ruleta con la bola terminando en el número del servidor, apuestas ganadoras resaltadas y perdedoras retiradas, rodillos con parada escalonada y línea premiada, mesa de póker con bots actuando y controles del jugador, panel de administración. No se ha medido el rendimiento en equipos modestos reales.

Versión 1.1 (14/10/2026), con capturas fotograma a fotograma en Chromium (1440 × 1000 y 412 × 915): galería de las 52 cartas a 96, 64 y 46 px; blackjack (extracción del zapato, vuelo, volteo, revelado dramático, derrota atenuada, recogida a la bandeja, totales sincronizados con las caras); póker (barajado central, reparto privado, cartas de rivales ocultas, retiradas que vuelven al crupier, flop/turn/river, fichas al bote); slots (parada escalonada, línea premiada coincidente con el motor y sus marcadores, atenuación, estados del botón); partículas de destello, ráfaga y fuegos artificiales en un banco de pruebas aislado. No se ha podido provocar un premio grande ni extraordinario real en la aplicación (el cartel correspondiente queda sin comprobar visualmente) ni escuchar el audio (entorno sin altavoces).

Versión 1.3 (15–20/10/2026), con capturas en Chromium (1440 × 1000 y 390 × 844): asistente de póker en sus tres modos, crupier y mesa multijugador de blackjack apaisada y vertical, recompensas y pantalla de recuperación, las dos máquinas de slots con giros gratis y bono de cofres, ruleta con trazos pintados, confirmación y resultado, página de amigos y campana de notificaciones, creación de sala y vista de sala con dos personas conectadas.
