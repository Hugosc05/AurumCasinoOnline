/**
 * ¿Merece la pena dibujar en 3D? (sin cargar three.js)
 *
 * Hace falta WebGL y, además, aceleración por hardware: con un rasterizador
 * por software (SwiftShader, llvmpipe…, típico de equipos sin controlador de
 * gráficos o de navegadores automatizados) las escenas 3D van a pocas
 * imágenes por segundo y bloquean la página, así que se usa la versión 2D.
 * `localStorage['aurum.3d'] = 'force'` obliga a usar 3D y `'off'` lo desactiva.
 */
let cached: boolean | null = null;

export function webglAvailable(): boolean {
  if (cached !== null) return cached;
  let pref: string | null = null;
  try {
    pref = localStorage.getItem('aurum.3d');
  } catch {
    /* sin almacenamiento */
  }
  if (pref === 'off') return (cached = false);
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return (cached = false);
    if (pref === 'force') return (cached = true);
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    cached = !/swiftshader|llvmpipe|softpipe|software|basic render/.test(renderer);
    return cached;
  } catch {
    return (cached = false);
  }
}
