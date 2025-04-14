#!/usr/bin/env zx
import { $, path, fs } from "zx";

/**
 * Script to generate package.json version from git tags
 * Updates the version field in package.json based on the latest git tag
 */

console.log("🔄 Updating package version from git tags...");

// Path to the package.json file
const packageJsonPath = path.resolve("./package.json");

try {
  // Check if we're in a git repository
  await $`git rev-parse --is-inside-work-tree`.quiet();

  // Try to get the latest tag
  const { stdout: tagOutput } = await $`git describe --tags --abbrev=0`.quiet();
  const latestTag = tagOutput.trim().replace(/^v/, "");

  // Read the current package.json
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
  const currentVersion = packageJson.version;
  packageJson.private = false;

  if (currentVersion !== latestTag) {
    // Update the version
    console.log(`📝 Updating version: ${currentVersion} → ${latestTag}`);
    packageJson.version = latestTag;

    // Write the updated package.json
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    console.log("✅ Package version updated successfully!");
  } else {
    console.log(`✓ Package version is already up to date (${currentVersion})`);
  }
} catch (error) {
  if (error.exitCode === 128) {
    console.warn("⚠️  Not a git repository or no tags found");
    console.log("ℹ️  Skipping version update");
  } else if (error.stderr?.includes("fatal: No names found")) {
    console.warn("⚠️  No git tags found in the repository");
    console.log("ℹ️  Skipping version update");
  } else {
    console.error("❌ Error updating package version:");
    if (error.stdout) console.error(error.stdout.trim());
    if (error.stderr) console.error(error.stderr.trim());
    process.exit(1);
  }
}

// Generate build information
console.log("\n📊 Build Information:");
console.log("─".repeat(60));

// Get package details
try {
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
  console.log(` Package   | ${packageJson.name}`);
  console.log(` Version   | ${packageJson.version}`);

  // Get git information
  try {
    const { stdout: branchOutput } =
      await $`git rev-parse --abbrev-ref HEAD`.quiet();
    const branch = branchOutput.trim();
    console.log(` Branch    | ${branch}`);

    const { stdout: commitOutput } =
      await $`git rev-parse --short HEAD`.quiet();
    const commit = commitOutput.trim();
    console.log(` Commit    | ${commit}`);

    const { stdout: dateOutput } =
      await $`git log -1 --format=%cd --date=format:"%Y-%m-%d %H:%M:%S"`.quiet();
    const date = dateOutput.trim();
    console.log(` Date      | ${date}`);
  } catch (error) {
    console.log(" Git info  | Not available");
  }

  // Node version
  const { stdout: nodeOutput } = await $`node --version`.quiet();
  console.log(` Node      | ${nodeOutput.trim()}`);

  // Check dependencies
  const hasDeps = Object.keys(packageJson.dependencies || {}).length > 0;
  const hasDevDeps = Object.keys(packageJson.devDependencies || {}).length > 0;
  console.log(
    ` Deps      | ${hasDeps ? Object.keys(packageJson.dependencies || {}).length : "None"}`,
  );
  console.log(
    ` Dev Deps  | ${hasDevDeps ? Object.keys(packageJson.devDependencies || {}).length : "None"}`,
  );
} catch (error) {
  console.error("❌ Error reading package information");
}

console.log("─".repeat(60));
console.log("✨ Build information generated successfully!");
