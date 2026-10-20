# Arquitectura

## Visión general

Monorepo con *npm workspaces* y tres paquetes:

| Paquete | Responsabilidad | Depende de |
| --- | --- | --- |
| `packages/engine` | Reglas puras de los juegos y de los bots. Sin E/S, sin UI, sin `Math.random()`: el azar se inyecta (`Rng`). | nada |
| `apps/server` | Autoridad única: sesiones, monedero, rondas, sorteos, mesas de póker, bots, administración. | engine |
| `apps/web` | Representación y animación. Nunca decide resultados ni importes. | engine (solo constantes y funciones puras de presentación) |

```mermaid
flowchart LR
  subgraph Navegador
    UI[React + Motion<br/>secuenciador de animaciones]
    WSC[Cliente WebSocket<br/>reconexión automática]
  end
  subgraph Servidor Node.js
    API[Express 5<br/>REST /api]
    HUB[RealtimeHub<br/>WebSocket /ws]
    AUTH[Sesiones + roles]
    WAL[Monedero<br/>libro mayor]
    RND[Rondas<br/>liquidación única]
    PKR[PokerManager<br/>mesas en memoria]
    BJM[BlackjackManager<br/>mesas multijugador]
    SOC[SocialService<br/>amigos, presencia, avisos]
    ROOM[RoomService<br/>salas privadas]
    ADS[AdsService<br/>anuncios recompensados]
    BOT[BotPool<br/>identidades de bot]
    LOG[Logger + auditoría]
  end
  ENG[(packages/engine<br/>motores puros)]
  DB[(SQLite<br/>node:sqlite)]
  UI -- fetch + cookie httpOnly --> API
  WSC -- cookie en el handshake --> HUB
  API --> AUTH --> DB
  API --> RND --> WAL --> DB
  RND --> ENG
  HUB --> PKR --> ENG
  PKR --> BOT --> DB
  PKR --> WAL
  API --> LOG --> DB
  HUB --> BJM --> ENG
  BJM --> WAL
  API --> SOC --> DB
  API --> ROOM --> PKR
  ROOM --> BJM
  ROOM --> SOC
  API --> ADS --> WAL
```

## Principios

1. **El servidor es la autoridad.** Cartas, números, paradas de rodillos, importes y roles se calculan y validan en el servidor. El cliente recibe un resultado ya decidido y lo anima.
2. **Motores puros.** Cada motor es una función o máquina de estados determinista dado un `Rng`. Se prueban sin servidor ni navegador.
3. **Animación separada de la lógica.** La interfaz traduce *eventos* del motor (`deal`, `reveal`, `street`, `award`…) a pasos de animación. Si se salta o se desactiva la animación, el estado final es el mismo.
4. **Abstracciones mínimas.** Repositorio SQL fino en lugar de un ORM; una sola clase de mesa de póker; sin capas intermedias sin uso.

## Persistencia

**Decisión: SQLite integrado en Node (`node:sqlite`) en lugar de Prisma + PostgreSQL.**

- Coste y fricción cero en Windows: no hay motor de base de datos que instalar ni binarios de Prisma que descargar o compilar.
- Las operaciones de saldo son **síncronas**: una transacción `BEGIN IMMEDIATE … COMMIT` se ejecuta de principio a fin sin que otra petición del mismo proceso pueda intercalarse. Además las actualizaciones son condicionales (`balance + ? >= 0`) y la columna tiene `CHECK (balance >= 0)`.
- Todas las consultas usan parámetros `?` (sin concatenación de datos del usuario).

**Camino a PostgreSQL**: el esquema (`apps/server/src/db/migrations/001_init.sql`) usa tipos portables (TEXT para UUID, INTEGER para importes enteros). Para migrar habría que sustituir la clase `Database` por un adaptador `pg` con la misma interfaz (`get/all/run/tx`), convertir `?` a `$n` y hacer asíncronas las transacciones, manteniendo `SELECT … FOR UPDATE` en el monedero. Los motores y la interfaz no cambian.

### Modelo de datos

```mermaid
erDiagram
  users ||--o{ sessions : tiene
  users ||--o{ wallet_transactions : mueve
  users ||--o{ game_rounds : juega
  users ||--|| user_stats : acumula
  users ||--o{ user_game_stats : por_juego
  users ||--o{ user_achievements : desbloquea
  users ||--o{ daily_claims : reclama
  users ||--o| blackjack_shoes : zapato
  users ||--o{ poker_seats : sentado
  poker_tables ||--o{ poker_seats : asientos
  poker_tables ||--o{ poker_hands : historial
  bots }o--o{ poker_tables : "se sientan (en memoria)"
  game_rounds ||--o{ wallet_transactions : "round_id"
  users ||--o{ ad_sessions : ve
  users ||--o{ slot_sessions : "giros gratis / bono"
  users ||--o{ roulette_formations : guarda
  users ||--o{ friendships : "una fila por pareja"
  users ||--o{ notifications : recibe
  users ||--o{ rooms : anfitrion
  rooms ||--o{ room_members : miembros
  rooms ||--o{ room_invites : invitaciones
```

Tablas auxiliares: `settings` (juegos habilitados, economía, anuncios), `blackjack_tables`, `audit_log`, `error_logs`, `schema_migrations`. Migraciones `001`–`007`, aplicadas en orden al arrancar.

## Monedero y rondas

```mermaid
sequenceDiagram
  participant C as Cliente
  participant S as Servidor
  participant DB as SQLite
  C->>S: POST /api/games/roulette/spin {bets, idempotencyKey}
  S->>DB: ¿existe ronda con esa clave? (repetición → misma respuesta)
  S->>S: validar apuestas (motor)
  S->>DB: BEGIN IMMEDIATE
  S->>DB: INSERT game_round (UNIQUE user+clave)
  S->>DB: UPDATE balance - total WHERE balance >= total
  S->>DB: INSERT wallet_transaction (antes/después)
  S->>S: número = randomInt(37) (CSPRNG)
  S->>DB: UPDATE round SET settled WHERE status='open'
  S->>DB: abono del premio + estadísticas + logros
  S->>DB: COMMIT
  S-->>C: {result, balance, achievements}
  C->>C: anima la rueda hasta result.pocketIndex
```

- **Idempotencia**: cada jugada lleva una clave única; una repetición devuelve la ronda original sin cobrar.
- **Liquidación única**: `UPDATE … WHERE status = 'open'` debe afectar exactamente a una fila; una segunda liquidación falla y no abona.
- **Blackjack**: la ronda queda `open` entre acciones con el estado (incluido el zapato) en `state_json`, que nunca se envía al cliente. Cada acción lleva `seq`; un número desfasado o repetido se rechaza (409).
- **Administradores**: saldo ilimitado. Los movimientos se registran con `unlimited = 1` y el saldo guardado no cambia. El rol se lee siempre de la base de datos.

## Póker en tiempo real

```mermaid
sequenceDiagram
  participant H as Humano (WS)
  participant T as PokerTable
  participant B as Bot
  T->>T: entre manos: salen bots sobrantes o sin fichas, entran bots si faltan jugadores
  T->>T: startHand (motor, CSPRNG)
  T-->>H: poker.update {events, snapshot filtrado}
  Note over T: espera el tiempo de animación de los eventos
  T->>B: turno: vista con SUS cartas + información pública
  B-->>T: decisión (Monte Carlo acotado en tiempo)
  T-->>H: poker.update
  T->>H: turno humano (25 s; 6 s si está desconectado)
  H-->>T: poker.act {handId, actionCount, action}
  T->>T: valida turno, secuencia e importes
  T-->>H: poker.update … showdown, award, hand_end
  T->>T: guarda la mano, estadísticas de humanos y fichas en poker_seats
```

- Cada observador recibe una **instantánea filtrada**: solo ve sus propias cartas; las ajenas solo si se muestran en el showdown.
- **Nadie bloquea la mesa**: temporizador por turno con acción por defecto (pasar o retirarse); si la decisión de un bot falla o es ilegal se aplica la acción por defecto; un error inesperado anula la mano y restaura las fichas iniciales.
- **Desconexiones**: el asiento queda marcado; sus turnos se resuelven solos; a los 2 minutos se le levanta y las fichas vuelven al monedero. Al reconectar, `poker.watch` envía la instantánea completa.
- **Reinicios**: las fichas de humanos sentados se guardan en `poker_seats` tras cada mano; al arrancar se reembolsan.
- **Mesas sin humanos**: solo juegan si alguien está mirando (modo demostración marcado como tal). Sin público, quedan en reposo.
- Multijugador humano: varias personas pueden sentarse en la misma mesa; la arquitectura es de un solo proceso (las mesas están en memoria).

## Blackjack multijugador

`BlackjackManager` mantiene mesas en memoria (`bj.*` por WebSocket) con el mismo motor que la mesa individual. Cada ronda pasa por apuestas (ventana con tiempo), reparto, turnos (tiempo límite con plantarse por defecto) y liquidación. Cada apuesta es una ronda idempotente del monedero; los límites se congelan al abrir la ronda. Tras un reinicio, las rondas abiertas se anulan y reembolsan. La carta tapada del crupier no se incluye en ninguna instantánea hasta que se revela.

## Bots

`BotPool` es el catálogo compartido de identidades de bot (nombre de fantasía, avatar SVG original, nivel, estrategia). Un bot solo puede estar en una mesa a la vez. Los bots **no son usuarios**: no tienen cuenta, no aparecen en la búsqueda de amigos, en la clasificación ni en los contadores de personas, y la interfaz los marca siempre como BOT. Sus nombres están reservados en el registro.

## Economía y anuncios

- **Recompensa diaria**: el periodo se calcula en el servidor (`economy/period.ts`) con la zona horaria configurada, incluidos los cambios de hora. La racha suma un escalón por cada día reclamado en los 6 anteriores (no castiga los días perdidos). Se reclama con una inserción única por `(usuario, tipo, día)` dentro de la transacción del abono.
- **Anuncios recompensados** (`ads/ads.ts`): interfaz de proveedor con tres modos. `none` (por defecto); `dev-simulation` (etiquetado en pantalla y rechazado al arrancar con `NODE_ENV=production`); `signed-callback`, donde solo una llamada servidor a servidor firmada con HMAC y con identificador de transacción único (`provider_tx_id UNIQUE`) concede créditos, tras el tiempo mínimo y dentro del límite diario. **El navegador nunca concede la recompensa en producción.** No se incluye el SDK de ningún proveedor real.

## Amigos, presencia y notificaciones

`SocialService` guarda las amistades con una fila por pareja (`pair_key` único), lo que impide duplicados o estados contradictorios. La presencia se deriva de conexiones WebSocket reales y de los asientos ocupados (eventos `seat` del hub): disponible, jugando (póker o blackjack) o desconectado. El modo invisible hace que el usuario aparezca siempre desconectado. Las notificaciones se guardan en BD y se empujan por WebSocket (`notification`).

## Salas privadas

```mermaid
sequenceDiagram
  participant A as Anfitrión
  participant S as RoomService
  participant M as Poker/BlackjackManager
  participant B as Invitado
  A->>S: POST /api/rooms {juego, límites, privacidad}
  S->>M: addRoomTable(room-<id>) con setAccess
  S-->>A: código aleatorio (caduca en 24 h)
  B->>S: POST /api/rooms/join {código} (limitado por usuario e IP)
  S->>S: valida código, caducidad, aforo, privacidad
  S-->>B: vista de la sala
  B->>M: poker.watch/sit room-<id>
  M->>S: ¿es miembro? (si no: ROOM_FORBIDDEN)
```

- Las mesas de sala no aparecen en el salón público y comparten el motor y las reglas de las mesas públicas.
- **Fichas**: en `wallet` se entra con el saldo (como en una mesa pública); en `room` (solo póker) todos reciben las mismas fichas de sala, sin tocar el monedero ni registrar rondas.
- **Ajustes**: los cambios de límites se aplican desde la siguiente mano; las fichas iniciales no cambian con la sala abierta.
- **Anfitrión desconectado**: tras 90 s sin conexión el rol pasa a otro miembro conectado; si se va, pasa igualmente. Sin miembros, o tras 15 min sin nadie conectado, la sala se cierra: la mesa termina y las fichas en juego se reembolsan.
- **Cartas privadas**: igual que en las mesas públicas, cada instantánea se filtra por destinatario en el servidor.
- **Reinicios**: las salas abiertas se recrean al arrancar con su mesa vacía (las fichas que hubiera ya se reembolsaron en el arranque).

## Frontend

- `components/Stage`: escenario con resolución de diseño fija que se escala; las posiciones de cartas y fichas se calculan en coordenadas del escenario. Blackjack y póker tienen una geometría apaisada y otra vertical para móvil.
- `lib/anim/sequencer`: secuencias de pasos con duración, salto (`skip`), cancelación al desmontar y bloqueo anti doble clic.
- `lib/audio`: motor de audio sintetizado; no se crea hasta la primera interacción.
- `lib/ws`: socket único con reconexión exponencial y re-suscripción.
- Cada juego tiene su modelo visual puro (`model.ts`, `rouletteAnim.ts`, `reelMotion.ts`, `board.ts`) probado con Vitest.
- `social/useSocial` y `NotificationBell`: amigos y notificaciones en tiempo real. `rooms/`: páginas de salas que incrustan las mismas mesas de póker y blackjack.

## Decisiones y alternativas descartadas

| Decisión | Alternativa | Motivo |
| --- | --- | --- |
| `node:sqlite` | Prisma + PostgreSQL | Sin instalación ni binarios nativos en Windows; transacciones síncronas simples. |
| scrypt (`node:crypto`) | bcrypt/argon2 | Sin dependencias nativas; parámetros guardados en el hash. |
| Sesión opaca en cookie httpOnly | JWT en localStorage | Revocable, no accesible desde JS. |
| SVG + rAF para la ruleta | Three.js | Calidad suficiente con un coste de carga y CPU mucho menor; sin dependencia pesada. |
| Audio sintetizado | Archivos de audio | Sin licencias de terceros ni descargas. |
| Mesas de póker en memoria | Estado en BD/Redis | Latencia mínima; el estado crítico (fichas) se persiste entre manos. |
