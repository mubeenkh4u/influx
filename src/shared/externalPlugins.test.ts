import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  enabledExternalPlugins,
  externalPluginsDirectory,
  importExternalPlugin,
  listExternalPlugins,
  setExternalPlugin,
} from "./externalPlugins";

const directories: string[] = [];
function fixture(): { data: string; source: string } {
  const data = mkdtempSync(path.join(os.tmpdir(), "influx-registry-"));
  const source = mkdtempSync(path.join(os.tmpdir(), "influx-source-"));
  directories.push(data, source);
  writeFileSync(path.join(source, "manifest.json"), JSON.stringify({
    id: "example-plugin", name: "Example", version: "1.0.0", apiVersion: 1,
    main: "index.js",
  }));
  writeFileSync(path.join(source, "index.js"), "window.Influx.registerPlugin({name:'Example'});");
  return { data, source };
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("imported plugins are untrusted until approved", () => {
  const { data, source } = fixture();
  expect(importExternalPlugin(source, data)).toBe("example-plugin");
  expect(listExternalPlugins(data)[0]?.status).toBe("untrusted");
  expect(enabledExternalPlugins(data)).toEqual([]);
  setExternalPlugin("example-plugin", "approve", data);
  expect(listExternalPlugins(data)[0]?.status).toBe("ready");
  expect(enabledExternalPlugins(data)[0]?.name).toBe("Example");
  setExternalPlugin("example-plugin", "disable", data);
  expect(enabledExternalPlugins(data)).toEqual([]);
  setExternalPlugin("example-plugin", "enable", data);
  expect(enabledExternalPlugins(data)).toHaveLength(1);
});

test("modifying approved code revokes execution until reapproved", () => {
  const { data, source } = fixture();
  importExternalPlugin(source, data);
  setExternalPlugin("example-plugin", "approve", data);
  writeFileSync(path.join(externalPluginsDirectory(data), "example-plugin", "index.js"), "changed();");
  expect(listExternalPlugins(data)[0]?.status).toBe("modified");
  expect(enabledExternalPlugins(data)).toHaveLength(0);
  expect(() => setExternalPlugin("example-plugin", "enable", data)).toThrow();
  setExternalPlugin("example-plugin", "approve", data);
  expect(enabledExternalPlugins(data)[0]?.code).toBe("changed();");
});

test("manifest traversal and symlink entries cannot be imported", () => {
  const { data, source } = fixture();
  const manifestFile = path.join(source, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  manifest.main = "../outside.js";
  writeFileSync(manifestFile, JSON.stringify(manifest));
  expect(() => importExternalPlugin(source, data)).toThrow();
  manifest.main = "index.js";
  writeFileSync(manifestFile, JSON.stringify(manifest));
  rmSync(path.join(source, "index.js"));
  symlinkSync(manifestFile, path.join(source, "index.js"));
  expect(() => importExternalPlugin(source, data)).toThrow();
});

test("invalid plugin is listed but not executed", () => {
  const { data } = fixture();
  const target = path.join(externalPluginsDirectory(data), "broken-plugin");
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, "manifest.json"), "{broken");
  expect(listExternalPlugins(data)[0]?.status).toBe("invalid");
  expect(enabledExternalPlugins(data)).toEqual([]);
});

test("import refuses duplicate ids and removal clears files and approval", () => {
  const { data, source } = fixture();
  importExternalPlugin(source, data);
  expect(() => importExternalPlugin(source, data)).toThrow();
  setExternalPlugin("example-plugin", "approve", data);
  setExternalPlugin("example-plugin", "remove", data);
  expect(listExternalPlugins(data)).toEqual([]);
  importExternalPlugin(source, data);
  expect(listExternalPlugins(data)[0]?.status).toBe("untrusted");
});
