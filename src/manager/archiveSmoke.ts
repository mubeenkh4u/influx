import { createPackage } from "@electron/asar";
import * as nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  inspectArchive,
  installInflux,
  installationStatus,
  restoreFluxerBackup,
  uninstallInflux,
} from "./installation";

export async function runPhysicalArchiveSmoke(): Promise<void> {
  const io: typeof nodeFs = process.versions.electron ? require("original-fs") : nodeFs;
  const root = io.mkdtempSync(path.join(os.tmpdir(), "influx-archive-smoke-"));
  try {
    const original = path.join(root, "original");
    const resources = path.join(root, "resources");
    const legacy = path.join(resources, "influx-original");
    const core = path.join(root, "core");
    const data = path.join(root, "user-data");
    for (const folder of [original, resources, legacy, core]) io.mkdirSync(folder);
    io.writeFileSync(path.join(original, "package.json"), JSON.stringify({
      name: "fluxer_desktop",
      version: "1.0.0",
      main: "index.js",
    }));
    io.writeFileSync(path.join(original, "index.js"), "console.log('synthetic Fluxer');\n");
    const physicalArchive = path.join(resources, "app.asar");
    await createPackage(original, physicalArchive);
    const originalInfo = inspectArchive(physicalArchive);
    if (originalInfo.kind !== "fluxer" || !originalInfo.sizeBytes ||
        !io.lstatSync(physicalArchive).isFile())
      throw new Error("Failed to detect physical Fluxer archive: " + JSON.stringify(originalInfo));
    io.copyFileSync(physicalArchive, path.join(legacy, "app.asar"));
    for (const filename of ["main.js", "preload.js", "renderer.js"])
      io.writeFileSync(path.join(core, filename), "// synthetic " + filename + "\n");
    await installInflux(resources, core, data);
    if (installationStatus(resources).state !== "installed" ||
        inspectArchive(physicalArchive).kind !== "shim")
      throw new Error("Failed to recognize installed Influx shim");
    io.unlinkSync(path.join(resources, "_app.asar"));
    const broken = installationStatus(resources);
    if (broken.state !== "broken" || !broken.recoveryAvailable ||
        inspectArchive(physicalArchive).kind !== "shim")
      throw new Error("Failed to diagnose missing backup without misidentifying the shim");
    restoreFluxerBackup(resources, path.join(legacy, "app.asar"));
    if (installationStatus(resources).state !== "installed")
      throw new Error("Failed to restore verified backup from legacy directory");
    uninstallInflux(resources);
    if (installationStatus(resources).state !== "available" ||
        inspectArchive(physicalArchive).kind !== "fluxer")
      throw new Error("Uninstall did not restore the physical original Fluxer archive");
  } finally {
    io.rmSync(root, { recursive: true, force: true });
  }
}
