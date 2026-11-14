param(
    [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [Parameter(Mandatory)][string]$UnsignedArchivePath,
    [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$api = 'https://addons.mozilla.org/api/v5/addons/addon/free-games-watcher-steam-epic/'
$addon = Invoke-RestMethod -Uri $api -TimeoutSec 60
if ($addon.guid -cne 'free-games-watcher@grim1313') { throw 'Unexpected AMO extension ID' }
$selected = $addon.current_version
if ($selected.version -cne $Version) {
    $selected = $null
    $next = "${api}versions/?page_size=50"
    while ($next) {
        if (-not $next.StartsWith("${api}versions/?", [StringComparison]::Ordinal)) { throw 'Unexpected AMO pagination URL' }
        $page = Invoke-RestMethod -Uri $next -TimeoutSec 60
        $selected = $page.results | Where-Object { $_.version -ceq $Version } | Select-Object -First 1
        if ($selected) { break }
        $next = $page.next
    }
}
if (-not $selected -or $selected.file.status -cne 'public') {
    throw "Firefox $Version is not public on AMO. Publish that exact version on AMO, wait for approval, then rerun Release. No unsigned fallback is allowed."
}
$file = $selected.file
if ($file.hash -notmatch '^sha256:([a-fA-F0-9]{64})$') { throw 'AMO did not return a SHA-256 hash' }
$sha256 = $Matches[1]
$url = [uri]$file.url
if ($url.Scheme -ne 'https' -or $url.Host -ne 'addons.mozilla.org' -or -not $url.AbsolutePath.StartsWith('/firefox/downloads/file/')) {
    throw 'Unexpected AMO download URL'
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$output = [IO.Path]::GetFullPath((Join-Path $OutputDirectory "Free-Games-Watcher-Firefox-$Version.xpi"))
$temporary = "$output.$([guid]::NewGuid().ToString('N')).download"
try {
    Invoke-WebRequest -Uri $url -OutFile $temporary -TimeoutSec 120
    if ((Get-Item -LiteralPath $temporary).Length -ne $file.size) { throw 'XPI size differs from AMO metadata' }
    & (Join-Path $PSScriptRoot 'verify-firefox-xpi.ps1') -XpiPath $temporary -UnsignedArchivePath $UnsignedArchivePath -Version $Version -Sha256 $sha256
    # Rename only: repacking or changing the signed contents invalidates the signature.
    Move-Item -LiteralPath $temporary -Destination $output -Force
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
}
Write-Output $output
