import { contextBridge, ipcRenderer } from "electron";

import type { ManagerBridge } from "./types";

const bridge: ManagerBridge = {
  snapshot: () => ipcRenderer.invoke("manager:snapshot"),
  chooseFluxer: () => ipcRenderer.invoke("manager:choose-fluxer"),
  resetFluxer: () => ipcRenderer.invoke("manager:reset-fluxer"),
  importPlugin: () => ipcRenderer.invoke("manager:import"),
  plugin: (id, action) => ipcRenderer.invoke("manager:plugin", id, action),
  install: () => ipcRenderer.invoke("manager:install"),
  uninstall: () => ipcRenderer.invoke("manager:uninstall"),
  diagnose: () => ipcRenderer.invoke("manager:diagnose"),
  openResources: () => ipcRenderer.invoke("manager:open-resources"),
  recoverBackup: () => ipcRenderer.invoke("manager:recover-backup"),
  openPlugins: () => ipcRenderer.invoke("manager:open-plugins"),
  openLogs: () => ipcRenderer.invoke("manager:open-logs"),
};

contextBridge.exposeInMainWorld("InfluxManager", bridge);
