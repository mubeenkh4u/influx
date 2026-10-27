import type { PluginSummary } from "../shared/externalPlugins";
import type { FluxerInstallation } from "./installation";

export interface ManagerSnapshot {
  version: string;
  installation: FluxerInstallation;
  pluginsPath: string;
  plugins: PluginSummary[];
}

export interface ManagerBridge {
  snapshot(): Promise<ManagerSnapshot>;
  chooseFluxer(): Promise<ManagerSnapshot>;
  resetFluxer(): Promise<ManagerSnapshot>;
  importPlugin(): Promise<ManagerSnapshot>;
  plugin(id: string, action: "approve" | "enable" | "disable" | "remove"): Promise<ManagerSnapshot>;
  install(): Promise<ManagerSnapshot>;
  uninstall(): Promise<ManagerSnapshot>;
  diagnose(): Promise<void>;
  openResources(): Promise<void>;
  recoverBackup(): Promise<ManagerSnapshot>;
  openPlugins(): Promise<void>;
  openLogs(): Promise<void>;
}
