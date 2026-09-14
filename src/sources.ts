export type Source = {
  title: string;
  url: string;
  /** 出典表記が必要なものだけ */
  attribution?: string;
};

/**
 * deck.gl-raster 公式 example (examples/cog-basic) で動作確認されている公開 COG。
 * どれも CORS と Range リクエストに対応している。
 */
export const REMOTE_SOURCES: Source[] = [
  {
    title: "Sentinel-2 TCI (New York, 2026) — EPSG:32618",
    url: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2026/1/S2B_18TWL_20260101_0_L2A/TCI.tif",
  },
  {
    title: "New Zealand 10m RGB — EPSG:2193（GPU再投影の確認）",
    url: "https://nz-imagery.s3-ap-southeast-2.amazonaws.com/new-zealand/new-zealand_2024-2025_10m/rgb/2193/CC11.tiff",
  },
  {
    title: "NLCD Land Cover 2023 — パレット画像 1.3GB",
    url: "https://ds-wheels.s3.us-east-1.amazonaws.com/Annual_NLCD_LndCov_2023_CU_C1V0.tif",
  },
  {
    title: "NAIP 空中写真 (New York, 2022)",
    url: "https://ds-wheels.s3.us-east-1.amazonaws.com/m_4007307_sw_18_060_20220803.tif",
  },
  {
    title: "Swisstopo 1:100万地形図 — EPSG:2056",
    url: "https://data.geo.admin.ch/ch.swisstopo.pixelkarte-farbe-pk1000.noscale/swiss-map-raster1000_1000/swiss-map-raster1000_1000_krel_50_2056.tif",
  },
  {
    title: "USGS 歴史地形図 (Kanab Point, AZ, 1962)",
    url: "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/AZ/AZ_Kanab%20Point_314712_1962_62500_geo.tif",
    attribution: "USGS Historical Topographic Map program",
  },
  {
    title: "Umbra SAR ロッテルダム港 — 回転アフィン変換の COG",
    url: "https://umbra-open-data-catalog.s3.amazonaws.com/sar-data/tasks/Port%20of%20Rotterdam%2C%20Netherlands/00864c2c-0b0f-49ef-b283-997735b27878/2025-07-29-11-17-12_UMBRA-08/2025-07-29-11-17-12_UMBRA-08_GEC.tif",
    attribution: "Umbra Open Data (registry.opendata.aws/umbra-open-data)",
  },
];

/** `.env` の VITE_COG_URL。R2 に置いた COG を想定。 */
const ownCogUrl = import.meta.env.VITE_COG_URL as string | undefined;

/**
 * dev サーバーでは vite.config.ts の local-raster プラグインが
 * LOCAL_RASTER_DIR を /local/ 配下に Range 付きで配信する。
 * ここでは URL 入力欄からいつでも指定できるので、既定の一覧には出さない。
 */
export const SOURCES: Source[] = [
  ...(ownCogUrl
    ? [{ title: "能登 CS立体図 COG（VITE_COG_URL）", url: ownCogUrl }]
    : []),
  ...REMOTE_SOURCES,
];
