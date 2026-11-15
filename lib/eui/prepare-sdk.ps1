$ErrorActionPreference = 'Stop'
$directory = Join-Path $PSScriptRoot 'sdk'
$archive = Join-Path $directory 'EUI-NEO-v0.6.3-windows-x64-sdk.zip'
$hash = '6c15ed06a3b8cd9a5cbccac302a45a70fb43c68c925d9ecbe711dcc110bfbc8e'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    $existing = Join-Path $PSScriptRoot '..\eui-poc\.deps\EUI-NEO-v0.6.3-windows-x64-sdk.zip'
    if (Test-Path -LiteralPath $existing) {
        Copy-Item -LiteralPath $existing -Destination $archive
    } else {
        Invoke-WebRequest -Uri 'https://github.com/sudoevolve/EUI-NEO/releases/download/v0.6.3/EUI-NEO-v0.6.3-windows-x64-sdk.zip' -OutFile $archive
    }
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) {
    throw 'EUI SDK SHA-256 mismatch; refusing to import.'
}
Expand-Archive -LiteralPath $archive -DestinationPath $directory -Force
Write-Host "Fixed EUI-NEO v0.6.3 SDK prepared at $directory. No runtime download is required."
