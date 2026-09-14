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
