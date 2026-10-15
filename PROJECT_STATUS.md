# Estado del proyecto

Actualizado: 15/10/2026 — versión 1.2.0.

## Hecho y verificado

| Área | Estado | Verificación |
| --- | --- | --- |
| Registro, login, logout, sesiones, bloqueo por intentos | Completo | Pruebas de integración + E2E |
| Roles y administrador por CLI, saldo ilimitado | Completo | Pruebas de integración + E2E |
| Monedero transaccional, idempotencia, liquidación única, concurrencia | Completo | Pruebas de integración |
| Blackjack (reglas, zapato, crupier animado, barajado, reparto) | Completo | 17 pruebas de motor + integración + E2E + capturas |
| Póker (motor, botes, bots, mesas en tiempo real, desconexiones) | Completo | 36 pruebas de motor + 6 de WebSocket + E2E + capturas |
| Ruleta (todas las apuestas, rueda con bola física, tapete) | Completo | 24 pruebas de motor + trayectoria + E2E + capturas |
| Slots (líneas, comodín, scatter, RTP exacto, rodillos) | Completo | 12 pruebas de motor + recorrido de rodillos + E2E + capturas |
| Logros, rachas, promociones, clasificación, actividad anonimizada | Completo | Pruebas de integración |
| Panel de administración | Completo | E2E + capturas |
| Cartas SVG propias (52 + reverso) y volteo en dos fases | Completo | 111 pruebas + galería capturada en 3 tamaños |
| Animaciones de blackjack, póker y slots y efectos de celebración | Completo | Pruebas de presentación + capturas fotograma a fotograma |
| Slots tipo máquina real (giro inmediato, física, frenada rápida) — v1.2 | Completo | 7 pruebas de física + E2E en producción y desarrollo + medición de fotogramas |
| Responsive (escritorio y móvil) | Completo | Capturas 1440 px y 390 px + E2E móvil |
| Documentación | Completa | — |

## Límites actuales (no son errores)

- **Una sola instancia**: las mesas de póker y los limitadores de frecuencia viven en memoria. Para varias instancias haría falta un almacén compartido (p. ej., Redis) y PostgreSQL.
- **Bots**: razonables pero explotables (ver `GAME_RULES.md#bots`).
- **Blackjack**: sin seguro ni rendición; una sola división por mano.
- **Slots**: sin giros gratis ni bonos; una única máquina.
- **Ruleta**: el cero no aplica *la partage*.
- **Gráficos**: crupier y ruleta en 2D/2.5D (SVG); no se usa 3D.
- **Música ambiental**: la preferencia existe, pero no hay pista musical (solo efectos sintetizados).
- **Correo**: sin verificación de correo ni recuperación de contraseña por email (se restablece por CLI).
- **Windows**: el código está pensado para Windows (sin binarios nativos propios, scripts multiplataforma), pero las pruebas se ejecutaron en Linux. Ejecuta `npm test` tras la primera instalación.
- **Audio**: los sonidos se sintetizan y se han probado por código, pero no se han escuchado en este entorno; conviene revisar el volumen relativo en un equipo real.
- **Premio grande/extraordinario**: las partículas (destello, ráfaga y fuegos artificiales) se han comprobado en un banco aislado, pero el cartel de premio grande no se ha visto en una tirada real porque no salió ninguno durante las capturas.
- **Rendimiento**: medido en un navegador sin aceleración gráfica (contenedor Linux): blackjack y póker a ~58-60 fps en desarrollo y producción; slots con mediana de 17 ms por fotograma y picos por el compositor por software. En un equipo con GPU el compositor no debería ser el cuello de botella, pero no se ha medido en un PC real.
- **`npm run dev` frente a `npm run jugar`**: el modo desarrollo de React es más pesado; para jugar, mejor `npm run jugar`.

## Siguientes pasos sugeridos

1. Ejecutar `npm install`, `npm test` y `npm run dev` en Windows y revisar la experiencia.
2. Añadir tabla de pagos visible dentro de las slots (ahora está en Reglas).
3. Guardar el historial de manos de póker por jugador con repetición visual.
4. Adaptador PostgreSQL y almacén compartido si se quiere desplegar con varias instancias.
5. Música ambiental opcional con licencia libre verificada.
