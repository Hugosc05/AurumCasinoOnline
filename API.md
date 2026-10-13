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
| 403 | `FORBIDDEN`, `ACCOUNT_DISABLED` |
| 404 | `NOT_FOUND`, `ROUND_NOT_FOUND` |
| 409 | `ALREADY_EXISTS`, `DUPLICATE_REQUEST`, `ROUND_IN_PROGRESS`, `STALE_ACTION`, `ALREADY_SETTLED`, `ALREADY_CLAIMED` |
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
| PATCH | `/me/preferences` | `{ sound?, volume?, music?, animations?: 'full'\|'reduced'\|'off', showOddsNotes? }` |
| GET | `/me/stats` | Totales, por juego y últimas 20 partidas (para la racha) |
| GET | `/me/history?game&page&pageSize` | Partidas liquidadas con resumen |
| GET | `/me/transactions?page&pageSize` | Libro mayor propio |
| GET | `/me/achievements` | Catálogo con fecha de desbloqueo |
| GET | `/me/promotions` | Estado del bono diario y de la recarga |
| POST | `/me/promotions/daily-bonus` | Reclama el bono (una vez al día) |
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

`POST /games/slots/spin` — `{ betPerLine, lines, idempotencyKey }` → `{ roundId, result: { stops, grid, lineWins, scatterWin, totalWin, totalBet, tier }, balance, achievements }`.

### Blackjack

| Método | Ruta | Cuerpo |
| --- | --- | --- |
| GET | `/games/blackjack/current` | Mano abierta (para recuperar tras recargar) e información del zapato |
| POST | `/games/blackjack/start` | `{ bet, idempotencyKey }` |
| POST | `/games/blackjack/action` | `{ roundId, action: 'hit'\|'stand'\|'double'\|'split', seq }` |

Respuesta: `{ roundId, seq, state, events, balance, achievements }`. `state.dealer[1]` es `null` mientras juegas; `events` es la lista ordenada (`shuffle`, `deal`, `split`, `double`, `reveal`, `active`, `settle`) que la interfaz anima. `seq` debe coincidir con el valor devuelto en la respuesta anterior.

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
| GET / PATCH | `/admin/settings` | `{ gamesEnabled, dailyBonus, demoRefillAmount, demoRefillThreshold, maintenanceMessage }` |
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

### Servidor → cliente

| `t` | Contenido |
| --- | --- |
| `hello` | `userId`, `online` |
| `presence` | `online` (usuarios autenticados distintos conectados) |
| `lobby` | `tables`, `online` |
| `poker.snapshot` | `snapshot` completo y filtrado para ese observador |
| `poker.update` | `seq`, `events` (eventos del motor a animar) y `snapshot` resultante |
| `poker.left` | `cashOut` |
| `poker.notice` | Aviso (sin fichas, inactividad) |
| `balance` | Nuevo saldo (entradas, salidas, ajustes del administrador) |
| `achievements` | Logros desbloqueados en póker |
| `error` | `code`, `message`, `ref` (tipo del mensaje que lo causó) |

`snapshot`: `{ table, seats[], hand, you: { seat, legal }, actionCount, deadline, history, demo, seq, serverTime }`. `legal` (solo en tu turno): `{ canFold, canCheck, callAmount, canRaise, isBet, minRaiseTo, maxRaiseTo, currentBet, pot }`.
