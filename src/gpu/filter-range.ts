import type { ShaderModule } from "@luma.gl/shadertools";

/** Props for the {@link FilterRange} shader module. */
export type FilterRangeProps = {
  /** この値未満の画素を捨てる。 */
  filterMin: number;
  /** この値を超える画素を捨てる。 */
  filterMax: number;
};

const MODULE_NAME = "filterRange";

/**
 * `color.r` に入っている生の値が範囲外なら fragment を捨てる。
 *
 * nodata タグが無い DEM で、海面や欠測を落とすのに使う。値をまだ [0,1] に
 * 潰していない段階、つまり `LinearRescale` の **前** に置くこと。
 */
export const FilterRange = {
  name: MODULE_NAME,
  fs: `\
uniform ${MODULE_NAME}Uniforms {
  float filterMin;
  float filterMax;
} ${MODULE_NAME};
`,
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      if (color.r < ${MODULE_NAME}.filterMin || color.r > ${MODULE_NAME}.filterMax) {
        discard;
      }
    `,
  },
  uniformTypes: {
    filterMin: "f32",
    filterMax: "f32",
  },
  getUniforms: (props: Partial<FilterRangeProps>) => ({
    filterMin: props.filterMin ?? Number.NEGATIVE_INFINITY,
    filterMax: props.filterMax ?? Number.POSITIVE_INFINITY,
  }),
} as const satisfies ShaderModule<FilterRangeProps>;
