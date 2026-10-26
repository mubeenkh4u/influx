import path from "node:path";

export const ORIGINAL_ASAR_DIRECTORY = "influx-original";
export const ORIGINAL_ASAR_FILE = "app.asar";

export function fluxerArchivePaths(resourcesDirectory: string) {
  const live = path.join(resourcesDirectory, ORIGINAL_ASAR_FILE);
  const original = path.join(resourcesDirectory, ORIGINAL_ASAR_DIRECTORY, ORIGINAL_ASAR_FILE);
  const legacyOriginal = path.join(resourcesDirectory, "_app.asar");
  return { live, original, legacyOriginal };
}
