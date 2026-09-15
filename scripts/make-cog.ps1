<#
.SYNOPSIS
  大きな GeoTIFF を deck.gl-raster で表示できる COG に変換する。

.DESCRIPTION
  ブラウザ側 (@developmentseed/geotiff) の制約が2つある。

  1. 圧縮は NONE / DEFLATE / LZW / ZSTD / JPEG / WEBP / LERC のみ解ける。
     LZMA と JPEG2000 は非対応なので選ばないこと。
     LERC_ZSTD / LERC_DEFLATE も内側の圧縮ごとデコードできる。

  2. ビット深度は 8 / 16 / 32 のみ。texture.js の verifyIdenticalBitsPerSample が
     それ以外を例外で弾くので、float64 の DEM は -OutputType Float32 で
     必ず 32 bit に落とすこと。WebGL2 に 64 bit テクスチャは無い。

  標高データには LERC が効く。能登 0.5m DEM の 8192x8192 窓での実測:

    raw float32            256.0 MB
    ZSTD 9 + predictor 3   158.3 MB
    LERC_ZSTD 1cm           70.8 MB
    LERC_ZSTD 5cm           42.0 MB

  航空レーザ DSM の垂直精度は ±15cm 程度なので、1cm 許容は実質可逆。

.EXAMPLE
  # 標高（float64 → Float32 + LERC）
  pwsh -File scripts/make-cog.ps1 `
    -Source "path\to\dem.tif" -Destination "path\to\dem-cog.tif" `
    -OutputType Float32 -Compression LERC_ZSTD -MaxZError 0.01

.EXAMPLE
  # RGB 画像（可逆の ZSTD）
  pwsh -File scripts/make-cog.ps1 `
    -Source "path\to\rgb.tif" -Destination "path\to\rgb-cog.tif"
#>
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination,
  [ValidateSet("ZSTD", "DEFLATE", "LZW", "LERC", "LERC_ZSTD", "LERC_DEFLATE", "WEBP", "JPEG")]
  [string]$Compression = "ZSTD",
  # LERC 系のときの許容誤差（データの単位、0 で可逆）
  [double]$MaxZError = 0.01,
  [int]$BlockSize = 512,
  [int]$Level = 9,
  [string]$Resampling = "AVERAGE",
  # float64 は WebGL2 で扱えないので Float32 に落とす用
  [ValidateSet("", "Byte", "UInt16", "Int16", "UInt32", "Int32", "Float32")]
  [string]$OutputType = "",
  # 整数は STANDARD(2)、浮動小数は FLOATING_POINT(3)。LERC では無視される
  [ValidateSet("STANDARD", "FLOATING_POINT", "NO")]
  [string]$Predictor = "STANDARD",
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

$isLerc = $Compression -like "LERC*"

$gdalArgs = @(
  "-of", "COG",
  "-co", "COMPRESS=$Compression",
  "-co", "OVERVIEW_COMPRESS=$Compression",
  "-co", "BLOCKSIZE=$BlockSize",
  "-co", "OVERVIEW_RESAMPLING=$Resampling",
  "-co", "NUM_THREADS=ALL_CPUS",
  "-co", "BIGTIFF=YES"
)
if ($isLerc) {
  $gdalArgs += @("-co", "MAX_Z_ERROR=$MaxZError", "-co", "MAX_Z_ERROR_OVERVIEW=$MaxZError")
} else {
  $gdalArgs += @("-co", "PREDICTOR=$Predictor", "-co", "OVERVIEW_PREDICTOR=$Predictor")
}
if ($Compression -in @("ZSTD", "DEFLATE", "LERC_ZSTD", "LERC_DEFLATE")) {
  $gdalArgs += @("-co", "LEVEL=$Level")
}
if ($OutputType) { $gdalArgs += @("-ot", $OutputType) }
$gdalArgs += @($Source, $Destination)

$srcGb = (Get-Item $Source).Length / 1GB
Write-Host ("source      : {0} ({1:N1} GB)" -f $Source, $srcGb)
Write-Host ("destination : {0}" -f $Destination)
Write-Host ("options     : {0}{1}, blocksize {2}, overviews {3}{4}" -f `
  $Compression,
  $(if ($isLerc) { " max_z_error $MaxZError" } else { " level $Level predictor $Predictor" }),
  $BlockSize, $Resampling,
  $(if ($OutputType) { ", -> $OutputType" } else { "" }))

$started = Get-Date
& $translate @gdalArgs
if ($LASTEXITCODE -ne 0) { throw "gdal_translate failed with exit code $LASTEXITCODE" }

$elapsed = (Get-Date) - $started
$dstGb = (Get-Item $Destination).Length / 1GB
Write-Host ""
Write-Host ("done in {0:hh\:mm\:ss} -> {1:N1} GB ({2:P0} of source)" -f $elapsed, $dstGb, ($dstGb / $srcGb))
