import { COLORMAP_INDEX } from "@developmentseed/deck.gl-raster/gpu-modules";

export type ColormapChoice = {
  id: string;
  label: string;
  colormapIndex: number;
  reversed: boolean;
};

/**
 * 標高の段彩に向くカラーマップ。スプライトには matplotlib の全カラーマップが
 * 入っているので、GPU 側は層の番号を切り替えるだけで済む。
 */
export const COLORMAP_CHOICES: ColormapChoice[] = [
  { id: "terrain", label: "terrain（地形）", colormapIndex: COLORMAP_INDEX.terrain, reversed: false },
  { id: "gist_earth", label: "gist_earth", colormapIndex: COLORMAP_INDEX.gist_earth, reversed: false },
  { id: "viridis", label: "viridis", colormapIndex: COLORMAP_INDEX.viridis, reversed: false },
  { id: "magma", label: "magma", colormapIndex: COLORMAP_INDEX.magma, reversed: false },
  { id: "turbo", label: "turbo", colormapIndex: COLORMAP_INDEX.turbo, reversed: false },
  { id: "spectral_r", label: "Spectral 反転（低→青, 高→赤）", colormapIndex: COLORMAP_INDEX.spectral, reversed: true },
  { id: "gray", label: "gray（陰影のみ見たいとき）", colormapIndex: COLORMAP_INDEX.gray, reversed: false },
];
