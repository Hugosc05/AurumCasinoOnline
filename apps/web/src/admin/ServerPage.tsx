import { Card, Loadable, MiniChart, PageTitle, Stat, duration, useLoad } from './shared';

interface Sample {
  at: number;
  cpu: number;
  cpuProcess: number;
  memUsedPct: number;
  rssMb: number;
  loopP50: number;
  loopMax: number;
  requests: number;
  latencyP50: number;
  latencyP95: number;
  errors5xx: number;
  connections: number;
  online: number;
}

interface Server {
  current: Sample;
  series: Sample[];
  disk: { path: string; totalGb: number; freeGb: number; freePct: number } | null;
  system: { hostname: string; platform: string; cpus: number; cpuModel: string | null; memTotalGb: number; uptimeSystemSec: number; uptimeProcessSec: number; node: string };
}

const time = (ms: number): string => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const pc = (v: number): string => `${v.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;
const gb = (v: number): string => v.toLocaleString('es-ES', { maximumFractionDigits: 1 });
const ms = (v: number): string => `${v.toLocaleString('es-ES', { maximumFractionDigits: 1 })} ms`;

export default function ServerPage() {
  const st = useLoad<Server>('/api/admin/server', 10_000);
  return (
    <div className="space-y-5">
      <PageTitle title="Servidor">
        <p className="flex items-center gap-2 text-xs text-niebla"><span className="h-2 w-2 animate-pulse rounded-full bg-exito" aria-hidden /> Se actualiza cada 10 s · última hora</p>
      </PageTitle>
      <Loadable state={st}>
        {(s) => {
          const c = s.current;
          const series = (pick: (x: Sample) => number) => s.series.map((x) => ({ label: time(x.at), value: pick(x) }));
          return (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="CPU del equipo" value={pc(c.cpu)} sub={`El casino usa ${pc(c.cpuProcess)}`} tone={c.cpu > 85 ? 'warn' : undefined} />
                <Stat label="Memoria" value={pc(c.memUsedPct)} sub={`El casino usa ${c.rssMb} MB de ${gb(s.system.memTotalGb)} GB`} tone={c.memUsedPct > 90 ? 'warn' : undefined} />
                <Stat label="Disco libre" value={s.disk ? `${gb(s.disk.freeGb)} GB` : '—'} sub={s.disk ? `${pc(s.disk.freePct)} de ${gb(s.disk.totalGb)} GB` : 'No disponible'} tone={s.disk && s.disk.freePct < 15 ? 'warn' : undefined} />
                <Stat label="Respuesta (p95)" value={ms(c.latencyP95)} sub={`Mediana ${ms(c.latencyP50)} · ${c.requests} peticiones en 10 s`} tone={c.latencyP95 > 1000 ? 'warn' : undefined} />
              </div>
              {s.series.length < 3 ? (
                <p className="text-sm text-niebla">Recogiendo datos: las gráficas aparecen en unos segundos.</p>
              ) : (
                <div className="grid gap-5 xl:grid-cols-2">
                  <Card title="CPU del equipo"><MiniChart name="CPU" data={series((x) => x.cpu)} format={pc} /></Card>
                  <Card title="Memoria en uso"><MiniChart name="Memoria" data={series((x) => x.memUsedPct)} format={pc} /></Card>
                  <Card title="Tiempo de respuesta (p95)"><MiniChart name="Respuesta p95" data={series((x) => x.latencyP95)} format={ms} /></Card>
                  <Card title="Retraso interno del servidor"><MiniChart name="Retraso" data={series((x) => x.loopP50)} format={ms} /></Card>
                  <Card title="Jugadores conectados"><MiniChart name="Conectados" data={series((x) => x.online)} /></Card>
                  <Card title="Peticiones cada 10 s"><MiniChart name="Peticiones" kind="bar" data={series((x) => x.requests)} /></Card>
                </div>
              )}
              <Card title="Equipo">
                <dl className="grid gap-4 text-sm sm:grid-cols-3">
                  <div><dt className="text-niebla">Nombre</dt><dd className="text-marfil">{s.system.hostname}</dd></div>
                  <div><dt className="text-niebla">Sistema</dt><dd className="text-marfil">{s.system.platform}</dd></div>
                  <div><dt className="text-niebla">Procesador</dt><dd className="text-marfil">{s.system.cpuModel ?? '—'} ({s.system.cpus} hilos)</dd></div>
                  <div><dt className="text-niebla">Encendido desde hace</dt><dd className="text-marfil">{duration(s.system.uptimeSystemSec)}</dd></div>
                  <div><dt className="text-niebla">Casino en marcha desde hace</dt><dd className="text-marfil">{duration(s.system.uptimeProcessSec)}</dd></div>
                  <div><dt className="text-niebla">Node.js</dt><dd className="text-marfil">{s.system.node}</dd></div>
                  <div className="sm:col-span-3"><dt className="text-niebla">Errores del servidor (500) en los últimos 10 s</dt><dd className="text-marfil">{c.errors5xx}</dd></div>
                </dl>
                <p className="mt-4 text-xs text-niebla">El retraso interno mide cuánto tarda el servidor en atender lo que tiene en cola: si sube de 100 ms de forma sostenida, todo el casino va a tirones. Si se mantiene alto 1 minuto, recibes un aviso.</p>
              </Card>
            </>
          );
        }}
      </Loadable>
    </div>
  );
}
