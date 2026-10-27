import { execFile } from "node:child_process";
import { accessSync, appendFileSync, constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

import {
  externalPluginsDirectory, importExternalPlugin, listExternalPlugins,
  setExternalPlugin,
} from "../shared/externalPlugins";
import { influxDataDirectory } from "../shared/paths";
import { findFluxer, installInflux, installationStatus, stageCoreFiles, uninstallInflux } from "./installation";
import type { ManagerSnapshot } from "./types";

let window: BrowserWindow | null = null;
let customResources: string | null = null;

const dataDirectory = influxDataDirectory();
const preferencesFile = path.join(dataDirectory, "manager.json");
const logFile = path.join(dataDirectory, "manager.log");
const runFile = promisify(execFile);

function requiresElevation(directory: string): boolean {
  if (process.platform !== "linux") return false;
  try {
    accessSync(directory, constants.W_OK);
    return false;
  } catch {
    return true;
  }
}

async function requestElevation(
  action: "install" | "uninstall", resources: string, mainScript?: string,
): Promise<void> {
  const helper = path.join(path.dirname(process.execPath), "influx-manager-helper");
  if (!existsSync(helper))
    throw new Error("The Linux administrator helper is missing from the manager package.");
  try {
    await runFile("pkexec", [helper, action, resources, ...(mainScript ? [mainScript] : [])], {
      timeout: 180_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      "Could not obtain administrator permission. Install a polkit authentication agent, " +
      "then retry. Details: " + String(error),
    );
  }
}

function record(message: string): void {
  try {
    mkdirSync(dataDirectory, { recursive: true });
    if (existsSync(logFile) && statSync(logFile).size > 2_000_000)
      renameSync(logFile, logFile + ".previous");
    appendFileSync(logFile, new Date().toISOString() + " " + message + "\n");
  } catch (error) {
    console.error("[Influx Manager] Logging failed", error);
  }
}

function loadPreferences(): void {
  try {
    const value: unknown = JSON.parse(readFileSync(preferencesFile, "utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const preferred = (value as { resources?: unknown }).resources;
      if (typeof preferred === "string" && preferred.length < 4096)
        customResources = preferred;
    }
  } catch {
    customResources = null;
  }
}

function storePreferences(): void {
  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(preferencesFile,
    JSON.stringify({ resources: customResources }, null, 2) + "\n", { mode: 0o600 });
}

function resourcesDirectory(): string {
  return customResources ?? findFluxer().path;
}

function snapshot(): ManagerSnapshot {
  return {
    version: app.getVersion(),
    installation: installationStatus(resourcesDirectory()),
    pluginsPath: externalPluginsDirectory(),
    plugins: listExternalPlugins(),
  };
}

function verifySender(event: Electron.IpcMainInvokeEvent): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
    throw new Error("Only the Influx Manager window can make this request");
}

function normalizeFolder(folder: string): string {
  const resolved = path.resolve(folder);
  if (resolved.endsWith(".app"))
    return path.join(resolved, "Contents", "Resources");
  if (existsSync(path.join(resolved, "resources")))
    return path.join(resolved, "resources");
  return resolved;
}

function registerHandlers(): void {
  ipcMain.handle("manager:snapshot", (event) => {
    verifySender(event);
    return snapshot();
  });
  ipcMain.handle("manager:choose-fluxer", async (event) => {
    verifySender(event);
    const result = await dialog.showOpenDialog(window!, {
      title: "Choose Fluxer's resources folder",
      properties: ["openDirectory"],
    });
    if (!result.canceled && result.filePaths[0]) {
      const candidate = normalizeFolder(result.filePaths[0]);
      if (installationStatus(candidate).state === "missing") {
        await dialog.showMessageBox(window!, {
          type: "warning", message: "That folder does not contain a supported Fluxer installation.",
          buttons: ["OK"],
        });
      } else {
        customResources = candidate;
        storePreferences();
        record("Selected Fluxer resources: " + candidate);
      }
    }
    return snapshot();
  });
  ipcMain.handle("manager:reset-fluxer", (event) => {
    verifySender(event);
    customResources = null;
    storePreferences();
    return snapshot();
  });
  ipcMain.handle("manager:import", async (event) => {
    verifySender(event);
    const picked = await dialog.showOpenDialog(window!, {
      title: "Import a plugin folder containing manifest.json and index.js",
      properties: ["openDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) return snapshot();
    const id = importExternalPlugin(picked.filePaths[0]);
    record("Imported plugin " + id + " (approval required)");
    return snapshot();
  });
  ipcMain.handle("manager:plugin", async (event, id: unknown, action: unknown) => {
    verifySender(event);
    if (typeof id !== "string" || !["approve", "enable", "disable", "remove"].includes(String(action)))
      throw new Error("Invalid plugin action");
    const existing = listExternalPlugins().find((plugin) => plugin.id === id);
    if (!existing) throw new Error("Plugin not found");
    if (action === "approve") {
      const result = await dialog.showMessageBox(window!, {
        type: "warning",
        title: "Approve executable plugin",
        message: "Trust and enable " + existing.name + "?",
        detail: "This plugin can execute code inside Fluxer. Review its files and source before approving.\n\nSHA-256 fingerprint:\n" +
          existing.fingerprint,
        buttons: ["Cancel", "Trust and enable"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (result.response !== 1) return snapshot();
    }
    if (action === "remove") {
      const result = await dialog.showMessageBox(window!, {
        type: "warning",
        message: "Delete plugin " + existing.name + "?",
        detail: "This removes the plugin's external folder and approval record. This cannot be undone.",
        buttons: ["Cancel", "Delete plugin"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (result.response !== 1) return snapshot();
    }
    setExternalPlugin(id, action as "approve" | "enable" | "disable" | "remove");
    record("Plugin " + id + ": " + action);
    return snapshot();
  });
  ipcMain.handle("manager:install", async (event) => {
    verifySender(event);
    const installation = installationStatus(resourcesDirectory());
    if (!["available", "installed"].includes(installation.state))
      throw new Error(installation.details);
    const answer = await dialog.showMessageBox(window!, {
      type: "question", message: "Have you completely exited Fluxer?",
      detail: "Installing or repairing modifies Fluxer's app.asar. Close all Fluxer processes first.",
      buttons: ["Cancel", "Fluxer is closed — continue"], defaultId: 0, cancelId: 0,
    });
    if (answer.response !== 1) return snapshot();
    const core = path.join(app.getAppPath(), "core");
    const resources = resourcesDirectory();
    if (requiresElevation(resources)) {
      const mainScript = stageCoreFiles(core);
      await requestElevation("install", resources, mainScript);
    } else {
      await installInflux(resources, core);
    }
    record("Installed or repaired Influx in " + installation.path);
    return snapshot();
  });
  ipcMain.handle("manager:uninstall", async (event) => {
    verifySender(event);
    const answer = await dialog.showMessageBox(window!, {
      type: "warning", message: "Remove Influx injection?",
      detail: "Close Fluxer first. The original Fluxer app will be restored. Your plugin files will remain on disk.",
      buttons: ["Cancel", "Restore Fluxer"], defaultId: 0, cancelId: 0,
    });
    if (answer.response !== 1) return snapshot();
    if (requiresElevation(resourcesDirectory())) {
      await requestElevation("uninstall", resourcesDirectory());
    } else {
      uninstallInflux(resourcesDirectory());
    }
    record("Uninstalled Influx from " + resourcesDirectory());
    return snapshot();
  });
  ipcMain.handle("manager:open-plugins", async (event) => {
    verifySender(event);
    mkdirSync(externalPluginsDirectory(), { recursive: true });
    const error = await shell.openPath(externalPluginsDirectory());
    if (error) throw new Error(error);
  });
  ipcMain.handle("manager:open-logs", async (event) => {
    verifySender(event);
    record("Opened manager log");
    const error = await shell.openPath(logFile);
    if (error) throw new Error(error);
  });
}

void app.whenReady().then(async () => {
  app.setName("Influx Manager");
  loadPreferences();
  registerHandlers();
  window = new BrowserWindow({
    width: 1050, height: 760, minWidth: 800, minHeight: 590,
    backgroundColor: "#0e111b", title: "Influx Manager",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      preload: path.join(app.getAppPath(), "preload.js"),
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("render-process-gone", (_, details) => record("Renderer crashed: " + details.reason));
  await window.loadFile(path.join(app.getAppPath(), "index.html"));
  if (process.argv.includes("--smoke-test")) {
    try {
      const result = await window.webContents.executeJavaScript(`({
        title: document.title,
        bridge: typeof window.InfluxManager?.snapshot === "function",
        installation: document.getElementById("installation")?.textContent,
        plugins: document.getElementById("plugin-count")?.textContent
      })`);
      if (result.title !== "Influx Manager" || !result.bridge || !result.installation || !result.plugins)
        throw new Error("Dashboard did not initialize: " + JSON.stringify(result));
      console.log("[Influx Manager] UI smoke test passed: " + JSON.stringify(result));
      app.exit(0);
    } catch (error) {
      console.error("[Influx Manager] UI smoke test failed", error);
      app.exit(1);
    }
    return;
  }
  record("Influx Manager started");
}).catch((error) => {
  record("Fatal startup error: " + String(error));
  dialog.showErrorBox("Influx Manager", String(error));
  app.quit();
});

app.on("window-all-closed", () => app.quit());
