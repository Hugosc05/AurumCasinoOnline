/* Calcula y muestra el RTP teórico exacto de la máquina de slots. */
import { REEL_STRIPS, computeRtp, scatterSpacingOk } from '../src/slots';

const r = computeRtp();
const pct = (x: number): string => `${(x * 100).toFixed(4)} %`;
console.log('Aurum Royale — RTP teórico exacto');
console.log('Longitudes de tira:', REEL_STRIPS.map((s) => s.length).join(', '));
console.log('Separación de scatters correcta:', scatterSpacingOk());
console.log('Combinaciones de paradas:', r.combinations.toLocaleString('es-ES'));
console.log('RTP líneas  :', pct(r.lineRtp));
console.log('RTP scatter :', pct(r.scatterRtp));
console.log('RTP total   :', pct(r.totalRtp));
console.log('Frecuencia de premio por línea:', pct(r.hitFrequencyPerLine));
