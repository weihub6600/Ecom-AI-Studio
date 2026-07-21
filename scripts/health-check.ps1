param(
    [string]$Url = "http://127.0.0.1:8787/api/health"
)

$ErrorActionPreference = "Stop"

function Format-Size {
    param([double]$Bytes)

    if ($Bytes -ge 1GB) {
        return "{0:N2} GB" -f ($Bytes / 1GB)
    }

    if ($Bytes -ge 1MB) {
        return "{0:N2} MB" -f ($Bytes / 1MB)
    }

    if ($Bytes -ge 1KB) {
        return "{0:N2} KB" -f ($Bytes / 1KB)
    }

    return "$([Math]::Round($Bytes)) 字节"
}

try {
    Write-Host ""
    Write-Host "正在检查 Ecom AI Studio 服务器……" -ForegroundColor Cyan

    $Report = Invoke-RestMethod `
        -Uri $Url `
        -Method Get `
        -TimeoutSec 30

    Write-Host ""
    Write-Host "检查时间：$($Report.checkedAt)"
    Write-Host "运行时间：$($Report.uptimeSeconds) 秒"
    Write-Host "Node.js：$($Report.nodeVersion)"
    Write-Host ""

    if ($Report.mysql.ok) {
        Write-Host "MySQL：正常" -ForegroundColor Green
    }
    else {
        Write-Host "MySQL：异常" -ForegroundColor Red
    }

    Write-Host "MySQL 延迟：$($Report.mysql.latencyMs) 毫秒"
    Write-Host "用户数量：$($Report.mysql.users)"
    Write-Host "有效会话：$($Report.mysql.activeSessions)"
    Write-Host "待结算任务：$($Report.mysql.pendingTasks)"
    Write-Host ""

    Write-Host "保存图片：$($Report.storage.fileCount) 张"
    Write-Host "图片占用：$(Format-Size $Report.storage.generatedBytes)"
    Write-Host "磁盘总容量：$(Format-Size $Report.storage.diskTotalBytes)"
    Write-Host "磁盘剩余：$(Format-Size $Report.storage.diskFreeBytes)"
    Write-Host "磁盘使用率：$($Report.storage.usedPercent)%"
    Write-Host ""

    if ($Report.status -eq "critical") {
        Write-Host "服务器状态：严重异常" -ForegroundColor Red
        exit 1
    }

    if ($Report.status -eq "warning") {
        Write-Host "服务器状态：存在预警" -ForegroundColor Yellow
        exit 0
    }

    Write-Host "服务器状态：正常" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "服务器健康检查失败。" -ForegroundColor Red
    Write-Host $_.Exception.Message
    Write-Host ""
    Write-Host "请先确认项目已经执行 npm run dev。"
    exit 1
}