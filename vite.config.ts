import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import type { Plugin } from "vite";
import { defineConfig, loadEnv } from "vite";

/**
 * 開発時にローカルの巨大ラスタを HTTP Range 付きで配信する。
 *
 * COG をブラウザで開くには Range リクエストが必須。Vite の静的配信では
 * プロジェクト外のパスを扱えないため、専用のミドルウェアを置く。
 * 本番ビルドには一切含まれない。
 */
function localRasterPlugin(rootDir: string | undefined): Plugin {
  return {
    name: "local-raster",
    apply: "serve",
    configureServer(server) {
      if (!rootDir) return;

      server.middlewares.use("/local", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
        const abs = normalize(join(rootDir, rel));

        // ディレクトリ外への脱出を防ぐ
        if (!abs.startsWith(normalize(rootDir) + sep)) {
          res.statusCode = 403;
          return res.end("Forbidden");
        }

        let size: number;
        try {
          const st = statSync(abs);
          if (!st.isFile()) return next();
          size = st.size;
        } catch {
          return next();
        }

        const type = extname(abs).toLowerCase() === ".json" ? "application/json" : "image/tiff";
        res.setHeader("Content-Type", type);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Access-Control-Allow-Origin", "*");

        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
        if (!range) {
          res.setHeader("Content-Length", String(size));
          if (req.method === "HEAD") return res.end();
          return createReadStream(abs).pipe(res);
        }

        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
          res.statusCode = 416;
          res.setHeader("Content-Range", `bytes */${size}`);
          return res.end();
        }

        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        res.setHeader("Content-Length", String(end - start + 1));
        if (req.method === "HEAD") return res.end();
        createReadStream(abs, { start, end }).pipe(res);
      });

      server.config.logger.info(`  ➜  Local rasters: serving ${rootDir} at /local/`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: "./",
    // @developmentseed/lzw-tiff-decoder (wasm) が top-level await を使うため
    // esnext でないと依存の事前バンドルで落ちる
    esbuild: { target: "esnext" },
    optimizeDeps: { esbuildOptions: { target: "esnext" } },
    build: { target: "esnext" },
    worker: { format: "es" },
    plugins: [localRasterPlugin(env.LOCAL_RASTER_DIR || undefined)],
    server: {
      // Windows では localhost だと IPv6 フォールバックで初回接続が遅くなることがある
      host: "127.0.0.1",
      port: 3000,
    },
  };
});
