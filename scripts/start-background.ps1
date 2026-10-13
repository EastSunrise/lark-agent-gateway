$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$stateRoot = Join-Path $projectRoot '.state'
New-Item -ItemType Directory -Path (Join-Path $stateRoot 'logs') -Force | Out-Null
if (Test-Path -LiteralPath (Join-Path $stateRoot 'gateway.pid')) {
  $gatewayProcessId = [int](Get-Content -LiteralPath (Join-Path $stateRoot 'gateway.pid'))
  if (Get-Process -Id $gatewayProcessId -ErrorAction SilentlyContinue) {
    Write-Output "Gateway already running: $gatewayProcessId"
    exit 0
  }
}
$nodePath = (Get-Command node).Source
$entryPath = Join-Path $projectRoot 'dist/src/main.js'
if (!(Test-Path -LiteralPath $entryPath)) { throw 'Run npm run build first.' }
$process = Start-Process -FilePath $nodePath -ArgumentList @('"' + $entryPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateRoot 'logs/service.stdout.log') -RedirectStandardError (Join-Path $stateRoot 'logs/service.stderr.log') -PassThru
Write-Output "Gateway background PID: $($process.Id)"
Write-Output "Startup output: $stateRoot/logs/service.stdout.log"
