import { rollupPluginHTML as html } from "@web/rollup-plugin-html";
import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { babel } from "@rollup/plugin-babel";
import terser from "@rollup/plugin-terser";
import proposalExplicitResourceManagement from "@babel/plugin-proposal-explicit-resource-management";

import { resolve } from "node:path";

export default {
  input: "index.html",
  output: {
    dir: "dist",
    format: "es",
    preserveModules: false,
  },
  plugins: [
    nodeResolve({}),

    // Configure TypeScript to target ES2022 for input
    typescript({
      tsconfig: "tsconfig.json",
      compilerOptions: {
        target: "es2022", // TypeScript input target
        module: "esnext",
      },
    }),

    // Then use Babel to transform ES2022 down to a more compatible version
    babel({
      babelHelpers: "bundled",
      presets: [
        [
          "@babel/preset-env",
          {
            targets: {
              browsers: [
                "last 2 Chrome versions",
                "last 2 Firefox versions",
                "last 2 Safari versions",
                "last 2 Edge versions",
                "not IE 11",
              ],
            },
            // Debug mode helps see what transforms are being applied
            // Set to false in production
            debug: true,
          },
        ],
      ],
      plugins: [proposalExplicitResourceManagement],
      // Only process JavaScript files
      extensions: [".js", ".ts", ".tsx"],
    }),

    html(),

    // Optionally minify the output for production
    terser(),
  ],
};
