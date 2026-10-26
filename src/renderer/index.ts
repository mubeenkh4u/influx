import pluginList from "~plugins";

import * as Gateway from "./api/Gateway";
import * as Plugins from "./api/Plugins";
import * as Settings from "./api/Settings";
import { Logger } from "./utils/Logger";
import * as common from "./webpack/common";
import * as finders from "./webpack/finders";
import * as webpack from "./webpack/patchWebpack";

const logger = new Logger("Core");

type ExternalBundle = { id: string; name: string; version: string; code: string };
let loadingExternal: ExternalBundle | null = null;
let externalRegistered = false;

const Influx = {
  version: INFLUX_VERSION,
  registerPlugin(plugin: Plugins.PluginDefinition): void {
    if (!loadingExternal || externalRegistered)
      throw new Error("External plugins may only register once during startup");
    if (plugin.name !== loadingExternal.name)
      throw new Error("External plugin name does not match the manifest");
    if (!Array.isArray(plugin.authors) || typeof plugin.description !== "string")
      throw new Error("External plugin requires a description and authors array");
    externalRegistered = true;
    Plugins.registerPlugins([{ ...plugin, externallyManaged: true }]);
  },
  plugins: Plugins.plugins,
  Plugins,
  Settings,
  Gateway,
  webpack: {
    ...finders,
    common,
    get webpackRequire() {
      return webpack.webpackRequire;
    },
    moduleCache: webpack.moduleCache,
    pendingPatches: Plugins.pendingPatches,
  },
};

declare global {
  interface Window {
    Influx: typeof Influx;
    __influxExternalPlugins?: ExternalBundle[];
  }
}

function evalAllowed(): boolean {
  try {
    return (0, eval)("true");
  } catch {
    return false;
  }
}

function registerExternalPlugins(): void {
  const bundles = window.__influxExternalPlugins ?? [];
  delete window.__influxExternalPlugins;
  for (const bundle of bundles) {
    loadingExternal = bundle;
    externalRegistered = false;
    try {
      (0, eval)(bundle.code + "\n//# sourceURL=influx-plugin-" + bundle.id + ".js");
      if (!externalRegistered) logger.error("No registration from external plugin " + bundle.id);
    } catch (error) {
      logger.error("Failed to load external plugin " + bundle.id, error);
    } finally {
      loadingExternal = null;
    }
  }
}

function initialize(): void {
  if (window.Influx) {
    logger.warn("Already loaded, skipping second injection");
    return;
  }
  window.Influx = Influx;

  Plugins.registerPlugins(pluginList);
  registerExternalPlugins();
  Plugins.pendingPatches.push(Gateway.gatewayPatch);
  if (evalAllowed()) {
    webpack.installWebpackHook(Plugins.pendingPatches);
  } else {
    logger.error(
      "The page's Content-Security-Policy blocks eval, so patches are disabled. " +
        "The extension or desktop injector should relax CSP. Check that it is installed correctly.",
    );
  }

  // Firefox fires DOMContentLoaded on a page that redirects before Fluxer's scripts run, but not load.
  window.addEventListener(
    "load",
    () => {
      if (!webpack.webpackRequire)
        logger.error("Never saw Fluxer's webpack runtime. Was Influx injected too late?");
    },
    { once: true },
  );

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      Plugins.startAllPlugins();
      logger.info(
        `Loaded version ${INFLUX_VERSION} with ${Object.keys(Plugins.plugins).length} plugins`,
      );
    },
    { once: true },
  );
}

initialize();
