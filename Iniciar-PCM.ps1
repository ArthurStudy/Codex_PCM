$ErrorActionPreference = 'Stop'
$pcmRoot = $PSScriptRoot
$pcmUrl = 'http://127.0.0.1:8765/'
try {
    $pcmState = Invoke-RestMethod -Uri ($pcmUrl + 'api/state') -TimeoutSec 2
    if ($null -ne $pcmState.orders -and $null -ne $pcmState.assets) {
        Start-Process $pcmUrl
        exit 0
    }
} catch { }
$pcmCandidates = @()
$pcmCommand = Get-Command python.exe -ErrorAction SilentlyContinue
if ($pcmCommand -and $pcmCommand.Source -notlike '*WindowsApps*') { $pcmCandidates += $pcmCommand.Source }
$pcmCandidates += (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe')
$pcmPython = $pcmCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $pcmPython) { throw 'Python nao encontrado. Instale Python 3.10 ou superior ou abra o projeto no Codex.' }
$pcmData = Join-Path $pcmRoot 'data'
New-Item -ItemType Directory -Path $pcmData -Force | Out-Null
$pcmProcess = Start-Process -FilePath $pcmPython -ArgumentList @('"' + (Join-Path $pcmRoot 'server.py') + '"','--port','8765') -WorkingDirectory $pcmRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $pcmData 'server.log') -RedirectStandardError (Join-Path $pcmData 'server-error.log')
for ($pcmAttempt = 0; $pcmAttempt -lt 30; $pcmAttempt++) {
    Start-Sleep -Milliseconds 200
    try {
        $pcmState = Invoke-RestMethod -Uri ($pcmUrl + 'api/state') -TimeoutSec 1
        if ($null -ne $pcmState.orders) {
            Start-Process $pcmUrl
            exit 0
        }
    } catch { }
    if ($pcmProcess.HasExited) { break }
}
throw 'Nao foi possivel iniciar o PCM. Consulte data\server-error.log ou verifique a porta 8765.'
