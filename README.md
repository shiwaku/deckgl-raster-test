# deckgl-raster-test

[deck.gl-raster](https://github.com/developmentseed/deck.gl-raster) の `COGLayer` を試すための最小構成のビューアです。
タイルサーバーを介さず、ブラウザが COG に HTTP Range リクエストを投げて直接描画します。

MapLibre GL JS のベースマップに deck.gl を `interleaved` で重ねています。

## 何を確認したかったか

- 数十GB 級の COG がサーバーなしで実用的に描画できるか
- 日本の平面直角座標系（EPSG:6675 など）が GPU 再投影で正しく扱えるか
- Cloudflare R2 に置いた COG を GitHub Pages 上のアプリから読めるか

## 動かす

```bash
npm install
npm run dev     # http://127.0.0.1:3000
```

公式サンプルの公開 COG（Sentinel-2、NLCD Land Cover 1.3GB、Swisstopo、Umbra SAR など）が
最初から選択肢に入っているので、設定なしで動きます。

自分の COG を見る場合は、パネルの URL 欄に直接貼るか `.env` を作ります。

```bash
cp .env.example .env
```

| 変数 | 用途 |
| --- | --- |
| `VITE_COG_URL` | 一覧の先頭に出す COG の URL。R2 の公開 URL を想定 |
| `LOCAL_RASTER_DIR` | dev サーバーが `/local/` 配下に Range 付きで配信するディレクトリ |

`LOCAL_RASTER_DIR` を設定すると、アップロード前にローカルの巨大 COG をそのまま検証できます。
たとえば `LOCAL_RASTER_DIR=C:\data` のとき `http://127.0.0.1:3000/local/foo/bar.tif` で読めます。
この配信は dev サーバー専用で、本番ビルドには含まれません。

## COG を作る

deck.gl-raster が描画できるのは **内部タイル化 + オーバービュー付き** の GeoTIFF だけです。
オーバービューが無いと、広域表示のたびに全画素を読むことになり実質的に描けません。

```powershell
pwsh -File scripts/make-cog.ps1 `
  -Source "path\to\huge.tif" `
  -Destination "path\to\huge-cog.tif"
```

圧縮は **ZSTD** を使っています。ブラウザ側（`@developmentseed/geotiff`）がデコードできるのは
`NONE` / `DEFLATE` / `LZW` / `ZSTD` / `JPEG` / `WEBP` / `LERC` のみで、
**`LZMA` と `JPEG2000` は非対応**です。ここを間違えるとタイルが一切表示されません。

再投影は不要です。EPSG:6675 のような投影法のまま置いておけば、deck.gl-raster が
適応的な三角メッシュを生成して GPU 側で Web メルカトルに変換します。

## DEM を陰影段彩で描く

能登 0.5m DEM（EPSG:6675, Float32）を段彩 + 陰影で描画します。カラーマップ・標高レンジ・
光源の向き・陰影の強さはすべて GPU 側のユニフォームなので、タイルを再取得せずに即時反映されます。

ここには deck.gl-raster を使ううえで効いてくる制約が2つあります。

**1. 既定のパイプラインは符号なし整数の COG しか組み立てない**

`inferRenderPipeline` は `SampleFormat` を見て分岐しますが、実装があるのは `SampleFormat.Uint`
だけで、浮動小数では次の例外を投げます。

```
Inferring render pipeline for non-unsigned integers not yet supported.
```

したがって Float32 の DEM では `getTileData` と `renderTile` を自前で渡す必要があります
（`src/dem/dem-pipeline.ts`）。標高は `r32float` テクスチャに載せ、
`CreateTexture` → `FilterRange` → `LinearRescale` → `Colormap` → `Hillshade` の順で合成します。
`FilterRange` が生の標高値に効く必要があるので `LinearRescale` より前、
`Hillshade` は段彩後の色に乗算するので `Colormap` より後、という順序に意味があります。

なお `r32float` は WebGL2 では線形補間できない（`OES_texture_float_linear` が要る）ため、
サンプラは nearest 固定にしています。

**2. 陰影の組み込みモジュールが無い**

GPU モジュールは `Colormap` / `LinearRescale` / `FilterNoDataVal` / `CompositeBands` /
色空間変換 / `CutlineBbox` / `MaskTexture` などで、hillshade は含まれていません。
`src/gpu/hillshade.ts` に Horn 法（3x3）の luma.gl ShaderModule を自前で用意しています。
連鎖してきた `color` ではなく、自前のサンプラで標高テクスチャを直接読みます。

既知の制限として、タイル境界では隣接タイルの画素を参照できずクランプされるため、
1 画素分の継ぎ目が出ます。消すには境界付きタイルで 1 画素の縁を読み込む必要があります。

## COG を検証する

ブラウザを開かずに、COG の読み取り経路（Range 配信・ヘッダ解析・タイル展開）だけを確認できます。
表示されないときに、原因がデータ側かレンダリング側かを切り分けるのに使います。

```bash
node scripts/probe-cog.mjs http://127.0.0.1:3000/local/path/to/foo.tif
```

```
header         : 158 ms / 1 requests / 64.0 KB
size           : 21504 x 22784, 3 bands
tiled          : true, tile 512 x 512
overviews      : 6
tile (0,0) of coarsest: 41 ms, 1 req, 237.8 KB
decoded        : 512 x 512, 3 bands, layout=pixel-interleaved
```

## R2 に置く

```powershell
pwsh -File scripts/upload-r2.ps1 -File "path\to\huge-cog.tif" -Bucket "<bucket>" -ProfileName r2-shiworks
```

バケットには CORS の設定が要ります（`scripts/r2-cors.json` を参照）。
Range リクエストを使うため、`content-range` / `accept-ranges` を `ExposeHeaders` に
含めておかないとブラウザ側で読めません。

数十GB の COG は GitHub Actions のランナーでは扱えない（ディスク約14GB、
ローカル PC のファイルにアクセスできない）ので、アップロードは手元から行います。

## つまずいた点

- **`Top-level await is not available`** — `@developmentseed/lzw-tiff-decoder` が top-level await を
  使うため、`vite.config.ts` の `esbuild` / `optimizeDeps` / `build` すべてに `target: "esnext"` が必要。
- **`epsgResolver` が epsg.io に外部リクエストを投げる** — 既定の実装が EPSG コードの解決に
  ネットワークを使う。閉域環境では `epsgResolver` プロップを差し替える必要がある。
- **Windows で `localhost`** — IPv6 フォールバックで初回接続が数秒遅れることがあるため
  dev サーバーは `127.0.0.1` にバインドしている。

## ライセンス

MIT
