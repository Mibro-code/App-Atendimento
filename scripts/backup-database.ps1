param(
  [string]$Container = "app-whats-postgres",
  [string]$Database = "app_whats",
  [string]$User = "app_whats"
)

$backupDirectory = Join-Path $PSScriptRoot "..\backups"
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $backupDirectory "app-whats-$timestamp.sql"

docker exec $Container pg_dump --clean --if-exists --no-owner --username=$User $Database | Set-Content -LiteralPath $target -Encoding utf8
if ($LASTEXITCODE -ne 0) {
  Remove-Item -LiteralPath $target -ErrorAction SilentlyContinue
  throw "Não foi possível criar o backup do PostgreSQL."
}
Write-Output "Backup criado em $target"
