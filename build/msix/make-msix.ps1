# Builds the Microsoft Store package: dist\FullWidget-<version>-x64.msix
#
# It packs the self-contained build (the one in the -full zip) with the manifest and logos here.
# The Store signs the package itself, so it is left unsigned.
#
# Usage: powershell -ExecutionPolicy Bypass -File build\msix\make-msix.ps1 [-Test]
#   (no flag)  for the Store: the identity comes from build\msix\identity.json (Partner Center →
#              the app → Product identity: Package/Identity/Name, Publisher, PublisherDisplayName)
#   -Test      for trying it out on this PC, with a test identity. An unsigned package can't be
#              installed as it is, but with Windows' developer mode on, its folder can:
#              Add-AppxPackage -Register dist\msix\package\AppxManifest.xml
#
# Needs the Windows SDK (makeappx.exe, makepri.exe).
param([switch]$Test)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$dist = Join-Path $root 'dist'
[xml]$csproj = Get-Content (Join-Path $root 'src\FullWidget\FullWidget.csproj')
$version = $csproj.Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1

if ($Test) {
  $id = @{ Name = 'FullWidget.Test'; Publisher = 'CN=FullWidget Test'; PublisherDisplayName = 'FullWidget (test)' }
  $msix = Join-Path $dist "FullWidget-$version-x64-test.msix"
} else {
  $file = Join-Path $PSScriptRoot 'identity.json'
  if (-not (Test-Path $file)) { throw "$file is missing: copy the identity from Partner Center (see the comment at the top)" }
  $j = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
  $id = @{ Name = $j.Name; Publisher = $j.Publisher; PublisherDisplayName = $j.PublisherDisplayName }
  $msix = Join-Path $dist "FullWidget-$version-x64.msix"
}

# the SDK's newest x64 tools
$kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
$bin = Get-ChildItem $kits -Directory -Filter '10.*' | Sort-Object { [version]$_.Name } -Descending |
  ForEach-Object { Join-Path $_.FullName 'x64' } | Where-Object { Test-Path (Join-Path $_ 'makeappx.exe') } | Select-Object -First 1
if (-not $bin) { throw "Windows SDK not found (makeappx.exe under $kits)" }
$makeappx = Join-Path $bin 'makeappx.exe'; $makepri = Join-Path $bin 'makepri.exe'

# the self-contained build
$full = Join-Path $dist "FullWidget-$version-win-x64-full\FullWidget"
if (-not (Test-Path (Join-Path $full 'FullWidget.exe'))) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'build\publish.ps1') -Step build
  if ($LASTEXITCODE -ne 0) { throw "build failed" }
}

$work = Join-Path $dist 'msix'
$pkg = Join-Path $work 'package'; $pri = Join-Path $work 'pri'
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $pkg, $pri | Out-Null
Write-Host "== msix $version ($($id.Name))"
Copy-Item (Join-Path $full '*') $pkg -Recurse

# logos, then the manifest with the identity and version filled in
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'build\make-icon.ps1') -Msix (Join-Path $pri 'Assets') | Out-Null
$xml = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'AppxManifest.xml'))
$esc = { param($s) [Security.SecurityElement]::Escape($s) }
$xml = $xml.Replace('$Name$', (& $esc $id.Name)).Replace('$Publisher$', (& $esc $id.Publisher)).Replace('$PublisherName$', (& $esc $id.PublisherDisplayName)).Replace('$Version$', "$version.0")
[IO.File]::WriteAllText((Join-Path $pri 'AppxManifest.xml'), $xml, (New-Object Text.UTF8Encoding $false))

# resources.pri from the logos alone (so Windows picks the right size), not the app's own files
Push-Location $pri
try {
  & $makepri createconfig /cf priconfig.xml /dq zh-TW /pv 10.0.0 /o | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "makepri createconfig failed" }
  & $makepri new /pr . /cf priconfig.xml /mn AppxManifest.xml /of resources.pri /o | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "makepri new failed" }
} finally { Pop-Location }
Copy-Item (Join-Path $pri 'Assets'), (Join-Path $pri 'AppxManifest.xml'), (Join-Path $pri 'resources.pri') $pkg -Recurse

Remove-Item $msix -ErrorAction SilentlyContinue
& $makeappx pack /d $pkg /p $msix /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makeappx failed" }
$mb = [math]::Round((Get-Item $msix).Length / 1MB, 1)
Write-Host "   $msix ($mb MB)"
if ($Test) { Write-Host "   try it: Add-AppxPackage -Register `"$(Join-Path $pkg 'AppxManifest.xml')`" (developer mode)" }
