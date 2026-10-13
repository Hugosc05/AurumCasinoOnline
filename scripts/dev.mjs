// Arranca servidor (puerto 3001) y frontend (puerto 5173) a la vez, en Windows, macOS o Linux.
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const procs = [
  ['servidor', ['run', 'dev', '-w', '@aurum/server']],
  ['web', ['run', 'dev', '-w', '@aurum/web']],
].map(([name, args]) => {
  const p = spawn(isWin ? 'npm.cmd' : 'npm', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: isWin });
  const prefix = name === 'web' ? '\x1b[36m[web]\x1b[0m ' : '\x1b[33m[servidor]\x1b[0m ';
  const pipe = (stream, out) => stream.on('data', (d) => out.write(String(d).split(/\r?\n/).filter(Boolean).map((l) => prefix + l).join('\n') + '\n'));
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => {
    console.log(`${prefix}terminado (código ${code})`);
    shutdown();
  });
  return p;
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  for (const p of procs) {
    if (p.exitCode === null) {
      if (isWin) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { shell: true });
      else p.kill('SIGINT');
    }
  }
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.log('Aurum en desarrollo: abre http://localhost:5173 (Ctrl+C para parar)');
