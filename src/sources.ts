export type SourceKind = "rgb" | "dem";

export type Source = {
  title: string;
  url: string;
  /**
   * `"rgb"` は COGLayer の既定パイプラインに任せる。
   * `"dem"` は Float32 1 バンド用の自前パイプライン（段彩 + 陰影）を使う。
   */
  kind: SourceKind;
  /** DEM のときの段彩の既定レンジ（m）。 */
  elevationRange?: [number, number];
  /** 出典表記。CC BY などで表示が要るものは必ず入れる。 */
  attribution?: string;
};

/** `.env` の VITE_COG_URL。R2 に置いた静岡市オルソを想定。 */
const ownCogUrl = import.meta.env.VITE_COG_URL as string | undefined;

/**
 * dev サーバーでは vite.config.ts の local-raster プラグインが
 * LOCAL_RASTER_DIR を /local/ 配下に Range 付きで配信する。
 * 手元で変換した COG をアップロード前に確認するための入口。
 */
const LOCAL_SHIZUOKA_PATH = "/local/deckgl-raster-test/data/shizuoka-aerial-cog.tif";

const SHIZUOKA_ATTRIBUTION =
  '出典: 静岡県「VIRTUAL SHIZUOKA 静岡県 中・西部 点群データ」(CC BY 4.0) を加工して作成';

const shizuoka = (url: string, label: string): Source => ({
  title: `静岡市 オルソ画像 0.2m ${label} — EPSG:6676`,
  kind: "rgb",
  attribution: SHIZUOKA_ATTRIBUTION,
  url,
});

/**
 * 一覧に出すのは手元で用意した COG だけ。変換が済んでいなかったり、
 * まだ R2 に上げていなかったりするので、初期表示では HEAD で存在を
 * 確かめてから選ぶ（main.ts の pickInitialSource）。
 */
export const SOURCES: Source[] = [
  ...(ownCogUrl ? [shizuoka(ownCogUrl, "(R2)")] : []),
  ...(import.meta.env.DEV ? [shizuoka(LOCAL_SHIZUOKA_PATH, "(ローカル)")] : []),
];
