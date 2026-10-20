# API

Base: `/api`. Todas las respuestas son JSON. Las peticiones que modifican estado (POST, PATCH) deben incluir la cabecera **`X-Requested-With: aurum`** y enviarse desde un origen permitido; la sesión viaja en la cookie `aurum_sid` (httpOnly).

Errores:

```json
{ "error": { "code": "INSUFFICIENT_FUNDS", "message": "Saldo virtual insuficiente", "details": null } }
```

| Estado | Códigos habituales |
| --- | --- |
| 400 | `VALIDATION_ERROR` (con `details.fields`), `INVALID_JSON`, `INVALID_BET`, `ILLEGAL_ACTION`, `INVALID_NUMBERS` |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS` |
| 402 | `INSUFFICIENT_FUNDS` |
| 403 | `FORBIDDEN`, `ACCOUNT_DISABLED`, `ROOM_FORBIDDEN` |
| 404 | `NOT_FOUND`, `ROUND_NOT_FOUND` |
| 409 | `ALREADY_EXISTS`, `DUPLICATE_REQUEST`, `ROUND_IN_PROGRESS`, `STALE_ACTION`, `ALREADY_SETTLED`, `ALREADY_CLAIMED`, `ALREADY_SENT`, `ALREADY_FRIENDS`, `ROOM_FULL`, `ROOM_CLOSED`, `CODE_EXPIRED`, `LOCKED` |
| 429 | `RATE_LIMITED`, `ACCOUNT_LOCKED` (con `details.retryAfterSec`) |
| 503 | `GAME_DISABLED` |

Objeto `balance`: `{ "balance": 10450, "unlimited": false }` (administradores: `{ "balance": null, "unlimited": true }`).

## Públicos

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/health` | Estado y tiempo activo |
| GET | `/lobby` | Juegos habilitados, mesas de póker (humanos y bots por separado), conectados reales, jugadores registrados, aviso |
| GET | `/activity` | Últimos premios reales de jugadores, con nombre anonimizado |
| GET | `/leaderboard?by=net\|balance\|biggest\|streak` | Top 25 de jugadores (sin bots ni administradores) |
| GET | `/rules` | Pagos, límites, líneas, tiras y RTP calculado |
| GET | `/bots` | Perfiles públicos de los bots (siempre identificados como bots) |

## Autenticación — `/auth`

| Método | Ruta | Cuerpo | Respuesta |
| --- | --- | --- | --- |
| POST | `/auth/register` | `{ username, email, password }` | 201 `{ user }` + cookie |
| POST | `/auth/login` | `{ identifier, password }` (usuario o correo) | `{ user }` + cookie |
| POST | `/auth/logout` | — | `{ ok: true }` |
| GET | `/auth/me` | — | `{ user \| null }` |

`user`: `{ id, username, email, role, createdAt, balance, unlimited, preferences }`.

## Cuenta — `/me` (requiere sesión)

| Método | Ruta | Descripción |
| --- | --- | --- |
| PATCH | `/me/preferences` | `{ sound?, volume?, music?, animations?: 'full'\|'reduced'\|'off', showOddsNotes?, pokerAssist?: 'off'\|'beginner'\|'standard'\|'advanced', invisible? }` |
| GET | `/me/stats` | Totales, por juego y últimas 20 partidas (para la racha) |
| GET | `/me/history?game&page&pageSize` | Partidas liquidadas con resumen |
| GET | `/me/transactions?page&pageSize` | Libro mayor propio |
| GET | `/me/achievements` | Catálogo con fecha de desbloqueo |
| GET | `/me/promotions` | Recompensa diaria (importe, racha, `nextResetAt` calculado en el servidor con la zona horaria configurada), recarga y anuncios |
| POST | `/me/promotions/daily-bonus` | Reclama la recompensa diaria (una vez por periodo; protegida contra peticiones simultáneas) |
| POST | `/me/promotions/demo-refill` | Recarga si el saldo es bajo (una vez al día) |

## Juegos — `/games` (requiere sesión; máx. 120 jugadas/min)

Todas las jugadas llevan `idempotencyKey` (8–64 caracteres `[A-Za-z0-9_-]`). Repetir la misma clave devuelve la ronda original con `replayed: true` (ruleta y slots) o 409 (blackjack).

### Ruleta

`POST /games/roulette/spin`

```json
{
  "idempotencyKey": "a1b2c3d4e5f6",
  "bets": [
    { "kind": "straight", "numbers": [17], "amount": 10 },
    { "kind": "split", "numbers": [17, 20], "amount": 10 },
    { "kind": "dozen", "index": 2, "amount": 25 },
    { "kind": "red", "amount": 50 }
  ]
}
```

Respuesta: `{ roundId, result: { number, color, pocketIndex, totalBet, totalPayout, bets: [{ bet, won, payout }] }, balance, achievements, streak }`. `kind`: `straight, split, street, corner, sixline, dozen, column, red, black, even, odd, low, high`.

### Slots

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/games/slots/state?machine=` | Giros gratis pendientes y bono abierto (solo cofres ya abiertos) |
| POST | `/games/slots/spin` | `{ machine, betPerLine, lines, idempotencyKey }` → `{ roundId, result: { stops, grid, lineWins, scatterWin, specialWins, freeSpinsAwarded, bonus, totalWin, totalBet, tier }, feature, balance }`. Durante los giros gratis la apuesta no se cobra y queda fijada por el servidor |
| POST | `/games/slots/bonus/pick` | `{ machine, index }` abre un cofre del bono; los premios se fijaron al activarlo y los cofres sin abrir nunca se envían |

Máquinas: `aurum-royale`, `reef-treasure`. No existe giro automático.

### Formaciones de ruleta — `/me/formations`

`GET /` lista, `POST /` `{ name, bets }` guarda (validadas con el motor), `PATCH /:id` renombra o reemplaza, `POST /:id/duplicate`, `DELETE /:id`, `GET /:id/check` comprueba legalidad y saldo antes de colocar las fichas.

### Blackjack

| Método | Ruta | Cuerpo |
| --- | --- | --- |
| GET | `/games/blackjack/current` | Mano abierta (para recuperar tras recargar) e información del zapato |
| POST | `/games/blackjack/start` | `{ bet, idempotencyKey }` |
| POST | `/games/blackjack/action` | `{ roundId, action: 'hit'\|'stand'\|'double'\|'split', seq }` |

Respuesta: `{ roundId, seq, state, events, balance, achievements }`. `state.dealer[1]` es `null` mientras juegas; `events` es la lista ordenada (`shuffle`, `deal`, `split`, `double`, `reveal`, `active`, `settle`) que la interfaz anima. `seq` debe coincidir con el valor devuelto en la respuesta anterior.

## Anuncios recompensados — `/ads`

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/ads/status` | Modo (`none`, `dev-simulation`, `signed-callback`), disponibilidad y límite diario |
| POST | `/ads/sessions` | Abre una sesión de anuncio (caduca en 30 min) |
| GET | `/ads/sessions/:id` | Estado de la sesión propia |
| POST | `/ads/sessions/:id/complete` | **Solo `dev-simulation` fuera de producción**: completa la simulación etiquetada. En producción devuelve 403 |
| POST | `/ads/callback` | Confirmación servidor a servidor del proveedor, firmada con HMAC-SHA256 (`ADS_CALLBACK_SECRET`), con marca de tiempo (`ADS_CALLBACK_MAX_AGE_SEC`) e identificador de transacción único. No requiere sesión ni cabecera CSRF; sí firma válida |

## Amigos y notificaciones — `/social` (requiere sesión)

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/social/friends` | `{ friends: [{ id, username, presence: { status, game } }], incoming, outgoing }`. Nunca incluye correo ni saldo |
| GET | `/social/friends/search?q=` | Busca por nombre de usuario (sin bots ni uno mismo) |
| POST | `/social/friends/requests` | `{ username }`. Si existía la solicitud inversa, se acepta |
| POST | `/social/friends/requests/:id/accept` · `/reject` | Solo el destinatario |
| DELETE | `/social/friends/requests/:id` | Cancela; solo el remitente |
| DELETE | `/social/friends/:userId` | Elimina la amistad |
| GET | `/social/notifications` | Últimas notificaciones y `unread` |
| POST | `/social/notifications/read` | `{ ids? }` marca como leídas (todas si no hay `ids`) |

`presence.status`: `available`, `playing` (con `game`: `poker` o `blackjack`) u `offline`. Con el modo invisible el usuario aparece siempre `offline`.

## Salas privadas — `/rooms` (requiere sesión)

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/rooms` | Salas abiertas de las que eres miembro |
| POST | `/rooms` | Crea: `{ name, game: 'poker'\|'blackjack', maxSeats (2–6 póker, 2–7 blackjack), privacy: 'code'\|'friends', allowBots, chipMode: 'wallet'\|'room', poker?: { smallBlind, bigBlind, minBuyIn, maxBuyIn, startingChips }, blackjack?: { minBet, maxBet } }`. Máx. 3 salas abiertas por anfitrión |
| POST | `/rooms/join` | `{ code }` (sin distinguir mayúsculas ni guion). 10 intentos por usuario y 30 por IP cada 10 min |
| GET | `/rooms/:id` | Vista para miembros: miembros con conexión real, anfitrión, código (solo miembros), caducidad, reglas y resumen de la mesa. 403 si no eres miembro |
| POST | `/rooms/:id/accept-invite` | Entra con una invitación pendiente |
| POST | `/rooms/:id/invite` | `{ username }` invita a un amigo (envía una notificación) |
| POST | `/rooms/:id/code` | Anfitrión: genera un código nuevo e invalida el anterior |
| PATCH | `/rooms/:id` | Anfitrión: nombre, privacidad, bots y límites (se aplican desde la siguiente mano; las fichas iniciales no se pueden cambiar) |
| POST | `/rooms/:id/leave` | Abandona (si eras anfitrión, pasa a otro miembro conectado) |
| POST | `/rooms/:id/close` | Anfitrión: cierra la sala, termina la mesa y reembolsa las fichas |

El código solo da acceso: no concede permisos de anfitrión. La mesa de la sala (`room-<id>`) usa los mismos mensajes WebSocket que las públicas, pero el servidor rechaza `watch` y `sit` de quien no es miembro (`ROOM_FORBIDDEN`) y nunca aparece en el salón.

## Administración — `/admin` (rol admin)

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/admin/overview` | Usuarios, partidas por juego y día, conectados, créditos en circulación, errores |
| GET | `/admin/users?q&page` | Listado y búsqueda |
| GET | `/admin/users/:id` | Detalle, movimientos, partidas y estado del libro mayor |
| PATCH | `/admin/users/:id` | `{ status: 'active'\|'banned' }` (no aplicable a administradores) |
| POST | `/admin/users/:id/adjust` | `{ amount (±), reason }` — queda auditado |
| GET | `/admin/rounds?game&userId&page` | Partidas |
| GET | `/admin/poker-hands` | Manos de póker guardadas |
| GET / PATCH | `/admin/bots`, `/admin/bots/:id` | `{ enabled?, profile?, difficulty? }` |
| GET / PATCH | `/admin/tables`, `/admin/tables/:id` | Ciegas, entradas, asientos, bots, jugadores objetivo, abierta |
| GET / PATCH | `/admin/settings` | `{ gamesEnabled, dailyBonus, dailyTimezone, dailyStreakEnabled, dailyStreakStep, dailyStreakMaxSteps, startingBalance, demoRefillAmount, demoRefillThreshold, adsRewardAmount, adsDailyLimit, adsMinWatchSeconds, maintenanceMessage }` |
| GET / PATCH | `/admin/blackjack-tables`, `/admin/blackjack-tables/:id` | Mesas de blackjack multijugador |
| GET | `/admin/errors`, `/admin/audit` | Registros |
| GET | `/admin/diagnostics` | Node, memoria, BD, migraciones, integridad SQLite, mesas |
| POST | `/admin/diagnostics/ledger-check` | Comprueba que cada saldo coincide con su libro mayor |

## WebSocket — `/ws`

Autenticación con la misma cookie. Sin sesión se puede mirar, pero no jugar. Mensajes JSON con campo `t`.

### Cliente → servidor

| `t` | Campos | Efecto |
| --- | --- | --- |
| `ping` | — | Responde `pong` |
| `lobby.subscribe` | — | Envía `lobby` |
| `poker.watch` / `poker.sync` | `tableId` | Suscribe y envía `poker.snapshot` |
| `poker.unwatch` | — | Deja de observar |
| `poker.sit` | `tableId, buyIn, seat?` | Se sienta (descuenta la entrada del monedero) |
| `poker.leave` | `tableId` | Se levanta (al terminar la mano si está jugando) |
| `poker.act` | `tableId, handId, actionCount, action, amount?` | `action`: `fold, check, call, bet, raise, allin`; `amount` = total de la apuesta en la calle ("subir a") |
| `bj.lobby` | — | Envía `bj.lobby` y suscribe a sus cambios |
| `bj.watch` / `bj.unwatch` | `tableId` | Observa una mesa de blackjack multijugador |
| `bj.sit` / `bj.leave` | `tableId, seat?` | Se sienta o se levanta |
| `bj.bet` | `tableId, roundNo, amount` | Apuesta en la ventana de apuestas (se cobra del monedero) |
| `bj.act` | `tableId, roundNo, actionCount, action` | `hit, stand, double, split` en tu turno |

### Servidor → cliente

| `t` | Contenido |
| --- | --- |
| `hello` | `userId`, `online` |
| `presence` | `online` (usuarios autenticados distintos conectados) |
| `lobby` | `tables`, `online` |
| `poker.snapshot` | `snapshot` filtrado para ese observador: las cartas privadas de cada jugador solo van en la instantánea de su dueño |
| `poker.update` | `seq`, `events` (eventos del motor a animar) y `snapshot` resultante |
| `poker.left` | `cashOut` |
| `poker.notice` | Aviso (sin fichas, inactividad) |
| `balance` | Nuevo saldo (entradas, salidas, ajustes del administrador) |
| `achievements` | Logros desbloqueados en póker |
| `bj.lobby` / `bj.snapshot` / `bj.update` / `bj.left` / `bj.notice` | Equivalentes del blackjack multijugador (la carta tapada del crupier nunca va en los datos) |
| `friends.changed` | Algo cambió en tu lista de amigos o en su presencia: vuelve a pedir `/social/friends` |
| `notification` | Nueva notificación (solicitud, aceptación, invitación a sala) |
| `room.changed` / `room.closed` / `room.host` / `room.left` | Cambios en una sala de la que eres miembro |
| `error` | `code`, `message`, `ref` (tipo del mensaje que lo causó) |

`snapshot`: `{ table, seats[], hand, you: { seat, legal }, actionCount, deadline, history, demo, seq, serverTime }`. `legal` (solo en tu turno): `{ canFold, canCheck, callAmount, canRaise, isBet, minRaiseTo, maxRaiseTo, currentBet, pot }`.
