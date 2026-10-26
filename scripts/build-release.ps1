Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoRoot 'manifest.json'

if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "manifest.json not found at $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = [string]$manifest.version

if ([string]::IsNullOrWhiteSpace($version)) {
    throw 'manifest.json does not contain a valid version'
}
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a numeric release version' }

$distDir = Join-Path $repoRoot 'dist'
$stageDir = Join-Path $distDir 'Free-Games-Watcher'
$archivePath = Join-Path $distDir ("Free-Games-Watcher-{0}.zip" -f $version)

# Only remove build outputs resolved directly under this repository's dist folder.
$resolvedDist = [IO.Path]::GetFullPath($distDir) + [IO.Path]::DirectorySeparatorChar
if ((Test-Path -LiteralPath $distDir) -and ((Get-Item -LiteralPath $distDir).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Refusing to build through a linked dist directory'
}
foreach ($target in @($stageDir, $archivePath)) {
    if (-not [IO.Path]::GetFullPath($target).StartsWith($resolvedDist, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Build output escaped dist: $target"
    }
    if ((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Refusing to replace a linked build output: $target"
    }
}

if (Test-Path -LiteralPath $stageDir) {
    Remove-Item -LiteralPath $stageDir -Recurse -Force
}

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}

New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $stageDir 'manifest.json') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination (Join-Path $stageDir 'LICENSE') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'src') -Destination (Join-Path $stageDir 'src') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repoRoot '_locales') -Destination (Join-Path $stageDir '_locales') -Recurse -Force

$iconPaths = @()

if ($manifest.icons) {
    foreach ($property in $manifest.icons.PSObject.Properties) {
        $iconPaths += [string]$property.Value
    }
}

$iconPaths = $iconPaths | Sort-Object -Unique

foreach ($relativePath in $iconPaths) {
    $sourcePath = Join-Path $repoRoot $relativePath

    if (-not (Test-Path -LiteralPath $sourcePath)) {
        throw "Manifest icon path not found: $relativePath"
    }

    $destinationPath = Join-Path $stageDir $relativePath
    $destinationParent = Split-Path -Parent $destinationPath

    if ($destinationParent) {
        New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
    }

    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $archivePath -CompressionLevel Optimal

$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $names = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    foreach ($required in @('manifest.json', 'LICENSE', 'src/service-worker.js', 'src/ui/popup.html', 'src/ui/options.html', 'src/ui/history.html', '_locales/en/messages.json', '_locales/ru/messages.json', 'resources/icons/icon128.png')) {
        if ($names -notcontains $required) { throw "Missing release entry: $required" }
    }
    if ($names | Where-Object { $_ -match '(^|/)(tests|scripts|node_modules|test-bootstrap\.js)(/|$)' }) {
        throw 'Development files found in release archive'
    }
    $manifestEntry = $archive.Entries | Where-Object { $_.FullName -eq 'manifest.json' } | Select-Object -First 1
    $reader = [IO.StreamReader]::new($manifestEntry.Open())
    try { $packedManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($packedManifest.version -ne $version) { throw 'Packed manifest version differs from source' }
} finally {
    $archive.Dispose()
}

Write-Output $archivePath
