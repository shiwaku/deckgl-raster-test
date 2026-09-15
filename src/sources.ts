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
  /**
   * 初期表示に選ぶ前に HEAD で存在を確かめる。
   * 変換が終わっていない、まだアップロードしていない、といったことが
   * ありうる自前のソースに付ける。公式サンプルには要らない。
   */
  probe?: boolean;
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
  probe: true,
  url,
});

/**
 * deck.gl-raster 公式 example (examples/cog-basic) で動作確認されている公開 COG。
 * どれも CORS と Range リクエストに対応している。
 */
export const REMOTE_SOURCES: Source[] = [
  {
    title: "Sentinel-2 TCI (New York, 2026) — EPSG:32618",
    url: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2026/1/S2B_18TWL_20260101_0_L2A/TCI.tif",
    kind: "rgb",
  },
  {
    title: "New Zealand 10m RGB — EPSG:2193（GPU再投影の確認）",
    url: "https://nz-imagery.s3-ap-southeast-2.amazonaws.com/new-zealand/new-zealand_2024-2025_10m/rgb/2193/CC11.tiff",
    kind: "rgb",
  },
  {
    title: "NLCD Land Cover 2023 — パレット画像 1.3GB",
    url: "https://ds-wheels.s3.us-east-1.amazonaws.com/Annual_NLCD_LndCov_2023_CU_C1V0.tif",
    kind: "rgb",
  },
  {
    title: "NAIP 空中写真 (New York, 2022)",
    url: "https://ds-wheels.s3.us-east-1.amazonaws.com/m_4007307_sw_18_060_20220803.tif",
    kind: "rgb",
  },
  {
    title: "Swisstopo 1:100万地形図 — EPSG:2056",
    url: "https://data.geo.admin.ch/ch.swisstopo.pixelkarte-farbe-pk1000.noscale/swiss-map-raster1000_1000/swiss-map-raster1000_1000_krel_50_2056.tif",
    kind: "rgb",
  },
  {
    title: "USGS 歴史地形図 (Kanab Point, AZ, 1962)",
    url: "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/AZ/AZ_Kanab%20Point_314712_1962_62500_geo.tif",
    kind: "rgb",
    attribution: "USGS Historical Topographic Map program",
  },
  {
    title: "Umbra SAR ロッテルダム港 — 回転アフィン変換の COG",
    url: "https://umbra-open-data-catalog.s3.amazonaws.com/sar-data/tasks/Port%20of%20Rotterdam%2C%20Netherlands/00864c2c-0b0f-49ef-b283-997735b27878/2025-07-29-11-17-12_UMBRA-08/2025-07-29-11-17-12_UMBRA-08_GEC.tif",
    kind: "rgb",
    attribution: "Umbra Open Data (registry.opendata.aws/umbra-open-data)",
  },
];

export const SOURCES: Source[] = [
  ...(ownCogUrl ? [shizuoka(ownCogUrl, "(R2)")] : []),
  ...(import.meta.env.DEV ? [shizuoka(LOCAL_SHIZUOKA_PATH, "(ローカル)")] : []),
  ...REMOTE_SOURCES,
];
