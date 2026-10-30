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
