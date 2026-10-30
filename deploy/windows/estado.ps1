#Requires -Version 5.1
<#
.SYNOPSIS
  Muestra cómo está el servidor de Aurum Casino: servicio, salud, dirección
  pública, última copia de seguridad y las últimas líneas del registro.
#>
$ErrorActionPreference = 'Continue'
$Code = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Carpeta = Split-Path $Code -Parent
$Tailscale = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'

$envFile = Join-Path $Code '.env'
$puerto = 3001
$copias = Join-Path $Carpeta 'datos\copias'
if (Test-Path $envFile) {
  foreach ($l in Get-Content -LiteralPath $envFile -Encoding UTF8) {
    if ($l -match '^\s*PORT\s*=\s*(\d+)') { $puerto = [int]$Matches[1] }
    if ($l -match '^\s*BACKUP_DIR\s*=\s*(.+)$') { $copias = $Matches[1].Trim() }
  }
}

$svc = Get-Service -Name 'AurumCasino' -ErrorAction SilentlyContinue
Write-Host ('Servicio:      ' + $(if ($svc) { $svc.Status } else { 'no instalado' }))

try {
  $h = Invoke-RestMethod -Uri "http://127.0.0.1:$puerto/api/health" -TimeoutSec 5
  Write-Host ("Salud:         ok={0}  base de datos={1}  encendido hace {2} min" -f $h.ok, $h.database, [math]::Round($h.uptimeSec / 60))
} catch { Write-Host 'Salud:         NO RESPONDE' -ForegroundColor Red }

if (Test-Path $Tailscale) {
  try {
    $st = (& $Tailscale status --json 2>$null) | Out-String | ConvertFrom-Json
    $dns = ([string]$st.Self.DNSName).TrimEnd('.')
    Write-Host "Tailscale:     $($st.BackendState)  ->  https://$dns"
    try {
      $pub = Invoke-RestMethod -Uri "https://$dns/api/health" -TimeoutSec 10
      Write-Host "Desde fuera:   $(if ($pub.ok) { 'OK' } else { 'ERROR' })"
    } catch { Write-Host 'Desde fuera:   no responde (¿Funnel activo? tailscale funnel status)' -ForegroundColor Yellow }
  } catch { Write-Host 'Tailscale:     sin sesión' -ForegroundColor Yellow }
}

$ultima = Get-ChildItem -LiteralPath $copias -Filter 'aurum-*.db' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host ('Última copia:  ' + $(if ($ultima) { "$($ultima.LastWriteTime)  $($ultima.FullName)" } else { 'ninguna' }))
Write-Host ('Versión:       ' + (& git -C $Code log -1 --format='%h %s (%cr)'))

$log = Join-Path $Carpeta 'logs\servidor.log'
if (Test-Path $log) {
  Write-Host ''
  Write-Host 'Últimas líneas del registro:' -ForegroundColor Cyan
  Get-Content -LiteralPath $log -Tail 15 -Encoding UTF8
}
