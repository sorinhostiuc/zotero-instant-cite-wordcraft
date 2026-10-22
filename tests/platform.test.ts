import { describe, expect, it } from "vitest";
import {
  detectPlatform,
  getDefaultOfficeShortcut,
  isWordCraftSupported,
} from "../src/modules/platform";

describe("platform helpers", () => {
  it.each([
    ["WINNT", "windows"],
    ["Darwin", "macos"],
    ["Linux", "linux"],
    ["Android", "unsupported"],
  ] as const)("maps %s to %s", (os, expected) => {
    expect(detectPlatform(os)).toBe(expected);
  });

  it("uses Command on macOS and Control elsewhere", () => {
    expect(getDefaultOfficeShortcut("macos")).toBe("Cmd+Shift+I");
    expect(getDefaultOfficeShortcut("windows")).toBe("Ctrl+Shift+I");
    expect(getDefaultOfficeShortcut("linux")).toBe("Ctrl+Shift+I");
  });

  it("offers the WordCraft integration on desktop platforms", () => {
    expect(isWordCraftSupported("windows")).toBe(true);
    expect(isWordCraftSupported("macos")).toBe(true);
    expect(isWordCraftSupported("linux")).toBe(true);
    expect(isWordCraftSupported("unsupported")).toBe(false);
  });

});
