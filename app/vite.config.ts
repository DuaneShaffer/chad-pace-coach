import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

function serviceWorkerManifest(): Plugin {
  let outDir = "dist";
  return {
    name: "sw-precache-manifest",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const swPath = join(outDir, "sw.js");
      const files = listFiles(outDir)
        .filter((f) => f !== swPath)
        .map((f) => relative(outDir, f).split("\\").join("/"))
        .sort();
      const hash = createHash("sha256");
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const build = hash.digest("hex").slice(0, 12);
      const urls = ["./", ...files.filter((f) => f !== "index.html").map((f) => `./${f}`)];
      const source = readFileSync(swPath, "utf8")
        .replace('const BUILD_ID = "dev";', `const BUILD_ID = ${JSON.stringify(build)};`)
        .replace("const PRECACHE_URLS = [];", `const PRECACHE_URLS = ${JSON.stringify(urls)};`);
      writeFileSync(swPath, source);
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [serviceWorkerManifest(), ...(mode === "https" ? [basicSsl()] : [])],
  server: mode === "https" ? { host: true } : undefined,
}));
