// COG の読み取り経路（Range 配信・ヘッダ解析・タイル展開）を Node で確認する。
// WebGL は通らないが、データ側が壊れていればここで落ちる。
//
//   node scripts/probe-cog.mjs http://127.0.0.1:3000/local/path/to/foo.tif
import { GeoTIFF } from "@developmentseed/geotiff";
import { DOMParser } from "@xmldom/xmldom";

// ライブラリは GDAL_METADATA タグの解析に DOMParser を使う。Node には無いので補う。
// xmldom は querySelectorAll を実装していないため、使われている分だけ生やす。
class ShimDOMParser extends DOMParser {
  parseFromString(xml, type) {
    const doc = super.parseFromString(xml, type);
    const root = doc.documentElement;
    if (root && typeof root.querySelectorAll !== "function") {
      root.querySelectorAll = (tag) => Array.from(root.getElementsByTagName(tag));
    }
    return doc;
  }
}
globalThis.DOMParser ??= ShimDOMParser;

// JPEG / WebP のタイルはブラウザの画像デコーダ（createImageBitmap）で展開される。
// Node にはそれが無いので、この 2 つはヘッダまでしか確認できない。
const CANVAS_CODECS = new Set(["image/jpeg", "image/webp"]);

const url = process.argv[2];
if (!url) throw new Error("usage: node scripts/probe-cog.mjs <url>");

let bytes = 0;
let requests = 0;
const origFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  requests += 1;
  const res = await origFetch(...args);
  bytes += Number(res.headers.get("content-length") ?? 0);
  return res;
};

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const t0 = performance.now();
const tiff = await GeoTIFF.fromUrl(url);

console.log(`url            : ${url}`);
console.log(`header         : ${Math.round(performance.now() - t0)} ms / ${requests} requests / ${kb(bytes)}`);
console.log(`size           : ${tiff.width} x ${tiff.height}, ${tiff.count} bands`);
console.log(`tiled          : ${tiff.isTiled}, tile ${tiff.tileWidth} x ${tiff.tileHeight}`);
console.log(`crs            : ${typeof tiff.crs === "object" ? "PROJJSON" : tiff.crs}`);
console.log(`bbox           : ${tiff.bbox.map((v) => v.toFixed(1)).join(", ")}`);
console.log(`nodata         : ${tiff.nodata}`);

const compression = String(tiff.image.compression ?? "").toLowerCase();
console.log(`compression    : ${compression || "(unknown)"}`);

console.log(`overviews      : ${tiff.overviews.length}`);
for (const [i, ov] of tiff.overviews.entries()) {
  console.log(`  [${i}] ${ov.width} x ${ov.height}  tiles ${ov.tileCount.x} x ${ov.tileCount.y}`);
}

if (CANVAS_CODECS.has(compression)) {
  console.log("");
  console.log(`タイルの展開は ${compression} なのでブラウザの画像デコーダが要る。`);
  console.log("ここで確認できるのは Range 配信とヘッダ解析まで。");
} else {
  // 最も粗いオーバービューの中央タイルを 1 枚だけ展開してみる
  const coarsest = tiff.overviews.at(-1) ?? tiff;
  const tx = Math.floor(coarsest.tileCount.x / 2);
  const ty = Math.floor(coarsest.tileCount.y / 2);
  const before = { requests, bytes };
  const t1 = performance.now();
  const tile = await coarsest.fetchTile(tx, ty);

  console.log("");
  console.log(
    `tile (${tx},${ty}) of coarsest: ${Math.round(performance.now() - t1)} ms, ` +
      `${requests - before.requests} req, ${kb(bytes - before.bytes)}`,
  );
  const a = tile.array;
  console.log(`decoded        : ${a.width} x ${a.height}, ${a.count} bands, layout=${a.layout}`);
  const first = a.layout === "band-separate" ? a.bands[0] : a.data;
  console.log(
    `samples        : ${Array.from(first.slice(0, 8)).join(",")}… ` +
      `(${first.constructor.name}, len ${first.length})`,
  );
}

console.log("");
console.log(`TOTAL          : ${requests} requests, ${kb(bytes)}`);
