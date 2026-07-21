param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
    $ProjectRoot = Split-Path $PSScriptRoot -Parent
}

$GitDirectory = Join-Path $ProjectRoot ".git"

if (-not (Test-Path -LiteralPath $GitDirectory)) {
    Write-Host "没有找到 .git，已跳过 Git 安全钩子安装。"
    exit 0
}

$HookDirectory = Join-Path $GitDirectory "hooks"
$HookPath = Join-Path $HookDirectory "pre-commit"

New-Item `
    -ItemType Directory `
    -Path $HookDirectory `
    -Force |
    Out-Null

$HookLines = @(
    "#!/bin/sh",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"./scripts/check-sensitive-files.ps1`"",
    "exit `$?"
)

$HookContent = $HookLines -join "`n"

[System.IO.File]::WriteAllText(
    $HookPath,
    $HookContent + "`n",
    [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Git 提交前敏感文件检查已安装。" -ForegroundColor Green