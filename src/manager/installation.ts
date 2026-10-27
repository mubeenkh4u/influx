import { createPackage, extractFile, uncache } from "@electron/asar";
import { randomBytes } from "node:crypto";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { influxDataDirectory } from "../shared/paths";

export interface FluxerInstallation {
  path: string;
  state: "available" | "installed" | "broken" | "conflict" | "missing";
  details: string;
}

const ASSETS = ["main.js", "preload.js", "renderer.js"] as const;


export interface ArchiveInfo {
  file: string;
  kind: "missing" | "shim" | "fluxer" | "unknown" | "unreadable";
  sizeBytes?: number;
  name?: string;
  productName?: string;
  version?: string;
  main?: string;
  error?: string;
}

export function inspectArchive(file: string): ArchiveInfo {
  const info: ArchiveInfo = { file, kind: "missing" };
  if (!existsSync(file)) return info;
  try {
    const stats = lstatSync(file);
    info.sizeBytes = stats.size;
    if (!stats.isFile()) throw new Error("Not a regular ASAR file");
    uncache(file);
    const value: unknown = JSON.parse(extractFile(file, "package.json").toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("ASAR package.json does not contain an object");
    const pkg = value as Record<string, unknown>;
    info.name = typeof pkg.name === "string" ? pkg.name : undefined;
    info.productName = typeof pkg.productName === "string" ? pkg.productName : undefined;
    info.version = typeof pkg.version === "string" ? pkg.version : undefined;
    info.main = typeof pkg.main === "string" ? pkg.main : undefined;
    if (info.name === "influx-shim") info.kind = "shim";
    else if (/fluxer/i.test(info.name ?? "") || /fluxer/i.test(info.productName ?? ""))
      info.kind = "fluxer";
    else info.kind = "unknown";
  } catch (error) {
    info.kind = "unreadable";
    info.error = error instanceof Error ? error.message : String(error);
  }
  return info;
}

function archiveDescription(info: ArchiveInfo): string {
  if (info.kind === "missing") return "file not found";
  if (info.kind === "unreadable") return "unreadable ASAR (" + info.error + ")";
  if (info.kind === "unknown")
    return "unrecognized package (" + (info.name ?? "no name") + ")";
  return info.kind === "shim" ? "Influx shim" : "Fluxer package (" + (info.name ?? "unnamed") + ")";
}

export function installationDiagnostics(resourcesDirectory: string): string {
  const directory = path.resolve(resourcesDirectory);
  const files = ["app.asar", "_app.asar"];
  try {
    const others = readdirSync(directory)
      .filter((name) => name.endsWith(".asar") && !files.includes(name)).sort().slice(0, 12);
    files.push(...others);
  } catch {
    // A missing or inaccessible resources directory is reported by inspectArchive.
  }
  const lines = [
    "Influx Manager - installation diagnostic (read-only)",
    "Resources directory: " + directory,
    "Status: " + installationStatus(directory).state,
    "Details: " + installationStatus(directory).details,
    "",
  ];
  for (const name of files) {
    const info = inspectArchive(path.join(directory, name));
    lines.push(name + ": " + archiveDescription(info));
    if (info.sizeBytes !== undefined) lines.push("  Size: " + info.sizeBytes + " bytes");
    if (info.name) lines.push("  Package: " + info.name);
    if (info.productName) lines.push("  Product: " + info.productName);
    if (info.version) lines.push("  Version: " + info.version);
    if (info.main) lines.push("  Entry point: " + info.main);
  }
  lines.push(
    "",
    "No files were modified by this diagnostic.",
    "If _app.asar is missing, recover a genuine matching Fluxer archive before reinstalling Influx.",
    "Never rename the Influx shim to _app.asar.",
  );
  return lines.join("\n");
}


export interface BackupRecoveryResult {
  restored: string;
  preservedOldBackup?: string;
}

export function restoreFluxerBackup(resourcesDirectory: string, candidatePath: string): BackupRecoveryResult {
  const resources = path.resolve(resourcesDirectory);
  const current = inspectArchive(path.join(resources, "app.asar"));
  if (current.kind !== "shim" || installationStatus(resources).state !== "broken")
    throw new Error("Recovery is only allowed for an Influx shim without a verified Fluxer backup");
  const candidate = path.resolve(candidatePath);
  const destination = path.join(resources, "_app.asar");
  if (candidate === path.join(resources, "app.asar") || candidate === destination)
    throw new Error("Select the genuine original Fluxer archive, not the shim or current backup");
  const original = inspectArchive(candidate);
  if (original.kind !== "fluxer" || !original.main)
    throw new Error("Selected file is not a verified Fluxer app.asar with an entry point");
  const companion = candidate + ".unpacked";
  if (existsSync(companion) && !lstatSync(companion).isDirectory())
    throw new Error("The selected archive has an invalid .unpacked companion folder");
  const suffix = Date.now().toString(36) + "-" + randomBytes(4).toString("hex");
  const staged = path.join(resources, ".influx-recovery-" + suffix + ".asar");
  const stagedUnpacked = staged + ".unpacked";
  const oldBackup = path.join(resources, ".influx-old-backup-" + suffix + ".asar");
  const oldUnpacked = oldBackup + ".unpacked";
  const destinationUnpacked = destination + ".unpacked";
  let movedOld = false;
  let movedOldUnpacked = false;
  let installed = false;
  let installedUnpacked = false;
  try {
    copyFileSync(candidate, staged);
    if (inspectArchive(staged).kind !== "fluxer")
      throw new Error("Staged Fluxer archive could not be verified");
    if (existsSync(companion)) cpSync(companion, stagedUnpacked, { recursive: true, force: false });
    if (existsSync(destination)) {
      renameSync(destination, oldBackup);
      movedOld = true;
    }
    if (existsSync(destinationUnpacked)) {
      renameSync(destinationUnpacked, oldUnpacked);
      movedOldUnpacked = true;
    }
    renameSync(staged, destination);
    installed = true;
    if (existsSync(stagedUnpacked)) {
      renameSync(stagedUnpacked, destinationUnpacked);
      installedUnpacked = true;
    }
    if (installationStatus(resources).state !== "installed")
      throw new Error("The recovered Fluxer archive failed final verification");
    return {
      restored: destination,
      preservedOldBackup: movedOld ? oldBackup : undefined,
    };
  } catch (error) {
    try {
      if (installedUnpacked) rmSync(destinationUnpacked, { recursive: true, force: true });
      if (installed) rmSync(destination, { force: true });
      if (movedOldUnpacked) renameSync(oldUnpacked, destinationUnpacked);
      if (movedOld) renameSync(oldBackup, destination);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError],
        "Backup recovery failed, and rollback requires manual inspection");
    }
    throw error;
  } finally {
    rmSync(staged, { force: true });
    rmSync(stagedUnpacked, { recursive: true, force: true });
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
  const current = inspectArchive(path.join(resources, "app.asar"));
  const backup = inspectArchive(path.join(resources, "_app.asar"));
  if (current.kind === "shim") {
    if (backup.kind === "fluxer")
      return { path: resources, state: "installed", details: "Influx shim installed; original Fluxer backup verified" };
    return {
      path: resources,
      state: "broken",
      details: "Influx shim is present, but _app.asar is " + archiveDescription(backup) +
        ". Use Inspect files to diagnose before making changes.",
    };
  }
  if (current.kind === "fluxer") {
    return backup.kind === "missing"
      ? { path: resources, state: "available", details: "Original Fluxer found; Influx is not installed" }
      : { path: resources, state: "conflict",
          details: "Original Fluxer found, but _app.asar also exists (" +
            archiveDescription(backup) + "). Inspect the files before reinstalling." };
  }
  if (current.kind === "missing" && backup.kind === "fluxer")
    return { path: resources, state: "broken",
      details: "Original Fluxer backup exists but app.asar is missing. Recovery is required." };
  if (current.kind === "missing" && backup.kind === "missing")
    return { path: resources, state: "missing", details: "No app.asar or _app.asar found" };
  return { path: resources, state: "conflict",
    details: "Unexpected app.asar: " + archiveDescription(current) +
      ". Existing files will not be overwritten." };
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

export function stageCoreFiles(
  coreDirectory: string, dataDirectory = influxDataDirectory(),
): string {
  const installDirectory = path.join(dataDirectory, "dist");
  installCoreFiles(coreDirectory, installDirectory);
  return path.join(installDirectory, "main.js");
}

export async function injectShim(resourcesDirectory: string, mainScript: string): Promise<void> {
  const status = installationStatus(resourcesDirectory);
  if (status.state !== "available" && status.state !== "installed")
    throw new Error(status.details);
  if (!existsSync(mainScript)) throw new Error("The Influx core main.js is missing");
  const directory = status.path;
  const active = path.join(directory, "app.asar");
  const backup = path.join(directory, "_app.asar");
  const unpacked = active + ".unpacked";
  const backupUnpacked = backup + ".unpacked";
  const previous = path.join(directory, ".influx-previous-" + process.pid + ".asar");
  const staged = path.join(directory, ".influx-next-" + process.pid + ".asar");
  const temporary = mkdtempSync(path.join(os.tmpdir(), "influx-manager-shim-"));
  let movedOriginal = false;
  let movedUnpacked = false;
  let movedShim = false;
  try {
    writeFileSync(path.join(temporary, "package.json"),
      JSON.stringify({ name: "influx-shim", main: "index.js" }));
    writeFileSync(path.join(temporary, "index.js"),
      "require(" + JSON.stringify(mainScript) + ");\n");
    await createPackage(temporary, staged);
    try {
      if (status.state === "available") {
        renameSync(active, backup);
        movedOriginal = true;
        if (existsSync(unpacked)) {
          renameSync(unpacked, backupUnpacked);
          movedUnpacked = true;
        }
      } else {
        renameSync(active, previous);
        movedShim = true;
      }
      renameSync(staged, active);
    } catch (error) {
      try {
        if (movedShim && existsSync(previous) && !existsSync(active))
          renameSync(previous, active);
        if (movedUnpacked) renameSync(backupUnpacked, unpacked);
        if (movedOriginal && !existsSync(active)) renameSync(backup, active);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Influx installation and rollback failed");
      }
      throw error;
    }
    if (movedShim) rmSync(previous, { force: true });
  } finally {
    rmSync(staged, { force: true });
    rmSync(temporary, { recursive: true, force: true });
  }
}

export async function installInflux(
  resourcesDirectory: string, coreDirectory: string,
  dataDirectory = influxDataDirectory(),
): Promise<void> {
  const state = installationStatus(resourcesDirectory).state;
  if (state !== "available" && state !== "installed")
    throw new Error("Fluxer must have a healthy installation before installing Influx");
  const mainScript = stageCoreFiles(coreDirectory, dataDirectory);
  await injectShim(resourcesDirectory, mainScript);
}

export function uninstallInflux(resourcesDirectory: string): void {
  const status = installationStatus(resourcesDirectory);
  if (status.state !== "installed")
    throw new Error("Uninstall requires a valid Influx installation and Fluxer backup");
  const directory = status.path;
  const active = path.join(directory, "app.asar");
  const backup = path.join(directory, "_app.asar");
  const previous = path.join(directory, ".influx-uninstall-" + process.pid + ".asar");
  renameSync(active, previous);
  try {
    renameSync(backup, active);
  } catch (error) {
    renameSync(previous, active);
    throw error;
  }
  const unpacked = backup + ".unpacked";
  if (existsSync(unpacked)) renameSync(unpacked, active + ".unpacked");
  rmSync(previous, { force: true });
}

export function installedCoreVersion(coreDirectory: string): string {
  return readdirSync(coreDirectory).filter((file) => ASSETS.includes(file as typeof ASSETS[number]))
    .length === ASSETS.length ? "Bundled Influx core" : "Incomplete core bundle";
}
