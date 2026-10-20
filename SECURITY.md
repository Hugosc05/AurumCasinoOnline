# Seguridad

Aurum no maneja dinero real, pero se trata como si lo hiciera: el saldo, los resultados y los roles se protegen igual.

## Modelo de confianza

- **El cliente no es de confianza.** El servidor ignora cualquier saldo, rol, resultado o carta que llegue del navegador. Los esquemas Zod son estrictos donde importa (`.strict()` en preferencias, bots y mesas): un campo `role` o `balance` en una petición se rechaza o se ignora.
- **El servidor decide todos los resultados** con `crypto.randomInt`. El RNG con semilla (`seededRng`) solo se usa en pruebas.
- **Las cartas ocultas no salen del servidor**: el estado completo de blackjack (zapato y carta tapada) se guarda en BD y se envía una vista pública; en póker, también en salas privadas, cada observador recibe una instantánea construida para él en la que solo van sus cartas (las ajenas solo si se enseñan en el showdown). No se ocultan con CSS: no están en los datos. Los premios del bono de cofres de las slots tampoco se envían hasta abrir cada cofre.

## Autenticación y sesiones

| Medida | Implementación |
| --- | --- |
| Contraseñas | scrypt (N=32768, r=8, p=1, sal de 16 bytes, clave de 64), comparación en tiempo constante. Parámetros dentro del hash para poder endurecerlos. |
| Política | Mínimo 10 caracteres con letras y números; validada en cliente y servidor. |
| Sesiones | Token aleatorio de 256 bits en cookie `httpOnly`, `SameSite=Strict`, `Secure` en producción. En BD solo se guarda su SHA-256. Caducidad deslizante (7 días por defecto) y rotación en cada inicio de sesión. |
| Nada en localStorage | Ni tokens ni datos sensibles. Solo las preferencias visuales de visitantes sin cuenta. |
| Fuerza bruta | 5 fallos por identificador en 15 min bloquean ese identificador; 30 intentos por IP en 15 min; 10 registros por IP y hora. Mensaje genérico y hash ficticio para usuarios inexistentes (sin enumeración por tiempo). |
| Suspensión | Al suspender una cuenta se borran sus sesiones y se cierran sus WebSocket. |

## Autorización y roles

- Roles `player` y `admin` en la columna `users.role`, leídos de la BD en cada petición a partir de la sesión.
- `requireAdmin` protege todo `/api/admin/*`. No existe ningún endpoint que cambie roles.
- **Primer administrador**: solo con la CLI `npm run admin:create` (requiere acceso a la máquina y a la BD). Sin credenciales por defecto ni contraseñas en el código. Cada creación o promoción queda en `audit_log`.
- **Saldo ilimitado**: se resuelve en `applyWalletMove` comprobando el rol en BD dentro de la transacción. Ni un identificador alterado ni una petición manual pueden activarlo.

## Permisos sociales y salas privadas

- Todas las comprobaciones se hacen en el servidor: solo el destinatario acepta o rechaza una solicitud, solo el remitente la cancela; solo el anfitrión cambia ajustes, renueva el código o cierra la sala; solo los miembros ven la sala, su código y su mesa (`ROOM_FORBIDDEN` en `watch`/`sit` por WebSocket).
- Los códigos de sala son aleatorios (`crypto`, 8 caracteres de un alfabeto sin ambigüedades, unos 40 bits), caducan a las 24 h y se invalidan al renovarlos. Entrar con código está limitado a 10 intentos por usuario y 30 por IP cada 10 minutos. El código solo da acceso, nunca permisos de anfitrión.
- Las salas con privacidad «solo amigos» exigen amistad con el anfitrión o una invitación; solo se puede invitar a amigos.
- Las respuestas sociales (búsqueda, amigos, miembros de sala) solo contienen identificador y nombre de usuario: nunca correo, saldo ni datos de cuenta. El modo invisible oculta la presencia también dentro de las salas, salvo estar sentado en la mesa.
- Los bots no son cuentas: no se pueden buscar, añadir ni invitar, y se identifican siempre como bots. Los contadores de personas cuentan solo usuarios humanos realmente conectados.

## Recompensas y anuncios

- El saldo solo cambia desde el servidor, con movimientos del libro mayor.
- La recompensa diaria se reclama una vez por periodo, calculado en el servidor; una restricción única impide cobrarla dos veces aunque lleguen peticiones simultáneas.
- Los anuncios recompensados solo se pagan con una confirmación servidor a servidor firmada con HMAC-SHA256 (`ADS_CALLBACK_SECRET`, mínimo 32 caracteres), con antigüedad máxima, identificador de transacción único, tiempo mínimo de visionado y límite diario. La simulación de desarrollo, la única en la que el navegador completa el anuncio, hace que el servidor se niegue a arrancar con `NODE_ENV=production`.

## CSRF, CORS y cabeceras

- La única ruta sin protección CSRF es `/api/ads/callback`, que no usa sesión y exige firma.
- Cookie `SameSite=Strict` + cabecera obligatoria `X-Requested-With: aurum` en toda petición que modifica estado (un formulario externo no puede añadirla y un `fetch` entre orígenes exige preflight CORS) + comprobación de `Origin` contra la lista permitida.
- CORS solo para los orígenes de `CLIENT_ORIGINS`.
- WebSocket: comprobación de `Origin` en el handshake, autenticación con la misma cookie, mensajes de máximo 16 KB, 40 mensajes por 5 s por conexión.
- Helmet: CSP restrictiva (`default-src 'self'`, sin scripts externos), `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors`; HSTS solo con HTTPS. `X-Powered-By` desactivado.
- Cuerpos JSON limitados a 32 KB.

## Integridad del monedero

- Transacciones `BEGIN IMMEDIATE`; actualización condicional del saldo y `CHECK (balance >= 0)`.
- Libro mayor con saldo anterior y posterior en cada movimiento; comprobación desde el panel («Comprobar libro mayor»).
- Idempotencia por clave única `(user_id, idempotency_key)`; liquidación única por transición condicional `open → settled`; acciones de blackjack con número de secuencia.
- Fichas de póker persistidas entre manos y reembolsadas tras un reinicio.

## Inyección y XSS

- Solo consultas parametrizadas. Las únicas partes dinámicas de SQL son fragmentos fijos elegidos por el servidor (por ejemplo, el `ORDER BY` de la clasificación a partir de un enum validado).
- React escapa todo el contenido; no se usa `dangerouslySetInnerHTML`. Los nombres de usuario están limitados a `[A-Za-z0-9_.-]`.

## Errores y registros

- Respuestas de error con código y mensaje genérico; las trazas nunca llegan al cliente.
- Avisos y errores en `error_logs` (visibles en el panel); acciones administrativas en `audit_log`. No se registran contraseñas ni tokens.

## Secretos y dependencias

- Configuración por variables de entorno (`.env`, ignorado por git). `.env.example` no contiene secretos reales. Las sesiones son tokens opacos; el único secreto opcional es `ADS_CALLBACK_SECRET`, que solo se define en el entorno.
- Revisión del 20/10/2026: `npm audit --omit=dev` sin vulnerabilidades tras actualizar `ws` a 8.22.0 (la 8.18.3 tenía dos avisos altos). Sin secretos ni bases de datos en el repositorio y sin cuentas administrativas con contraseña por defecto.
- Dependencias mínimas y con versión fija. Revisa periódicamente con `npm audit` (algunos avisos pueden afectar solo a herramientas de desarrollo).

## Fuera de alcance / pendiente

- HTTPS lo debe proporcionar un proxy inverso si se publica en Internet.
- Los limitadores de frecuencia (incluidos los de códigos de sala) están en memoria: se reinician con el proceso y no se comparten entre instancias.
- No hay moderación ni bloqueo de usuarios en el sistema de amigos (solo eliminar la amistad).
- No hay verificación de correo ni recuperación de contraseña (no hay servicio de correo para mantener el coste 0); quien administra la máquina puede restablecer una contraseña con `npm run admin:create -- --reset-password <usuario>`.

## Informar de un problema

Abre una incidencia privada en el repositorio describiendo el problema y cómo reproducirlo.
