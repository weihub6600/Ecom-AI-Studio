param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
    $ProjectRoot = Split-Path $PSScriptRoot -Parent
}

Push-Location $ProjectRoot

try {
    $TrackedFiles = @(git ls-files)

    if ($LASTEXITCODE -ne 0) {
        throw "无法读取 Git 文件列表。"
    }

    $Problems = @()

    foreach ($Path in $TrackedFiles) {
        $Normalized = $Path.Replace("\", "/")

        if (
            $Normalized -eq ".env" -or
            $Normalized -match "^data/" -or
            $Normalized -match "^backups/" -or
            $Normalized -match "^logs/" -or
            $Normalized -match "\.(sql|dump|pem|key|pfx|p12)$"
        ) {
            $Problems += $Normalized
        }
    }

    $GitIgnorePath = Join-Path $ProjectRoot ".gitignore"

    if (-not (Test-Path $GitIgnorePath)) {
        $Problems += "缺少 .gitignore"
    }
    else {
        $GitIgnore = [System.IO.File]::ReadAllText(
            $GitIgnorePath,
            [System.Text.Encoding]::UTF8
        )

        foreach ($RequiredRule in @(
            ".env",
            "data/",
            "backups/"
        )) {
            if (
                $GitIgnore -notmatch (
                    "(?m)^" +
                    [regex]::Escape($RequiredRule) +
                    "$"
                )
            ) {
                $Problems += ".gitignore 缺少：$RequiredRule"
            }
        }
    }

    if ($Problems.Count -gt 0) {
        Write-Host ""
        Write-Host "敏感文件检查未通过：" -ForegroundColor Red

        $Problems |
            Sort-Object -Unique |
            ForEach-Object {
                Write-Host " - $_" -ForegroundColor Red
            }

        Write-Host ""
        Write-Host "已阻止提交，请先清理上述文件。"
        exit 1
    }

    Write-Host "敏感文件检查通过。" -ForegroundColor Green
}
finally {
    Pop-Location
}