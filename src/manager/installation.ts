import { createPackage, extractFile } from "@electron/asar";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { influxDataDirectory } from "../shared/paths";

export interface FluxerInstallation {
  path: string;
  state: "available" | "installed" | "broken" | "conflict" | "missing";
  details: string;
}

const ASSETS = ["main.js", "preload.js", "renderer.js"] as const;

function originalPackage(asar: string): boolean {
  try {
    const pkg = JSON.parse(extractFile(asar, "package.json").toString("utf8")) as {
      name?: string; productName?: string;
    };
    return /fluxer/i.test(pkg.name ?? "") || /fluxer/i.test(pkg.productName ?? "");
  } catch {
    return false;
  }
}

function shim(asar: string): boolean {
  try {
    return (JSON.parse(extractFile(asar, "package.json").toString("utf8")) as { name?: string })
      .name === "influx-shim";
  } catch {
    return false;
  }
}

export function defaultFluxerPaths(): string[] {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return ["fluxer_desktop", "fluxer_desktop_canary"].map((name) =>
      path.join(base, name, "current", "resources"));
  }
  if (process.platform === "darwin")
    return ["Fluxer", "Fluxer Canary"].map((name) =>
      path.join("/Applications", name + ".app", "Contents", "Resources"));
  return ["/opt/Fluxer/resources", "/opt/fluxer/resources",
    "/opt/fluxer-canary/resources", "/usr/lib/Fluxer/resources",
    "/usr/lib/fluxer/resources"];
}

export function installationStatus(directory: string): FluxerInstallation {
  const resources = path.resolve(directory);
  const active = path.join(resources, "app.asar");
  const original = path.join(resources, "_app.asar");
  const hasActive = existsSync(active);
  const hasOriginal = existsSync(original);
  if (hasActive && shim(active)) {
    return hasOriginal && originalPackage(original)
      ? { path: resources, state: "installed", details: "Influx shim installed" }
      : { path: resources, state: "broken", details: "Influx shim exists but the Fluxer backup is missing or invalid" };
  }
  if (hasActive && originalPackage(active)) {
    return hasOriginal
      ? { path: resources, state: "conflict", details: "A backup exists alongside the original Fluxer app. Inspect before installing." }
      : { path: resources, state: "available", details: "Fluxer found. Influx is not installed." };
  }
  if (!hasActive && hasOriginal && originalPackage(original))
    return { path: resources, state: "broken", details: "Fluxer backup exists but app.asar is missing" };
  return { path: resources, state: "missing", details: "No valid Fluxer app.asar was found" };
}

export function findFluxer(): FluxerInstallation {
  const statuses = defaultFluxerPaths().map(installationStatus);
  return statuses.find((item) => item.state === "installed") ??
    statuses.find((item) => item.state === "available") ??
    statuses.find((item) => item.state === "broken" || item.state === "conflict") ??
    statuses[0];
}

function installCoreFiles(coreDirectory: string, outputDirectory: string): void {
  mkdirSync(outputDirectory, { recursive: true });
  for (const file of ASSETS) {
    const source = path.join(coreDirectory, file);
    if (!existsSync(source)) throw new Error("Manager bundle is missing core/" + file);
    if (readFileSync(source).length === 0) throw new Error("Empty core asset: " + file);
  }
  const staging = mkdtempSync(path.join(outputDirectory, ".core-"));
  try {
    for (const file of ASSETS) copyFileSync(path.join(coreDirectory, file), path.join(staging, file));
    for (const file of ASSETS) renameSync(path.join(staging, file), path.join(outputDirectory, file));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export async function installInflux(
  resourcesDirectory: string, coreDirectory: string,
  dataDirectory = influxDataDirectory(),
): Promise<void> {
  const status = installationStatus(resourcesDirectory);
  if (status.state !== "available" && status.state !== "installed")
    throw new Error(status.details);
  const directory = status.path;
  const installDirectory = path.join(influxDataDirectory(), "dist");
  installCoreFiles(coreDirectory, installDirectory);
  const temporary = mkdtempSync(path.join(os.tmpdir(), "influx-manager-shim-"));
  const staged = path.join(directory, ".influx-manager-shim.asar");
  try {
    writeFileSync(path.join(temporary, "package.json"),
      JSON.stringify({ name: "influx-shim", main: "index.js" }));
    writeFileSync(path.join(temporary, "index.js"),
      "require(" + JSON.stringify(path.join(installDirectory, "main.js")) + ");\n");
    await createPackage(temporary, staged);
    if (status.state === "available") {
      renameSync(path.join(directory, "app.asar"), path.join(directory, "_app.asar"));
      const unpacked = path.join(directory, "app.asar.unpacked");
      if (existsSync(unpacked))
        renameSync(unpacked, path.join(directory, "_app.asar.unpacked"));
    } else {
      rmSync(path.join(directory, "app.asar"), { force: true });
    }
    renameSync(staged, path.join(directory, "app.asar"));
  } finally {
    rmSync(staged, { force: true });
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function uninstallInflux(resourcesDirectory: string): void {
  const status = installationStatus(resourcesDirectory);
  if (status.state !== "installed")
    throw new Error("Uninstall requires a valid Influx installation and Fluxer backup");
  const directory = status.path;
  rmSync(path.join(directory, "app.asar"), { force: true });
  renameSync(path.join(directory, "_app.asar"), path.join(directory, "app.asar"));
  const unpacked = path.join(directory, "_app.asar.unpacked");
  if (existsSync(unpacked)) renameSync(unpacked, path.join(directory, "app.asar.unpacked"));
}

export function installedCoreVersion(coreDirectory: string): string {
  return readdirSync(coreDirectory).filter((file) => ASSETS.includes(file as typeof ASSETS[number]))
    .length === ASSETS.length ? "Bundled Influx core" : "Incomplete core bundle";
}
