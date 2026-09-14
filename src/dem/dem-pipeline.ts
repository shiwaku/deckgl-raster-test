import type {
  MinimalTileData,
  RenderTileResult,
} from "@developmentseed/deck.gl-raster";
import {
  Colormap,
  CreateTexture,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";
import { FilterRange } from "../gpu/filter-range.js";
import { Hillshade } from "../gpu/hillshade.js";

/**
 * Float32 の DEM 1 バンドを描くための自前パイプライン。
 *
 * COGLayer の既定パイプライン（inferRenderPipeline）は SampleFormat が
 * 符号なし整数の COG しか組み立てられず、浮動小数では
 * "Inferring render pipeline for non-unsigned integers not yet supported"
 * を投げる。そのため getTileData と renderTile を両方自前で渡す。
 */
export type DemTileData = MinimalTileData & {
  /** r32float の標高テクスチャ。 */
  texture: Texture;
  /** 1 画素あたりの地上距離（CRS の単位。EPSG:6675 なら m）。 */
  cellSize: number;
};

/**
 * タイルを 1 枚読み、標高をそのまま r32float テクスチャに載せる。
 *
 * r32float は WebGL2 では線形補間できない（OES_texture_float_linear が要る）
 * ため、サンプラは nearest 固定。
 */
export async function getDemTileData(
  image: GeoTIFF | Overview,
  options: GetTileDataOptions,
): Promise<DemTileData> {
  const { device, x, y, pool, signal } = options;

  const tile = await image.fetchTile(x, y, { boundless: false, pool, signal });
  const { array } = tile;

  if (array.count !== 1) {
    throw new Error(`Expected a single-band DEM, got ${array.count} bands.`);
  }

  // LERC のデコーダは band-separate を返し、ZSTD などは pixel-interleaved を
  // 返す。1 バンドなのでどちらでも中身は同じ長さの typed array 1 本になる。
  const elevation =
    array.layout === "band-separate" ? array.bands[0] : array.data;

  const texture = device.createTexture({
    data: elevation,
    format: "r32float",
    width: array.width,
    height: array.height,
    sampler: {
      minFilter: "nearest",
      magFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    },
  });

  // transform = [a, b, c, d, e, f]。a が 1 画素の幅。
  const cellSize = Math.abs(image.transform[0]);

  return {
    texture,
    cellSize,
    width: array.width,
    height: array.height,
    byteLength: elevation.byteLength,
  };
}

/** {@link makeDemRenderTile} に渡す表示設定。 */
export type DemRenderOptions = {
  /** カラーマップスプライト（2d-array テクスチャ）。 */
  colormapTexture: Texture;
  /** スプライトの何層目を使うか。 */
  colormapIndex: number;
  /** カラーマップを反転するか。 */
  colormapReversed: boolean;
  /** 段彩の下限標高（m）。 */
  rescaleMin: number;
  /** 段彩の上限標高（m）。 */
  rescaleMax: number;
  /** これ未満の標高を捨てる（海面や欠測の除去）。 */
  filterMin: number;
  /** これを超える標高を捨てる。 */
  filterMax: number;
  /** 陰影の効き具合。0 で段彩のみ。 */
  hillshadeStrength: number;
  /** 標高の強調倍率。 */
  zFactor: number;
  /** 光源の方位角（度）。 */
  azimuth: number;
  /** 光源の高度角（度）。 */
  altitude: number;
};

/**
 * 現在の表示設定を閉じ込めた renderTile を作る。
 *
 * モジュールの順番には意味がある。FilterRange は生の標高値に対して効くので
 * LinearRescale より前、Hillshade は段彩後の色に乗算するので Colormap より後。
 */
export function makeDemRenderTile(options: DemRenderOptions) {
  return function renderTile(data: DemTileData): RenderTileResult {
    return {
      renderPipeline: [
        { module: CreateTexture, props: { textureName: data.texture } },
        {
          module: FilterRange,
          props: { filterMin: options.filterMin, filterMax: options.filterMax },
        },
        {
          module: LinearRescale,
          props: {
            rescaleMin: options.rescaleMin,
            rescaleMax: options.rescaleMax,
          },
        },
        {
          module: Colormap,
          props: {
            colormapTexture: options.colormapTexture,
            colormapIndex: options.colormapIndex,
            reversed: options.colormapReversed,
          },
        },
        {
          module: Hillshade,
          props: {
            elevationTexture: data.texture,
            texelSize: [1 / data.width, 1 / data.height],
            cellSize: data.cellSize,
            zFactor: options.zFactor,
            azimuth: options.azimuth,
            altitude: options.altitude,
            strength: options.hillshadeStrength,
          },
        },
      ],
    };
  };
}
