import { createPackage } from "@electron/asar";
import { chmod, cp, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const root = path.dirname(import.meta.dir);
const platform = process.platform;
if (platform !== "win32" && platform !== "linux")
  throw new Error("Windows and Linux packaging are supported by this script");

const source = path.join(root, "node_modules", "electron", "dist");
try {
  await stat(path.join(source, platform === "win32" ? "electron.exe" : "electron"));
} catch {
  throw new Error("Electron binary is missing. Install dependencies without ELECTRON_SKIP_BINARY_DOWNLOAD.");
}
const output = path.join(root, "dist", "manager", "packages",
  "influx-manager-" + platform + "-" + process.arch);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });

const resources = path.join(output, "resources");
await mkdir(resources, { recursive: true });
await rm(path.join(resources, "default_app.asar"), { force: true });
await createPackage(path.join(root, "dist", "manager", "app"), path.join(resources, "app.asar"));

const executable = platform === "win32" ? "Influx Manager.exe" : "influx-manager";
await rename(path.join(output, platform === "win32" ? "electron.exe" : "electron"),
  path.join(output, executable));
if (platform === "linux") await chmod(path.join(output, executable), 0o755);
console.log("Packaged " + output);
