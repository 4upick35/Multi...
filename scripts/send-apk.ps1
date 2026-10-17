#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ApkPath,

    [Parameter(Mandatory = $false)]
    [string]$Version,

    [Parameter(Mandatory = $false)]
    [string]$Notes,

    [Parameter(Mandatory = $false)]
    [string]$Caption,

    [Parameter(Mandatory = $false)]
    [string]$ChatId
)

$MaxBytes = 52428800 # 50 MB
$TimeoutSec = 360    # 6 minutes

$token = $env:MULTIELMA_TG_TOKEN

if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host "error: environment variable MULTIELMA_TG_TOKEN is not set"
    exit 1
}

if ([string]::IsNullOrWhiteSpace($ChatId)) {
    $ChatId = $env:MULTIELMA_TG_CHAT
}

if ([string]::IsNullOrWhiteSpace($ChatId)) {
    Write-Host "error: chat id is not set (use -ChatId parameter or MULTIELMA_TG_CHAT env variable)"
    exit 1
}

if (-not (Test-Path -LiteralPath $ApkPath -PathType Leaf)) {
    Write-Host "error: file not found: $ApkPath"
    exit 1
}

$file = Get-Item -LiteralPath $ApkPath

if ($file.Length -gt $MaxBytes) {
    Write-Host ("warning: file size {0} bytes exceeds 50 MB ({1} bytes), Telegram Bot API will not accept it" -f $file.Length, $MaxBytes)
    exit 2
}

function Escape-Html {
    param([string]$Text)
    if ($null -eq $Text) { return '' }
    return $Text.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;')
}

function Get-AutoVersion {
    param([string]$Name)
    if ($Name -match '-v([0-9]+(?:\.[0-9]+)+)') {
        return $Matches[1]
    }
    return 'unknown'
}

function Get-ApkLabel {
    param([string]$Name)
    $lower = $Name.ToLowerInvariant()
    if ($lower.Contains('release')) { return 'release' }
    if ($lower.Contains('diag')) { return 'diag' }
    return 'apk'
}

function Build-AutoCaption {
    $ver = $Version
    if ([string]::IsNullOrWhiteSpace($ver)) {
        $ver = Get-AutoVersion -Name $file.Name
    }

    $label = Get-ApkLabel -Name $file.Name

    $sizeMiB = $file.Length / 1MB
    $sizeStr = $sizeMiB.ToString('F1', [System.Globalization.CultureInfo]::InvariantCulture)
    $dateStr = (Get-Date).ToString('dd.MM.yyyy', [System.Globalization.CultureInfo]::InvariantCulture)

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add(('🚀 <b>MultiElma v{0}</b>' -f (Escape-Html $ver)))
    $lines.Add('')
    $lines.Add(('📦 {0} • {1} МБ' -f $label, $sizeStr))
    $lines.Add(('📅 {0}' -f $dateStr))
    if ($label -eq 'diag') {
        $lines.Add('🧪 <i>Диагностическая сборка — с возможностью отправки логов и ошибок работы</i>')
        $lines.Add('ℹ️ Ставится рядом с обычной версией (отдельный applicationId)')
    }
    $lines.Add('')
    $lines.Add('<b>Что нового:</b>')

    if (-not [string]::IsNullOrWhiteSpace($Notes)) {
        $notesText = $Notes.Replace('\n', "`n")
        foreach ($line in ($notesText -split "`r?`n")) {
            $trimmed = $line.Trim()
            if ($trimmed.Length -gt 0) {
                $lines.Add(('• {0}' -f (Escape-Html $trimmed)))
            }
        }
    }

    return ($lines -join "`n")
}

# Имя файла как на компьютере: MultiElma-v<version>-<label>.apk в папке release.
function Get-GradleVersion {
    param([string]$RepoRoot)
    $gradle = Join-Path $RepoRoot 'android\app\build.gradle'
    if (-not (Test-Path -LiteralPath $gradle)) { return '' }
    $hit = Select-String -LiteralPath $gradle -Pattern 'versionName\s+\"([^\"]+)\"' | Select-Object -First 1
    if ($hit) { return $hit.Matches[0].Groups[1].Value }
    return ''
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedVersion = $Version
if ([string]::IsNullOrWhiteSpace($resolvedVersion)) {
    $resolvedVersion = Get-GradleVersion -RepoRoot $repoRoot
}
if ([string]::IsNullOrWhiteSpace($resolvedVersion)) {
    $resolvedVersion = Get-AutoVersion -Name $file.Name
}
$Version = $resolvedVersion

$releaseDir = Join-Path $repoRoot 'release'
if (Test-Path -LiteralPath $releaseDir) {
    $label = Get-ApkLabel -Name $file.Name
    $targetPath = Join-Path $releaseDir ("MultiElma-v{0}-{1}.apk" -f $resolvedVersion, $label)
    if ($file.FullName -ne $targetPath) {
        Copy-Item -LiteralPath $file.FullName -Destination $targetPath -Force
    }
    $file = Get-Item -LiteralPath $targetPath
}

if ([string]::IsNullOrEmpty($Caption)) {
    $Caption = Build-AutoCaption
}

if ($Caption.Length -gt 1024) {
    $Caption = $Caption.Substring(0, 1023) + '…'
}

$uri = "https://api.telegram.org/bot$token/sendDocument"

function Send-Form {
    $irm = Get-Command Invoke-RestMethod
    if ($irm.Parameters.ContainsKey('Form')) {
        $form = @{
            chat_id    = $ChatId
            document   = $file
            parse_mode = 'HTML'
        }
        if (-not [string]::IsNullOrEmpty($Caption)) {
            $form['caption'] = $Caption
        }
        return Invoke-RestMethod -Uri $uri -Method Post -Form $form -TimeoutSec $TimeoutSec
    }

    if ($PSVersionTable.PSVersion.Major -lt 6) {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    }

    Add-Type -AssemblyName System.Net.Http

    $client = New-Object System.Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSec)

    $content = New-Object System.Net.Http.MultipartFormDataContent
    $content.Add((New-Object System.Net.Http.StringContent([string]$ChatId)), 'chat_id')
    $content.Add((New-Object System.Net.Http.StringContent('HTML')), 'parse_mode')
    if (-not [string]::IsNullOrEmpty($Caption)) {
        $content.Add((New-Object System.Net.Http.StringContent([string]$Caption)), 'caption')
    }

    $fileContent = New-Object System.Net.Http.StreamContent([System.IO.File]::OpenRead($file.FullName))
    $fileContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/vnd.android.package-archive')
    $fileContent.Headers.ContentType = $fileContentType
    $content.Add($fileContent, 'document', $file.Name)

    try {
        $response = $client.PostAsync($uri, $content).GetAwaiter().GetResult()
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $result = $body | ConvertFrom-Json
        if (-not $response.IsSuccessStatusCode -or -not $result.ok) {
            Write-Host "error: $body"
            exit 1
        }
        return $result
    }
    finally {
        $content.Dispose()
        $client.Dispose()
    }
}

try {
    $result = Send-Form
}
catch {
    $body = $null
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        $body = $_.ErrorDetails.Message
    }
    elseif ($_.Exception.Response) {
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $body = $reader.ReadToEnd()
            $reader.Dispose()
        }
        catch { }
    }
    if (-not $body) { $body = $_.Exception.Message }
    Write-Host "error: $body"
    exit 1
}

if (-not $result.ok) {
    Write-Host "error: $($result | ConvertTo-Json -Compress)"
    exit 1
}

Write-Host "sent: $($result.result.message_id)"
exit 0
