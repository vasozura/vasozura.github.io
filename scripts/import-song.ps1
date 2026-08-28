param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$PackagePath,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$resolvedPackage = (Resolve-Path -LiteralPath $PackagePath).Path
$arguments = @("import:song", "--", $resolvedPackage)
if ($DryRun) { $arguments += "--dry-run" }

Push-Location -LiteralPath $repositoryRoot
try {
  & pnpm @arguments
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
