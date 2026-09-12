param(
  [Parameter(Mandatory = $true)][string]$SourceDatabaseUrl,
  [Parameter(Mandatory = $true)][string]$RestoreDatabaseUrl,
  [Parameter(Mandatory = $true)][string]$EvidenceDirectory
)

$ErrorActionPreference = "Stop"
if ($env:RELEASE_RESTORE_CONFIRM -ne "RESTORE_TO_EMPTY_NON_PRODUCTION_DATABASE") {
  throw "Set RELEASE_RESTORE_CONFIRM=RESTORE_TO_EMPTY_NON_PRODUCTION_DATABASE after verifying the target."
}
if ($SourceDatabaseUrl -eq $RestoreDatabaseUrl) { throw "Source and restore database URLs must differ." }
foreach ($tool in @("pg_dump", "pg_restore", "psql")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is required." }
}

$restoreUri = [Uri]$RestoreDatabaseUrl
if ($restoreUri.Host -eq $env:PRODUCTION_DATABASE_HOST -and $env:PRODUCTION_DATABASE_HOST) {
  throw "The restore target matches PRODUCTION_DATABASE_HOST."
}
if ($restoreUri.Scheme -notin @("postgres", "postgresql")) { throw "Restore target must be PostgreSQL." }

New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
$resolvedEvidence = (Resolve-Path -LiteralPath $EvidenceDirectory).Path
$dumpPath = Join-Path $resolvedEvidence "collectboss-release.dump"
$manifestPath = Join-Path $resolvedEvidence "restore-evidence.txt"

$tableCount = & psql $RestoreDatabaseUrl -X -A -t -v ON_ERROR_STOP=1 -c "select count(*) from pg_tables where schemaname='public';"
if ($LASTEXITCODE -ne 0) { throw "Could not inspect the restore target." }
if ([int]($tableCount.Trim()) -ne 0) { throw "Restore target is not empty; refusing destructive restore." }

& pg_dump $SourceDatabaseUrl --format=custom --no-owner --no-acl --file=$dumpPath
if ($LASTEXITCODE -ne 0) { throw "Backup creation failed." }
& pg_restore --dbname=$RestoreDatabaseUrl --no-owner --no-acl --exit-on-error $dumpPath
if ($LASTEXITCODE -ne 0) { throw "Restore failed." }

$sourceFingerprint = & psql $SourceDatabaseUrl -X -A -t -v ON_ERROR_STOP=1 -c "select json_build_object('businesses',(select count(*) from public.businesses),'cases',(select count(*) from public.cases),'audit_logs',(select count(*) from public.audit_logs));"
if ($LASTEXITCODE -ne 0) { throw "Source verification query failed." }
$restoreFingerprint = & psql $RestoreDatabaseUrl -X -A -t -v ON_ERROR_STOP=1 -c "select json_build_object('businesses',(select count(*) from public.businesses),'cases',(select count(*) from public.cases),'audit_logs',(select count(*) from public.audit_logs));"
if ($LASTEXITCODE -ne 0) { throw "Restored verification query failed." }
if ($sourceFingerprint.Trim() -ne $restoreFingerprint.Trim()) { throw "Restored table-count fingerprint does not match the source." }

$sha = (Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash.ToLowerInvariant()
$lines = @(
  "completed_at_utc=$([DateTime]::UtcNow.ToString('o'))",
  "source_host=$(([Uri]$SourceDatabaseUrl).Host)",
  "restore_host=$($restoreUri.Host)",
  "dump_sha256=$sha",
  "row_count_fingerprint=$($restoreFingerprint.Trim())",
  "result=PASS"
)
Set-Content -LiteralPath $manifestPath -Value $lines -Encoding utf8
Write-Output "Backup and restore verification passed. Evidence: $manifestPath"
