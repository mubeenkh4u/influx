import definePlugin from "@api/Plugins";
import { definePluginSettings } from "@api/Settings";
import { filters, waitFor } from "@webpack/finders";

interface LimitOptions {
  key: string;
  fallback: number;
  context?: unknown;
  instanceDomain?: string;
}

interface LimitResolver {
  resolve(options: LimitOptions): number;
  resolveStock(key: string, fallback: number): number;
  resolveRestricted(key: string, fallback: number): number;
}

const settings = definePluginSettings({
  higherStreamQuality: {
    type: "boolean",
    description:
      "Offer higher-resolution and 60 FPS streams locally. Fluxer's instance and voice server may still enforce limits.",
    default: true,
  },
});

let active = false;
let resolver: LimitResolver | undefined;
let originalResolve: LimitResolver["resolve"] | undefined;
let patchedResolve: LimitResolver["resolve"] | undefined;

export function qualityLimitValue(key: string, actual: number, enabled: boolean): number {
  return key === "feature_higher_video_quality" && enabled ? Math.max(1, actual) : actual;
}

function install(resolved: LimitResolver): void {
  if (!active || resolver) return;
  const previous = resolved.resolve;
  if (typeof previous !== "function") return;

  const replacement: LimitResolver["resolve"] = function (this: LimitResolver, options) {
    const value = previous.call(this, options);
    return qualityLimitValue(options?.key, value, settings.store.higherStreamQuality);
  };

  try {
    resolved.resolve = replacement;
    if (resolved.resolve !== replacement) return;
  } catch {
    return;
  }

  resolver = resolved;
  originalResolve = previous;
  patchedResolve = replacement;
}

export default definePlugin({
  name: "FakePlutonium",
  description:
    "Unlocks local high-quality screen-share choices without changing account status or the instance bitrate ceiling.",
  authors: [{ name: "mubeenkh4u", id: "0" }],
  settings,

  start() {
    active = true;
    waitFor(filters.byProperties("resolve", "resolveStock", "resolveRestricted"), install);
  },

  stop() {
    active = false;
    if (resolver && originalResolve && resolver.resolve === patchedResolve) {
      resolver.resolve = originalResolve;
    }
    resolver = undefined;
    originalResolve = undefined;
    patchedResolve = undefined;
  },

  getStatus() {
    return {
      running: active,
      resolverHooked: resolver !== undefined && resolver.resolve === patchedResolve,
      higherStreamQuality: settings.store.higherStreamQuality,
    };
  },
});
