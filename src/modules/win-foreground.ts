/**
 * Bring a Zotero window to the foreground on Windows.
 *
 * Windows only lets the process that owns the foreground hand it to another
 * process. Word's Zotero plugin does that before asking for a citation;
 * WordCraft does not, so Zotero's own raise path (win.focus() plus
 * getAttention(), see Zotero.Utilities.Internal.activate) only flashes the
 * taskbar button, and Gecko's `alwaysRaised` orders the window among Gecko
 * windows only. This goes to user32 directly: attach our input queue to the
 * foreground window's thread (which lifts the restriction), raise and
 * activate, and if Windows still refuses, at least put the window on top of
 * the z-order with a TOPMOST/NOTOPMOST bounce.
 */

/** The user32/kernel32 calls used here; HWNDs are passed as numeric strings. */
export interface Win32Api {
  getForegroundWindow(): string;
  getWindowThreadId(hwnd: string): number;
  getCurrentThreadId(): number;
  attachThreadInput(from: number, to: number, attach: boolean): boolean;
  isIconic(hwnd: string): boolean;
  restore(hwnd: string): void;
  bringWindowToTop(hwnd: string): void;
  setForegroundWindow(hwnd: string): boolean;
  bounceTopmost(hwnd: string): void;
}

export type ForegroundOutcome = "already" | "activated" | "raised-only" | "unavailable";

let win32: Win32Api | null | undefined;

/** Parse nsIBaseWindow.nativeHandle ("0x00000000001A0B2C") into a decimal string. */
export function parseNativeHandle(handle: unknown): string | null {
  if (typeof handle !== "string" || !/^0x[0-9a-f]+$/i.test(handle.trim())) return null;
  const value = BigInt(handle.trim());
  return value === 0n ? null : value.toString();
}

function getNativeHandle(win: Window): string | null {
  try {
    const Ci = (globalThis as any).Components?.interfaces;
    const owner = (win as any).docShell?.treeOwner;
    if (!Ci?.nsIBaseWindow || !owner) return null;
    return parseNativeHandle(owner.QueryInterface(Ci.nsIBaseWindow).nativeHandle);
  } catch {
    return null;
  }
}

/** Run the foreground sequence against `hwnd`; separated from ctypes for tests. */
export function raiseWindow(api: Win32Api, hwnd: string): ForegroundOutcome {
  if (api.getForegroundWindow() === hwnd) return "already";
  if (api.isIconic(hwnd)) api.restore(hwnd);

  const foreground = api.getForegroundWindow();
  const foregroundThread = foreground !== "0" ? api.getWindowThreadId(foreground) : 0;
  const ourThread = api.getCurrentThreadId();
  const attached = foregroundThread !== 0 && foregroundThread !== ourThread &&
    api.attachThreadInput(ourThread, foregroundThread, true);
  try {
    api.bringWindowToTop(hwnd);
    api.setForegroundWindow(hwnd);
  } finally {
    if (attached) api.attachThreadInput(ourThread, foregroundThread, false);
  }

  if (api.getForegroundWindow() === hwnd) return "activated";
  api.bounceTopmost(hwnd);
  return "raised-only";
}

/**
 * Bring `win` to the foreground. Returns "unavailable" off Windows or when the
 * native handle or user32 cannot be reached, so callers keep their own focus().
 */
export function forceForeground(win: Window, api: Win32Api | null = loadWin32()): ForegroundOutcome {
  if (!api) return "unavailable";
  const hwnd = getNativeHandle(win);
  if (!hwnd) return "unavailable";
  try {
    const outcome = raiseWindow(api, hwnd);
    if (typeof Zotero !== "undefined") Zotero.debug("[InstantCite WordCraft] Foreground: " + outcome);
    return outcome;
  } catch (err) {
    if (typeof Zotero !== "undefined") Zotero.logError(err as Error);
    return "unavailable";
  }
}

function loadWin32(): Win32Api | null {
  if (win32 !== undefined) return win32;
  win32 = null;
  try {
    if (typeof Zotero === "undefined" || !Zotero.isWin) return null;
    const { ctypes } = (globalThis as any).ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const user32 = ctypes.open("user32.dll");
    const kernel32 = ctypes.open("kernel32.dll");
    const HWND = ctypes.uintptr_t;
    const BOOL = ctypes.int;
    const abi = ctypes.winapi_abi;

    const GetForegroundWindow = user32.declare("GetForegroundWindow", abi, HWND);
    const GetWindowThreadProcessId = user32.declare("GetWindowThreadProcessId", abi, ctypes.uint32_t, HWND, ctypes.voidptr_t);
    const AttachThreadInput = user32.declare("AttachThreadInput", abi, BOOL, ctypes.uint32_t, ctypes.uint32_t, BOOL);
    const IsIconic = user32.declare("IsIconic", abi, BOOL, HWND);
    const ShowWindow = user32.declare("ShowWindow", abi, BOOL, HWND, ctypes.int);
    const BringWindowToTop = user32.declare("BringWindowToTop", abi, BOOL, HWND);
    const SetForegroundWindow = user32.declare("SetForegroundWindow", abi, BOOL, HWND);
    const SetWindowPos = user32.declare("SetWindowPos", abi, BOOL,
      HWND, ctypes.intptr_t, ctypes.int, ctypes.int, ctypes.int, ctypes.int, ctypes.uint32_t);
    const GetCurrentThreadId = kernel32.declare("GetCurrentThreadId", abi, ctypes.uint32_t);

    const h = (hwnd: string) => ctypes.UInt64(hwnd);
    const SW_RESTORE = 9;
    const HWND_TOPMOST = -1;
    const HWND_NOTOPMOST = -2;
    const SWP_NOSIZE_NOMOVE_SHOW = 0x0001 | 0x0002 | 0x0040;

    win32 = {
      // 64-bit ctypes results come back as ctypes.UInt64, whose toString() is decimal.
      getForegroundWindow: () => String(GetForegroundWindow()),
      getWindowThreadId: hwnd => GetWindowThreadProcessId(h(hwnd), null),
      getCurrentThreadId: () => GetCurrentThreadId(),
      attachThreadInput: (from, to, attach) => AttachThreadInput(from, to, attach ? 1 : 0) !== 0,
      isIconic: hwnd => IsIconic(h(hwnd)) !== 0,
      restore: hwnd => { ShowWindow(h(hwnd), SW_RESTORE); },
      bringWindowToTop: hwnd => { BringWindowToTop(h(hwnd)); },
      setForegroundWindow: hwnd => SetForegroundWindow(h(hwnd)) !== 0,
      bounceTopmost: (hwnd) => {
        SetWindowPos(h(hwnd), HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE_NOMOVE_SHOW);
        SetWindowPos(h(hwnd), HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOSIZE_NOMOVE_SHOW);
      },
    };
  } catch (err) {
    if (typeof Zotero !== "undefined") Zotero.logError(err as Error);
    win32 = null;
  }
  return win32;
}
