import { Glob, $ } from "bun"
import pkg from "./package.json"

await $`rm -rf dist`
const files = new Glob("./src/**/*.{ts,tsx}").scan()
for await (const file of files) {
  await Bun.build({
    format: "esm",
    outdir: "dist/esm",
    external: ["*"],
    root: "src",
    entrypoints: [file],
    sourcemap: "linked"
  })
}

await $`bun tsc --outDir dist/types --declaration --emitDeclarationOnly --declarationMap`