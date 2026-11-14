param(
    [Parameter(Mandatory)][string]$XpiPath,
    [Parameter(Mandatory)][string]$UnsignedArchivePath,
    [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$Sha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ((Get-FileHash -LiteralPath $XpiPath -Algorithm SHA256).Hash -ne $Sha256) {
    throw 'XPI SHA-256 differs from the AMO file hash'
}

function Read-Entries([string]$Path) {
    $files = [Collections.Generic.Dictionary[string, byte[]]]::new([StringComparer]::Ordinal)
    $zip = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($Path))
    try {
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            if ($name.EndsWith('/')) { continue }
            if ($files.ContainsKey($name)) { throw "Duplicate archive entry: $name" }
            $stream = $entry.Open()
            $buffer = [IO.MemoryStream]::new()
            try { $stream.CopyTo($buffer); $files.Add($name, $buffer.ToArray()) }
            finally { $buffer.Dispose(); $stream.Dispose() }
        }
    } finally { $zip.Dispose() }
    return ,$files
}

function Canonical-Json($Value) {
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [Collections.IDictionary]) {
        $pairs = foreach ($key in ($Value.Keys | Sort-Object -CaseSensitive)) {
            (ConvertTo-Json -InputObject ([string]$key) -Compress) + ':' + (Canonical-Json $Value[$key])
        }
        return '{' + ($pairs -join ',') + '}'
    }
    if ($Value -is [array]) {
        $items = foreach ($item in $Value) { Canonical-Json $item }
        return '[' + ($items -join ',') + ']'
    }
    return ConvertTo-Json -InputObject $Value -Compress
}

$signed = Read-Entries $XpiPath
$unsigned = Read-Entries $UnsignedArchivePath
foreach ($name in @('META-INF/manifest.mf', 'META-INF/mozilla.sf', 'META-INF/mozilla.rsa')) {
    if (-not $signed.ContainsKey($name) -or $signed[$name].Length -eq 0) {
        throw "Missing Mozilla signature entry: $name"
    }
}
if (-not $signed.ContainsKey('manifest.json') -or -not $unsigned.ContainsKey('manifest.json')) {
    throw 'Missing manifest.json'
}
$manifest = [Text.Encoding]::UTF8.GetString($signed['manifest.json']) | ConvertFrom-Json -AsHashtable
$expected = [Text.Encoding]::UTF8.GetString($unsigned['manifest.json']) | ConvertFrom-Json -AsHashtable
if ($manifest.version -cne $Version -or $expected.version -cne $Version) { throw 'Firefox version differs from release version' }
if ($manifest.browser_specific_settings.gecko.id -cne 'free-games-watcher@grim1313') { throw 'Unexpected Firefox extension ID' }
if ($manifest.ContainsKey('update_url') -or $manifest.browser_specific_settings.gecko.ContainsKey('update_url')) {
    throw 'Firefox updates must use AMO, without a custom update_url'
}
if ((Canonical-Json $manifest) -cne (Canonical-Json $expected)) { throw 'Firefox manifests differ' }

# Only Mozilla signature metadata may be added. Every production byte must match;
# manifest JSON formatting/key order may change when Mozilla signs the package.
$signatureNames = @('META-INF/manifest.mf', 'META-INF/mozilla.sf', 'META-INF/mozilla.rsa', 'META-INF/cose.manifest', 'META-INF/cose.sig')
$productionNames = @($signed.Keys | Where-Object { $_ -cnotin $signatureNames })
if ($productionNames.Count -ne $unsigned.Count) { throw 'Firefox production file counts differ' }
foreach ($name in $unsigned.Keys) {
    if (-not $signed.ContainsKey($name)) { throw "Missing Firefox production file: $name" }
    if ($name -ceq 'manifest.json') { continue }
    $actualHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($signed[$name]))
    $expectedHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($unsigned[$name]))
    if ($actualHash -cne $expectedHash) { throw "Firefox production file differs: $name" }
}

# Signature entry presence is structural validation. Authenticity relies on the
# hash obtained over HTTPS from AMO; Firefox checks the signature on installation.
Write-Host "Verified AMO XPI $Version ($($unsigned.Count) production files, SHA-256 $Sha256)"
