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

## 再投影のしくみ

平面直角座標系の COG が、事前変換なしで Web メルカトルの地図に重なる理由です。

**画素は変換されません。** 変換されるのはメッシュの頂点座標だけです。

```
[画素] タイルを Range 取得 → JPEG 展開 → そのまま GPU テクスチャへ（平面直角のまま）
[座標] タイルの頂点のみ  ピクセル → EPSG:6676 → EPSG:3857 → 画面座標（CPU / proj4）
[描画] GPU が頂点間を線形補間してテクスチャを引き伸ばす
```

タイルごとに三角メッシュを作り、そこに元画像を貼って引き伸ばしています。
計算するのが全画素ではなく三角形の頂点だけなので、51.8 ギガピクセルの COG でも
サーバーなしで開けます。

### 三角形の数は誤差で決まる

メッシュ生成は `@developmentseed/raster-reproject` の `delatin.js` で、
Mapbox の [delatin](https://github.com/mapbox/delatin) を改変したものです
（ファイル冒頭に "Originally copied from" と明記されています）。

本家は DEM から地形 TIN を作りますが、**測る誤差が差し替えられています**。

| | 本家 delatin | deck.gl-raster |
| --- | --- | --- |
| 測る誤差 | 三角形で近似した標高と実際の標高の差 | 三角形で引き伸ばした位置と実際の位置の差 |
| 単位 | メートル | 入力画像のピクセル |
| 閾値 | 任意 | 0.125（1/8 ピクセル） |

アルゴリズム（誤差最大の点に頂点を足して分割 → ドロネー条件を回復 → 閾値を下回るまで反復）は
本家のままです。閾値 1/8 ピクセルは `gdalwarp -et` の既定値と同じ考え方で、
**gdalwarp が事前に行う近似変換を、GPU で表示のたびに行っている**と捉えると分かりやすいです。

なお、ここでの TIN は「点群から DEM を作る TIN 内挿」とは向きが逆で、
既にある格子を軽い三角形メッシュに**間引く**用途（メッシュ簡略化）です。

### 実測：平面直角ではほとんど分割されない

検証データ（EPSG:6676 / GSD 0.2 m / 512 px タイル）で、階層ごとの三角形数を測った結果です。
`RasterReprojector` に同じ変換関数を渡して直接動かしています。

| オーバービュー | GSD | 1タイルの地上幅 | 三角形 | 残差 |
| --- | --- | --- | --- | --- |
| 最細（本体） | 0.2 m | 0.10 km | 2 | 0.0014 px |
| 6 段目 | 12.8 m | 6.6 km | 2 | 0.092 px |
| 7 段目 | 25.6 m | 13.1 km | 4 | 0.093 px |
| 8 段目 | 51.2 m | 26.2 km | 8 | 0.093 px |
| 最粗（9 段目） | 102.4 m | 52.4 km | 16 | 0.093 px |

普段見るズームでは**三角形 2 枚、つまり初期状態から一度も分割されません**。
平面直角も Web メルカトルも横メルカトル系なので、512 px 程度の範囲では
線形補間の誤差が 0.0014 px しか出ないためです。分割が始まるのは 1 タイルが 13 km を
超えるあたりで、メッシュが効いてくるのは広域表示か、より歪みの大きい投影の場合です。

`COGLayer` に `debug: true` を渡すと、実際の三角形が色分けで表示されます。

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
- **マルチレンジ要求を 400 で返す配信元がある** — `Range: bytes=0-99,200-299` のように
  複数範囲を 1 リクエストで要求すると、配信元によっては `400 Bad Request` が返る。
  実際 `shi-works.com`（Cloudflare 経由）は単一レンジなら 206 を返すが、マルチレンジは 400 だった。
  リーダーはその 400 の HTML 本文を TIFF として解釈してしまうため、
  `144115188075861300 exceeds MAX_SAFE_INTEGER`（`@cogeotiff/core` の `getUint64`）のような
  一見無関係なエラーになる。リモートの COG だけヘッダ解析で落ちる場合はこれを疑う
  （同じ寸法・同じ CRS のローカルファイルは正常に読めた）。**因果は未確定。**

## 出典

静岡市のオルソ画像は
[静岡県「VIRTUAL SHIZUOKA 静岡県 中・西部 点群データ」](https://www.geospatial.jp/ckan/dataset/virtual-shizuoka-mw)
（CC BY 4.0）を加工して作成しています。
図郭の取得と整理には [aerial-photo-tile-pipeline](https://github.com/shiwaku/aerial-photo-tile-pipeline) を使いました。

## ライセンス

MIT
