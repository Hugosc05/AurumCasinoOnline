# Servidor en casa (mini PC con Windows, 0 €)

Con esto el casino funciona en un PC de tu casa, encendido siempre, con una dirección pública **HTTPS** que puede abrir cualquiera (tus amigos no instalan nada):

```
https://<nombre-del-pc>.<tu-red>.ts.net
```

| Pieza | Qué hace | Coste |
| --- | --- | --- |
| **Mini PC con Windows 10/11** | Ejecuta el casino como servicio de Windows (arranca solo y se reinicia si falla) | Luz: 1–3 €/mes |
| **Tailscale Funnel** | Publica el casino en internet por HTTPS sin abrir puertos del router y sin mostrar la IP de tu casa | Gratis |
| **SQLite** | Base de datos en el propio mini PC, con copia de seguridad diaria | Gratis |
| **GitHub** | De ahí se descarga el código y cada actualización | Gratis |

> **¿Por qué SQLite y no Supabase?** El servidor espera a la base de datos en cada consulta. Desde Render (Fráncfort) Supabase respondía en 1–3 ms; desde tu casa serían 30–40 ms por consulta y las mesas irían a tirones. Con SQLite en el mismo PC cada consulta tarda menos de 1 ms. El instalador **copia todos tus datos de Supabase** (cuentas, saldos, historial, amigos, cosméticos…), así que no se pierde nada.

Tiempo aproximado: 20–30 minutos (casi todo es esperar a que se instalen cosas).

---

## Parte A — En tu PC de siempre

1. **Sube el código a GitHub** (desde `C:\PROYECTOS\Casino`):

   ```powershell
   git push
   ```

2. **Ten a mano la cadena de conexión de Supabase** (solo para copiar los datos una vez):
   Supabase → tu proyecto → **Connect** → **Session pooler** → copia la cadena `postgresql://postgres.xxxx:[YOUR-PASSWORD]@…:5432/postgres` y cambia `[YOUR-PASSWORD]` por tu contraseña de la base de datos.
   ¿No la recuerdas? *Project Settings → Database → Reset database password* (Render ya no la necesitará).

3. **Render**: no lo borres todavía; se hace al final (Parte C).

## Parte B — En el mini PC

1. Conéctalo a internet (mejor por **cable** que por wifi) y deja Windows actualizado.

2. Abre **PowerShell como administrador**: menú Inicio → escribe `PowerShell` → clic derecho → **Ejecutar como administrador**.

3. Pega este comando y pulsa Intro (descarga el instalador de tu repositorio y lo ejecuta):

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass -Force; irm https://raw.githubusercontent.com/Hugosc05/AurumCasinoOnline/main/deploy/windows/instalar-servidor.ps1 -OutFile $env:TEMP\instalar-aurum.ps1; & $env:TEMP\instalar-aurum.ps1
   ```

4. El instalador hace todo solo y solo te pide intervenir en tres momentos:

   | Cuando veas… | Haz esto |
   | --- | --- |
   | **Inicia sesión en Tailscale** (se abre el navegador) | Crea tu cuenta gratuita de Tailscale con Google, Microsoft o GitHub y acepta añadir el equipo. |
   | **¿Importar los datos de Supabase? [S/n]** | Pulsa Intro (= sí) y pega la cadena de la Parte A (no se ve al pegarla; es normal). No se guarda en ningún sitio. |
   | **Funnel is not enabled… visit: https://login.tailscale.com/f/funnel…** | Abre el enlace y pulsa **Enable** (activa HTTPS y Funnel para este equipo). El instalador sigue solo. |

   Si empiezas de cero (sin importar), te ofrecerá crear tu cuenta de administrador.

5. Al terminar verás la dirección de tu casino:

   ```
   ¡Listo! Tu casino está en:
   https://minipc.tail1234.ts.net
   ```

   Ábrela desde el móvil con los datos (no con el wifi de casa) para comprobar que se ve desde fuera. La primera vez puede tardar 1–2 minutos.

### Traer los datos con un archivo (sin cadena de conexión)

En el plan gratuito, Supabase no deja descargar copias de seguridad, pero sí exportar todo con una consulta:

1. Supabase → tu proyecto → **SQL Editor** → **New query**.
2. Pega el contenido de [`deploy/supabase-export.sql`](deploy/supabase-export.sql) y pulsa **Run**. Sale una fila por tabla. La consulta solo lee: no cambia nada en Supabase.
3. En el resultado: **Export** → **Download CSV**.
4. Copia ese archivo `.csv` a `C:\Aurum\datos\` en el mini PC.
5. Importa (PowerShell como administrador):

   ```powershell
   cd C:\Aurum\casino
   Stop-Service AurumCasino -Force
   npm run -s db:backup -w '@aurum/server'
   npm run db:import -w '@aurum/server' '--' --file C:\Aurum\datos\NOMBRE_DEL_ARCHIVO.csv --force
   Start-Service AurumCasino
   ```

   `--force` sustituye la base actual (la línea anterior guarda antes una copia en `C:\Aurum\datos\copias`). Si Supabase estaba en una versión anterior del esquema, el importador la actualiza solo.

El instalador también lo detecta: si al llegar a «Base de datos» hay un `.csv` exportado en `C:\Aurum\datos`, ofrece importar desde él.

> Si el proyecto de Supabase lleva más de una semana sin uso, puede estar **pausado**: entra en el panel y pulsa **Restore project** antes de exportar.

### Tres ajustes a mano (5 minutos)

1. **Que Tailscale no caduque** (si no, a los 180 días el casino deja de verse):
   [login.tailscale.com/admin/machines](https://login.tailscale.com/admin/machines) → el mini PC → **⋯** → **Disable key expiry**.
2. **Que se encienda solo tras un apagón**: entra en la BIOS al arrancar (normalmente tecla `Supr`, `F2` o `F10`) y busca *Restore on AC Power Loss* / *After Power Failure* → **Power On**.
3. *(Opcional)* **Una dirección más bonita**:
   - En *Machines* → **⋯** → **Edit machine name** → por ejemplo `aurum`.
   - En *DNS* → **Rename tailnet…** → elige uno de los nombres que te propone.
   - Después vuelve a ejecutar el instalador (paso 3), que actualiza la dirección en la configuración. Quedará algo como `https://aurum.gato-feliz.ts.net`.

## Parte C — Apagar Render

Cuando compruebes que el mini PC funciona, en Render → tu servicio → **Settings** → **Delete Web Service**.
Hazlo **antes del día 1**: si no, Render volvería a arrancar con la base de datos antigua de Supabase y habría dos casinos distintos. Supabase puedes dejarlo como está (no se usa) o pausarlo.

---

## Parte D — El panel de administración (10 minutos)

Entra en `https://tu-casino…/admin` con tu cuenta de administrador.

1. **Verificación en dos pasos (obligatoria).** La primera vez te pedirá activarla: instala Google Authenticator, Microsoft Authenticator o Authy en el móvil, escanea el QR y escribe el código. Guarda los **8 códigos de recuperación** fuera del móvil (papel o gestor de contraseñas). Desde entonces, cada sesión nueva del panel pide un código (vale 12 horas).
   ¿Perdiste el móvil y los códigos? En el mini PC: `cd C:\Aurum\casino; npm run admin:reset-2fa -w '@aurum/server' '--' --username TU_NOMBRE`.
2. **Avisos al móvil por Telegram** (*Seguridad → Avisos al móvil*): crea un bot con [@BotFather](https://t.me/BotFather) (`/newbot`), pega el token, abre tu bot y pulsa *Iniciar*, luego *Buscar mi chat* → *Guardar y enviar prueba*.
3. **Aviso si el servidor se cae**: crea una cuenta gratuita en [healthchecks.io](https://healthchecks.io), un *check* con periodo de 5 minutos y margen de 5 minutos, conecta tu Telegram en *Integrations* y pega la URL de ping en el mismo apartado. Si el mini PC se apaga o se queda sin internet, healthchecks.io te avisa.

Qué hay en cada sección:

| Sección | Qué ves |
| --- | --- |
| **En directo** | Quién está conectado, en qué juego o mesa, desde qué dispositivo e IP, cuánto tiempo lleva; botón para expulsar; aviso si varias cuentas comparten conexión |
| **Actividad** | Activos por día/semana/mes, registros, retención (vuelven al día siguiente y a la semana), visitas por sección, pico de conectados, partidas, beneficio de la casa, economía de créditos y jugadores destacados |
| **Ingresos** | Ganancias reales de AdSense (hoy, 7 días, mes, por día, RPM) y dónde se muestran los anuncios |
| **Seguridad** | Comprobaciones automáticas, intentos de acceso fallidos, escaneos de vulnerabilidades, IP sospechosas, posibles multicuentas, vulnerabilidades en dependencias (`npm audit` diario), libro mayor, 2FA y avisos |
| **Servidor** | CPU, memoria, disco, tiempos de respuesta y retraso del mini PC en la última hora |

Avisos automáticos que llegan a Telegram: ataques de fuerza bruta y escaneos, códigos 2FA incorrectos, entrada de un administrador desde una IP nueva, 2FA desactivada, premios grandes (umbral configurable), saldos que no cuadran, vulnerabilidades graves nuevas, disco o memoria casi llenos, servidor lento, errores del servidor y cada arranque (para saber si ha habido un corte).

### Anuncios (AdSense)

AdSense **solo aprueba sitios con dominio propio**: con la dirección gratuita `*.ts.net` no se puede. Cuando quieras monetizar:

1. Compra un dominio (≈10 €/año, p. ej. en Cloudflare) y pídeme que cambie el túnel a Cloudflare Tunnel (gratis), que sí admite dominio propio.
2. Da de alta el dominio en [AdSense](https://adsense.google.com) y espera la aprobación (días o semanas; el sitio debe tener contenido propio, política de privacidad y aviso de cookies).
3. En *Ingresos → Anuncios en la web*: pega tu ID de editor (`ca-pub-…`) y los números de los bloques de anuncio, y actívalos. La web publica sola `/ads.txt`.
4. En *Ingresos → Conectar AdSense* sigue los 5 pasos (proyecto de Google Cloud gratuito) para ver las ganancias en el panel.

Los anuncios solo aparecen en la portada, los vestíbulos de juegos y recompensas, nunca dentro de una partida.

> Mientras el casino sea solo con créditos virtuales sin valor (no se compran ni se canjean por dinero), AdSense no lo trata como «juego con dinero real», que tiene la publicidad muy limitada. Si algún día se vendieran créditos o se dieran premios reales, eso cambiaría.

## Día a día

Todos los scripts se ejecutan en **PowerShell como administrador** en el mini PC.

| Quiero… | Comando |
| --- | --- |
| **Actualizar** a la última versión (después de hacer `git push` en tu PC) | `powershell -ExecutionPolicy Bypass -File C:\Aurum\casino\deploy\windows\actualizar.ps1` |
| **Ver el estado** (servicio, dirección, última copia, registro) | `powershell -ExecutionPolicy Bypass -File C:\Aurum\casino\deploy\windows\estado.ps1` |
| Reiniciar el casino | `Restart-Service AurumCasino` |
| Pararlo / arrancarlo | `Stop-Service AurumCasino` / `Start-Service AurumCasino` |
| Crear un administrador | `cd C:\Aurum\casino; npm run admin:create -w '@aurum/server' '--' --username TU_NOMBRE --email TU@CORREO` |
| Ver el registro | `Get-Content C:\Aurum\logs\servidor.log -Tail 50 -Wait` |

`actualizar.ps1` hace una copia de seguridad antes de tocar nada; el casino está parado 1–2 minutos mientras se actualiza.

### Dónde está cada cosa

| Carpeta | Contenido |
| --- | --- |
| `C:\Aurum\casino` | El código (con su `.env`, que solo pueden leer los administradores) |
| `C:\Aurum\datos\aurum.db` | La base de datos |
| `C:\Aurum\datos\copias` | Copias diarias (05:00), se guardan las 14 últimas |
| `C:\Aurum\datos\secrets.key` | Clave que cifra los tokens de Telegram y AdSense guardados en la base de datos (si se pierde, solo hay que volver a configurarlos) |
| `C:\Aurum\logs` | Registro del servidor (rota a los 10 MB) |

### Copias fuera de casa (recomendado)

Si el mini PC se estropea, las copias se pierden con él. Para tener siempre la última en OneDrive (o Google Drive), añade al final de `C:\Aurum\casino\.env`:

```
BACKUP_COPY_DIR=C:\Users\TU_USUARIO\OneDrive\AurumCopias
```

### Restaurar una copia

```powershell
Stop-Service AurumCasino
Copy-Item C:\Aurum\datos\copias\aurum-AAAA-MM-DD_HHMMSSmmm.db C:\Aurum\datos\aurum.db -Force
Remove-Item C:\Aurum\datos\aurum.db-wal, C:\Aurum\datos\aurum.db-shm -ErrorAction SilentlyContinue
Start-Service AurumCasino
```

## Qué hace el instalador exactamente

1. Instala con `winget`: Git, Node.js LTS, NSSM (gestor de servicios) y Tailscale.
2. Descarga el código en `C:\Aurum\casino`, instala dependencias y compila la web.
3. Inicia sesión en Tailscale en modo *unattended* (funciona sin nadie con la sesión de Windows abierta).
4. Crea el `.env`: producción, escucha solo en `127.0.0.1` (nadie de tu red puede entrar saltándose el túnel), SQLite en `C:\Aurum\datos`, IP real de cada jugador a través del túnel (`TRUST_PROXY`).
5. Importa los datos de Supabase con `npm run db:import` (solo lee Supabase; no lo modifica).
6. Instala el servicio **Aurum Casino**: arranque automático, reinicio a los 5 s si se cae y registro con rotación.
7. Activa **Tailscale Funnel** en el puerto 3001 (persistente tras reinicios).
8. Programa la copia diaria, quita la suspensión e hibernación y limita los reinicios de Windows Update a la franja de 2:00 a 8:00.

Se puede ejecutar otra vez cuando quieras: respeta la base de datos y el `.env` existentes.

## Problemas frecuentes

- **«No se reconoce winget»**: instala *Instalador de aplicación* (App Installer) desde Microsoft Store.
- **No se ve desde fuera**: ejecuta `estado.ps1`. Si dice *Desde fuera: no responde*, ejecuta `tailscale funnel status` y, si no aparece nada, `tailscale funnel --bg 3001`.
- **Se ve desde fuera pero no puedo iniciar sesión**: si cambiaste el nombre del equipo o de la red de Tailscale, vuelve a ejecutar el instalador (actualiza `CLIENT_ORIGINS`).
- **Va lento con muchos jugadores**: el límite es la velocidad de **subida** de tu conexión y la potencia del mini PC. Para un grupo de amigos sobra.
- **Se ha ido la luz o internet**: la web no estará disponible mientras tanto. Al volver, el PC se enciende solo (con el ajuste de la BIOS) y el casino y Tailscale arrancan sin que hagas nada.
