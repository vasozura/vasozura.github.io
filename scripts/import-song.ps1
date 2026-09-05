param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$PackagePath,
  [switch]$DryRun,
  [switch]$Resume
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$resolvedPackage = (Resolve-Path -LiteralPath $PackagePath).Path
$temporaryRoot = $null
if ([IO.Path]::GetExtension($resolvedPackage) -ieq ".zip") {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("zura-song-import-" + [Guid]::NewGuid().ToString("N"))
  [IO.Directory]::CreateDirectory($temporaryRoot) | Out-Null
  $archive = [IO.Compression.ZipFile]::OpenRead($resolvedPackage)
  try {
    if ($archive.Entries.Count -gt 2048) { throw "ZIP contains more than 2048 entries." }
    [long]$expandedBytes = 0
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName.Replace('\', '/')
      if ([IO.Path]::IsPathRooted($name) -or $name.Split('/') -contains '..') { throw "ZIP contains an unsafe path." }
      $expandedBytes += $entry.Length
      if ($expandedBytes -gt 536870912) { throw "ZIP expands beyond the 512 MB package limit." }
      if ($entry.Length -gt 1048576 -and $entry.CompressedLength -gt 0 -and ($entry.Length / $entry.CompressedLength) -gt 100) { throw "ZIP contains a suspicious compression ratio." }
      $destination = [IO.Path]::GetFullPath((Join-Path $temporaryRoot $name))
      $prefix = [IO.Path]::GetFullPath($temporaryRoot) + [IO.Path]::DirectorySeparatorChar
      if (-not $destination.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "ZIP path escapes the temporary directory." }
    }
    foreach ($entry in $archive.Entries) {
      if ([string]::IsNullOrEmpty($entry.Name)) { continue }
      $destination = [IO.Path]::GetFullPath((Join-Path $temporaryRoot $entry.FullName))
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $false)
    }
  }
  finally { $archive.Dispose() }
  $roots = @(Get-ChildItem -LiteralPath $temporaryRoot)
  if ($roots.Count -eq 1 -and $roots[0].PSIsContainer -and (Test-Path -LiteralPath (Join-Path $roots[0].FullName "metadata.json"))) { $resolvedPackage = $roots[0].FullName }
  else { $resolvedPackage = $temporaryRoot }
}
$arguments = @("import:song", "--", $resolvedPackage)
if ($DryRun) { $arguments += "--dry-run" }
if ($Resume) { $arguments += "--resume" }

Push-Location -LiteralPath $repositoryRoot
try {
  & pnpm @arguments
  exit $LASTEXITCODE
}
finally {
  Pop-Location
  if ($temporaryRoot -and (Test-Path -LiteralPath $temporaryRoot)) {
    $resolvedTemporaryRoot = [IO.Path]::GetFullPath($temporaryRoot)
    $systemTemporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedTemporaryRoot.StartsWith($systemTemporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or -not ([IO.Path]::GetFileName($resolvedTemporaryRoot)).StartsWith("zura-song-import-")) { throw "Refusing to remove an unexpected temporary path." }
    Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
  }
}
