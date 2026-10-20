/* Calcula y muestra el RTP teórico exacto de cada máquina de slots, funciones incluidas. */
import { SLOT_MACHINES, computeMachineRtp, machineSpacingOk, machineStrips } from '../src/slotMachines';

const pct = (x: number): string => `${(x * 100).toFixed(4)} %`;
for (const m of SLOT_MACHINES) {
  const r = computeMachineRtp(m);
  console.log(`\n${m.name} — RTP teórico exacto`);
  console.log('Longitudes de tira:', machineStrips(m).map((s: string[]) => s.length).join(', '));
  console.log('Separación de símbolos especiales correcta:', machineSpacingOk(m));
  console.log('RTP líneas      :', pct(r.lineRtp));
  console.log('RTP scatter     :', pct(r.scatterRtp));
  console.log('RTP giros gratis:', pct(r.freeSpinsRtp), `(probabilidad por tirada ${pct(r.freeSpinsChance)})`);
  console.log('RTP bono        :', pct(r.bonusRtp), `(probabilidad por tirada ${pct(r.bonusChance)})`);
  console.log('RTP total       :', pct(r.totalRtp));
  console.log('Frecuencia de premio por línea:', pct(r.hitFrequencyPerLine));
}
