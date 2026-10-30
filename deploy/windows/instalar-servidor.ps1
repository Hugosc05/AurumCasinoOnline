#Requires -Version 5.1
<#
.SYNOPSIS
  Convierte un PC con Windows en el servidor de Aurum Casino, accesible desde
  internet por HTTPS y gratis (Tailscale Funnel). Ver DEPLOY-CASA.md.

.DESCRIPTION
  Se puede ejecutar varias veces: lo que ya está hecho se respeta.
  1. Instala Git, Node.js LTS, NSSM y Tailscale (winget).
  2. Descarga o actualiza el código en <Carpeta>\casino y lo compila.
  3. Inicia sesión en Tailscale y obtiene la dirección pública.
  4. Crea el .env (base de datos SQLite local en <Carpeta>\datos).
  5. Opcional: trae todos los datos desde Supabase (cuentas, saldos, historial…).
  6. Instala el servicio de Windows «AurumCasino» (arranca solo y se reinicia si falla).
  7. Publica el casino con Tailscale Funnel (HTTPS público).
  8. Copia de seguridad diaria a las 05:00, sin suspensión y reinicios de
     Windows Update solo de 2:00 a 8:00.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\instalar-servidor.ps1
#>
[CmdletBinding()]
param(
  [string]$Carpeta = 'C:\Aurum',
  [int]$Puerto = 3001,
  [string]$Repo = 'https://github.com/Hugosc05/AurumCasinoOnline.git',
  [string]$Rama = 'main'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Servicio = 'AurumCasino'
$Code = Join-Path $Carpeta 'casino'
$Datos = Join-Path $Carpeta 'datos'
$Copias = Join-Path $Datos 'copias'
$Logs = Join-Path $Carpeta 'logs'
$Bin = Join-Path $Carpeta 'bin'
$Nssm = Join-Path $Bin 'nssm.exe'
$Tailscale = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
$script:paso = 0

function Paso([string]$texto) { $script:paso++; Write-Host ''; Write-Host "[$script:paso] $texto" -ForegroundColor Cyan }
function Ok([string]$texto) { Write-Host "    OK  $texto" -ForegroundColor Green }
function Aviso([string]$texto) { Write-Host "    !!  $texto" -ForegroundColor Yellow }
function Falla([string]$texto) { Write-Host ''; Write-Host "ERROR: $texto" -ForegroundColor Red; exit 1 }

function Refrescar-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# Ejecuta un programa externo sin que sus avisos por stderr detengan el script (PowerShell 5.1).
function Silencioso([scriptblock]$bloque) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $bloque 2>&1 | Out-Null } catch { } finally { $ErrorActionPreference = $prev }
}

# Ejecuta un programa externo y se detiene si termina con error.
function Ejecutar([string]$exe, [string[]]$argumentos, [string]$queHace) {
  & $exe @argumentos
  if ($LASTEXITCODE -ne 0) { Falla "$queHace (código $LASTEXITCODE)." }
}

function Instalar-Winget([string]$id, [string]$nombre, [scriptblock]$yaEsta) {
  if (& $yaEsta) { Ok "$nombre ya está instalado"; return }
  Write-Host "    Instalando $nombre…"
  & winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
  Refrescar-Path
  if (-not (& $yaEsta)) { Falla "No se pudo instalar $nombre con winget. Instálalo a mano y vuelve a ejecutar el script." }
  Ok "$nombre instalado"
}

function Leer-Si([string]$pregunta) {
  $r = Read-Host "$pregunta [S/n]"
  return ($r -eq '' -or $r -match '^[sSyY]')
}

# Pone (o cambia) una línea CLAVE=valor del .env sin tocar el resto.
function Poner-Env([string]$archivo, [string]$clave, [string]$valor) {
  $lineas = @()
  if (Test-Path $archivo) { $lineas = @(Get-Content -LiteralPath $archivo -Encoding UTF8) }
  $hecho = $false
  $nuevas = foreach ($l in $lineas) {
    if ($l -match "^\s*$([regex]::Escape($clave))\s*=") { $hecho = $true; "$clave=$valor" } else { $l }
  }
  if (-not $hecho) { $nuevas = @($nuevas) + "$clave=$valor" }
  # UTF-8 sin BOM (el servidor también acepta BOM, pero así queda limpio).
  [IO.File]::WriteAllText($archivo, (($nuevas -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))
}

function Esperar-Salud([int]$segundos) {
  for ($i = 0; $i -lt $segundos; $i += 2) {
    try {
      $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Puerto/api/health" -TimeoutSec 3
      if ($r.ok) { return $true }
    } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

# --------------------------------------------------------------------------

Write-Host '=============================================' -ForegroundColor DarkYellow
Write-Host '   Aurum Casino - instalación del servidor' -ForegroundColor DarkYellow
Write-Host '=============================================' -ForegroundColor DarkYellow

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Falla 'Abre PowerShell como administrador (clic derecho > Ejecutar como administrador) y vuelve a lanzarlo.' }
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Falla 'Falta winget. Instala «Instalador de aplicación» (App Installer) desde Microsoft Store y vuelve a ejecutar el script.'
}
New-Item -ItemType Directory -Force -Path $Carpeta, $Datos, $Copias, $Logs, $Bin | Out-Null

# 1. Programas -------------------------------------------------------------
Paso 'Programas necesarios'
Instalar-Winget 'Git.Git' 'Git' { [bool](Get-Command git -ErrorAction SilentlyContinue) }
Instalar-Winget 'OpenJS.NodeJS.LTS' 'Node.js LTS' { [bool](Get-Command node -ErrorAction SilentlyContinue) }
$nodeVer = [version]((& node -p 'process.versions.node').Trim())
if ($nodeVer -lt [version]'22.13.0') {
  Write-Host "    Node $nodeVer es antiguo; actualizando…"
  & winget upgrade --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
  Refrescar-Path
  $nodeVer = [version]((& node -p 'process.versions.node').Trim())
  if ($nodeVer -lt [version]'22.13.0') { Falla "Hace falta Node 22.13 o superior (tienes $nodeVer)." }
}
Ok "Node $nodeVer"
$Node = (Get-Command node).Source

if (-not (Test-Path $Nssm)) {
  Instalar-Winget 'NSSM.NSSM' 'NSSM (servicios de Windows)' {
    [bool](Get-Command nssm -ErrorAction SilentlyContinue) -or
    [bool](Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages", "$env:ProgramFiles\WinGet\Packages" -Recurse -Filter nssm.exe -ErrorAction SilentlyContinue | Select-Object -First 1)
  }
  # Copia propia en <Carpeta>\bin: el servicio no depende de dónde lo deje winget.
  $origen = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages", "$env:ProgramFiles\WinGet\Packages" -Recurse -Filter nssm.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match 'win64' } | Select-Object -First 1
  if (-not $origen) {
    $cmd = Get-Command nssm -ErrorAction SilentlyContinue
    if ($cmd) { $origen = Get-Item $cmd.Source }
  }
  if (-not $origen) { Falla 'No encuentro nssm.exe tras instalarlo.' }
  Copy-Item -LiteralPath $origen.FullName -Destination $Nssm -Force
}
Ok "NSSM en $Nssm"

Instalar-Winget 'Tailscale.Tailscale' 'Tailscale' { Test-Path $Tailscale }

# 2. Código ----------------------------------------------------------------
Paso 'Código del casino'
& git config --global --add safe.directory ($Code -replace '\\', '/') | Out-Null
if (Test-Path (Join-Path $Code '.git')) {
  Ejecutar git @('-C', $Code, 'pull', '--ff-only') 'No se pudo actualizar el código'
} else {
  Ejecutar git @('clone', '--branch', $Rama, $Repo, $Code) 'No se pudo descargar el código'
}
Ok "Código en $Code ($((& git -C $Code log -1 --format='%h %s')))"

$servicioExiste = [bool](Get-Service $Servicio -ErrorAction SilentlyContinue)
if ($servicioExiste) {
  # Windows bloquea los archivos en uso: hay que parar el servidor antes de reinstalar dependencias.
  Silencioso { & $Nssm stop $Servicio }
}

Push-Location $Code
try {
  Write-Host '    Instalando dependencias (puede tardar unos minutos)…'
  Ejecutar npm @('ci', '--include=dev', '--no-audit', '--no-fund') 'Falló npm ci'
  Write-Host '    Compilando la web…'
  Ejecutar npm @('run', 'build') 'Falló la compilación'
} finally { Pop-Location }
Ok 'Dependencias instaladas y web compilada'

# 3. Tailscale -------------------------------------------------------------
Paso 'Tailscale (dirección pública gratuita)'
function Estado-Tailscale {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { return ((& $Tailscale status --json 2>$null) | Out-String | ConvertFrom-Json) } catch { return $null } finally { $ErrorActionPreference = $prev }
}
# Recién instalado, el servicio de Tailscale tarda unos segundos en arrancar.
for ($i = 0; $i -lt 30; $i++) {
  $svcTs = Get-Service -Name 'Tailscale' -ErrorAction SilentlyContinue
  if ($svcTs -and $svcTs.Status -eq 'Running') { break }
  if ($svcTs -and $svcTs.Status -eq 'Stopped') { Start-Service -Name 'Tailscale' -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
}
$st = Estado-Tailscale
if (-not $st -or $st.BackendState -ne 'Running') {
  Write-Host '    Inicia sesión en Tailscale en la ventana del navegador que se abrirá'
  Write-Host '    (o abre el enlace que aparece abajo). Puedes usar tu cuenta de Google, Microsoft o GitHub.'
  & $Tailscale up --unattended
  $st = Estado-Tailscale
  if (-not $st -or $st.BackendState -ne 'Running') { Falla 'Tailscale no ha iniciado sesión. Vuelve a ejecutar el script.' }
}
# Que funcione sin nadie con la sesión de Windows abierta.
Silencioso { & $Tailscale set --unattended=true }
if ($LASTEXITCODE -ne 0) { Aviso 'Activa a mano en el icono de Tailscale: Settings > Run unattended.' }
$dns = ([string]$st.Self.DNSName).TrimEnd('.')
if (-not $dns) { Falla 'Tailscale no tiene nombre DNS. Activa MagicDNS en https://login.tailscale.com/admin/dns y repite.' }
$Url = "https://$dns"
Ok "Este equipo será: $Url"

# 4. Configuración (.env) --------------------------------------------------
Paso 'Configuración (.env)'
$envFile = Join-Path $Code '.env'
$dbFile = Join-Path $Datos 'aurum.db'
$vacia = $false
$nuevo = -not (Test-Path $envFile)
if ($nuevo) {
  $cabecera = @(
    '# Servidor de casa (Windows + Tailscale Funnel). Generado por deploy/windows/instalar-servidor.ps1.',
    '# No lo subas a GitHub (ya está en .gitignore).',
    ''
  ) -join [Environment]::NewLine
  [IO.File]::WriteAllText($envFile, $cabecera, (New-Object Text.UTF8Encoding $false))
  Poner-Env $envFile 'SESSION_TTL_HOURS' '168'
  Poner-Env $envFile 'STARTING_BALANCE' '10000'
  Poner-Env $envFile 'REGISTER_LIMIT_PER_HOUR' '10'
  Poner-Env $envFile 'LOGIN_LIMIT_PER_15MIN' '30'
  Poner-Env $envFile 'LOG_LEVEL' 'info'
  Poner-Env $envFile 'ADS_PROVIDER' 'none'
}
Poner-Env $envFile 'NODE_ENV' 'production'
Poner-Env $envFile 'HOST' '127.0.0.1'
Poner-Env $envFile 'PORT' "$Puerto"
Poner-Env $envFile 'DATABASE_PATH' $dbFile
Poner-Env $envFile 'DATABASE_URL' ''
Poner-Env $envFile 'BACKUP_DIR' $Copias
Poner-Env $envFile 'TRUST_PROXY' 'true'
Poner-Env $envFile 'KEEPALIVE' 'false'
Poner-Env $envFile 'CLIENT_ORIGINS' "$Url,http://localhost:$Puerto,http://127.0.0.1:$Puerto"
Ok "$envFile ($(if ($nuevo) { 'creado' } else { 'actualizado' }))"

# 5. Datos -----------------------------------------------------------------
Paso 'Base de datos'
if (Test-Path $dbFile) {
  Ok "Ya existe ${dbFile}: se conserva"
} else {
  Write-Host '    Puedes traer TODO lo que hay en Supabase (cuentas, saldos, historial, amigos, cosméticos…).'
  Write-Host '    Si eliges que no, el casino empieza vacío.'
  if (Leer-Si '    ¿Importar los datos de Supabase?') {
    Write-Host '    Pega la cadena de conexión de Supabase (Connect > Session pooler, con tu contraseña).'
    Write-Host '    No se guarda en ningún sitio: solo se usa para esta copia.'
    $seguro = Read-Host '    Cadena postgresql://…' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
    try { $env:IMPORT_FROM_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    Push-Location $Code
    try {
      & npm run -s db:import -w '@aurum/server'
      $codigo = $LASTEXITCODE
    } finally {
      Remove-Item Env:IMPORT_FROM_URL -ErrorAction SilentlyContinue
      Pop-Location
    }
    if ($codigo -ne 0) {
      Remove-Item -LiteralPath $dbFile, "$dbFile-wal", "$dbFile-shm" -ErrorAction SilentlyContinue
      Falla 'La importación no se completó (revisa la cadena de conexión). Vuelve a ejecutar el script.'
    }
    Ok 'Datos importados'
  } else {
    $vacia = $true
    Ok 'Se empezará con una base de datos vacía'
  }
}
# Solo administradores y el sistema pueden leer la carpeta de datos y el .env.
& icacls $Datos /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
& icacls $envFile /inheritance:r /grant:r '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null

# 6. Servicio --------------------------------------------------------------
Paso 'Servicio de Windows «Aurum Casino»'
if (-not $servicioExiste) { Ejecutar $Nssm @('install', $Servicio, $Node) 'No se pudo crear el servicio' }
$cfg = @(
  @('Application', $Node),
  @('AppParameters', '--import tsx --no-warnings=ExperimentalWarning src/index.ts'),
  @('AppDirectory', (Join-Path $Code 'apps\server')),
  @('DisplayName', 'Aurum Casino'),
  @('Description', 'Servidor de Aurum Casino (créditos virtuales). Publicado con Tailscale Funnel.'),
  @('Start', 'SERVICE_AUTO_START'),
  @('AppStdout', (Join-Path $Logs 'servidor.log')),
  @('AppStderr', (Join-Path $Logs 'servidor.log')),
  @('AppRotateFiles', '1'),
  @('AppRotateOnline', '1'),
  @('AppRotateBytes', '10485760'),
  @('AppStopMethodConsole', '15000'),
  @('AppRestartDelay', '5000')
)
foreach ($c in $cfg) { Ejecutar $Nssm (@('set', $Servicio) + $c) "No se pudo configurar $($c[0])" }
Ejecutar $Nssm @('set', $Servicio, 'AppExit', 'Default', 'Restart') 'No se pudo configurar el reinicio automático'
Ejecutar $Nssm @('start', $Servicio) 'No se pudo arrancar el servicio'
if (-not (Esperar-Salud 90)) { Falla "El servidor no responde. Mira el registro: $Logs\servidor.log" }
Ok "Funcionando en http://127.0.0.1:$Puerto"

if ($vacia -and (Leer-Si '    Base de datos nueva: ¿crear ahora tu cuenta de administrador?')) {
  $u = Read-Host '    Nombre de usuario'
  $e = Read-Host '    Correo electrónico'
  Push-Location $Code
  # '--' entre comillas: Windows PowerShell 5.1 se come un -- suelto y npm no pasaría los argumentos.
  try { & npm run -s admin:create -w '@aurum/server' '--' --username $u --email $e } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { Aviso 'No se creó el administrador; puedes hacerlo luego (ver DEPLOY-CASA.md).' } else { Ok "Administrador $u creado" }
}

# 7. Funnel ----------------------------------------------------------------
Paso 'Publicar en internet (Tailscale Funnel)'
Write-Host '    Si es la primera vez, Tailscale mostrará un enlace para permitir Funnel: ábrelo y acepta.'
& $Tailscale funnel --bg $Puerto
if ($LASTEXITCODE -ne 0) { Falla 'No se pudo activar Funnel. Abre el enlace que indica Tailscale, acepta y repite el script.' }
Ok "Publicado en $Url"

# 8. Copias, energía y actualizaciones -------------------------------------
Paso 'Copias de seguridad, energía y Windows Update'
$accion = New-ScheduledTaskAction -Execute $Node -Argument '--import tsx --no-warnings=ExperimentalWarning src/cli/backup.ts' -WorkingDirectory (Join-Path $Code 'apps\server')
$cuando = New-ScheduledTaskTrigger -Daily -At '05:00'
$quien = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName 'Aurum - copia de seguridad' -Action $accion -Trigger $cuando -Principal $quien -Settings $ajustes -Force | Out-Null
Start-ScheduledTask -TaskName 'Aurum - copia de seguridad'
Ok "Copia diaria a las 05:00 en $Copias (se guardan 14)"

& powercfg /change standby-timeout-ac 0
& powercfg /change hibernate-timeout-ac 0
& powercfg /hibernate off
Ok 'El equipo ya no se suspende ni hiberna'

$wu = 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
if (-not (Test-Path $wu)) { New-Item -Path $wu | Out-Null }
Set-ItemProperty -Path $wu -Name ActiveHoursStart -Value 8 -Type DWord
Set-ItemProperty -Path $wu -Name ActiveHoursEnd -Value 2 -Type DWord
Set-ItemProperty -Path $wu -Name SmartActiveHoursState -Value 0 -Type DWord -ErrorAction SilentlyContinue
Ok 'Windows Update solo reinicia entre las 2:00 y las 8:00'

# Fin ----------------------------------------------------------------------
$publico = $false
try { $publico = (Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 15).ok } catch { }

Write-Host ''
Write-Host '=============================================' -ForegroundColor Green
Write-Host '   ¡Listo! Tu casino está en:' -ForegroundColor Green
Write-Host "   $Url" -ForegroundColor White
Write-Host '=============================================' -ForegroundColor Green
if (-not $publico) { Aviso 'Aún no responde desde fuera: Funnel puede tardar 1-2 minutos la primera vez.' }
Write-Host ''
Write-Host 'Quedan 3 cosas a mano (ver DEPLOY-CASA.md):'
Write-Host '  1. https://login.tailscale.com/admin/machines > este equipo > «...» > Disable key expiry.'
Write-Host '  2. En la BIOS: «Restore on AC power loss» = Power On (se enciende solo tras un apagón).'
Write-Host '  3. Borra o suspende el servicio de Render para que no vuelva a arrancar el 1 de mes.'
Write-Host ''
Write-Host "Actualizar en el futuro: $Code\deploy\windows\actualizar.ps1"
Write-Host "Ver el estado:            $Code\deploy\windows\estado.ps1"
