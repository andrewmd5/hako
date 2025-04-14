#!/usr/bin/env zx
import { $, path, fs } from "zx";
/**
 * Build script for Hako WASM module
 * Creates both debug and release variants
 * Also generates TypeScript files with the WASM bytes
 * Then removes the .wasm files from the dist folder
 */
// Configure build variants
const variants = [
  {
    name: "debug",
    buildType: "Debug",
    outputName: "hako-debug.wasm",
    clean: true,
  },
  {
    name: "release",
    buildType: "Release",
    outputName: "hako.wasm",
    clean: true,
  },
];

const exportGenerator = path.resolve("../../tools/gen.py");
const exportDir = path.resolve("./src/etc");
const headerFile = path.resolve("../../bridge/hako.h");
// Path to the build script
const buildScript = path.resolve("../../tools/build.sh");
// Create output directory for builds
const outputDir = path.resolve("./dist");
await fs.mkdir(outputDir, { recursive: true });

// Create src/variants directory for TypeScript files
const srcVariantsDir = path.resolve("./src/variants");
await fs.mkdir(srcVariantsDir, { recursive: true });

console.log("🏗️  Starting Hako WASM builds...");
const results =
  await $`python3 ${exportGenerator} ${headerFile} ${exportDir}/ffi.ts`;
if (results.exitCode !== 0) {
  console.error("❌ Failed to run export generator");
  process.exit(1);
}
// Build each variant
for (const variant of variants) {
  console.log(`\n📦 Building ${variant.name} variant...`);
  try {
    // Run the build script with appropriate parameters
    await $`${buildScript} \
      --build-type=${variant.buildType} \
      --output=${variant.outputName} \
      ${variant.clean ? "--clean" : ""}`;
    // Get the path to the built file
    const buildDir = path.resolve("../../bridge/build");
    const builtFile = path.join(buildDir, variant.outputName);
    // Copy the built file to our output directory  
    const destFile = path.join(outputDir, variant.outputName);
    await fs.copyFile(builtFile, destFile);

    // Read the WASM file bytes
    const wasmBytes = await fs.readFile(destFile);

    // Generate TypeScript file with the WASM bytes
    const tsFilename = `${path.basename(variant.outputName, ".wasm")}.g.ts`;
    const tsFilePath = path.join(srcVariantsDir, tsFilename);

    // Create TypeScript content with byte array
    const tsContent = `/**
 * Auto-generated file containing the ${variant.name} WASM binary
 * Generated on: ${new Date().toISOString()}
 * DO NOT EDIT
 */
import type {Base64} from "../etc/types";
const variant = "${wasmBytes.toString("base64")}" as Base64;
export default variant;
`;

    // Write the TypeScript file
    await fs.writeFile(tsFilePath, tsContent);

    // Get file size for logging
    const stats = await fs.stat(destFile);
    const fileSizeKB = Math.round(stats.size / 1024);
    console.log(
      `✅ ${variant.name} build completed: ${destFile} (${fileSizeKB} KB)`,
    );
    console.log(`✅ Generated TypeScript file: ${tsFilePath}`);
  } catch (error) {
    console.error(`❌ Failed to build ${variant.name} variant:`);
    // Extract and display just the error message, not the whole object
    if (error.stdout) console.error(error.stdout.trim());
    if (error.stderr) console.error(error.stderr.trim());
    process.exit(1);
  }
}
console.log("\n🎉 All builds completed successfully!");
console.log(`📁 Output directory: ${outputDir}`);
console.log(`📁 TypeScript files: ${srcVariantsDir}`);
// Print a summary of the builds
console.log("\n📊 Build Summary:");
console.log("─".repeat(60));
console.log(" Variant  | Size (KB) | WASM Path | TypeScript Path");
console.log("─".repeat(60));
for (const variant of variants) {
  const filePath = path.join(outputDir, variant.outputName);
  const tsFilename = `${path.basename(variant.outputName, ".wasm")}.g.ts`;
  const tsFilePath = path.join(srcVariantsDir, tsFilename);

  try {
    const stats = await fs.stat(filePath);
    const fileSizeKB = Math.round(stats.size / 1024);
    console.log(
      ` ${variant.name.padEnd(8)} | ${fileSizeKB.toString().padEnd(9)} | ${filePath} | ${tsFilePath}`,
    );
  } catch (error) {
    console.log(
      ` ${variant.name.padEnd(8)} | Failed    | ${filePath} | ${tsFilePath}`,
    );
  }
}
console.log("─".repeat(60));

// Remove .wasm files from dist folder
console.log("\n🧹 Cleaning up WASM files from dist folder...");
try {
  const files = await fs.readdir(outputDir);
  const wasmFiles = files.filter((file) => file.endsWith(".wasm"));

  if (wasmFiles.length === 0) {
    console.log("ℹ️ No .wasm files found in the dist folder.");
  } else {
    for (const file of wasmFiles) {
      const filePath = path.join(outputDir, file);
      await fs.unlink(filePath);
      console.log(`✅ Removed: ${filePath}`);
    }
    console.log(
      `\n🎉 Successfully removed ${wasmFiles.length} .wasm file(s) from the dist folder.`,
    );
  }
} catch (error) {
  console.error("❌ Failed to clean up .wasm files:", error.message);
}
