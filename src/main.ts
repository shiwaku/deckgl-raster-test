import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { SOURCES } from "./sources.js";

const selectEl = document.getElementById("src") as HTMLSelectElement;
const urlEl = document.getElementById("url") as HTMLInputElement;
const loadEl = document.getElementById("load") as HTMLButtonElement;
const debugEl = document.getElementById("debug") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

for (const [i, s] of SOURCES.entries()) {
  const opt = document.createElement("option");
  opt.value = String(i);
  opt.textContent = s.title;
  selectEl.appendChild(opt);
}

const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  center: [137, 37],
  zoom: 4,
});
map.addControl(new maplibregl.NavigationControl(), "bottom-right");
map.addControl(new maplibregl.ScaleControl());

const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
map.addControl(overlay as unknown as maplibregl.IControl);

/** 現在表示中の COG。デバッグ表示の切替で作り直すために保持する。 */
let currentUrl = SOURCES[0]?.url ?? "";
/** レイヤー id を毎回変えると再読込になるので、URL が同じ間は固定する。 */
let generation = 0;

function setStatus(text: string, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function render(url: string, { newSource }: { newSource: boolean }) {
  if (!url) return;
  currentUrl = url;
  if (newSource) generation += 1;

  const started = performance.now();
  if (newSource) setStatus(`ヘッダ取得中…\n${url}`);

  const layer = new COGLayer({
    id: `cog-${generation}`,
    geotiff: url,
    debug: debugEl.checked,
    onGeoTIFFLoad: (tiff, { projection, geographicBounds }) => {
      const { west, south, east, north } = geographicBounds;
      if (newSource) {
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 40, duration: 1000 },
        );
      }
      // コンソールから中身を触れるようにしておく
      (window as unknown as { tiff: unknown }).tiff = tiff;

      const overviews = tiff.overviews?.length ?? 0;
      setStatus(
        [
          `ヘッダ取得   : ${(performance.now() - started).toFixed(0)} ms`,
          `サイズ       : ${tiff.width.toLocaleString()} x ${tiff.height.toLocaleString()} px`,
          `画素数       : ${((tiff.width * tiff.height) / 1e9).toFixed(1)} ギガピクセル`,
          `オーバービュー: ${overviews}${overviews === 0 ? "  ← 0 だと拡大時しか描けません" : ""}`,
          `CRS          : ${projection?.title ?? "unknown"}`,
          `範囲(WGS84)  : ${west.toFixed(4)}, ${south.toFixed(4)}, ${east.toFixed(4)}, ${north.toFixed(4)}`,
        ].join("\n"),
      );
    },
  });

  overlay.setProps({ layers: [layer] });
}

selectEl.addEventListener("change", () => {
  const source = SOURCES[Number(selectEl.value)];
  urlEl.value = "";
  render(source.url, { newSource: true });
});

loadEl.addEventListener("click", () => {
  const url = urlEl.value.trim();
  if (!url) return;
  render(url, { newSource: true });
});

urlEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadEl.click();
});

debugEl.addEventListener("change", () => render(currentUrl, { newSource: false }));

window.addEventListener("unhandledrejection", (e) => {
  setStatus(`読み込みに失敗しました:\n${e.reason}`, true);
});

map.on("load", () => render(currentUrl, { newSource: true }));
