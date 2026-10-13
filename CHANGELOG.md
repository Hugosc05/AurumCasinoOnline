# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

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
