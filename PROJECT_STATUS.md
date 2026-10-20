# Estado del proyecto

Actualizado: 20/10/2026 — versión 1.3.0.

## Hecho y verificado

| Área | Estado | Verificación |
| --- | --- | --- |
| Registro, login, logout, sesiones, bloqueo por intentos | Completo | Pruebas de integración + E2E |
| Roles y administrador por CLI, saldo ilimitado | Completo | Pruebas de integración + E2E |
| Monedero transaccional, idempotencia, liquidación única, concurrencia | Completo | Pruebas de integración |
| Blackjack individual (reglas, zapato, barajado, reparto) | Completo | 17 pruebas de motor + integración + E2E |
| Crupier nuevo (brazos articulados, mirada, poses) — v1.3 | Completo | Galería `/dev/crupier` + capturas |
| Blackjack multijugador (asientos, ventana de apuestas, turnos, reembolso tras reinicio) — v1.3 | Completo | 15 pruebas de motor + 11 de servidor + 7 de modelo + E2E escritorio y móvil |
| Póker (motor, botes, bots, mesas en tiempo real, desconexiones) | Completo | 36 pruebas de motor + 6 de WebSocket + E2E |
| Asistente de manos de póker — v1.3 | Completo | 25 pruebas de motor + 6 de interfaz + capturas |
| Identidad de bots (catálogo, avatares, banca compartida, perfiles públicos) — v1.3 | Completo | Integración + E2E |
| Economía: recompensa diaria por zona horaria, racha, recuperación — v1.3 | Completo | 10 pruebas de servidor (incluye cambio de hora y concurrencia) + E2E |
| Anuncios recompensados: interfaz de proveedor, simulación de desarrollo, confirmación firmada — v1.3 | Adaptador completo; **sin SDK de proveedor real** | Pruebas de firma, idempotencia, límites y bloqueo en producción |
| Slots: dos máquinas, giros gratis, bono de cofres, RTP exacto, sin giro automático — v1.3 | Completo | 17 pruebas de motor + 4 de servidor + 10 de interfaz + E2E |
| Ruleta: pintado por arrastre, formaciones, confirmación, rueda mejorada — v1.3 | Completo | 24 de motor + 9 de tapete + 4 de servidor + E2E escritorio y móvil |
| Amigos, presencia real, modo invisible, notificaciones — v1.3 | Completo | 5 pruebas de servidor + E2E con dos navegadores |
| Salas privadas de póker y blackjack — v1.3 | Completo (ver límites) | 9 pruebas de servidor + E2E con dos navegadores + capturas |
| Logros, promociones, clasificación, actividad anonimizada | Completo | Pruebas de integración |
| Panel de administración (incluye economía, anuncios y mesas de blackjack) | Completo | E2E + capturas |
| Responsive (escritorio y móvil) | Completo | Capturas 1440 px y 390 px + E2E móvil |
| Documentación | Actualizada para 1.3.0 | — |

## Límites actuales (no son errores)

- **Anuncios**: no se integra ningún SDK de proveedor. Con `ADS_PROVIDER=none` (por defecto) la interfaz indica que no hay anuncios; `signed-callback` necesita un proveedor que llame a `/api/ads/callback` con la firma documentada.
- **Salas privadas**: las salas de blackjack siempre usan el saldo (las fichas de sala solo existen en póker). Tras reiniciar el servidor, las salas abiertas se recrean con la mesa vacía (las fichas ya se reembolsaron). No hay chat ni moderación (expulsar o bloquear).
- **Slots**: no hay símbolos expansivos; las funciones son comodín multiplicador, scatter, giros gratis, combinación especial y bono de cofres.
- **Una sola instancia**: mesas, salas en juego y limitadores de frecuencia viven en memoria. Para varias instancias haría falta un almacén compartido (p. ej., Redis) y PostgreSQL.
- **Bots**: razonables pero explotables (ver `GAME_RULES.md#bots`).
- **Blackjack**: sin seguro ni rendición; una sola división por mano.
- **Ruleta**: el cero no aplica *la partage*. La rueda es 2.5D en SVG, no 3D (Three.js).
- **Música ambiental**: la preferencia existe, pero no hay pista musical.
- **Correo**: sin verificación ni recuperación de contraseña por email (se restablece por CLI).
- **Windows**: el código no usa binarios nativos propios, pero las pruebas se ejecutaron en Linux. Ejecuta `npm test` tras la primera instalación.
- **Audio**: sintetizado y probado por código, no escuchado en este entorno.
- **Rendimiento**: medido en un navegador sin aceleración gráfica; no medido en un PC real.

## Siguientes pasos sugeridos

1. Ejecutar `npm install`, `npm test` y `npm run jugar` en Windows y revisar la experiencia.
2. Integrar el SDK de un proveedor de anuncios con verificación servidor a servidor, si se quieren anuncios reales.
3. Fichas de sala para blackjack y persistencia del estado de las mesas de sala entre reinicios.
4. Moderación en salas (expulsar) y bloqueo de usuarios en amigos.
5. Adaptador PostgreSQL y almacén compartido para desplegar con varias instancias.
