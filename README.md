# Aurum — casino con moneda virtual

Plataforma de casino **exclusivamente de demostración**: blackjack individual y multijugador con crupier animado, Texas Hold'em en tiempo real con asistente de manos, ruleta europea con bola física y apuestas pintadas a mano, dos máquinas de slots con funciones especiales, amigos y salas privadas. Se juega con créditos virtuales sin valor económico: no hay pagos, depósitos, retiradas ni conversión a dinero real.

Todo funciona en local, con coste 0 €: sin servicios externos, sin APIs de pago y sin binarios nativos que compilar. Para jugar con amigos por internet sin tener tu PC encendido, se puede publicar gratis en **Render + Supabase**: guía paso a paso en [DEPLOY.md](DEPLOY.md).

![Portada](docs/screenshots/home.png)

| Ruleta | Blackjack | Slots |
| --- | --- | --- |
| ![Ruleta](docs/screenshots/roulette.png) | ![Blackjack](docs/screenshots/blackjack.png) | ![Slots](docs/screenshots/slots.png) |

> Las capturas se tomaron de la aplicación real en ejecución (Chromium, 1440 × 900).

## Qué incluye

- **Cuentas**: registro, inicio de sesión por usuario o correo, sesiones con cookie httpOnly, bloqueo temporal tras intentos fallidos, perfil con estadísticas, historial, movimientos, logros y preferencias de sonido y animación.
- **Monedero virtual transaccional**: cada movimiento guarda saldo anterior y posterior, motivo y partida; liquidación única, idempotencia y sin saldos negativos.
- **Blackjack**: zapato de 6 barajas con penetración real, barajado tipo *riffle*, crupier ilustrado con brazos articulados, mirada y poses; doblar y dividir. Mesa individual y **mesas multijugador** de hasta 7 asientos contra un crupier común (demo con bots o solo personas).
- **Texas Hold'em**: mesas de 6 con ciegas, botes secundarios, all-in, temporizador de turno, multijugador humano real por WebSocket y bots con perfiles y dificultades. **Asistente de manos** opcional (principiante, estándar, avanzado) que resalta tu combinación, explica qué cartas la forman y calcula la probabilidad exacta de mejorar.
- **Bots identificados**: nombres de fantasía, avatares propios y etiqueta BOT siempre visible; nunca se presentan como personas ni cuentan como usuarios conectados.
- **Ruleta europea**: todas las apuestas; se pintan arrastrando con ratón, dedo o lápiz, con borrado, deshacer por trazo y **formaciones guardadas**. El giro siempre se confirma. Rueda 2.5D con separadores metálicos, bola que frena, cae y rebota hasta el número que ya decidió el servidor.
- **Slots**: *Aurum Royale* (giros gratis ×2, combinación especial) y *Tesoro del Arrecife* (ola comodín ×2, bono de cofres). RTP exacto calculado desde la definición (≈ 96 %), tabla de premios generada del motor, sin giro automático y sin mensajes engañosos de «casi premio».
- **Economía virtual**: saldo inicial configurable, recompensa diaria con cuenta atrás y zona horaria, racha amable, pantalla de recuperación sin saldo y módulo de anuncios recompensados (desactivado por defecto; solo paga con confirmación firmada del proveedor).
- **Amigos**: búsqueda, solicitudes, presencia real (disponible, jugando, desconectado), modo invisible y notificaciones en tiempo real.
- **Salas privadas** de póker y blackjack: código de invitación con caducidad, invitar a amigos, privacidad, límites, bots opcionales (siempre marcados), fichas de sala en póker, traspaso de anfitrión y cierre con reembolso.
- **Administración**: métricas, usuarios (ajuste de saldo con motivo, suspensión), partidas, bots, mesas, juegos habilitados, errores, auditoría y comprobación del libro mayor. El administrador tiene saldo ilimitado sin poder obtenerlo desde el cliente.

## Requisitos

- **Node.js 22.13 o superior** (recomendado Node 24 LTS). Se usa el módulo SQLite integrado en Node (`node:sqlite`), así que no hace falta instalar ninguna base de datos.
- npm 10 o superior (viene con Node).
- Windows 10/11, macOS o Linux.

Comprueba tu versión con `node -v`. Si es anterior a 22.13, instala la LTS actual desde nodejs.org.

## Puesta en marcha (Windows, PowerShell o CMD)

```powershell
cd C:\PROYECTOS\Casino
npm install
copy .env.example .env          # opcional: valores por defecto razonables
npm run admin:create -- --username admin --email admin@example.com
npm run dev
```

Abre **http://localhost:5173**. El servidor de la API escucha en el puerto 3001 y Vite redirige `/api` y `/ws` hacia él.

`admin:create` pide la contraseña por teclado (mínimo 10 caracteres, letras y números). También puedes definir `ADMIN_PASSWORD` en el entorno. Para dar el rol a una cuenta ya registrada: `npm run admin:create -- --promote nombre_de_usuario`. Para restablecer una contraseña: `npm run admin:create -- --reset-password nombre_de_usuario`.

### Para jugar con la máxima fluidez (recomendado)

```powershell
npm run jugar
```

Compila el frontend y arranca el servidor en un solo proceso. Abre **http://localhost:3001**. Es la versión optimizada: las animaciones van más fluidas que en `npm run dev`, que incluye herramientas de depuración de React (montaje doble en modo estricto, comprobaciones extra) pensadas para desarrollar, no para jugar.

Equivale a `npm run build` seguido de `npm start`.

### Publicarlo en internet (Render + Supabase)

Sigue [DEPLOY.md](DEPLOY.md): el servidor queda en Render y la base de datos en Supabase (PostgreSQL), los dos gratis y sin tu PC encendido.

### Jugar online desde tu PC (túnel temporal)

```powershell
npm run online
```

Compila, abre un túnel rápido de Cloudflare (gratuito, sin cuenta y sin abrir puertos del router) y arranca el servidor. En la consola aparece un enlace del tipo `https://palabras-al-azar.trycloudflare.com`: pásaselo a tus amigos y **entra tú también por ese enlace**. Cada uno se registra, tú creas una **sala privada** y les das el código.

- La primera vez descarga `cloudflared`, el programa oficial de Cloudflare, en la carpeta `tools/` (no se sube al repositorio). Si ya lo tienes instalado, usa ese.
- Tu PC hace de servidor: debe estar encendido, con esta ventana abierta, mientras jugáis. `Ctrl + C` cierra el túnel y el servidor.
- **El enlace cambia cada vez** que ejecutas `npm run online`. Las cuentas y saldos se conservan (están en tu base de datos).
- El servidor sigue escuchando solo en tu equipo (`127.0.0.1`); desde fuera solo se llega por el túnel, con HTTPS. Se arranca en modo producción y solo acepta peticiones desde ese enlace y desde tu propio equipo.
- Cualquiera con el enlace puede registrarse, pero a tus salas solo se entra con el código o con tu invitación.
- Los túneles rápidos de Cloudflare no tienen garantía de disponibilidad: si el enlace deja de responder, vuelve a ejecutar el comando. Para una dirección fija haría falta un túnel con cuenta de Cloudflare y un dominio propio.
- Para empezar con la versión ya compilada: `npm run online -- --sin-compilar`.

### Parar

`Ctrl + C` en la terminal. Al apagarse, el servidor devuelve a sus dueños las fichas que hubiera en las mesas de póker. Si el proceso se corta de golpe, esas fichas se reembolsan automáticamente en el siguiente arranque.

## Comandos

| Comando | Para qué |
| --- | --- |
| `npm run dev` | Servidor (recarga automática) + frontend Vite |
| `npm run build` | Compila el frontend en `apps/web/dist` |
| `npm start` | Arranca el servidor (sirve `dist` si existe) |
| `npm run jugar` | Compila y arranca la versión optimizada (http://localhost:3001) |
| `npm run online` | Igual, y además la publica por internet con un túnel gratuito de Cloudflare para jugar con amigos |
| `npm test` | 385 pruebas unitarias y de integración (Vitest, SQLite) |
| `npm run test:pg` | Las 90 pruebas del servidor contra PostgreSQL real (PGlite), como en Supabase |
| `npm run test:e2e` | 17 pruebas de extremo a extremo con Playwright (versión compilada) |
| `npm run test:e2e:dev` | Pruebas de animación contra el servidor de desarrollo (modo estricto de React) |
| `npm run typecheck` / `npm run lint` | Comprobación de tipos estricta de los tres paquetes |
| `npm run db:migrate` | Aplica migraciones pendientes |
| `npm run db:seed` | Inserta bots y mesas de demostración (idempotente) |
| `npm run admin:create -- …` | Crea o promueve un administrador |
| `npm run rtp` | Recalcula el RTP exacto de las slots |

Las migraciones y los datos de demostración se aplican solos al arrancar el servidor.

## Tecnologías

- **Frontend**: React 19, TypeScript estricto, Vite 6, Tailwind CSS 3, Motion (Framer Motion), Lucide. Tipografías Bodoni Moda y Manrope autoalojadas (sin peticiones a terceros).
- **Backend**: Node.js, Express 5, `ws`, Zod, Helmet.
- **Datos**: SQLite integrado en Node en local, o PostgreSQL (Supabase) si se define `DATABASE_URL`. Las mismas migraciones SQL versionadas sirven para los dos (ver [ARCHITECTURE.md](ARCHITECTURE.md)).
- **Pruebas**: Vitest y Playwright.
- **Audio**: sonidos sintetizados en el navegador con Web Audio (originales, sin licencias de terceros). **Desactivado por defecto**; se activa con el altavoz de la cabecera.
- **Efectos**: partículas de celebración proporcionales al premio, regulables o desactivables en Perfil → Ajustes.

## Estructura

```
packages/engine   Motores puros: cartas, blackjack, póker (evaluador, mesa, botes, bots), ruleta, slots, logros
apps/server       API REST + WebSocket, monedero, autenticación, mesas de póker y blackjack, economía, anuncios, amigos, salas, administración, CLI
apps/web          Interfaz React: salón, juegos, perfil, promociones, amigos, salas privadas, panel de administración
e2e               Pruebas de extremo a extremo
docs              Guía de animación y capturas
```

## Documentación

- [DEPLOY.md](DEPLOY.md): publicarlo gratis en Render + Supabase
- [ARCHITECTURE.md](ARCHITECTURE.md): arquitectura, diagramas y decisiones técnicas
- [GAME_RULES.md](GAME_RULES.md): reglas, pagos y RTP de los cuatro juegos
- [SECURITY.md](SECURITY.md): modelo de seguridad
- [API.md](API.md): endpoints REST y protocolo WebSocket
- [TESTING.md](TESTING.md): qué se prueba y cómo
- [docs/ANIMATION_GUIDE.md](docs/ANIMATION_GUIDE.md): sistema de animación y dirección artística
- [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md), [PROJECT_STATUS.md](PROJECT_STATUS.md)

## Solución de problemas

| Síntoma | Causa probable y solución |
| --- | --- |
| `No such built-in module: node:sqlite` | Node anterior a 22.13. Actualiza a Node 22.13+ o 24 LTS. |
| Aviso `ExperimentalWarning: SQLite` | Inofensivo; los scripts ya lo silencian. |
| `EADDRINUSE: 3001` o `5173` | Otro proceso usa el puerto. Ciérralo o cambia `PORT` en `.env` (y `AURUM_API` para Vite). |
| Error de `@rollup/rollup-win32-…` o `esbuild` al instalar | Instalación interrumpida o `node_modules` copiada desde otro sistema. Borra `node_modules` y `package-lock.json` y ejecuta `npm install` de nuevo. |
| La interfaz dice «Sin conexión en tiempo real» | El servidor no está en marcha o el puerto no coincide. Revisa la terminal del servidor. |
| No puedo iniciar sesión en `npm start` tras HTTPS | Si sirves por HTTP con `NODE_ENV=production`, define `COOKIE_SECURE=false`. |
| «Cuenta bloqueada temporalmente» | 5 intentos fallidos en 15 minutos. Espera o reinicia el servidor. |
| Quiero empezar de cero | Para el servidor y borra `apps/server/data/aurum.db*` (perderás cuentas y saldos). |

## Límites conocidos

Resumidos aquí; detalle en [PROJECT_STATUS.md](PROJECT_STATUS.md).

- Los bots juegan de forma razonable, pero no son óptimos ni invencibles (ver [GAME_RULES.md](GAME_RULES.md#bots)).
- Las mesas viven en memoria del proceso: no hay escalado horizontal (un solo servidor). Tras un reinicio, las salas privadas siguen abiertas pero con la mesa vacía.
- No se implementan seguro ni rendición en blackjack. Las salas de blackjack usan siempre el saldo (no hay fichas de sala).
- Los anuncios recompensados no incluyen el SDK de ningún proveedor: solo el adaptador de confirmación firmada.
- El crupier y la ruleta son 2D/2.5D (SVG), no 3D.

## Licencia

MIT. Proyecto de demostración sin dinero real.
