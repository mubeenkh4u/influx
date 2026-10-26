import { createPackage } from "@electron/asar";
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { installInflux, installationStatus, uninstallInflux } from "./installation";

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
    JSON.stringify({ name: "fluxer-desktop", version: "1.0.0", main: "index.js" }));
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
