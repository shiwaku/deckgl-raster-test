import type { Layer } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import {
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import type { Device, Texture } from "@luma.gl/core";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { COLORMAP_CHOICES } from "./colormaps.js";
import { getDemTileData, makeDemRenderTile } from "./dem/dem-pipeline.js";
import type { Source, SourceKind } from "./sources.js";
import { SOURCES } from "./sources.js";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const selectEl = el<HTMLSelectElement>("src");
const urlEl = el<HTMLInputElement>("url");
const loadEl = el<HTMLButtonElement>("load");
const debugEl = el<HTMLInputElement>("debug");
const statusEl = el<HTMLDivElement>("status");
const demControlsEl = el<HTMLFieldSetElement>("dem-controls");
const cmapEl = el<HTMLSelectElement>("cmap");
const rminEl = el<HTMLInputElement>("rmin");
const rmaxEl = el<HTMLInputElement>("rmax");
const strengthEl = el<HTMLInputElement>("strength");
const strengthValEl = el<HTMLSpanElement>("strength-val");
const zfactorEl = el<HTMLInputElement>("zfactor");
const zfactorValEl = el<HTMLSpanElement>("zfactor-val");
const azimuthEl = el<HTMLInputElement>("azimuth");
const altitudeEl = el<HTMLInputElement>("altitude");
const fminEl = el<HTMLInputElement>("fmin");
const kindEl = el<HTMLSelectElement>("kind");
const attributionEl = el<HTMLParagraphElement>("attribution");

for (const [i, s] of SOURCES.entries()) {
  const opt = document.createElement("option");
  opt.value = String(i);
  opt.textContent = s.title;
  selectEl.appendChild(opt);
}
for (const [i, c] of COLORMAP_CHOICES.entries()) {
  const opt = document.createElement("option");
  opt.value = String(i);
  opt.textContent = c.label;
  cmapEl.appendChild(opt);
}

strengthEl.value = "0.65";
zfactorEl.value = "1.5";
azimuthEl.value = "315";
altitudeEl.value = "45";
fminEl.value = "0.5";
rminEl.value = "0";
rmaxEl.value = "600";

const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  center: [137, 37],
  zoom: 4,
});
map.addControl(new maplibregl.NavigationControl(), "bottom-right");
map.addControl(new maplibregl.ScaleControl());

/** カラーマップスプライトは device が来てから一度だけ GPU に載せる。 */
let colormapTexture: Texture | null = null;
const spritePromise = fetch(colormapsPngUrl)
  .then((r) => r.arrayBuffer())
  .then(decodeColormapSprite);

const overlay = new MapboxOverlay({
  interleaved: true,
  layers: [],
  onDeviceInitialized: (device: Device) => {
    spritePromise
      .then((image) => {
        colormapTexture = createColormapTexture(device, image);
        // DEM を先に選んでいた場合、テクスチャが揃った時点で描き直す
        if (current.source?.kind === "dem") update({ refetch: false });
      })
      .catch((e) => setStatus(`カラーマップの読み込みに失敗: ${e}`, true));
  },
});
map.addControl(overlay as unknown as maplibregl.IControl);

let current = { source: SOURCES[0], generation: 0 };

function setStatus(text: string, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function readDemOptions() {
  const choice = COLORMAP_CHOICES[Number(cmapEl.value) || 0];
  return {
    colormapIndex: choice.colormapIndex,
    colormapReversed: choice.reversed,
    rescaleMin: Number(rminEl.value),
    rescaleMax: Number(rmaxEl.value),
    filterMin: Number(fminEl.value),
    filterMax: Number.POSITIVE_INFINITY,
    hillshadeStrength: Number(strengthEl.value),
    zFactor: Number(zfactorEl.value),
    azimuth: Number(azimuthEl.value),
    altitude: Number(altitudeEl.value),
  };
}

/**
 * レイヤーを組み直す。
 *
 * `refetch: false` のときは id を据え置くので、タイルは再取得されず
 * シェーダのユニフォームだけが差し替わる。カラーマップや陰影の調整はこちら。
 */
function update({ refetch }: { refetch: boolean }) {
  const { source } = current;
  if (!source?.url) return;
  if (refetch) current.generation += 1;

  const started = performance.now();
  if (refetch) setStatus(`ヘッダ取得中…\n${source.url}`);

  const common = {
    id: `cog-${current.generation}`,
    geotiff: source.url,
    debug: debugEl.checked,
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
      if (refetch) {
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
  };

  let layer: Layer;
  if (source.kind === "dem") {
    if (!colormapTexture) {
      setStatus("カラーマップの準備中…");
      return;
    }
    const demOptions = readDemOptions();
    layer = new COGLayer({
      ...common,
      getTileData: getDemTileData,
      renderTile: makeDemRenderTile({ ...demOptions, colormapTexture }),
      // タイルを再取得せずにシェーダのユニフォームだけ差し替えるためのキー。
      // colormapTexture は同一参照なので含めなくてよい。
      updateTriggers: { renderTile: Object.values(demOptions) },
    });
  } else {
    layer = new COGLayer(common);
  }

  overlay.setProps({ layers: [layer] });
}

function selectSource(source: Source) {
  current = { source, generation: current.generation };
  const isDem = source.kind === "dem";
  demControlsEl.hidden = !isDem;
  kindEl.value = source.kind;
  attributionEl.textContent = source.attribution ?? "";
  if (isDem && source.elevationRange) {
    rminEl.value = String(source.elevationRange[0]);
    rmaxEl.value = String(source.elevationRange[1]);
  }
  syncLabels();
  update({ refetch: true });
}

function syncLabels() {
  strengthValEl.textContent = `(${strengthEl.value})`;
  zfactorValEl.textContent = `(x${zfactorEl.value})`;
}

selectEl.addEventListener("change", () => {
  urlEl.value = "";
  selectSource(SOURCES[Number(selectEl.value)]);
});

loadEl.addEventListener("click", () => {
  const url = urlEl.value.trim();
  if (!url) return;
  // URL からは種別を判別できないので、隣のセレクタの指定に従う
  const kind = kindEl.value as SourceKind;
  selectSource({ title: url, url, kind, elevationRange: [0, 600] });
});

urlEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadEl.click();
});

for (const input of [cmapEl, rminEl, rmaxEl, strengthEl, zfactorEl, azimuthEl, altitudeEl, fminEl]) {
  input.addEventListener("input", () => {
    syncLabels();
    update({ refetch: false });
  });
}

debugEl.addEventListener("change", () => update({ refetch: false }));

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
