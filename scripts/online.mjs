// Juega por internet gratis: compila, abre un túnel rápido de Cloudflare (sin cuenta ni abrir
// puertos del router) y arranca el servidor permitiendo solo esa dirección pública.
//
//   npm run online                 compila y arranca
//   npm run online -- --sin-compilar  arranca sin volver a compilar
//
// El servidor sigue escuchando solo en 127.0.0.1: el único acceso desde fuera es el túnel (HTTPS).
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const args = process.argv.slice(2);

/** Lee una variable del entorno o, si no está, del archivo .env de la raíz. */
function envValue(key) {
  if (process.env[key]) return process.env[key];
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '');
  }
  return undefined;
}

const PORT = Number(envValue('PORT') ?? 3001);
const say = (msg) => console.log(`\x1b[33m[online]\x1b[0m ${msg}`);
const children = [];
const fail = (msg) => {
  console.error(`\x1b[31m[online]\x1b[0m ${msg}`);
  for (const p of children) {
    if (p.exitCode !== null) continue;
    if (isWin) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
    else p.kill('SIGKILL');
  }
  process.exit(1);
};

/* ---------------------------- 1. Compilar ---------------------------- */
if (!args.includes('--sin-compilar') || !existsSync(join(ROOT, 'apps/web/dist/index.html'))) {
  say('Compilando la interfaz…');
  const r = spawnSync(isWin ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: isWin });
  if (r.status !== 0) fail('La compilación ha fallado.');
}

/* --------------------------- 2. cloudflared -------------------------- */
function cloudflaredAsset() {
  const arch = process.arch;
  if (isWin) return arch === 'ia32' ? 'cloudflared-windows-386.exe' : 'cloudflared-windows-amd64.exe';
  if (process.platform === 'linux') return arch === 'arm64' ? 'cloudflared-linux-arm64' : arch === 'arm' ? 'cloudflared-linux-arm' : 'cloudflared-linux-amd64';
  return null;
}

async function findCloudflared() {
  const onPath = spawnSync('cloudflared', ['--version'], { stdio: 'ignore', shell: isWin });
  if (onPath.status === 0) return 'cloudflared';
  const local = join(ROOT, 'tools', isWin ? 'cloudflared.exe' : 'cloudflared');
  if (existsSync(local)) return local;

  const asset = cloudflaredAsset();
  if (!asset) fail('Instala cloudflared (en macOS: brew install cloudflared) y vuelve a ejecutar npm run online.');
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
  say(`Descargando cloudflared (programa oficial y gratuito de Cloudflare, una sola vez)…\n         ${url}`);
  const res = await fetch(url).catch((e) => fail(`No se pudo descargar cloudflared: ${e.message}`));
  if (!res.ok) fail(`No se pudo descargar cloudflared (HTTP ${res.status}).`);
  mkdirSync(join(ROOT, 'tools'), { recursive: true });
  const tmp = `${local}.part`;
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  renameSync(tmp, local);
  if (!isWin) chmodSync(local, 0o755);
  return local;
}

const cloudflared = await findCloudflared();

/* ----------------------------- 3. Túnel ------------------------------ */
say('Abriendo el túnel seguro…');
const tunnel = spawn(cloudflared, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(tunnel);
let server = null;
let closing = false;

const publicUrl = await new Promise((resolve) => {
  let log = '';
  const timer = setTimeout(() => {
    console.error(log.slice(-2000));
    fail('Cloudflare no ha dado una dirección en 60 s. Comprueba tu conexión a internet y vuelve a intentarlo.');
  }, 60_000);
  const onData = (d) => {
    log += String(d);
    // La dirección del túnel; no confundir con la de la API de Cloudflare (api.trycloudflare.com).
    const m = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/.exec(log);
    if (m) {
      clearTimeout(timer);
      resolve(m[0]);
    }
  };
  tunnel.stdout.on('data', onData);
  tunnel.stderr.on('data', onData);
  tunnel.on('exit', (code) => {
    if (!closing) {
      console.error(log.slice(-2000));
      fail(`El túnel se ha cerrado (código ${code}).`);
    }
  });
});

/* ---------------------------- 4. Servidor ---------------------------- */
const local = `http://localhost:${PORT},http://127.0.0.1:${PORT}`;
const origins = [envValue('CLIENT_ORIGINS') ?? local, publicUrl].join(',');
// Un único proceso de Node (sin npm ni shell intermedios) para que Ctrl+C le llegue y cierre con calma.
server = spawn(process.execPath, ['--import', 'tsx', '--no-warnings=ExperimentalWarning', 'src/index.ts'], {
  cwd: join(ROOT, 'apps/server'),
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1', // nada expuesto en la red: solo el túnel llega al servidor
    PORT: String(PORT),
    CLIENT_ORIGINS: origins,
    COOKIE_SECURE: 'true', // la dirección pública es HTTPS
    TRUST_PROXY: 'true', // la IP real de cada jugador llega en la cabecera del túnel
  },
});
children.push(server);
server.on('exit', (code) => {
  if (!closing) {
    console.error(`El servidor se ha detenido (código ${code}).`);
    shutdown();
  }
});

setTimeout(() => {
  const line = '═'.repeat(64);
  console.log(`\n\x1b[32m${line}\n  Aurum está en línea:\n\n     ${publicUrl}\n\n  Pasa este enlace a tus amigos. Tú también entra por él (no por localhost).\n  Crea una sala privada y compárteles el código.\n  Deja esta ventana abierta mientras jugáis. Ctrl+C para cerrar.\n  El enlace cambia cada vez que ejecutas npm run online.\n${line}\x1b[0m\n`);
}, 4000);

/* ------------------------------ Cierre ------------------------------- */
function shutdown() {
  if (closing) return;
  closing = true;
  say('Cerrando el túnel y el servidor (se devuelven las fichas de las mesas)…');
  const alive = [server, tunnel].filter((p) => p && p.exitCode === null);
  // En Windows, Ctrl+C ya llega a los dos procesos de la consola: se les deja cerrar con calma
  // y solo se fuerzan si siguen vivos. Si el servidor se corta, las fichas se devuelven al arrancar.
  if (!isWin) for (const p of alive) p.kill('SIGINT');
  setTimeout(() => {
    for (const p of alive) {
      if (p.exitCode !== null) continue;
      if (isWin) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
      else p.kill('SIGKILL');
    }
    process.exit(0);
  }, 6000);
  if (alive.every((p) => p.exitCode !== null)) process.exit(0);
  for (const p of alive) p.on('exit', () => { if (alive.every((q) => q.exitCode !== null)) process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
