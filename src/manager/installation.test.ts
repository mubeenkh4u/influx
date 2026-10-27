import { createPackage } from "@electron/asar";
import { afterEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { inspectArchive, installInflux, installationDiagnostics, installationStatus, restoreFluxerBackup, uninstallInflux } from "./installation";

const fixtures: string[] = [];

async function setup(): Promise<{ root: string; resources: string; core: string; data: string }> {
  const root = mkdtempSync(path.join(os.tmpdir(), "influx-manager-install-test-"));
  fixtures.push(root);
  const resources = path.join(root, "resources");
  const core = path.join(root, "core");
  const data = path.join(root, "userData");
  const original = path.join(root, "original");
  mkdirSync(resources);
  mkdirSync(core);
  mkdirSync(original);
  writeFileSync(path.join(original, "package.json"),
    JSON.stringify({ name: "fluxer_desktop", version: "1.0.0", main: "index.js" }));
  writeFileSync(path.join(original, "index.js"), "console.log('original Fluxer');\n");
  await createPackage(original, path.join(resources, "app.asar"));
  for (const file of ["main.js", "preload.js", "renderer.js"]) {
    writeFileSync(path.join(core, file), "// " + file + "\n");
  }
  return { root, resources, core, data };
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("installation preserves the original Fluxer app and adds Influx shim", async () => {
  const { resources, core, data } = await setup();
  const originalBytes = readFileSync(path.join(resources, "app.asar"));
  expect(installationStatus(resources).state).toBe("available");
  await installInflux(resources, core, data);
  expect(installationStatus(resources).state).toBe("installed");
  expect(readFileSync(path.join(resources, "_app.asar"))).toEqual(originalBytes);
  expect(existsSync(path.join(data, "dist", "renderer.js"))).toBe(true);
  uninstallInflux(resources);
  expect(installationStatus(resources).state).toBe("available");
  expect(readFileSync(path.join(resources, "app.asar"))).toEqual(originalBytes);
});

test("reinstall repairs the shim without touching original backup", async () => {
  const { resources, core, data } = await setup();
  await installInflux(resources, core, data);
  const originalBackup = readFileSync(path.join(resources, "_app.asar"));
  await installInflux(resources, core, data);
  expect(installationStatus(resources).state).toBe("installed");
  expect(readFileSync(path.join(resources, "_app.asar"))).toEqual(originalBackup);
  uninstallInflux(resources);
  expect(installationStatus(resources).state).toBe("available");
});

test("bad folders and corrupted states are refused", async () => {
  const { resources, core, data } = await setup();
  writeFileSync(path.join(resources, "_app.asar"), "stale backup");
  expect(installationStatus(resources).state).toBe("conflict");
  expect(installInflux(resources, core, data)).rejects.toThrow();
  expect(() => uninstallInflux(resources)).toThrow();
});

test("missing core assets cannot alter the Fluxer installation", async () => {
  const { resources, core, data } = await setup();
  const original = readFileSync(path.join(resources, "app.asar"));
  rmSync(path.join(core, "renderer.js"));
  expect(installInflux(resources, core, data)).rejects.toThrow();
  expect(readFileSync(path.join(resources, "app.asar"))).toEqual(original);
  expect(installationStatus(resources).state).toBe("available");
});

test("missing Fluxer backup is reported precisely without changing files", async () => {
  const { resources, core, data } = await setup();
  await installInflux(resources, core, data);
  rmSync(path.join(resources, "_app.asar"));
  const before = readFileSync(path.join(resources, "app.asar"));
  const status = installationStatus(resources);
  expect(status.state).toBe("broken");
  expect(status.details).toContain("file not found");
  const report = installationDiagnostics(resources);
  expect(report).toContain("_app.asar: file not found");
  expect(report).toContain("No files were modified");
  expect(readFileSync(path.join(resources, "app.asar"))).toEqual(before);
  expect(() => uninstallInflux(resources)).toThrow();
});

test("unreadable original backup is blocked with a concrete diagnosis", async () => {
  const { resources, core, data } = await setup();
  await installInflux(resources, core, data);
  writeFileSync(path.join(resources, "_app.asar"), "not an ASAR");
  const backup = inspectArchive(path.join(resources, "_app.asar"));
  expect(backup.kind).toBe("unreadable");
  expect(installationStatus(resources).state).toBe("broken");
  expect(installationDiagnostics(resources)).toContain("_app.asar: unreadable ASAR");
});

test("a genuine Fluxer backup can be explicitly restored without replacing the shim", async () => {
  const { root, resources, core, data } = await setup();
  await installInflux(resources, core, data);
  const clean = path.join(root, "clean.asar");
  copyFileSync(path.join(resources, "_app.asar"), clean);
  mkdirSync(clean + ".unpacked");
  writeFileSync(path.join(clean + ".unpacked", "native.txt"), "native");
  const shim = readFileSync(path.join(resources, "app.asar"));
  rmSync(path.join(resources, "_app.asar"));
  expect(installationStatus(resources).state).toBe("broken");
  const result = restoreFluxerBackup(resources, clean);
  expect(result.restored).toBe(path.join(resources, "_app.asar"));
  expect(result.preservedOldBackup).toBeUndefined();
  expect(readFileSync(path.join(resources, "_app.asar"))).toEqual(readFileSync(clean));
  expect(readFileSync(path.join(resources, "_app.asar.unpacked", "native.txt"), "utf8")).toBe("native");
  expect(readFileSync(path.join(resources, "app.asar"))).toEqual(shim);
  expect(installationStatus(resources).state).toBe("installed");
});

test("recovery preserves a damaged prior backup for manual investigation", async () => {
  const { root, resources, core, data } = await setup();
  await installInflux(resources, core, data);
  const clean = path.join(root, "matching-fluxer.asar");
  copyFileSync(path.join(resources, "_app.asar"), clean);
  writeFileSync(path.join(resources, "_app.asar"), "previous damaged backup");
  const result = restoreFluxerBackup(resources, clean);
  expect(result.preservedOldBackup).toBeDefined();
  expect(readFileSync(result.preservedOldBackup!, "utf8")).toBe("previous damaged backup");
  expect(installationStatus(resources).state).toBe("installed");
});

test("recovery refuses shim archives and does not overwrite existing files", async () => {
  const { resources, core, data } = await setup();
  await installInflux(resources, core, data);
  writeFileSync(path.join(resources, "_app.asar"), "prior damaged backup");
  const original = readFileSync(path.join(resources, "_app.asar"));
  expect(() => restoreFluxerBackup(resources, path.join(resources, "app.asar"))).toThrow();
  expect(readFileSync(path.join(resources, "_app.asar"))).toEqual(original);
  expect(installationStatus(resources).state).toBe("broken");
});

test("missing shim with intact backup cannot use the backup restore action", async () => {
  const { resources, core, data } = await setup();
  await installInflux(resources, core, data);
  rmSync(path.join(resources, "app.asar"));
  const status = installationStatus(resources);
  expect(status.state).toBe("broken");
  expect(status.recoveryAvailable).toBeUndefined();
  expect(() => restoreFluxerBackup(resources, path.join(resources, "_app.asar"))).toThrow();
});

test("an unrelated ASAR is not a trusted Fluxer backup", async () => {
  const { root, resources, core, data } = await setup();
  await installInflux(resources, core, data);
  const source = path.join(root, "foreign");
  mkdirSync(source);
  writeFileSync(path.join(source, "package.json"),
    JSON.stringify({ name: "other-chat", version: "1.0.0", main: "index.js" }));
  writeFileSync(path.join(source, "index.js"), "// other client");
  const foreign = path.join(root, "foreign.asar");
  await createPackage(source, foreign);
  copyFileSync(foreign, path.join(resources, "_app.asar"));
  expect(inspectArchive(path.join(resources, "_app.asar")).kind).toBe("unknown");
  expect(installationStatus(resources).state).toBe("broken");
  expect(installationDiagnostics(resources)).toContain("unrecognized package");
  expect(() => restoreFluxerBackup(resources, foreign)).toThrow();
  expect(readFileSync(path.join(resources, "_app.asar"))).toEqual(readFileSync(foreign));
});
