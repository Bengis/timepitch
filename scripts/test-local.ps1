param(
    [switch]$RealModel,
    [ValidateRange(1024, 65535)][int]$Port = 8078,
    [string]$RuntimeDir = ''
)
$ErrorActionPreference = 'Stop'
$timepitchRoot = Split-Path -Parent $PSScriptRoot
$timepitchPython = Join-Path $timepitchRoot 'backend\.venv\Scripts\python.exe'
$timepitchOldModel = $env:TIMEPITCH_LOCAL_MODEL
$timepitchOldPath = $env:PATH
$timepitchOldRuntime = $env:TIMEPITCH_RUNTIME_DIR
$timepitchOldTestPort = $env:TIMEPITCH_TEST_PORT
Push-Location $timepitchRoot
try {
    Remove-Item Env:TIMEPITCH_LOCAL_MODEL -ErrorAction SilentlyContinue
    $env:TIMEPITCH_TEST_PORT = [string]$Port
    $env:TIMEPITCH_RUNTIME_DIR = if ($RuntimeDir) { [System.IO.Path]::GetFullPath($RuntimeDir) } else { Join-Path $timepitchRoot ".local\validation-test-local-$PID" }
    & $timepitchPython -m pytest backend/tests -q -p no:cacheprovider --basetemp .local/pytest-local
    if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed' }
    & npm.cmd --prefix web test
    if ($LASTEXITCODE -ne 0) { throw 'Web component tests failed' }
    & npm.cmd --prefix web run build
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed' }
    & npm.cmd --prefix web run test:e2e
    if ($LASTEXITCODE -ne 0) { throw 'Browser tests failed' }
    if ($RealModel) {
        $env:PATH = (Join-Path $timepitchRoot '.local\foundry-runtime\0.8.119') + ';' + $timepitchOldPath
        & $timepitchPython -m timepitch.agents.acceptance
        if ($LASTEXITCODE -ne 0) { throw 'Real local-model acceptance failed' }
        & npm.cmd --prefix web run test:e2e -- --config playwright.real.config.ts
        if ($LASTEXITCODE -ne 0) { throw 'Real local-model browser acceptance failed' }
    }
    Write-Output "TimePitch local checks passed. Real model included: $RealModel"
} finally {
    $env:PATH = $timepitchOldPath
    if ($null -eq $timepitchOldRuntime) { Remove-Item Env:TIMEPITCH_RUNTIME_DIR -ErrorAction SilentlyContinue } else { $env:TIMEPITCH_RUNTIME_DIR = $timepitchOldRuntime }
    if ($null -eq $timepitchOldTestPort) { Remove-Item Env:TIMEPITCH_TEST_PORT -ErrorAction SilentlyContinue } else { $env:TIMEPITCH_TEST_PORT = $timepitchOldTestPort }
    if ($null -eq $timepitchOldModel) { Remove-Item Env:TIMEPITCH_LOCAL_MODEL -ErrorAction SilentlyContinue } else { $env:TIMEPITCH_LOCAL_MODEL = $timepitchOldModel }
    Pop-Location
}
