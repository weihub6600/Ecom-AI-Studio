param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
    $ProjectRoot = Split-Path $PSScriptRoot -Parent
}

$EnvPath = Join-Path $ProjectRoot ".env"

if (-not (Test-Path -LiteralPath $EnvPath)) {
    throw "没有找到 .env：$EnvPath"
}

function Read-DotEnv {
    param([string]$Path)

    $Values = @{}

    foreach (
        $Line in
        [System.IO.File]::ReadAllLines(
            $Path,
            [System.Text.Encoding]::UTF8
        )
    ) {
        $Text = $Line.Trim()

        if (
            -not $Text -or
            $Text.StartsWith("#") -or
            $Text -notmatch "^([A-Za-z_][A-Za-z0-9_]*)=(.*)$"
        ) {
            continue
        }

        $Name = $Matches[1]
        $Value = $Matches[2].Trim()

        if (
            $Value.Length -ge 2 -and
            (
                (
                    $Value.StartsWith('"') -and
                    $Value.EndsWith('"')
                ) -or
                (
                    $Value.StartsWith("'") -and
                    $Value.EndsWith("'")
                )
            )
        ) {
            $Value = $Value.Substring(
                1,
                $Value.Length - 2
            )
        }

        $Values[$Name] = $Value
    }

    return $Values
}

$Settings = Read-DotEnv $EnvPath

$HostName = if ($Settings.MYSQL_HOST) {
    $Settings.MYSQL_HOST
}
else {
    "127.0.0.1"
}

$Port = if ($Settings.MYSQL_PORT) {
    $Settings.MYSQL_PORT
}
else {
    "3306"
}

$Database = if ($Settings.MYSQL_DATABASE) {
    $Settings.MYSQL_DATABASE
}
else {
    "ecom_ai_studio"
}

$User = if ($Settings.MYSQL_USER) {
    $Settings.MYSQL_USER
}
else {
    "root"
}

$Password = $Settings.MYSQL_PASSWORD

$RetentionDays = if (
    $Settings.BACKUP_RETENTION_DAYS
) {
    [Math]::Max(
        1,
        [int]$Settings.BACKUP_RETENTION_DAYS
    )
}
else {
    14
}

$Candidates = @()

$DumpCommand = Get-Command `
    "mysqldump.exe" `
    -ErrorAction SilentlyContinue

if ($DumpCommand) {
    $Candidates += $DumpCommand.Source
}

$Candidates += @(
    "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe",
    "C:\Program Files\MySQL\MySQL Server 9.0\bin\mysqldump.exe",
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe"
)

$DumpPath = $Candidates |
    Where-Object {
        $_ -and
        (Test-Path -LiteralPath $_)
    } |
    Select-Object -First 1

if (-not $DumpPath) {
    throw "没有找到 mysqldump.exe，请确认 MySQL 已正确安装。"
}

$BackupDirectory = Join-Path `
    $ProjectRoot `
    "backups\mysql"

New-Item `
    -ItemType Directory `
    -Path $BackupDirectory `
    -Force |
    Out-Null

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$OutputPath = Join-Path `
    $BackupDirectory `
    "${Database}_$Timestamp.sql"

$OldMysqlPassword = $env:MYSQL_PWD
$env:MYSQL_PWD = $Password

try {
    Write-Host ""
    Write-Host "正在备份 MySQL 数据库……" -ForegroundColor Cyan
    Write-Host "数据库：$Database"
    Write-Host "服务器：${HostName}:$Port"

    $Arguments = @(
        "--host=$HostName",
        "--port=$Port",
        "--user=$User",
        "--default-character-set=utf8mb4",
        "--single-transaction",
        "--quick",
        "--routines",
        "--events",
        "--triggers",
        "--set-gtid-purged=OFF",
        "--result-file=$OutputPath",
        $Database
    )

    & $DumpPath @Arguments

    if ($LASTEXITCODE -ne 0) {
        Remove-Item `
            -LiteralPath $OutputPath `
            -Force `
            -ErrorAction SilentlyContinue

        throw "MySQL 备份失败，退出代码：$LASTEXITCODE"
    }
}
finally {
    $env:MYSQL_PWD = $OldMysqlPassword
}

$Cutoff = (Get-Date).AddDays(
    -$RetentionDays
)

Get-ChildItem `
    -LiteralPath $BackupDirectory `
    -Filter "*.sql" `
    -File |
    Where-Object {
        $_.LastWriteTime -lt $Cutoff
    } |
    Remove-Item -Force

$BackupFile = Get-Item `
    -LiteralPath $OutputPath

Write-Host ""
Write-Host "MySQL 数据库备份成功。" -ForegroundColor Green
Write-Host "备份文件：$($BackupFile.FullName)"
Write-Host "文件大小：$($BackupFile.Length) 字节"
Write-Host "保留时间：$RetentionDays 天"