import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/** Props for the {@link Hillshade} shader module. */
export type HillshadeProps = {
  /**
   * 標高テクスチャ。`CreateTexture` に渡すものと同じ Texture を指定する。
   * 標高値は `.r` に入っている前提（r32float）。
   */
  elevationTexture: Texture;
  /** 1 テクセルあたりの UV 幅・高さ。`[1 / width, 1 / height]`。 */
  texelSize: [number, number];
  /** 1 画素あたりの地上距離（m）。傾斜の計算に使う。 */
  cellSize: number;
  /** 標高の強調倍率。1 で等倍。 */
  zFactor: number;
  /** 光源の方位角（度、北=0、時計回り）。 */
  azimuth: number;
  /** 光源の高度角（度、水平=0、真上=90）。 */
  altitude: number;
  /** 陰影の効き具合。0 で陰影なし、1 で全掛け。 */
  strength: number;
};

const MODULE_NAME = "hillshade";

/**
 * Horn 法（3x3）で傾斜と斜面方位を求め、既に `color` に入っている段彩へ
 * 陰影を乗算するシェーダモジュール。
 *
 * deck.gl-raster に陰影の組み込みモジュールは無いので自前で用意している。
 * 段彩を作る {@link Colormap} の **後ろ** に置くこと。入力は連鎖してきた
 * `color` ではなく、自前のサンプラで標高テクスチャを直接読む。
 *
 * タイル境界では隣接タイルの画素を参照できずクランプされるため、1 画素分の
 * 継ぎ目が出る。厳密に消すには境界付きタイル（boundless）で 1 画素の縁を
 * 付けて読み込む必要がある。
 */
export const Hillshade = {
  name: MODULE_NAME,
  fs: `\
uniform ${MODULE_NAME}Uniforms {
  vec2 texelSize;
  float cellSize;
  float zFactor;
  float azimuth;
  float altitude;
  float strength;
} ${MODULE_NAME};
`,
  inject: {
    "fs:#decl": `\
uniform sampler2D elevationTexture;

float ${MODULE_NAME}_sample(vec2 uv, vec2 offset) {
  return texture(elevationTexture, uv + offset).r;
}
`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      {
        vec2 hs_t = ${MODULE_NAME}.texelSize;
        vec2 hs_uv = geometry.uv;

        float hs_a = ${MODULE_NAME}_sample(hs_uv, vec2(-hs_t.x, -hs_t.y));
        float hs_b = ${MODULE_NAME}_sample(hs_uv, vec2(     0.0, -hs_t.y));
        float hs_c = ${MODULE_NAME}_sample(hs_uv, vec2( hs_t.x, -hs_t.y));
        float hs_d = ${MODULE_NAME}_sample(hs_uv, vec2(-hs_t.x,      0.0));
        float hs_f = ${MODULE_NAME}_sample(hs_uv, vec2( hs_t.x,      0.0));
        float hs_g = ${MODULE_NAME}_sample(hs_uv, vec2(-hs_t.x,  hs_t.y));
        float hs_h = ${MODULE_NAME}_sample(hs_uv, vec2(     0.0,  hs_t.y));
        float hs_i = ${MODULE_NAME}_sample(hs_uv, vec2( hs_t.x,  hs_t.y));

        float hs_cell = max(${MODULE_NAME}.cellSize, 1e-6);
        float hs_dzdx = ((hs_c + 2.0 * hs_f + hs_i) - (hs_a + 2.0 * hs_d + hs_g)) / (8.0 * hs_cell);
        // v は下向きに増えるので、北を上にするため符号を反転する
        float hs_dzdy = -((hs_g + 2.0 * hs_h + hs_i) - (hs_a + 2.0 * hs_b + hs_c)) / (8.0 * hs_cell);

        hs_dzdx *= ${MODULE_NAME}.zFactor;
        hs_dzdy *= ${MODULE_NAME}.zFactor;

        float hs_slope = atan(sqrt(hs_dzdx * hs_dzdx + hs_dzdy * hs_dzdy));
        float hs_aspect = atan(hs_dzdy, -hs_dzdx);

        float hs_zenith = radians(90.0 - ${MODULE_NAME}.altitude);
        float hs_az = radians(360.0 - ${MODULE_NAME}.azimuth + 90.0);

        float hs_shade =
          cos(hs_zenith) * cos(hs_slope) +
          sin(hs_zenith) * sin(hs_slope) * cos(hs_az - hs_aspect);
        hs_shade = clamp(hs_shade, 0.0, 1.0);

        color.rgb *= mix(1.0, hs_shade, ${MODULE_NAME}.strength);
      }
    `,
  },
  uniformTypes: {
    texelSize: "vec2<f32>",
    cellSize: "f32",
    zFactor: "f32",
    azimuth: "f32",
    altitude: "f32",
    strength: "f32",
  },
  getUniforms: (props: Partial<HillshadeProps>) => ({
    elevationTexture: props.elevationTexture,
    texelSize: props.texelSize ?? [0, 0],
    cellSize: props.cellSize ?? 1,
    zFactor: props.zFactor ?? 1,
    azimuth: props.azimuth ?? 315,
    altitude: props.altitude ?? 45,
    strength: props.strength ?? 1,
  }),
} as const satisfies ShaderModule<HillshadeProps>;
