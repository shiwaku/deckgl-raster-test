<#
.SYNOPSIS
  図郭分割された多数の画像を 1 枚の COG にまとめる。

.DESCRIPTION
  VRT を経由して gdal_translate -of COG に渡す。

  航空写真は可逆圧縮がほとんど効かない（静岡市の 100 図郭・非圧縮 861MB での実測で
  ZSTD 9 は 836MB にしかならない）。JPEG 85 なら 137MB、WebP 85 なら 129MB。
  ブラウザ側はどちらも画像デコーダ（createImageBitmap）で展開する。
  JPEG はタイル共通の量子化テーブルが JPEGTables タグに入るが、
  @developmentseed/geotiff の fetch.js が getJpegHeader で結合するので問題ない。

  元画像に CRS が埋まっておらずワールドファイルだけの場合は -TargetSrs を指定する。

.EXAMPLE
  pwsh -File scripts/make-mosaic-cog.ps1 `
    -SourceDir "...\data\shizuoka-city" `
    -Destination "...\data\shizuoka-aerial-cog.tif" `
    -TargetSrs EPSG:6676
#>
param(
  [Parameter(Mandatory = $true)][string]$SourceDir,
  [Parameter(Mandatory = $true)][string]$Destination,
  [string]$Filter = "*.tif",
  # 元画像に CRS が無いとき（ワールドファイルのみ）に付与する
  [string]$TargetSrs = "",
  [ValidateSet("JPEG", "WEBP", "ZSTD", "DEFLATE", "LZW")]
  [string]$Compression = "JPEG",
  [int]$Quality = 85,
  [int]$BlockSize = 512,
  [string]$Resampling = "AVERAGE",
  # 図郭が敷き詰められていない範囲を透過させる。
  # gdalbuildvrt -addalpha で 4 バンド目を作ると、COG ドライバが JPEG 圧縮時に
  # それをマスクバンドへ変換する（JPEG は 3 バンドしか持てないため）。
  # @developmentseed/geotiff はマスク IFD を読み、既定パイプラインが
  # MaskTexture モジュールを挿すので透過がそのまま効く。サイズ増は 0.2% 未満。
  [switch]$AddAlpha,
  [string]$GdalRoot = "C:\OSGeo4W-gdal313"
)

$ErrorActionPreference = "Stop"

$env:GDAL_DATA = Join-Path $GdalRoot "apps\gdal\share\gdal"
$env:PROJ_DATA = Join-Path $GdalRoot "share\proj"
$env:GDAL_CACHEMAX = "4096"
$env:GDAL_NUM_THREADS = "ALL_CPUS"

$buildvrt  = Join-Path $GdalRoot "bin\gdalbuildvrt.exe"
$translate = Join-Path $GdalRoot "bin\gdal_translate.exe"
foreach ($exe in @($buildvrt, $translate)) {
  if (-not (Test-Path $exe)) { throw "not found: $exe" }
}

$outDir = Split-Path -Parent $Destination
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$sources = Get-ChildItem $SourceDir -Filter $Filter -File
if ($sources.Count -eq 0) { throw "no files matched $Filter in $SourceDir" }
$srcGb = ($sources | Measure-Object Length -Sum).Sum / 1GB

$listPath = [System.IO.Path]::ChangeExtension($Destination, ".inputs.txt")
$vrtPath  = [System.IO.Path]::ChangeExtension($Destination, ".vrt")
$sources.FullName | Set-Content $listPath -Encoding ascii

Write-Host ("sources     : {0:N0} files ({1:N1} GB) in {2}" -f $sources.Count, $srcGb, $SourceDir)
Write-Host ("destination : {0}" -f $Destination)
Write-Host ("options     : {0} quality {1}, blocksize {2}, overviews {3}{4}" -f `
  $Compression, $Quality, $BlockSize, $Resampling, $(if ($AddAlpha) { ", alpha -> mask band" } else { "" }))

$started = Get-Date
Write-Host "`n[1/2] building VRT…"
$vrtArgs = @("-overwrite")
if ($AddAlpha) { $vrtArgs += "-addalpha" }
$vrtArgs += @("-input_file_list", $listPath, $vrtPath)
& $buildvrt @vrtArgs
if ($LASTEXITCODE -ne 0) { throw "gdalbuildvrt failed with exit code $LASTEXITCODE" }

$gdalArgs = @(
  "-of", "COG",
  "-co", "COMPRESS=$Compression",
  "-co", "OVERVIEW_COMPRESS=$Compression",
  "-co", "BLOCKSIZE=$BlockSize",
  "-co", "OVERVIEW_RESAMPLING=$Resampling",
  "-co", "NUM_THREADS=ALL_CPUS",
  "-co", "BIGTIFF=YES"
)
if ($Compression -in @("JPEG", "WEBP")) {
  $gdalArgs += @("-co", "QUALITY=$Quality", "-co", "OVERVIEW_QUALITY=$Quality")
}
if ($TargetSrs) { $gdalArgs += @("-a_srs", $TargetSrs) }
$gdalArgs += @($vrtPath, $Destination)

Write-Host "[2/2] writing COG…"
& $translate @gdalArgs
if ($LASTEXITCODE -ne 0) { throw "gdal_translate failed with exit code $LASTEXITCODE" }

$elapsed = (Get-Date) - $started
$dstGb = (Get-Item $Destination).Length / 1GB
Write-Host ""
Write-Host ("done in {0:hh\:mm\:ss} -> {1:N1} GB ({2:P1} of source)" -f $elapsed, $dstGb, ($dstGb / $srcGb))
