// Build script for the library
import { build } from "esbuild";
import { existsSync, mkdirSync } from "node:fs";

if (!existsSync("./dist")) {
  mkdirSync("./dist");
}

console.log("🔨 Building library...");

try {
  await build({
    entryPoints: ["src/index.ts"],
    outdir: "dist",
    bundle: true,
    format: "esm",
    sourcemap: true,
    minify: false,
    platform: "neutral",
    target: "esnext"
  });
  console.log("✅ Build completed successfully!");
} catch (error) {
  console.error("❌ Build failed:", error);
  process.exit(1);
}
