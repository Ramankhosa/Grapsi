$ErrorActionPreference='Stop'
$repo=Resolve-Path (Join-Path $PSScriptRoot '..\..')
$out=Join-Path $repo 'outputs\local-worker'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$pilot=Join-Path $env:LOCALAPPDATA 'Grapsi\local-screening'
$archive=Join-Path $pilot 'llama-b11669-bin-win-cpu-x64.zip'
$expectedArchive='37b3efcf962847ca869745fd4ccf7f5e7e8dacfeff9fa3523b4ca8cdc66d632b'
if(-not(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedArchive){throw 'The pinned official runtime archive must pass verification before building'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$manifest=@{}
$zip=[IO.Compression.ZipFile]::OpenRead($archive)
try{foreach($entry in $zip.Entries){
 if([IO.Path]::GetExtension($entry.FullName) -in @('.exe','.dll')){
  if($entry.FullName -ne $entry.Name){throw 'Unexpected runtime archive layout'}
  $stream=$entry.Open(); $hasher=[Security.Cryptography.SHA256]::Create()
  try{$manifest[$entry.Name]=[BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$hasher.Dispose()}
 }
}}finally{$zip.Dispose()}
if(-not$manifest.ContainsKey('llama-server.exe')){throw 'Verified portable runtime is required to build the runtime integrity manifest'}
$utf8=New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $out 'runtime-manifest.json'),($manifest | ConvertTo-Json),$utf8)
$generator=Join-Path $repo 'tools\local-worker\build-config.cjs'
& node $generator (Join-Path $out 'config.json')
if($LASTEXITCODE -ne 0){throw 'Embedded configuration generation failed'}
$compiler='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$binary=Join-Path $out 'Grapsi.LocalWorker.exe'
$arguments=@('/nologo','/target:winexe','/platform:x64','/optimize+','/utf8output',('/out:'+$binary),('/resource:'+(Join-Path $out 'config.json')+',config.json'),('/resource:'+(Join-Path $out 'runtime-manifest.json')+',runtime-manifest.json'))
foreach($reference in @('System.Windows.Forms.dll','System.Drawing.dll','System.Net.Http.dll','System.Web.Extensions.dll','System.Security.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll')){$arguments+=('/reference:'+$reference)}
$arguments+=(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.cs' | Select-Object -ExpandProperty FullName)
& $compiler @arguments
if($LASTEXITCODE -ne 0){throw 'Windows executable compilation failed'}
Get-FileHash -LiteralPath $binary -Algorithm SHA256 | Select-Object Path,Hash
