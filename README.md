# deckgl-raster-test

[deck.gl-raster](https://github.com/developmentseed/deck.gl-raster) の `COGLayer` を試すための最小構成のビューアです。
タイルサーバーを介さず、ブラウザが COG に HTTP Range リクエストを投げて直接描画します。

MapLibre GL JS のベースマップに deck.gl を `interleaved` で重ねています。

## 何を確認したかったか

- 数十GB 級の COG がサーバーなしで実用的に描画できるか
- 日本の平面直角座標系（EPSG:6676 など）が GPU 再投影で正しく扱えるか
- Cloudflare R2 に置いた COG を GitHub Pages 上のアプリから読めるか

検証データは静岡市の航空写真（オルソ画像 GSD 0.2 m/px）です。
図郭分割された 8,844 枚・非圧縮 74.3 GB を 1 枚の COG にまとめています。

## 動かす

```bash
npm install
npm run dev     # http://127.0.0.1:3000
```

COG はパネルの URL 欄に貼って読み込みます。起動時に読み込むものを決めておく場合は
`.env` を作ります。

```bash
cp .env.example .env
```

| 変数 | 用途 |
| --- | --- |
| `VITE_COG_URL` | 起動時に読み込む COG の URL。R2 の公開 URL を想定。未設定なら URL 欄の入力を待つ |
| `VITE_COG_ATTRIBUTION` | パネルに出す出典表記。CC BY のデータでは必ず入れる |
| `LOCAL_RASTER_DIR` | dev サーバーが `/local/` 配下に Range 付きで配信するディレクトリ |

`LOCAL_RASTER_DIR` を設定すると、アップロード前にローカルの巨大 COG をそのまま検証できます。
たとえば `LOCAL_RASTER_DIR=C:\data` のとき `http://127.0.0.1:3000/local/foo/bar.tif` で読めます。
この配信は dev サーバー専用で、本番ビルドには含まれません。

## COG を作る

deck.gl-raster が描画できるのは **内部タイル化 + オーバービュー付き** の GeoTIFF だけです。
オーバービューが無いと、広域表示のたびに全画素を読むことになり実質的に描けません。

図郭分割された画像を 1 枚にまとめる場合（VRT 経由）:

```powershell
pwsh -File scripts/make-mosaic-cog.ps1 `
  -SourceDir "path\to\figure-sheets" `
  -Destination "data\mosaic-cog.tif" `
  -TargetSrs "EPSG:6676" -Compression JPEG -Quality 85
```

単一ファイルの場合:

```powershell
pwsh -File scripts/make-cog.ps1 -Source "path\to\huge.tif" -Destination "data\huge-cog.tif"
```

### 圧縮方式の選び方

ブラウザ側（`@developmentseed/geotiff`）がデコードできるのは
`NONE` / `DEFLATE` / `LZW` / `ZSTD` / `JPEG` / `WEBP` / `LERC` のみで、
**`LZMA` と `JPEG2000` は非対応**です。ここを間違えるとタイルが一切表示されません。

データの性質で最適解が変わります。いずれも実測値です。

**航空写真**（静岡市 100 図郭、18000x22500、非圧縮 861 MB）

| 方式 | サイズ | 所要 |
| --- | --- | --- |
| ZSTD 9（可逆） | 836.4 MB | 18s |
| WebP 85 | 129.4 MB | 20s |
| **JPEG 85** | **137.3 MB** | **12s** |

可逆圧縮はほとんど効きません。JPEG と WebP は僅差ですが、JPEG のほうが速く、
公式 example にも JPEG の COG が含まれていて実績があるので JPEG を採用しています。

JPEG はタイル共通の量子化・ハフマンテーブルが `JPEGTables` タグに入るため、
タイルの生バイトは単体では JPEG として成立しません。
`@developmentseed/geotiff` の `fetch.js` が `getJpegHeader` で結合するので問題ありませんが、
自前でタイルを読む場合は注意が要ります。

**標高**（能登 0.5m DEM、8192x8192、非圧縮 float32 256 MB）

| 方式 | サイズ |
| --- | --- |
| ZSTD 9 + 浮動小数 predictor | 158.3 MB |
| **LERC_ZSTD 1cm** | **70.8 MB** |
| LERC_ZSTD 5cm | 42.0 MB |

標高には LERC が効きます。航空レーザ測量の垂直精度は ±15cm 程度なので、
1cm 許容は実質可逆です。`LERC_ZSTD` は内側の zstd ごとデコーダが対応しています。

### ビット深度の制約

`texture.js` の `verifyIdenticalBitsPerSample` が **8 / 16 / 32 bit 以外を例外で弾きます**。
WebGL2 に 64 bit テクスチャは無いので、float64 の DEM は `-OutputType Float32` で
32 bit に落としてください。

### 再投影は不要

EPSG:6676 のような投影法のまま置いておけば、deck.gl-raster が適応的な三角メッシュを
生成して GPU 側で Web メルカトルに変換します。事前に 3857 へ変換する必要はありません。

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

バケットには CORS の設定が要ります。
Range リクエストを使うため、`content-range` / `accept-ranges` を `ExposeHeaders` に
含めておかないとブラウザ側で読めません。

数十GB の COG は GitHub Actions のランナーでは扱えない（ディスク約14GB、
ローカル PC のファイルにアクセスできない）ので、アップロードは手元から行います。

## つまずいた点

- **JPEG と WebP の COG が Worker では展開できない** — 既定の `defaultDecoderPool` は Web Worker
  プールでタイルを展開するが、その中では JPEG / WebP のタイルが展開できず、エラーも出さずに
  描画されないまま止まる。この 2 つだけが `createImageBitmap` + `OffscreenCanvas` に依存する
  **"browser-only" コーデック**で、LZW や DEFLATE のような JS 実装とは経路が分かれている
  （upstream の [#228](https://github.com/developmentseed/deck.gl-raster/issues/228) 参照）。
  実際、同じ EPSG:6676・同じ寸法で圧縮だけ違う COG を並べると、LZW / DEFLATE は描画され、
  JPEG / WebP は描画されなかった。`COGLayer` の `pool` に
  `new DecoderPool({ size: 0 })` を渡すとメインスレッドで展開され、JPEG の COG が出る。
  展開がメインスレッドに載るので描画は重くなる。
- **`Top-level await is not available`** — `@developmentseed/lzw-tiff-decoder` が top-level await を
  使うため、`vite.config.ts` の `esbuild` / `optimizeDeps` / `build` すべてに `target: "esnext"` が必要。
- **`epsgResolver` が epsg.io に外部リクエストを投げる** — 既定の実装が EPSG コードの解決に
  ネットワークを使う。閉域環境では `epsgResolver` プロップを差し替える必要がある。
- **Windows で `localhost`** — IPv6 フォールバックで初回接続が数秒遅れることがあるため
  dev サーバーは `127.0.0.1` にバインドしている。

## 出典

静岡市のオルソ画像は
[静岡県「VIRTUAL SHIZUOKA 静岡県 中・西部 点群データ」](https://www.geospatial.jp/ckan/dataset/virtual-shizuoka-mw)
（CC BY 4.0）を加工して作成しています。
図郭の取得と整理には [aerial-photo-tile-pipeline](https://github.com/shiwaku/aerial-photo-tile-pipeline) を使いました。

## ライセンス

MIT
