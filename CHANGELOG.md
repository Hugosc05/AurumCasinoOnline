# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

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
