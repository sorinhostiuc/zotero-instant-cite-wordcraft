import { describe, expect, it } from "vitest";
import { forceForeground, parseNativeHandle, raiseWindow, type Win32Api } from "../src/modules/win-foreground";

const OURS = "1704684";
const WORDCRAFT = "395620";

/** A desktop where WordCraft owns the foreground; `grants` decides whether SetForegroundWindow works. */
function fakeDesktop(grants: (attached: boolean) => boolean) {
  const calls: string[] = [];
  let foreground = WORDCRAFT;
  let attached = false;
  let iconic = true;
  const api: Win32Api = {
    getForegroundWindow: () => foreground,
    getWindowThreadId: hwnd => (hwnd === WORDCRAFT ? 7 : 0),
    getCurrentThreadId: () => 3,
    attachThreadInput: (from, to, attach) => {
      calls.push(`attach ${from}->${to} ${attach}`);
      attached = attach;
      return true;
    },
    isIconic: () => iconic,
    restore: () => { calls.push("restore"); iconic = false; },
    bringWindowToTop: () => { calls.push("top"); },
    setForegroundWindow: hwnd => {
      calls.push("setForeground");
      if (!grants(attached)) return false;
      foreground = hwnd;
      return true;
    },
    bounceTopmost: () => { calls.push("bounce"); },
  };
  return { api, calls };
}

describe("parseNativeHandle", () => {
  it("turns nsIBaseWindow.nativeHandle into a decimal HWND", () => {
    expect(parseNativeHandle("0x00000000001A02EC")).toBe(OURS);
    expect(parseNativeHandle("0x0")).toBeNull();
    expect(parseNativeHandle("")).toBeNull();
    expect(parseNativeHandle(undefined)).toBeNull();
  });
});

describe("raiseWindow", () => {
  it("activates through the foreground thread's input queue and detaches afterwards", () => {
    const { api, calls } = fakeDesktop(attached => attached);
    expect(raiseWindow(api, OURS)).toBe("activated");
    expect(calls).toEqual(["restore", "attach 3->7 true", "top", "setForeground", "attach 3->7 false"]);
  });

  it("falls back to a topmost bounce when Windows refuses the foreground", () => {
    const { api, calls } = fakeDesktop(() => false);
    expect(raiseWindow(api, OURS)).toBe("raised-only");
    expect(calls.at(-2)).toBe("attach 3->7 false");
    expect(calls.at(-1)).toBe("bounce");
  });

  it("does nothing when the window is already in front", () => {
    const { api, calls } = fakeDesktop(() => true);
    api.setForegroundWindow(OURS);
    calls.length = 0;
    expect(raiseWindow(api, OURS)).toBe("already");
    expect(calls).toEqual([]);
  });
});

describe("forceForeground", () => {
  it("is unavailable without user32 or a native handle", () => {
    const win = {} as Window;
    expect(forceForeground(win, null)).toBe("unavailable");
    expect(forceForeground(win, fakeDesktop(() => true).api)).toBe("unavailable");
  });
});
