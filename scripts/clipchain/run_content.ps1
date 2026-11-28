$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:PYTHONIOENCODING = 'utf-8'
$env:OPENBLAS_NUM_THREADS = '4'
$env:OMP_NUM_THREADS = '4'
$work = 'D:\ClipChainWork'
$app = $PSScriptRoot
$cpu = Join-Path $app '.venv\Scripts\python.exe'
$gpu = Join-Path $app '.venv-gpu\Scripts\python.exe'
$gpuPackages = 'D:\pinokio\api\wan.git\app\venv\Lib\site-packages'
$report = Get-ChildItem -LiteralPath 'D:\ZuraCatalog' -Filter 'report-*.json' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
$catalog = Get-Content -LiteralPath $report.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
$failedFolders = @()
foreach ($entry in $catalog.wan_folders) {
    $source = $entry[0]
    $name = Split-Path -Leaf $source
    $output = Join-Path $work $name
    "[$(Get-Date -Format o)] $source"
    if ((Test-Path (Join-Path $output 'index.json')) -and
        (Test-Path (Join-Path $output 'index.html'))) {
        "Reusing complete storyboard directory: $output"
        continue
    }
    try {
        if (Test-Path -LiteralPath $output) {
            throw "Partial or unrelated output directory exists: $output"
        }
        $collection = & $cpu -B -u (Join-Path $app 'index_clips.py') $source
        $status = $LASTEXITCODE
        $collection | Write-Output
        if ($status -ne 0) {
            $failedFolders += $source
            "Collector exit $status. Continuing with cached clips where available."
        }
        if ("$collection" -notmatch 'Cache: (.+\.sqlite3)$') {
            throw 'Collector returned no cache path.'
        }
        $cache = $Matches[1]
        $env:PYTHONPATH = $gpuPackages
        try {
            & $gpu -B -u (Join-Path $app 'embed_cached.py') $cache
            if ($LASTEXITCODE -ne 0) { throw "CUDA embedding exit $LASTEXITCODE" }
        } finally {
            Remove-Item Env:PYTHONPATH
        }
        $links = Join-Path $work "$name-reviewed-links.json"
        $options = @()
        if (Test-Path -LiteralPath $links -PathType Leaf) { $options = @('--links', $links) }
        & $cpu -B -u (Join-Path $app 'content_storyboard.py') $cache $output @options
        if ($LASTEXITCODE -ne 0) { throw "Storyboard exit $LASTEXITCODE" }
    } catch {
        $failedFolders += $source
        "Failed: $_"
    }
}
if ($failedFolders.Count) {
    "Folders with failures: $($failedFolders | Select-Object -Unique)"
    exit 1
}
"[$(Get-Date -Format o)] All ranked folders processed."
