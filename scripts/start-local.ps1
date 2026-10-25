param(
    [ValidateRange(1024, 65535)][int]$Port = 8078,
    [switch]$EnableLocalAI,
    [switch]$SkipBuild,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$timepitchRoot = Split-Path -Parent $PSScriptRoot
$timepitchPython = Join-Path $timepitchRoot 'backend\.venv\Scripts\python.exe'
$timepitchOldModel = $env:TIMEPITCH_LOCAL_MODEL
$timepitchOldPath = $env:PATH
Push-Location $timepitchRoot
try {
    $timepitchProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    try { $timepitchProbe.Start() }
    catch { throw "Port $Port is already in use. Choose another explicit port; no existing process was stopped." }
    finally { $timepitchProbe.Stop() }
    if (-not (Test-Path -LiteralPath $timepitchPython)) { throw 'Missing backend environment. Run: python -m uv sync --project backend --locked' }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node/npm is required. See README.md.' }
    & $timepitchPython -c "import sys,fastapi,pydantic,agent_framework; from timepitch.catalog.repository import CatalogRepository; from timepitch.config import DATASET; assert sys.version_info[:2]==(3,12), 'Python 3.12 is required'; assert len(CatalogRepository(DATASET).list_teams())==686, 'Historical dataset is incomplete'"
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependency or historical dataset check failed. See README.md.' }
    if ($EnableLocalAI) {
        $timepitchRuntime = Join-Path $timepitchRoot '.local\foundry-runtime\0.8.119'
        if (-not (Test-Path -LiteralPath (Join-Path $timepitchRuntime 'foundry.exe'))) { throw 'Prepare the verified Foundry Local runtime first; see docs/demo/local-ai-probe.md.' }
        $env:PATH = "$timepitchRuntime;$timepitchOldPath"
        & $timepitchPython -c "import asyncio; from foundry_local.models import DeviceType; from timepitch.agents.provider import FoundryTransport; t=FoundryTransport('qwen2.5-1.5b'); info=t.client.manager.get_model_info('qwen2.5-1.5b',device=DeviceType.GPU); assert info.id=='qwen2.5-1.5b-instruct-generic-gpu:4', 'Model revision needs acceptance'; assert any(m.id==info.id for m in t.client.manager.list_loaded_models()), 'Load the prepared model explicitly before launch'; asyncio.run(t.client.client.close())"
        if ($LASTEXITCODE -ne 0) { throw 'Local AI is not prepared. This launcher never starts services or downloads/loads models.' }
        $env:TIMEPITCH_LOCAL_MODEL = 'qwen2.5-1.5b'
    } else { Remove-Item Env:TIMEPITCH_LOCAL_MODEL -ErrorAction SilentlyContinue }
    if ($CheckOnly) { Write-Output "Local preflight passed: http://127.0.0.1:$Port (AI enabled: $EnableLocalAI). No server started."; return }
    if (-not $SkipBuild) {
        if (-not (Test-Path -LiteralPath 'web\node_modules')) { throw 'Missing web dependencies. Run: npm.cmd --prefix web ci' }
        & npm.cmd --prefix web run build
        if ($LASTEXITCODE -ne 0) { throw 'Web build failed; server was not started.' }
    }
    if (-not (Test-Path -LiteralPath 'web\dist\index.html')) { throw 'Built web app missing. Run without -SkipBuild.' }
    Write-Output "TimePitch: http://127.0.0.1:$Port"
    Write-Output "Local AI enabled: $EnableLocalAI. Press Ctrl+C to stop this server. Foundry remains under your explicit control."
    & $timepitchPython -m uvicorn timepitch.app:create_app --factory --host 127.0.0.1 --port $Port
    if ($LASTEXITCODE -ne 0) { throw "Server exited with code $LASTEXITCODE" }
} finally {
    $env:PATH = $timepitchOldPath
    if ($null -eq $timepitchOldModel) { Remove-Item Env:TIMEPITCH_LOCAL_MODEL -ErrorAction SilentlyContinue } else { $env:TIMEPITCH_LOCAL_MODEL = $timepitchOldModel }
    Pop-Location
}
