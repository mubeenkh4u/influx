import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { influxDataDirectory } from "./paths";

const MAX_PLUGINS = 128;
const MAX_MANIFEST_BYTES = 32 * 1024;
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const PLUGIN_ID = /^[a-z][a-z0-9-]{1,63}$/;
const ENTRY_FILE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.js$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface ExternalPluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  main: string;
  apiVersion: number;
}

interface StoredPlugin {
  approvedHash?: string;
  enabled?: boolean;
}

interface Registry {
  version: 1;
  plugins: Record<string, StoredPlugin>;
}

export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  status: "ready" | "disabled" | "untrusted" | "modified" | "invalid";
  error?: string;
  fingerprint?: string;
}

export interface ExternalPluginBundle {
  id: string;
  name: string;
  version: string;
  code: string;
}

interface PluginContents {
  manifest: ExternalPluginManifest;
  manifestBytes: Buffer;
  scriptBytes: Buffer;
  hash: string;
}

export function externalPluginsDirectory(dataDirectory = influxDataDirectory()): string {
  return path.join(dataDirectory, "plugins");
}

function registryFile(dataDirectory: string): string {
  return path.join(dataDirectory, "plugins.json");
}

function validId(id: string): boolean {
  return PLUGIN_ID.test(id);
}

function readRegularFile(file: string, maxBytes: number): Buffer {
  const stats = lstatSync(file);
  if (!stats.isFile() || stats.size > maxBytes)
    throw new Error("File must be a regular file smaller than " + maxBytes + " bytes");
  return readFileSync(file);
}

function readContents(directory: string, expectedId?: string): PluginContents {
  if (!lstatSync(directory).isDirectory()) throw new Error("Plugin directory is not a folder");
  const manifestBytes = readRegularFile(path.join(directory, "manifest.json"), MAX_MANIFEST_BYTES);
  const input: unknown = JSON.parse(manifestBytes.toString("utf8"));
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid plugin manifest");
  const manifest = input as ExternalPluginManifest;
  if (typeof manifest.id !== "string" || !validId(manifest.id))
    throw new Error("Plugin id must use lowercase letters, digits and hyphens");
  if (expectedId && manifest.id !== expectedId)
    throw new Error("Manifest id must match the plugin folder name");
  if (typeof manifest.name !== "string" || !manifest.name.trim() || manifest.name.length > 80)
    throw new Error("Plugin name must contain 1 to 80 characters");
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version))
    throw new Error("Invalid plugin version");
  if (manifest.description !== undefined &&
      (typeof manifest.description !== "string" || manifest.description.length > 500))
    throw new Error("Invalid plugin description");
  if (manifest.apiVersion !== 1) throw new Error("Unsupported plugin API version");
  if (typeof manifest.main !== "string" || !ENTRY_FILE.test(manifest.main))
    throw new Error("Plugin main must be a JavaScript file in the plugin folder");
  const scriptBytes = readRegularFile(path.join(directory, manifest.main), MAX_SCRIPT_BYTES);
  if (scriptBytes.includes(0)) throw new Error("Plugin entry contains invalid binary data");
  const hash = createHash("sha256").update(manifestBytes).update(Buffer.from([0]))
    .update(scriptBytes).digest("hex");
  return { manifest, manifestBytes, scriptBytes, hash };
}

function readRegistry(dataDirectory: string): Registry {
  const file = registryFile(dataDirectory);
  if (!existsSync(file)) return { version: 1, plugins: {} };
  const parsed: unknown = JSON.parse(readRegularFile(file, MAX_MANIFEST_BYTES * 8).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid plugin registry");
  const value = parsed as Registry;
  if (value.version !== 1 || !value.plugins || typeof value.plugins !== "object" ||
      Array.isArray(value.plugins))
    throw new Error("Unsupported plugin registry");
  return value;
}

function saveRegistry(dataDirectory: string, registry: Registry): void {
  mkdirSync(dataDirectory, { recursive: true });
  const file = registryFile(dataDirectory);
  const temporary = file + "." + process.pid + "." + createHash("sha256")
    .update(randomBytes(16)).digest("hex").slice(0, 12) + ".tmp";
  try {
    writeFileSync(temporary, JSON.stringify(registry, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function pluginEntries(dataDirectory: string): Array<{ id: string; directory: string }> {
  const root = externalPluginsDirectory(dataDirectory);
  mkdirSync(root, { recursive: true });
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && validId(entry.name))
    .slice(0, MAX_PLUGINS)
    .map((entry) => ({ id: entry.name, directory: path.join(root, entry.name) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function inspect(dataDirectory: string): Array<{
  summary: PluginSummary;
  contents?: PluginContents;
}> {
  const registry = readRegistry(dataDirectory);
  return pluginEntries(dataDirectory).map(({ id, directory }) => {
    try {
      const contents = readContents(directory, id);
      const saved = Object.hasOwn(registry.plugins, id) ? registry.plugins[id] : undefined;
      const approved = saved?.approvedHash && SHA256.test(saved.approvedHash)
        ? saved.approvedHash : undefined;
      const status: PluginSummary["status"] = !approved ? "untrusted"
        : approved !== contents.hash ? "modified"
        : saved?.enabled ? "ready" : "disabled";
      return {
        summary: {
          id,
          name: contents.manifest.name,
          version: contents.manifest.version,
          description: contents.manifest.description ?? "",
          status,
          fingerprint: contents.hash,
        },
        contents,
      };
    } catch (error) {
      return {
        summary: {
          id, name: id, version: "", description: "",
          status: "invalid" as const,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });
}

export function listExternalPlugins(dataDirectory = influxDataDirectory()): PluginSummary[] {
  return inspect(dataDirectory).map((item) => item.summary);
}

export function enabledExternalPlugins(dataDirectory = influxDataDirectory()): ExternalPluginBundle[] {
  return inspect(dataDirectory)
    .filter((item) => item.summary.status === "ready" && item.contents)
    .map((item) => ({
      id: item.summary.id,
      name: item.contents!.manifest.name,
      version: item.contents!.manifest.version,
      code: item.contents!.scriptBytes.toString("utf8"),
    }));
}

export function setExternalPlugin(
  id: string,
  action: "approve" | "enable" | "disable" | "remove",
  dataDirectory = influxDataDirectory(),
): void {
  if (!validId(id)) throw new Error("Invalid plugin id");
  const registry = readRegistry(dataDirectory);
  const entry = inspect(dataDirectory).find((item) => item.summary.id === id);
  if (!entry) throw new Error("Plugin not found");
  if (action === "remove") {
    const folder = path.join(externalPluginsDirectory(dataDirectory), id);
    if (!lstatSync(folder).isDirectory()) throw new Error("Invalid plugin folder");
    rmSync(folder, { recursive: true });
    delete registry.plugins[id];
  } else {
    if (!entry.contents) throw new Error(entry.summary.error ?? "Invalid plugin");
    const saved = Object.hasOwn(registry.plugins, id) ? registry.plugins[id] : {};
    if (action === "approve") {
      saved.approvedHash = entry.contents.hash;
      saved.enabled = true;
    } else if (action === "enable") {
      if (saved.approvedHash !== entry.contents.hash)
        throw new Error("Plugin files changed. Approve them again.");
      saved.enabled = true;
    } else {
      saved.enabled = false;
    }
    registry.plugins[id] = saved;
  }
  saveRegistry(dataDirectory, registry);
}

export function importExternalPlugin(sourceDirectory: string, dataDirectory = influxDataDirectory()): string {
  const contents = readContents(sourceDirectory);
  const root = externalPluginsDirectory(dataDirectory);
  mkdirSync(root, { recursive: true });
  const destination = path.join(root, contents.manifest.id);
  if (existsSync(destination)) throw new Error("A plugin with that id already exists");
  const staging = mkdtempSync(path.join(root, ".import-"));
  try {
    writeFileSync(path.join(staging, "manifest.json"), contents.manifestBytes);
    writeFileSync(path.join(staging, contents.manifest.main), contents.scriptBytes);
    renameSync(staging, destination);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return contents.manifest.id;
}
