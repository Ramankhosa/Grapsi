$ErrorActionPreference='Stop'
$repo=Resolve-Path (Join-Path $PSScriptRoot '..\..')
$out=Join-Path $repo 'outputs\local-worker'
$package=Join-Path $out ('broker-package-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $package 'prisma') -Force | Out-Null
Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object {$_.Name -in @('broker.cjs','general-reuse.cjs','policy.cjs','policy-1.1.0.cjs','evidence-packing.cjs','schema.sql','install.cjs','grapsi-local-analysis-queue.service','grapsi-local-analysis-queue.timer')} | Copy-Item -Destination $package
Copy-Item -LiteralPath (Join-Path $repo 'prisma\schema.prisma') -Destination (Join-Path $package 'prisma\schema.prisma')
Copy-Item -LiteralPath (Join-Path $repo 'prisma\migrations') -Destination (Join-Path $package 'prisma\migrations') -Recurse
$archive=Join-Path $out 'broker-package.tgz'
& tar -czf $archive -C $package .
if($LASTEXITCODE -ne 0){throw 'Packaging failed'}
Get-FileHash -LiteralPath $archive -Algorithm SHA256 | Select-Object Path,Hash
