import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import { DecoderPool } from "@developmentseed/geotiff";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const urlEl = el<HTMLInputElement>("url");
const loadEl = el<HTMLButtonElement>("load");
const statusEl = el<HTMLDivElement>("status");
const attributionEl = el<HTMLParagraphElement>("attribution");

/** `.env` の VITE_COG_URL。起動時に URL 欄へ入れて、そのまま読み込む。 */
const initialUrl = (import.meta.env.VITE_COG_URL as string | undefined)?.trim();

/** `.env` の VITE_COG_ATTRIBUTION。CC BY などで出典表示が要るデータのために出す。 */
const attribution = (import.meta.env.VITE_COG_ATTRIBUTION as string | undefined)?.trim();
attributionEl.textContent = attribution ?? "";

const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  center: [137, 37],
  zoom: 4,
  // 見ている位置を URL に残す。おかしい場所をそのままリンクで渡せる
  hash: true,
});
map.addControl(new maplibregl.NavigationControl(), "bottom-right");
map.addControl(new maplibregl.ScaleControl());

const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
map.addControl(overlay as unknown as maplibregl.IControl);

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

/** 読み込むたびに id を変えて、タイルを取り直させる。 */
let generation = 0;

function load(url: string) {
  generation += 1;
  const started = performance.now();
  setStatus(`ヘッダ取得中…\n${url}`);

  const layer = new COGLayer({
    id: `cog-${generation}`,
    geotiff: url,
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
      // 起動時も URL 欄からの読み込みも、必ずデータの範囲へ飛ぶ。
      // ハッシュを優先すると、前回の位置が残っているだけのときに
      // 読み込めているのに何も見えない状態になる。
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 40, duration: 1000 },
      );
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

loadEl.addEventListener("click", () => {
  const url = urlEl.value.trim();
  if (url) load(url);
});

urlEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadEl.click();
});

window.addEventListener("unhandledrejection", (e) => {
  setStatus(`読み込みに失敗しました:\n${e.reason}`, true);
});

map.on("load", () => {
  if (!initialUrl) {
    setStatus("URL 欄に COG の URL を貼ってください。");
    return;
  }
  urlEl.value = initialUrl;
  load(initialUrl);
});
