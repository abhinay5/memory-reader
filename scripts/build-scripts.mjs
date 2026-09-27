// Bundles the MV3 service worker (ES module) and the content script (IIFE) into dist/.
import { build } from "esbuild";

const common = { bundle: true, sourcemap: true, target: "chrome120", logLevel: "info" };

await build({ ...common, entryPoints: ["src/background/service-worker.ts"], outfile: "dist/background.js", format: "esm" });
await build({ ...common, entryPoints: ["src/content/index.ts"], outfile: "dist/content.js", format: "iife" });
