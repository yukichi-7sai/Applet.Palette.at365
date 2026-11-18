param([string]$HostRoot = (Join-Path $PSScriptRoot '..\..\AppDock.at365'))
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskHost = [IO.Path]::GetFullPath($HostRoot)
$taskManifest = Get-Content -LiteralPath (Join-Path $taskRoot 'extension.json') -Raw | ConvertFrom-Json
$taskToolchain = Get-Content -LiteralPath (Join-Path $taskHost 'toolchain.json') -Raw | ConvertFrom-Json
$taskNode = Join-Path $taskHost ('.tools\node\' + $taskToolchain.node + '\node.exe')
$taskOutput = & $taskNode (Join-Path $taskHost 'scripts\publish-paths.cjs') $taskRoot
if ($LASTEXITCODE -ne 0) { throw 'Publish destination resolution failed' }
$taskOutput = [IO.Path]::GetFullPath($taskOutput.Trim())
$taskStage = Join-Path $taskRoot ('.artifacts\package\' + $taskManifest.version)
function Get-PaletteFileHash([string]$Path) {
    $taskHasher = [Security.Cryptography.SHA256]::Create()
    try {
        return [Convert]::ToBase64String($taskHasher.ComputeHash([IO.File]::ReadAllBytes($Path)))
    } finally {
        $taskHasher.Dispose()
    }
}
foreach ($taskDirectory in @($taskStage, $taskOutput)) {
    New-Item -ItemType Directory -Path (Join-Path $taskDirectory 'resources\translations') -Force | Out-Null
    foreach ($taskFile in @('extension.json', 'index.cjs', 'palette.cjs', 'resources\translations\applet.json')) {
        Copy-Item -LiteralPath (Join-Path $taskRoot $taskFile) -Destination (Join-Path $taskDirectory $taskFile) -Force
    }
}
& (Join-Path $taskHost 'scripts\pack-applet-update.ps1') -SourceDirectory $taskStage -OutputDirectory $taskOutput
if (-not $?) { throw 'Applet update package failed' }
foreach ($taskFile in @('extension.json', 'index.cjs', 'palette.cjs', 'resources\translations\applet.json')) {
    if ((Get-PaletteFileHash (Join-Path $taskRoot $taskFile)) -ne (Get-PaletteFileHash (Join-Path $taskOutput $taskFile))) {
        throw ('Published file mismatch: ' + $taskFile)
    }
}
Write-Output ('Published Palette ' + $taskManifest.version + ': ' + $taskOutput)
