# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

## [1.5.0] — 2026-10-22

### Añadido
- **Ruleta 3D** (three.js) con física de la bola: pista, caída, rombos, rebotes en los separadores y asentamiento. Termina siempre en el número del servidor corrigiendo la fase del rotor antes de que la bola lo toque. Se carga aparte; sin WebGL o con animaciones desactivadas, ruleta 2.5D.
- **Blackjack multijugador** en una mesa de casino real: media luna con baranda de cuero, leyendas impresas, bandeja de fichas, zapato y descartes, casillas de apuesta por asiento.
- **Tragaperras**: rótulo iluminado, bisel cromado y contador de premio grande que sube y cambia de categoría solo si el premio real la alcanza.

### Cambiado
- Póker y blackjack: los controles del jugador van justo debajo de la mesa y quedan fijos al borde inferior mientras se juega.

## [1.4.0] — 2026-10-21

### Añadido
- **PostgreSQL / Supabase**: con `DATABASE_URL` el servidor usa PostgreSQL en lugar de SQLite, con las mismas migraciones (traducidas al arrancar) y las mismas garantías del monedero. Las consultas se ejecutan en un hilo auxiliar y el servidor espera cada respuesta, así que las transacciones siguen siendo atómicas sin reescribir la lógica de juego.
- **Render**: `render.yaml` (servicio web gratuito en Fráncfort), su dirección pública admitida automáticamente como origen y ping cada 5 minutos a `/api/health` para que no se duerma; `/api/health` comprueba también la base de datos.
- `DEPLOY.md`: guía paso a paso para publicar en Render + Supabase.
- `npm run test:pg` (las pruebas del servidor contra PostgreSQL real con PGlite) y `E2E_DB=pg` para las de extremo a extremo; pruebas nuevas de traducción SQL, configuración y todas las consultas de lectura.

### Cambiado
- SQL portable entre los dos motores: `ON CONFLICT DO NOTHING`, `RETURNING id`, columnas calificadas en los *upserts* y búsqueda en JSON sin funciones propias de SQLite.
- Las pruebas ignoran cualquier `DATABASE_URL` real del entorno.

## [1.3.1] — 2026-10-21

### Añadido
- `npm run online`: publica el casino por internet gratis con un túnel rápido de Cloudflare para jugar salas privadas con amigos desde casa. Descarga `cloudflared` si falta, arranca en modo producción y solo admite el origen del túnel.

## [1.3.0] — 2026-10-20

### Añadido
- **Póker**: asistente de manos para principiantes (resaltado de la combinación, explicación y probabilidad exacta de mejorar; modos principiante, estándar y avanzado).
- **Blackjack**: mesas multijugador por WebSocket con varios asientos contra un crupier común, ventana de apuestas y turnos con tiempo; crupier nuevo con brazos articulados, mirada y poses.
- **Bots**: catálogo con nombres de fantasía y avatares propios, banca compartida (un bot en una sola mesa), estadísticas reales y perfiles públicos; siempre etiquetados como bots.
- **Economía**: recompensa diaria por zona horaria con cuenta atrás y racha amable, saldo inicial configurable, pantalla de recuperación y aviso de saldo bajo.
- **Anuncios recompensados**: interfaz de proveedor (`ADS_PROVIDER`), simulación de desarrollo etiquetada y prohibida en producción, y confirmación servidor a servidor firmada con HMAC.
- **Slots**: motor de máquinas configurables, *Tesoro del Arrecife* con bono de cofres, giros gratis, combinaciones especiales, tabla de premios desde el motor y estadísticas de sesión.
- **Ruleta**: pintado de apuestas arrastrando (ratón, dedo, lápiz), borrado, deshacer por trazo, confirmación antes de girar y formaciones guardadas; rueda con más detalle.
- **Amigos**: solicitudes, presencia real, modo invisible y notificaciones en tiempo real.
- **Salas privadas** de póker y blackjack con código, invitaciones, privacidad, bots opcionales, fichas de sala en póker, traspaso de anfitrión y cierre con reembolso.
- Migraciones `003`–`007`; 107 pruebas unitarias e integración y 8 E2E nuevas.

### Cambiado
- Slots: eliminado el giro automático.
- El aviso «solo juegan bots» solo aparece si de verdad hay bots en la mesa.
- `ws` actualizado a 8.22.0 (corrige dos avisos de seguridad de la 8.18.3).

## [1.2.0] — 2026-10-15

### Corregido
- **Cartas boca abajo en `npm run dev`**: con el modo estricto de React (solo en desarrollo) el vuelo de la carta se cancelaba y nunca llegaba a girarse. `TableCard` es ahora idempotente y una prueba E2E contra el servidor de desarrollo lo vigila.
- Tirones al primer clic: el motor de audio ya no se crea mientras el sonido está desactivado y la reverberación se genera fuera del gesto.
- Renders innecesarios que restaban fluidez (props que rompían la memoización de cartas y rodillos, filtros SVG en las líneas de premio) y desenfoques de fondo (`backdrop-blur`) encima de zonas animadas.
- Póker: el indicador podía quedarse en «Reconectando…» estando conectado; las cartas de los rivales ya no quedan bajo su placa ni sobre las comunitarias; bote en una fila visible entre el tablero y tus cartas.

### Cambiado
- **Slots como una máquina real**: los rodillos arrancan al instante al pulsar (sin esperar al servidor), frenan con física y rebote hasta la parada exacta, se pueden frenar pulsando otra vez y se puede volver a girar durante la presentación de un premio. Palanca lateral, bombillas que recorren el marco, golpe visual al parar, símbolos premiados que saltan y brillan, anticipación más marcada.
- **Sonidos rehechos**: reverberación, estéreo, campanas, fichas, golpes mecánicos, motor de rodillos, contador de premio (sigue siendo todo sintetizado, sin archivos de terceros).

### Añadido
- `npm run jugar` (versión optimizada) y `npm run test:e2e:dev` (pruebas de animación en modo desarrollo).
- Física de rodillos pura (`reelMotion.ts`) con 7 pruebas; 2 pruebas E2E de animación.

### Eliminado
- `reelPlan.ts` (recorrido precalculado), sustituido por la física de rodillos.

## [1.1.0] — 2026-10-14

Mejora visual y de animación sobre la versión 1.0 (sin cambios de reglas, saldos ni persistencia).

### Añadido
- Baraja francesa propia en SVG (`components/cards/`): índices de rango y palo dibujados con trazos (sin fuentes ni emojis), índice inferior girado 180°, disposición clásica de pips, as con palo central, J/Q/K con figura original simétrica, reverso propio y variante compacta automática para tamaños pequeños.
- `Celebration`: partículas en canvas (destello, ráfaga con monedas, fuegos artificiales) con tope de partículas y bucle que se detiene solo.
- Preferencia **Efectos de celebración** (completos / discretos / desactivados), limitada siempre por el nivel de animación; disponible en Perfil → Ajustes y en la consola de las slots.
- Slots: líneas premiadas en SVG que siguen exactamente la línea del motor, vista general de todas las líneas y después ciclo una a una («i de N»), marcadores numerados de línea a ambos lados, cartel de premio grande/extraordinario con multiplicador, botón de silencio, apuesta y saldo tras la tirada visibles antes de girar.
- `games/slots/presentation.ts`: plan de presentación puro (REELS_STOPPED → WINNING_LINE_DETECTED → SCATTER_WIN → TOTAL_WIN → CELEBRATION).
- Blackjack: bandeja de descartes y recogida animada de cartas, estado del crupier («Barajando el zapato», «Turno del crupier»…), revelado dramático de la carta oculta, efectos por resultado (blackjack, victoria, derrota, pasarse con sacudida).
- Póker: recogida de cartas antes de cada mano, barajado en el centro de la mesa, cartas retiradas que vuelven al crupier, apuestas que vuelan al bote.
- Ruleta: sonidos de inicio y parada del giro.
- 114 pruebas nuevas (52 cartas × comprobaciones de rango, palo, color, pips, índices y ocultación; presentación de slots frente al motor).

### Cambiado
- Volteo de cartas en dos fases (la carta gira hasta el canto, cambia de cara y termina el giro): nunca se ven ambas caras ni una cara reflejada.
- Vuelo de cartas: extracción del zapato, arco con duración según la distancia, sombra que crece con la altura y aterrizaje con asentamiento.
- Los totales de blackjack solo cuentan cartas cuya cara ya es visible.
- Póker: bote más arriba y apuesta del jugador junto a sus cartas para que no se tapen; efectos de las animaciones fuera del actualizador de estado (sin duplicados en modo estricto).
- Atenuación de los símbolos no premiados más ligera.
- **El sonido viene desactivado por defecto** hasta que el usuario lo active; límite de voces simultáneas y separación mínima por sonido para evitar saturación.

## [1.0.0] — 2026-10-13

Primera versión completa.

### Añadido
- Motores puros de blackjack (6 barajas, S17, 3:2, doblar, dividir, peek), Texas Hold'em (botes secundarios, all-in, rotación de ciegas), ruleta europea (todas las apuestas) y slots 5 × 3 con 20 líneas, comodín y scatter.
- Evaluador de manos de póker con las diez categorías.
- Bots de póker con cuatro perfiles y tres dificultades (Chen + Monte Carlo + pot odds + modelo de rival).
- RTP exacto de las slots (95,2552 %) calculado por enumeración.
- Servidor Express 5 + WebSocket con sesiones httpOnly, roles, rate limiting, CSRF, Helmet.
- Monedero transaccional con libro mayor, idempotencia y liquidación única.
- Mesas de póker en tiempo real con temporizadores, gestión de desconexiones, reembolso tras reinicio y multijugador humano.
- Logros y rachas basados en resultados reales; promociones virtuales (bono diario y recarga).
- Panel de administración: métricas, usuarios, ajustes de saldo auditados, partidas, bots, mesas, juegos habilitados, errores, auditoría, diagnóstico y comprobación del libro mayor.
- CLI protegida para crear o promover administradores y restablecer contraseñas.
- Interfaz React con salón, cuatro juegos animados (crupier 2D, barajado riffle, ruleta 2.5D con bola física, rodillos con parada escalonada), perfil, clasificación, promociones y páginas de información.
- Sistema de animación con secuenciador, tres niveles de movimiento y saltos; audio sintetizado.
- 153 pruebas unitarias y de integración y 7 pruebas E2E.
- Documentación: README, arquitectura, reglas, seguridad, API, pruebas, guía de animación.
