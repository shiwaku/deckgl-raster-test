<#
.SYNOPSIS
  大きな GeoTIFF を deck.gl-raster で表示できる COG に変換する。

.DESCRIPTION
  deck.gl-raster (@developmentseed/geotiff) がブラウザで解ける圧縮は
  NONE / DEFLATE / LZW / ZSTD / JPEG / WEBP / LERC のみ。
  ここでは可逆で圧縮率と展開速度のバランスが良い ZSTD を使う。
  LZMA と JPEG2000 は非対応なので選ばないこと。

.EXAMPLE
  pwsh -File scripts/make-cog.ps1 `
    -Source "C:\Users\yshiw\Documents\GIS\noto-csmap\csmap-py\noto-dem-2024-csmap.tif" `
    -Destination "C:\Users\yshiw\Documents\GIS\noto-csmap\cog\noto-csmap-2024-cog.tif"
#>
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination,
  [int]$BlockSize = 512,
  [int]$Level = 9,
  [string]$Resampling = "AVERAGE",
  [string]$GdalRoot = "C:\OSGeo4W-gdal313"
)

$ErrorActionPreference = "Stop"

$env:GDAL_DATA = Join-Path $GdalRoot "apps\gdal\share\gdal"
$env:PROJ_DATA = Join-Path $GdalRoot "share\proj"
$env:GDAL_CACHEMAX = "4096"
$env:GDAL_NUM_THREADS = "ALL_CPUS"

$translate = Join-Path $GdalRoot "bin\gdal_translate.exe"
if (-not (Test-Path $translate)) { throw "gdal_translate not found: $translate" }

$outDir = Split-Path -Parent $Destination
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$srcGb = (Get-Item $Source).Length / 1GB
Write-Host ("source      : {0} ({1:N1} GB)" -f $Source, $srcGb)
Write-Host ("destination : {0}" -f $Destination)
Write-Host ("options     : ZSTD level {0}, blocksize {1}, overviews {2}" -f $Level, $BlockSize, $Resampling)

$started = Get-Date

& $translate -of COG `
  -co COMPRESS=ZSTD `
  -co LEVEL=$Level `
  -co PREDICTOR=STANDARD `
  -co OVERVIEW_COMPRESS=ZSTD `
  -co OVERVIEW_PREDICTOR=STANDARD `
  -co BLOCKSIZE=$BlockSize `
  -co OVERVIEW_RESAMPLING=$Resampling `
  -co NUM_THREADS=ALL_CPUS `
  -co BIGTIFF=YES `
  $Source $Destination

if ($LASTEXITCODE -ne 0) { throw "gdal_translate failed with exit code $LASTEXITCODE" }

$elapsed = (Get-Date) - $started
$dstGb = (Get-Item $Destination).Length / 1GB
Write-Host ""
Write-Host ("done in {0:hh\:mm\:ss} -> {1:N1} GB ({2:P0} of source)" -f $elapsed, $dstGb, ($dstGb / $srcGb))
