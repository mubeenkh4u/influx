import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.dirname(import.meta.dir);
const appDirectory = path.join(root, "dist", "manager", "app");
const coreDirectory = path.join(appDirectory, "core");
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
  version: string;
};

await rm(appDirectory, { recursive: true, force: true });
await mkdir(coreDirectory, { recursive: true });

const desktopFiles = ["main.js", "preload.js", "renderer.js"] as const;
for (const filename of desktopFiles)
  await cp(path.join(root, "dist", "desktop", filename), path.join(coreDirectory, filename));

const main = await Bun.build({
  entrypoints: [
    path.join(root, "src/manager/main.ts"),
    path.join(root, "src/manager/preload.ts"),
  ],
  outdir: appDirectory,
  target: "node",
  format: "cjs",
  naming: "[name].js",
  external: ["electron", "original-fs"],
});
if (!main.success) {
  for (const message of main.logs) console.error(message);
  throw new Error("Manager main process build failed");
}

const renderer = await Bun.build({
  entrypoints: [path.join(root, "src/manager/renderer.ts")],
  outdir: appDirectory,
  target: "browser",
  format: "iife",
  naming: "renderer.js",
});
if (!renderer.success) {
  for (const message of renderer.logs) console.error(message);
  throw new Error("Manager renderer build failed");
}

for (const filename of ["index.html", "style.css"])
  await cp(path.join(root, "src/manager", filename), path.join(appDirectory, filename));

await writeFile(path.join(appDirectory, "package.json"),
  JSON.stringify({
    name: "influx-manager",
    productName: "Influx Manager",
    version,
    private: true,
    main: "main.js",
  }, null, 2) + "\n");

console.log("Influx Manager app built in dist/manager/app");
