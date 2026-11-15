param([switch]$Run)

$ErrorActionPreference = 'Stop'
$sdkHash = '6c15ed06a3b8cd9a5cbccac302a45a70fb43c68c925d9ecbe711dcc110bfbc8e'
$archiveName = 'EUI-NEO-v0.6.3-windows-x64-sdk.zip'
$dependencyDir = Join-Path $PSScriptRoot '.deps'
$archive = Join-Path $dependencyDir $archiveName
$buildDir = Join-Path $PSScriptRoot '.build'

if (-not [Environment]::Is64BitOperatingSystem -or $env:OS -ne 'Windows_NT') {
    throw 'This bootstrap is validated only for Windows x64. See README.md for other platforms.'
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
    throw 'Visual Studio Build Tools with Desktop development with C++ is required.'
}
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $vs) {
    throw 'No Visual Studio installation with the C++ toolchain was found.'
}
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
$cmake = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$ctest = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\ctest.exe'
$ninja = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe'
foreach ($tool in @($vcvars, $cmake, $ctest, $ninja)) {
    if (-not (Test-Path -LiteralPath $tool)) {
        throw "Required build tool is missing: $tool. Install the C++ CMake tools component."
    }
}

New-Item -ItemType Directory -Path $dependencyDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    $url = "https://github.com/sudoevolve/EUI-NEO/releases/download/v0.6.3/$archiveName"
    Write-Host "Downloading fixed EUI-NEO v0.6.3 SDK from $url"
    Invoke-WebRequest -Uri $url -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sdkHash) {
    throw "SDK SHA-256 mismatch: $archive. Do not use this download."
}
if (-not (Test-Path -LiteralPath (Join-Path $dependencyDir 'lib\cmake\EuiNeo\EuiNeoConfig.cmake'))) {
    Expand-Archive -LiteralPath $archive -DestinationPath $dependencyDir
}

$command = "call `"$vcvars`" >nul && `"$cmake`" -S `"$PSScriptRoot`" -B `"$buildDir`" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_MAKE_PROGRAM=`"$ninja`" -DCMAKE_PREFIX_PATH=`"$dependencyDir`" && `"$cmake`" --build `"$buildDir`" && `"$ctest`" --test-dir `"$buildDir`" --output-on-failure"
& $env:ComSpec /d /c $command
if ($LASTEXITCODE -ne 0) {
    throw "EUI example configure/build/test failed (exit $LASTEXITCODE)."
}

$executable = Join-Path $buildDir 'ycide_eui_poc.exe'
Write-Host "Built and tested: $executable"
if ($Run) {
    Start-Process -FilePath $executable -WorkingDirectory $buildDir
}
