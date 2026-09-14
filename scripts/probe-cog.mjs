// COG の読み取り経路（Range 配信 + ヘッダ解析 + タイル展開）を Node で検証する。
// WebGL は含まれないが、データ経路が壊れていればここで落ちる。
import { GeoTIFF } from "@developmentseed/geotiff";

const url = process.argv[2];
if (!url) throw new Error("usage: node probe-cog.mjs <url>");

let bytes = 0;
let requests = 0;
const origFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  requests += 1;
  const res = await origFetch(...args);
  const len = Number(res.headers.get("content-length") ?? 0);
  bytes += len;
  return res;
};

const t0 = performance.now();
const tiff = await GeoTIFF.fromUrl(url);
const headerMs = performance.now() - t0;

console.log("url            :", url);
console.log(`header         : ${Math.round(headerMs)} ms / ${requests} requests / ${(bytes / 1024).toFixed(1)} KB`);
console.log("size           : %d x %d, %d bands", tiff.width, tiff.height, tiff.count);
console.log("tiled          : %s, tile %d x %d", tiff.isTiled, tiff.tileWidth, tiff.tileHeight);
console.log("crs            :", typeof tiff.crs === "object" ? "PROJJSON" : tiff.crs);
console.log("bbox           :", tiff.bbox.map((v) => v.toFixed(1)).join(", "));
console.log("nodata         :", tiff.nodata);
console.log("overviews      : %d", tiff.overviews.length);
for (const [i, ov] of tiff.overviews.entries()) {
  console.log("  [%d] %d x %d  tiles %o", i, ov.width, ov.height, ov.tileCount);
}

// 最も粗いオーバービューの中央タイルを 1 枚だけ展開してみる
const coarsest = tiff.overviews.at(-1) ?? tiff;
const tx = Math.floor(coarsest.tileCount.x / 2);
const ty = Math.floor(coarsest.tileCount.y / 2);
const before = { requests, bytes };
const t1 = performance.now();
const tile = await coarsest.fetchTile(tx, ty);
console.log(
  `\ntile (${tx},${ty}) of coarsest: ${Math.round(performance.now() - t1)} ms, ` +
    `${requests - before.requests} req, ${((bytes - before.bytes) / 1024).toFixed(1)} KB`,
);
const a = tile.array;
console.log(`decoded        : ${a.width} x ${a.height}, ${a.count} bands, layout=${a.layout}`);
const first = a.layout === "band-separate" ? a.data[0] : a.data;
console.log(
  `samples        : ${Array.from(first.slice(0, 8)).join(",")}… ` +
    `(${first.constructor.name}, len ${first.length})`,
);
console.log(`\nTOTAL          : ${requests} requests, ${(bytes / 1024).toFixed(1)} KB`);
