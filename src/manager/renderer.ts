import type { PluginSummary } from "../shared/externalPlugins";
import type { ManagerBridge, ManagerSnapshot } from "./types";

declare global {
  interface Window {
    InfluxManager: ManagerBridge;
  }
}

const elements = {
  version: document.getElementById("version")!,
  installation: document.getElementById("installation")!,
  installationPath: document.getElementById("installation-path")!,
  installationDetails: document.getElementById("installation-details")!,
  install: document.getElementById("install") as HTMLButtonElement,
  recoverBackup: document.getElementById("recover-backup") as HTMLButtonElement,
  uninstall: document.getElementById("uninstall") as HTMLButtonElement,
  plugins: document.getElementById("plugins")!,
  pluginCount: document.getElementById("plugin-count")!,
  pluginsPath: document.getElementById("plugins-path")!,
  notice: document.getElementById("notice")!,
};

const api = window.InfluxManager;
let current: ManagerSnapshot | null = null;
let busy = false;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, value?: string,
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  if (className) created.className = className;
  if (value !== undefined) created.textContent = value;
  return created;
}

function notify(message: string, error = false): void {
  elements.notice.textContent = message;
  elements.notice.className = error ? "notice error" : "notice";
  elements.notice.hidden = false;
}

async function perform(work: () => Promise<ManagerSnapshot | void>, success: string): Promise<void> {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  try {
    const next = await work();
    if (next) current = next;
    if (current) render(current);
    notify(success);
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error), true);
  } finally {
    busy = false;
    document.body.classList.remove("busy");
  }
}

function action(label: string, kind: string, handler: () => void): HTMLButtonElement {
  const button = element("button", "button " + kind, label);
  button.type = "button";
  button.addEventListener("click", handler);
  return button;
}

function pluginCard(plugin: PluginSummary): HTMLElement {
  const card = element("article", "plugin");
  const header = element("div", "plugin-header");
  const headline = element("div", "plugin-name-wrap");
  headline.append(element("h3", "", plugin.name));
  headline.append(element("span", "plugin-version", plugin.version ? "v" + plugin.version : "Unknown version"));
  header.append(headline);
  const status = element("span", "state state-" + plugin.status, plugin.status);
  header.append(status);
  card.append(header);
  card.append(element("p", "plugin-description",
    plugin.error || plugin.description || "No description provided."));
  const meta = element("div", "plugin-meta");
  meta.append(element("span", "", plugin.id));
  if (plugin.fingerprint) {
    const fingerprint = element("span", "", "SHA-256 " + plugin.fingerprint.slice(0, 12) + "…");
    fingerprint.title = plugin.fingerprint;
    meta.append(fingerprint);
  }
  card.append(meta);
  const buttons = element("div", "plugin-actions");
  if (plugin.status === "untrusted" || plugin.status === "modified") {
    buttons.append(action("Review and approve", "primary",
      () => void perform(() => api.plugin(plugin.id, "approve"),
        plugin.name + " approved. Restart Fluxer to load it.")));
  } else if (plugin.status === "ready") {
    buttons.append(action("Disable", "secondary",
      () => void perform(() => api.plugin(plugin.id, "disable"),
        plugin.name + " disabled. Restart Fluxer to apply.")));
  } else if (plugin.status === "disabled") {
    buttons.append(action("Enable", "primary",
      () => void perform(() => api.plugin(plugin.id, "enable"),
        plugin.name + " enabled. Restart Fluxer to load it.")));
  }
  buttons.append(action("Remove", "danger",
    () => void perform(() => api.plugin(plugin.id, "remove"),
      "Plugin operation finished. Restart Fluxer to apply.")));
  card.append(buttons);
  return card;
}

function render(snapshot: ManagerSnapshot): void {
  elements.version.textContent = "Manager v" + snapshot.version;
  elements.installation.textContent = snapshot.installation.state.replace("-", " ");
  elements.installation.className = "state state-" + snapshot.installation.state;
  elements.installationPath.textContent = snapshot.installation.path;
  elements.installationDetails.textContent = snapshot.installation.details;
  elements.pluginsPath.textContent = snapshot.pluginsPath;
  elements.install.disabled = !["available", "installed"].includes(snapshot.installation.state);
  elements.install.textContent =
    snapshot.installation.state === "installed" ? "Repair / Update Influx" : "Install Influx";
  elements.uninstall.disabled = snapshot.installation.state !== "installed";
  elements.recoverBackup.hidden = !snapshot.installation.recoveryAvailable;
  elements.plugins.replaceChildren();
  const ready = snapshot.plugins.filter((plugin) => plugin.status === "ready").length;
  elements.pluginCount.textContent = ready + " enabled / " + snapshot.plugins.length + " detected";
  if (snapshot.plugins.length === 0) {
    const empty = element("div", "empty");
    empty.append(element("h3", "", "No external plugins yet"));
    empty.append(element("p", "",
      "Import a plugin folder or copy one into the plugins directory. Approval is always required before first use."));
    elements.plugins.append(empty);
  } else {
    for (const plugin of snapshot.plugins) elements.plugins.append(pluginCard(plugin));
  }
}

function buttonHandler(id: string, handler: () => Promise<ManagerSnapshot | void>, message: string): void {
  document.getElementById(id)!.addEventListener("click", () =>
    void perform(handler, message));
}

buttonHandler("choose-fluxer", () => api.chooseFluxer(), "Fluxer installation selection updated.");
buttonHandler("reset-fluxer", () => api.resetFluxer(), "Automatic Fluxer detection restored.");
buttonHandler("install", () => api.install(), "Influx install/repair operation finished. Restart Fluxer.");
buttonHandler("inspect-files", () => api.diagnose(), "Diagnostic inspection completed.");
buttonHandler("open-resources", () => api.openResources(), "Fluxer resources folder opened.");
buttonHandler("recover-backup", () => api.recoverBackup(), "Recovery dialog completed. Check the installation status.");
buttonHandler("uninstall", () => api.uninstall(), "Fluxer restored. External plugin files were preserved.");
buttonHandler("import-plugin", () => api.importPlugin(), "Import dialog closed. Review any new plugin before approving.");
buttonHandler("open-plugins", () => api.openPlugins(), "Opened plugin folder.");
buttonHandler("open-logs", () => api.openLogs(), "Opened manager log.");
buttonHandler("refresh", () => api.snapshot(), "Plugin directory refreshed.");

void perform(() => api.snapshot(), "Manager is ready.");
