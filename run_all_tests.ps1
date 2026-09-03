# =============================================================================
# run_all_tests.ps1
#
# Runs all Family Card k6 test types and generates HTML + JSON reports.
# Reports are saved to: v1\reports\
#
# Usage:
#   Run all tests sequentially:
#     .\run_all_tests.ps1
#
#   Run a single test:
#     .\run_all_tests.ps1 -Test load
#     .\run_all_tests.ps1 -Test spike
#     .\run_all_tests.ps1 -Test soak
#     .\run_all_tests.ps1 -Test stress
#
#   Run a subset:
#     .\run_all_tests.ps1 -Test load,spike
# =============================================================================

param (
    [string[]] $Test = @('load', 'spike', 'soak', 'stress')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Paths ─────────────────────────────────────────────────────────────────────
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ReportsDir = Join-Path $ScriptDir 'reports'

# Ensure reports directory exists
if (-not (Test-Path $ReportsDir)) {
    New-Item -ItemType Directory -Path $ReportsDir | Out-Null
    Write-Host "[init] Created reports directory: $ReportsDir" -ForegroundColor Cyan
}

# ── Helpers ───────────────────────────────────────────────────────────────────
function Write-Banner {
    param([string] $Message, [string] $Color = 'Cyan')
    $line = '=' * 72
    Write-Host $line                -ForegroundColor $Color
    Write-Host "  $Message"         -ForegroundColor $Color
    Write-Host $line                -ForegroundColor $Color
}

function Run-Test {
    param([string] $Name)

    $scriptFile = Join-Path $ScriptDir "family_card_${Name}.js"

    if (-not (Test-Path $scriptFile)) {
        Write-Host "[SKIP] Test file not found: $scriptFile" -ForegroundColor Yellow
        return
    }

    Write-Banner "Starting: family_card_${Name}.js"

    $startTime = Get-Date
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Running $Name test..." -ForegroundColor White

    # k6 writes reports via handleSummary inside the test script.
    # We run from the v1 directory so relative paths (./lib, ./reports) resolve correctly.
    Push-Location $ScriptDir
    try {
        k6 run "family_card_${Name}.js"
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    $elapsed = (Get-Date) - $startTime
    $elapsedStr = '{0:mm}m {0:ss}s' -f $elapsed

    if ($exitCode -eq 0) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Name test PASSED in $elapsedStr" -ForegroundColor Green
    } else {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Name test FINISHED WITH ERRORS (exit $exitCode) in $elapsedStr" -ForegroundColor Red
    }

    # List the reports just written
    $latest = Get-ChildItem -Path $ReportsDir -Filter "family_card_${Name}_*" |
              Sort-Object LastWriteTime -Descending |
              Select-Object -First 2
    if ($latest) {
        Write-Host "[reports]" -ForegroundColor Cyan
        $latest | ForEach-Object { Write-Host "  $_" -ForegroundColor Cyan }
    }

    Write-Host ""
    return $exitCode
}

# ── Validate requested tests ──────────────────────────────────────────────────
$validTests = @('load', 'spike', 'soak', 'stress')
foreach ($t in $Test) {
    if ($t -notin $validTests) {
        Write-Host "[ERROR] Unknown test type '$t'. Valid options: $($validTests -join ', ')" -ForegroundColor Red
        exit 1
    }
}

# ── Main ──────────────────────────────────────────────────────────────────────
Write-Banner "Family Card k6 Test Suite" 'Magenta'
Write-Host "Tests to run : $($Test -join ', ')"   -ForegroundColor White
Write-Host "Reports dir  : $ReportsDir"           -ForegroundColor White
Write-Host "Started at   : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor White
Write-Host ""

$results    = @{}
$suiteStart = Get-Date

foreach ($t in $Test) {
    $results[$t] = Run-Test -Name $t
}

# ── Suite summary ─────────────────────────────────────────────────────────────
$suiteElapsed = (Get-Date) - $suiteStart
Write-Banner "Suite Summary" 'Magenta'
Write-Host ('Total time: {0:mm}m {0:ss}s' -f $suiteElapsed) -ForegroundColor White
Write-Host ""

$allPassed = $true
foreach ($t in $Test) {
    $code   = $results[$t]
    $status = if ($code -eq 0) { 'PASSED' } else { "FAILED (exit $code)" }
    $color  = if ($code -eq 0) { 'Green'  } else { 'Red' }
    Write-Host ("  {0,-10} {1}" -f $t.ToUpper(), $status) -ForegroundColor $color
    if ($code -ne 0) { $allPassed = $false }
}

Write-Host ""
Write-Host "Reports saved to: $ReportsDir" -ForegroundColor Cyan
Write-Host ""

exit $(if ($allPassed) { 0 } else { 1 })
