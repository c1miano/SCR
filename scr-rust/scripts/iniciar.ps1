param([switch]$Build)
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$env:PATH="$env:USERPROFILE/.cargo/bin;$env:PATH"
if($Build){npm.cmd run build}else{npm.cmd run dev}
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
