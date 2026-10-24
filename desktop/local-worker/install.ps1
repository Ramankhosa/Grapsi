param([string]$Executable=(Join-Path $PSScriptRoot '..\..\outputs\local-worker\Grapsi.LocalWorker.exe'),[switch]$Start)
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $Executable).Path
$folder=Join-Path $env:LOCALAPPDATA 'Grapsi\LocalWorker'
$target=Join-Path $folder 'Grapsi.LocalWorker.exe'
$active=Get-Process -Name 'Grapsi.LocalWorker' -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $target}
if($active){throw 'Exit Grapsi Local Worker from its tray menu before installing an update.'}
New-Item -ItemType Directory -Path $folder -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $target -Force
if((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $target).Hash){throw 'The installed EXE failed verification'}
$shell=New-Object -ComObject WScript.Shell
$desktop=[Environment]::GetFolderPath('DesktopDirectory')
$shortcut=$shell.CreateShortcut((Join-Path $desktop 'Grapsi Local Worker.lnk'))
$shortcut.TargetPath=$target
$shortcut.WorkingDirectory=$folder
$shortcut.Description='Analyse queued Grapsi funding pages on this computer'
$shortcut.Save()
Write-Output "Installed: $target"
Write-Output 'Desktop shortcut: Grapsi Local Worker'
if($Start){Start-Process -FilePath $target}
