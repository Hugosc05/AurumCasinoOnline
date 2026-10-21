# Publicar Aurum en internet (Render + Supabase, gratis)

Con esto el casino queda en una dirección pública del tipo `https://aurum-casino.onrender.com`, encendido aunque tu PC esté apagado, y tus amigos pueden jugar desde su casa en salas privadas.

| Pieza | Qué hace | Plan |
| --- | --- | --- |
| **Render** | Ejecuta el servidor (API, WebSocket y la web) | Gratis |
| **Supabase** | Guarda la base de datos (PostgreSQL): cuentas, saldos, historial, amigos, salas | Gratis |
| **GitHub** | Render descarga el código de tu repositorio y lo vuelve a desplegar en cada `git push` | Gratis |

Tiempo aproximado: 15 minutos. No hace falta tarjeta.

## 1. Sube el código a GitHub

En tu PC, dentro de `C:\PROYECTOS\Casino`:

```powershell
git push
```

El repositorio es `Hugosc05/AurumCasinoOnline`. No contiene secretos: `.env` y la base de datos local están excluidos por `.gitignore`.

## 2. Crea la base de datos en Supabase

1. Entra en [supabase.com](https://supabase.com) → **Start your project** (puedes entrar con tu cuenta de GitHub).
2. **New project**:
   - *Name*: `aurum`
   - *Database Password*: pulsa **Generate a password** y **guárdala**.
   - *Region*: **Central EU (Frankfurt)**. Importante: es la misma región que el servidor de Render, y así cada consulta tarda 1–3 ms.
3. Cuando el proyecto esté listo, pulsa **Connect** (arriba) → pestaña **Connection string** → elige **Session pooler** (no "Direct connection": Render no la alcanza).
4. Copia la cadena. Tiene esta forma:

   ```
   postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```

   Sustituye `[YOUR-PASSWORD]` (corchetes incluidos) por la contraseña del paso 2. Si la contraseña tiene símbolos como `@`, `#` o `/`, genera otra solo con letras y números para no tener que codificarla.

No tienes que crear tablas: el servidor las crea solo la primera vez que arranca.

## 3. Despliega el servidor en Render

1. Entra en [render.com](https://render.com) → **Get Started** → entra con **GitHub** y autoriza el acceso al repositorio `AurumCasinoOnline`.
2. **New +** → **Blueprint** → elige `AurumCasinoOnline`. Render lee `render.yaml` y propone un servicio web gratuito llamado `aurum-casino` en Fráncfort.
3. Te pedirá **DATABASE_URL**: pega la cadena del paso 2.4 → **Apply**.
4. Espera a que termine el despliegue (3–5 minutos). La dirección aparece arriba, por ejemplo `https://aurum-casino.onrender.com`. Si el nombre está ocupado, Render añade unas letras al final.
5. Abre `https://TU-DIRECCION.onrender.com/api/health`: debe responder `{"ok":true,"database":true,…}`.

Todo lo demás ya está configurado en `render.yaml`: modo producción, cookies seguras, la dirección pública como único origen permitido (Render la comunica sola en `RENDER_EXTERNAL_URL`) y el ping cada 5 minutos.

## 4. Crea tu cuenta de administrador

El panel de administración no se puede activar desde la web (por seguridad). Desde tu PC, en PowerShell, apunta la CLI a Supabase solo para este comando:

```powershell
cd C:\PROYECTOS\Casino
$env:DATABASE_URL = "postgresql://postgres.abcdefghijkl:TU-CONTRASEÑA@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
npm run admin:create -- --username hugo --email tu@correo.com
Remove-Item Env:DATABASE_URL
```

Te pedirá la contraseña del administrador. Si ya te habías registrado en la web con ese nombre, usa `--promote hugo` en lugar de `--username … --email …`.

> No pongas `DATABASE_URL` en tu `.env` local salvo que quieras que tu `npm run dev` también use Supabase: sin ella, en tu PC se sigue usando el archivo SQLite de siempre.

## 5. A jugar

Pasa la dirección de Render a tus amigos. Cada uno se registra, tú creas una **sala privada** y les das el código (o los invitas desde Amigos).

Cada `git push` a `main` vuelve a desplegar el servidor automáticamente.

## Que no se duerma

El plan gratuito de Render duerme el servicio tras 15 minutos sin visitas (y tarda ~1 minuto en despertar). El servidor se llama a sí mismo por su dirección pública cada 5 minutos (`KEEPALIVE=true`); esa petición entra por el balanceador de Render y cuenta como visita. La ruta `/api/health` hace además una consulta a la base de datos, lo que evita que Supabase pause el proyecto (el plan gratuito lo pausa tras 7 días sin actividad).

**Recomendado, como respaldo** (por si Render reinicia el servicio y nadie entra durante un rato): crea un monitor gratuito en [UptimeRobot](https://uptimerobot.com) → *New monitor* → *HTTP(s)* → URL `https://TU-DIRECCION.onrender.com/api/health` → intervalo 5 minutos. Además te avisa por correo si el casino deja de responder.

## Límites del plan gratuito

- **Render**: 750 horas al mes por cuenta. Un servicio encendido todo el mes usa 720–744, así que cabe **uno solo** encendido siempre. 512 MB de memoria y CPU compartida: suficiente para un grupo de amigos, no para cientos de jugadores a la vez.
- **Supabase**: 500 MB de base de datos (sobra para miles de partidas) y pausa tras 7 días sin actividad (evitado por el ping).
- **Reinicios**: con cada despliegue o reinicio de Render, las mesas en juego se cierran y las fichas vuelven al saldo de cada jugador. Las salas privadas siguen abiertas, con la mesa vacía. Cuentas, saldos e historial se conservan en Supabase.
- **Datos de tu PC**: las cuentas que tengas en tu SQLite local no se copian a Supabase; el casino online empieza de cero.

## Problemas frecuentes

| Síntoma | Solución |
| --- | --- |
| El despliegue falla con `DATABASE_URL debe empezar por postgresql://` | Revisa que pegaste la cadena completa, sin comillas. |
| `/api/health` responde `"database":false` o el registro da error 500 | Contraseña mal sustituida, o se usó *Direct connection* en lugar de *Session pooler*. Corrige `DATABASE_URL` en Render → *Environment* y pulsa *Manual Deploy*. |
| `password authentication failed` en los registros de Render | La contraseña no es la del proyecto. En Supabase: *Project Settings → Database → Reset database password*. |
| Tarda un minuto en cargar | El servicio estaba dormido (por ejemplo, tras un reinicio sin visitas). Activa el monitor de UptimeRobot. |
| «Origen no permitido» | Entra siempre por la dirección `onrender.com` que muestra Render. |
| Supabase muestra el proyecto en pausa | Pulsa *Restore* en el panel de Supabase y comprueba que el ping funciona (registros de Render: «Keep-alive»). |

## Seguridad

- Las contraseñas y secretos solo están en las variables de entorno de Render; nunca en el repositorio.
- La conexión con Supabase va cifrada (TLS). Para verificar además el certificado del servidor, descarga el certificado de Supabase (*Project Settings → Database → SSL Configuration → Download certificate*) y pega su contenido en una variable `DATABASE_SSL_CA` de Render.
- El navegador nunca habla con Supabase: solo el servidor tiene la cadena de conexión.
