# Seguridad

Aurum no maneja dinero real, pero se trata como si lo hiciera: el saldo, los resultados y los roles se protegen igual.

## Modelo de confianza

- **El cliente no es de confianza.** El servidor ignora cualquier saldo, rol, resultado o carta que llegue del navegador. Los esquemas Zod son estrictos donde importa (`.strict()` en preferencias, bots y mesas): un campo `role` o `balance` en una petición se rechaza o se ignora.
- **El servidor decide todos los resultados** con `crypto.randomInt`. El RNG con semilla (`seededRng`) solo se usa en pruebas.
- **Las cartas ocultas no salen del servidor**: el estado completo de blackjack (zapato y carta tapada) se guarda en BD y se envía una vista pública; en póker cada observador recibe una instantánea filtrada.

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

## CSRF, CORS y cabeceras

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

- Configuración por variables de entorno (`.env`, ignorado por git). `.env.example` no contiene secretos reales. No hay secretos de firma: las sesiones son tokens opacos.
- Dependencias mínimas y con versión fija. Revisa periódicamente con `npm audit` (algunos avisos pueden afectar solo a herramientas de desarrollo).

## Fuera de alcance / pendiente

- HTTPS lo debe proporcionar un proxy inverso si se publica en Internet.
- Los limitadores de frecuencia están en memoria (un solo proceso).
- No hay verificación de correo ni recuperación de contraseña (no hay servicio de correo para mantener el coste 0); quien administra la máquina puede restablecer una contraseña con `npm run admin:create -- --reset-password <usuario>`.

## Informar de un problema

Abre una incidencia privada en el repositorio describiendo el problema y cómo reproducirlo.
