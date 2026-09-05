param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ManifestPath,
  [switch]$DryRun,
  [switch]$Resume,
  [ValidateRange(1, 4)]
  [int]$Concurrency = 2
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$resolvedManifest = (Resolve-Path -LiteralPath $ManifestPath).Path
$checkpoint = "$resolvedManifest.checkpoint.json"
$arguments = @("import:batch", "--", $resolvedManifest, "--concurrency=$Concurrency")
if ($DryRun) { $arguments += "--dry-run" }
if ($Resume -or -not $DryRun) { $arguments += "--checkpoint=$checkpoint" }

Push-Location -LiteralPath $repositoryRoot
try {
  & pnpm @arguments
  exit $LASTEXITCODE
}
finally { Pop-Location }
