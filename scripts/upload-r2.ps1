<#
.SYNOPSIS
  COG を Cloudflare R2 にアップロードする。

.DESCRIPTION
  数十GB の COG は GitHub Actions のランナー（ディスク約14GB、ローカルPCの
  ファイルにアクセスできない）では扱えないため、アップロードはこの PC から行う。

  認証は以下のどちらか:
    1. aws CLI のプロファイル  -ProfileName r2-shiworks
    2. 環境変数 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY

.EXAMPLE
  pwsh -File scripts/upload-r2.ps1 `
    -File "C:\Users\yshiw\Documents\GIS\noto-csmap\cog\noto-csmap-2024-cog.tif" `
    -Bucket "<bucket>" -ProfileName r2-shiworks
#>
param(
  [Parameter(Mandatory = $true)][string]$File,
  [Parameter(Mandatory = $true)][string]$Bucket,
  [string]$Key,
  [string]$ProfileName,
  [string]$EndpointUrl,
  [string]$ChunkSize = "64MB"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $File)) { throw "file not found: $File" }
if (-not $Key) { $Key = Split-Path -Leaf $File }

if (-not $EndpointUrl) {
  if ($env:R2_ACCOUNT_ID) {
    $EndpointUrl = "https://$($env:R2_ACCOUNT_ID).r2.cloudflarestorage.com"
  } elseif (-not $ProfileName) {
    throw "-EndpointUrl か -ProfileName、または R2_ACCOUNT_ID のいずれかが必要です"
  }
}

# AWS CLI v2 は既定で CRC32 チェックサムを付けるが R2 がこれを拒否することがある
$env:AWS_REQUEST_CHECKSUM_CALCULATION = "when_required"
$env:AWS_RESPONSE_CHECKSUM_VALIDATION = "when_required"

$args = @(
  "s3", "cp", $File, "s3://$Bucket/$Key",
  "--content-type", "image/tiff",
  "--cli-read-timeout", "0",
  "--cli-write-timeout", "0"
)
if ($EndpointUrl) { $args += @("--endpoint-url", $EndpointUrl) }
if ($ProfileName) { $args += @("--profile", $ProfileName) }

$sizeGb = (Get-Item $File).Length / 1GB
Write-Host ("uploading {0:N1} GB -> s3://{1}/{2}" -f $sizeGb, $Bucket, $Key)

aws configure set default.s3.multipart_chunksize $ChunkSize
aws configure set default.s3.max_concurrent_requests 16

$started = Get-Date
aws @args
if ($LASTEXITCODE -ne 0) { throw "aws s3 cp failed with exit code $LASTEXITCODE" }

$elapsed = (Get-Date) - $started
Write-Host ("done in {0:hh\:mm\:ss} ({1:N1} MB/s)" -f $elapsed, (($sizeGb * 1024) / $elapsed.TotalSeconds))
