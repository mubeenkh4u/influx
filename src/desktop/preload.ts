import { contextBridge, ipcRenderer } from "electron";

import {
  FLUXER_APP_ORIGINS,
  IPC_GET_RENDERER,
  IPC_UPDATER_CHECK,
  IPC_UPDATER_INSTALL,
  IPC_UPDATER_RESTART,
} from "./constants";
import type { InfluxNative } from "./types";

if (process.isMainFrame && FLUXER_APP_ORIGINS.includes(location.origin)) {
  contextBridge.exposeInMainWorld("InfluxNative", {
    updater: {
      check: () => ipcRenderer.invoke(IPC_UPDATER_CHECK),
      install: () => ipcRenderer.invoke(IPC_UPDATER_INSTALL),
      restart: () => ipcRenderer.invoke(IPC_UPDATER_RESTART),
    },
  } satisfies InfluxNative);

  const payload: {
    renderer: string;
    plugins: Array<{ id: string; name: string; version: string; code: string }>;
  } = ipcRenderer.sendSync(IPC_GET_RENDERER);
  contextBridge.executeInMainWorld({
    func: (input) => {
      Object.defineProperty(window, "__influxExternalPlugins", {
        value: input.plugins,
        configurable: true,
      });
      try {
        (0, eval)(input.renderer + "\n//# sourceURL=influx-renderer.js");
      } finally {
        delete (window as typeof window & { __influxExternalPlugins?: unknown })
          .__influxExternalPlugins;
      }
    },
    args: [payload],
  });
}
