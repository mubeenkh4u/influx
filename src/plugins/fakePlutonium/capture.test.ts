import { describe, expect, it } from "bun:test";

import { shouldEnhanceMonitorCapture, suggestCaptureUpgrade } from "./capture";

describe("FakePlutonium safe display capture enhancement", () => {
  it("targets 3840x1080 for the measured ultrawide source under 125% scaling", () => {
    expect(suggestCaptureUpgrade(
      { width: 2708, height: 762 },
      { width: 4096, height: 1152 },
      1.25,
      60,
    )).toEqual({ width: 3840, height: 1080, frameRate: 60 });
  });

  it("proposes 4K capture for a full 4K monitor previously captured at 1080p", () => {
    expect(suggestCaptureUpgrade(
      { width: 1920, height: 1080 },
      { width: 3840, height: 2160 },
      1,
      60,
    )).toEqual({ width: 3840, height: 2160, frameRate: 60 });
  });

  it("does not upscale 1080p monitors or nearly-native tracks", () => {
    expect(suggestCaptureUpgrade(
      { width: 1920, height: 1080 },
      { width: 1920, height: 1080 },
      1,
      60,
    )).toBeNull();
    expect(suggestCaptureUpgrade(
      { width: 3620, height: 1018 },
      { width: 4096, height: 1152 },
      1.25,
      60,
    )).toBeNull();
  });

  it("never guesses capture geometry for a mismatched secondary monitor", () => {
    expect(suggestCaptureUpgrade(
      { width: 1280, height: 720 },
      { width: 4096, height: 1152 },
      1.25,
      60,
    )).toBeNull();
  });

  it("rejects invalid sizes and clamps requested fps", () => {
    expect(suggestCaptureUpgrade(
      { width: 0, height: 720 },
      { width: 3840, height: 2160 },
      1,
      60,
    )).toBeNull();
    expect(suggestCaptureUpgrade(
      { width: 1920, height: 1080 },
      { width: 3840, height: 2160 },
      1,
      120,
    )?.frameRate).toBe(60);
  });

  it("only enhances explicit desktop custom Source monitor shares", () => {
    const allowed = shouldEnhanceMonitorCapture(true, "monitor", "custom", "source", true, true);
    expect(allowed).toBe(true);
    expect(shouldEnhanceMonitorCapture(false, "monitor", "custom", "source", true, true)).toBe(false);
    expect(shouldEnhanceMonitorCapture(true, "window", "custom", "source", true, true)).toBe(false);
    expect(shouldEnhanceMonitorCapture(true, "monitor", "gaming", "ultra", true, true)).toBe(false);
    expect(shouldEnhanceMonitorCapture(true, "monitor", "custom", "source", false, true)).toBe(false);
    expect(shouldEnhanceMonitorCapture(true, "monitor", "custom", "source", true, false)).toBe(false);
  });
});
