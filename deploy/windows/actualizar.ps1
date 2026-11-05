#Requires -Version 5.1
<#
.SYNOPSIS
  Actualiza el servidor de Aurum Casino a la última versión de GitHub.

.DESCRIPTION
  1. Descarga los cambios (git pull).
  2. Hace una copia de seguridad de la base de datos.
  3. Para el servicio, instala dependencias, compila y lo vuelve a arrancar
     (las migraciones de la base de datos se aplican solas al arrancar).
  El casino está parado 1-2 minutos. Usa -Forzar para recompilar aunque no
  haya cambios nuevos.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\Aurum\casino\deploy\windows\actualizar.ps1
#>
[CmdletBinding()]
param([switch]$Forzar)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Servicio = 'AurumCasino'
$Code = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Carpeta = Split-Path $Code -Parent
$Nssm = Join-Path $Carpeta 'bin\nssm.exe'

function Ok([string]$t) { Write-Host "OK  $t" -ForegroundColor Green }
function Falla([string]$t) { Write-Host "ERROR: $t" -ForegroundColor Red; exit 1 }
function Puerto {
  $l = Get-Content -LiteralPath (Join-Path $Code '.env') -Encoding UTF8 | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -First 1
  if ($l) { return [int]($l -replace '^\s*PORT\s*=\s*', '') } else { return 3001 }
}
function Esperar-Salud([int]$segundos) {
  $p = Puerto
  for ($i = 0; $i -lt $segundos; $i += 2) {
    try { if ((Invoke-RestMethod -Uri "http://127.0.0.1:$p/api/health" -TimeoutSec 3).ok) { return $true } } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Falla 'Abre PowerShell como administrador.' }
if (-not (Test-Path $Nssm)) { Falla "No encuentro $Nssm. ¿Se instaló con instalar-servidor.ps1?" }

Push-Location $Code
try {
  $antes = (& git rev-parse --short HEAD).Trim()
  & git pull --ff-only
  if ($LASTEXITCODE -ne 0) { Falla 'git pull falló (¿hay cambios locales en el código?).' }
  $despues = (& git rev-parse --short HEAD).Trim()
  if ($antes -eq $despues -and -not $Forzar) {
    Ok "Ya estás en la última versión ($despues). Nada que hacer."
    exit 0
  }
  Write-Host "Actualizando $antes -> $despues"
  & git log --oneline "$antes..$despues" | Select-Object -First 15 | ForEach-Object { Write-Host "   $_" }

  Write-Host 'Copia de seguridad previa…'
  & npm run -s db:backup -w '@aurum/server'
  if ($LASTEXITCODE -ne 0) { Falla 'No se pudo hacer la copia de seguridad; no se actualiza.' }

  Write-Host 'Parando el casino…'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & $Nssm stop $Servicio 2>&1 | Out-Null
  $ErrorActionPreference = $prev

  $ok = $true
  Write-Host 'Instalando dependencias…'
  & npm ci --include=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { $ok = $false }
  if ($ok) {
    Write-Host 'Compilando la web…'
    & npm run build
    if ($LASTEXITCODE -ne 0) { $ok = $false }
  }
} finally { Pop-Location }

$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& $Nssm start $Servicio 2>&1 | Out-Null
$ErrorActionPreference = $prev
if (-not (Esperar-Salud 90)) {
  $log = Join-Path $Carpeta 'logs\servidor.log'
  if (Test-Path $log) { Get-Content -LiteralPath $log -Tail 25 -Encoding UTF8 | ForEach-Object { Write-Host "   $_" } }
  Falla "El casino no arranca. Mira $Carpeta\logs\servidor.log (y si hace falta, vuelve a la versión anterior con: git -C $Code reset --hard $antes)."
}
if (-not $ok) { Falla 'La instalación o la compilación falló; el casino sigue con lo que había. Revisa los mensajes de arriba.' }
Ok "Casino actualizado a $despues y funcionando."
