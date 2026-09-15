import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import { DecoderPool } from "@developmentseed/geotiff";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Source } from "./sources.js";
import { SOURCES } from "./sources.js";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const selectEl = el<HTMLSelectElement>("src");
const urlEl = el<HTMLInputElement>("url");
const loadEl = el<HTMLButtonElement>("load");
const statusEl = el<HTMLDivElement>("status");
const attributionEl = el<HTMLParagraphElement>("attribution");

for (const [i, s] of SOURCES.entries()) {
  const opt = document.createElement("option");
  opt.value = String(i);
  opt.textContent = s.title;
  selectEl.appendChild(opt);
}

/**
 * 起動時に URL で位置が指定されていたか。
 *
 * 指定されていれば最初の COG 読み込みで `fitBounds` を見送る。
 * そうしないと、共有された URL を開いた瞬間に COG 全体の範囲へ飛ばされて
 * ハッシュを付けた意味がなくなる。2 回目以降の読み込みでは通常どおり飛ぶ。
 */
let honorInitialHash = /^#\d/.test(location.hash);

const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  center: [137, 37],
  zoom: 4,
  // 見ている位置を URL に残す。表示がおかしい場所をそのまま共有できる
  hash: true,
});
map.addControl(new maplibregl.NavigationControl(), "bottom-right");
map.addControl(new maplibregl.ScaleControl());

const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
map.addControl(overlay as unknown as maplibregl.IControl);

let current: { source: Source | undefined; generation: number } = {
  source: SOURCES[0],
  generation: 0,
};

function setStatus(text: string, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

/**
 * タイルの展開を Worker に出さず、メインスレッドで行う。
 *
 * 既定の `defaultDecoderPool` は Worker プールを作るが、その Worker の中では
 * JPEG と WebP のタイルが展開できず、描画されないまま止まる。
 * この 2 つは `createImageBitmap` + `OffscreenCanvas` に依存する
 * "browser-only" コーデックで、LZW や DEFLATE のような JS 実装とは経路が別。
 * 実際 LZW の COG は Worker のままでも描画できていた。
 *
 * `size: 0` なら `createWorker` が呼ばれず `hasWorkers` が false になり、
 * `pool.decode()` が `worker.submitJob` ではなく `decode()` を直接呼ぶ。
 * 展開がメインスレッドに載るぶん描画は重くなるが、JPEG の COG が出る。
 */
const mainThreadPool = new DecoderPool({ size: 0 });

/** 選ばれているソースでレイヤーを組み直す。id を変えるのでタイルは取り直される。 */
function update() {
  const { source } = current;
  if (!source?.url) return;
  current.generation += 1;

  const started = performance.now();
  setStatus(`ヘッダ取得中…\n${source.url}`);

  const layer = new COGLayer({
    id: `cog-${current.generation}`,
    geotiff: source.url,
    pool: mainThreadPool,
    onGeoTIFFLoad: (
      tiff: { width: number; height: number; overviews: unknown[] },
      {
        projection,
        geographicBounds,
      }: {
        projection?: { title?: string };
        geographicBounds: { west: number; south: number; east: number; north: number };
      },
    ) => {
      const { west, south, east, north } = geographicBounds;
      if (honorInitialHash) {
        honorInitialHash = false;
      } else {
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 40, duration: 1000 },
        );
      }
      (window as unknown as { tiff: unknown }).tiff = tiff;

      const overviews = tiff.overviews?.length ?? 0;
      setStatus(
        [
          `ヘッダ取得   : ${(performance.now() - started).toFixed(0)} ms`,
          `サイズ       : ${tiff.width.toLocaleString()} x ${tiff.height.toLocaleString()} px`,
          `画素数       : ${((tiff.width * tiff.height) / 1e9).toFixed(1)} ギガピクセル`,
          `オーバービュー: ${overviews}${overviews === 0 ? "  ← 0 だと広域表示ができません" : ""}`,
          `CRS          : ${projection?.title ?? "unknown"}`,
          `範囲(WGS84)  : ${west.toFixed(4)}, ${south.toFixed(4)}, ${east.toFixed(4)}, ${north.toFixed(4)}`,
        ].join("\n"),
      );
    },
  });

  overlay.setProps({ layers: [layer] });
}

function selectSource(source: Source) {
  current = { source, generation: current.generation };
  attributionEl.textContent = source.attribution ?? "";
  update();
}

selectEl.addEventListener("change", () => {
  urlEl.value = "";
  selectSource(SOURCES[Number(selectEl.value)]);
});

loadEl.addEventListener("click", () => {
  const url = urlEl.value.trim();
  if (!url) return;
  selectSource({ title: url, url });
});

urlEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadEl.click();
});

window.addEventListener("unhandledrejection", (e) => {
  setStatus(`読み込みに失敗しました:\n${e.reason}`, true);
});

/**
 * 一覧のソースはどれも手元で用意する COG なので、変換が終わっていなかったり、
 * まだ R2 に上げていなかったりする。HEAD で存在を確かめてから選ぶ。
 */
async function pickInitialSource(): Promise<Source | null> {
  for (const source of SOURCES) {
    try {
      const res = await fetch(source.url, { method: "HEAD" });
      if (res.ok) return source;
    } catch {
      // 次の候補へ
    }
  }
  return null;
}

map.on("load", async () => {
  const source = await pickInitialSource();
  if (!source) {
    setStatus("読み込める COG がありません。URL 欄に COG の URL を貼ってください。", true);
    return;
  }
  selectEl.value = String(SOURCES.indexOf(source));
  selectSource(source);
});
