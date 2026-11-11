$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$electron=Join-Path (Split-Path -Parent $project) 'semestre-desktop/node_modules/electron/dist/electron.exe'
if(-not(Test-Path -LiteralPath $electron)){throw 'Mantenha a pasta semestre-desktop ao lado de scr-rust para migrar os dados.'}
& $electron (Join-Path $PSScriptRoot 'export-electron.cjs')
if($LASTEXITCODE -ne 0){throw 'Não foi possível exportar o perfil. Nenhum dado original foi alterado.'}
