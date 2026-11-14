Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path ([IO.Path]::GetTempPath()) "fgw-signed-test-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $work | Out-Null
$passed = 0

function Write-Zip([string]$Path, [hashtable]$Entries) {
    $zip = [IO.Compression.ZipFile]::Open($Path, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in $Entries.Keys) {
            $stream = $zip.CreateEntry($name).Open()
            try { $stream.Write([Text.Encoding]::UTF8.GetBytes($Entries[$name])) } finally { $stream.Dispose() }
        }
    } finally { $zip.Dispose() }
}
function Expect-Failure([scriptblock]$Action, [string]$Message) {
    $caught = $null
    try { & $Action | Out-Null } catch { $caught = $_.Exception.Message }
    if (-not $caught -or $caught -notlike "*$Message*") { throw "Expected '$Message', got '$caught'" }
    $script:passed++
}

try {
    $manifest = '{"version":"2.2.1","browser_specific_settings":{"gecko":{"id":"free-games-watcher@grim1313"}}}'
    $entries = @{ 'manifest.json' = $manifest; 'src/main.js' = 'const example = 1;' }
    $unsigned = Join-Path $work 'unsigned.zip'
    Write-Zip $unsigned $entries
    $signedEntries = $entries.Clone()
    # A reordered/reformatted manifest must compare equal without rewriting the XPI.
    $signedEntries['manifest.json'] = '{ "browser_specific_settings": { "gecko": { "id": "free-games-watcher@grim1313" } }, "version": "2.2.1" }'
    foreach ($name in @('manifest.mf', 'mozilla.sf', 'mozilla.rsa', 'cose.manifest', 'cose.sig')) {
        $signedEntries["META-INF/$name"] = 'synthetic test metadata, not a real signature'
    }
    $signed = Join-Path $work 'signed.xpi'
    Write-Zip $signed $signedEntries
    $hash = (Get-FileHash $signed -Algorithm SHA256).Hash.ToLowerInvariant()
    $verify = Join-Path $root 'scripts/verify-firefox-xpi.ps1'
    & $verify -XpiPath $signed -UnsignedArchivePath $unsigned -Version '2.2.1' -Sha256 $hash
    $passed++
    Expect-Failure { & $verify -XpiPath $signed -UnsignedArchivePath $unsigned -Version '2.2.1' -Sha256 ('0' * 64) } 'SHA-256'
    Expect-Failure { & $verify -XpiPath $signed -UnsignedArchivePath $unsigned -Version '2.2.2' -Sha256 $hash } 'version differs'

    $cases = @(
        @{ Name = 'content'; Entry = 'src/main.js'; Value = 'const example = 2;'; Error = 'production file differs' },
        @{ Name = 'extra'; Entry = 'extra.js'; Value = 'unexpected'; Error = 'file counts differ' },
        @{ Name = 'metadata-extra'; Entry = 'META-INF/extra.js'; Value = 'unexpected'; Error = 'file counts differ' },
        @{ Name = 'signature'; Entry = 'META-INF/mozilla.rsa'; Value = $null; Error = 'Missing Mozilla signature' },
        @{ Name = 'missing'; Entry = 'src/main.js'; Value = $null; Error = 'file counts differ' },
        @{ Name = 'identity'; Entry = 'manifest.json'; Value = $manifest.Replace('@grim1313', '@other'); Error = 'extension ID' },
        @{ Name = 'manifest'; Entry = 'manifest.json'; Value = $manifest.Replace('"version":', '"permissions":["tabs"],"version":'); Error = 'manifests differ' },
        @{ Name = 'updates'; Entry = 'manifest.json'; Value = $manifest.Replace('"id":', '"update_url":"https://example.com/updates.json","id":'); Error = 'updates must use AMO' }
    )
    foreach ($case in $cases) {
        $changed = $signedEntries.Clone()
        if ($null -eq $case.Value) { $changed.Remove($case.Entry) } else { $changed[$case.Entry] = $case.Value }
        $path = Join-Path $work "$($case.Name).xpi"
        Write-Zip $path $changed
        $changedHash = (Get-FileHash $path -Algorithm SHA256).Hash
        Expect-Failure { & $verify -XpiPath $path -UnsignedArchivePath $unsigned -Version '2.2.1' -Sha256 $changedHash } $case.Error
    }

    # Isolate the downloader from the network; exercise version selection and
    # failure behavior using the same production script and archive validator.
    $file = @{ status = 'public'; hash = "sha256:$hash"; size = (Get-Item $signed).Length; url = 'https://addons.mozilla.org/firefox/downloads/file/123/test.xpi' }
    $version = @{ version = '2.2.1'; file = $file }
    $addon = @{ guid = 'free-games-watcher@grim1313'; current_version = $version }
    $page = @{ results = @($version); next = $null }
    $downloadState = @{ count = 0 }
    function Invoke-RestMethod($Uri, $TimeoutSec) {
        if ([string]$Uri -like '*/versions/*') { return $page }
        return $addon
    }
    function Invoke-WebRequest($Uri, $OutFile, $TimeoutSec) {
        $downloadState.count++
        Copy-Item -LiteralPath $signed -Destination $OutFile
    }
    $download = Join-Path $root 'scripts/get-signed-firefox.ps1'
    $outputDir = Join-Path $work 'output'
    $output = & $download -Version '2.2.1' -UnsignedArchivePath $unsigned -OutputDirectory $outputDir
    if ((Get-FileHash $output).Hash.ToLowerInvariant() -cne $hash) { throw 'Downloaded XPI changed' }
    $passed++
    $addon.current_version = @{ version = '2.3.0'; file = $file }
    $output = & $download -Version '2.2.1' -UnsignedArchivePath $unsigned -OutputDirectory $outputDir
    $passed++
    Expect-Failure { & $download -Version '2.2.2' -UnsignedArchivePath $unsigned -OutputDirectory $outputDir } 'not public on AMO'
    $file.status = 'awaiting_review'
    Expect-Failure { & $download -Version '2.2.1' -UnsignedArchivePath $unsigned -OutputDirectory $outputDir } 'not public on AMO'
    $file.status = 'public'
    if ($downloadState.count -ne 2) { throw 'Unavailable versions must not trigger a download' }
    $file.hash = 'sha256:' + ('0' * 64)
    Expect-Failure { & $download -Version '2.2.1' -UnsignedArchivePath $unsigned -OutputDirectory $outputDir } 'SHA-256'
    if ((Get-FileHash $output).Hash.ToLowerInvariant() -cne $hash) { throw 'Failed download replaced a verified XPI' }
    if (@(Get-ChildItem $outputDir -Filter '*.download').Count) { throw 'Failed download was not cleaned up' }
    $passed++
    Write-Host "$passed signed Firefox release checks passed"
} finally {
    # Only remove the unique directory created by this test under the OS temp path.
    if ([IO.Path]::GetFullPath($work).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $work) -match '^fgw-signed-test-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $work -Recurse -Force
    }
}
