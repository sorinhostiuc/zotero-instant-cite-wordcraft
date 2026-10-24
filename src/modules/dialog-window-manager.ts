import { getSearchDialogWindowSize } from "./preferences";
import { forceForeground } from "./win-foreground";

type DialogWindow = Window & {
  _instantCiteInitialized?: boolean;
};

const DIALOG_URL = "chrome://instantcitewc/content/instantcite.xhtml";
const DIALOG_NAME = "instantcitewc-search";

let persistentDialogWindow: DialogWindow | null = null;

function getDialogFeatures(raised = false): string {
  const { width, height } = getSearchDialogWindowSize();
  const features = `chrome,centerscreen,resizable=yes,width=${width},height=${height}`;
  return raised ? `${features},${getCitationRaiseFeature()}` : features;
}

/**
 * Same raise mode Zotero uses for its own citation dialog. It only orders the
 * window among Gecko windows; raising it above another app's window on
 * Windows is forceForeground's job.
 */
export function getCitationRaiseFeature(): string {
  try {
    if (!Zotero.isMac && Zotero.Prefs.get("integration.keepAddCitationDialogRaised")) {
      return "popup";
    }
  } catch { /* ignore */ }
  return "alwaysRaised";
}

function isLiveDialogWindow(win: DialogWindow | null): win is DialogWindow {
  return !!win && !(win as any).closed;
}

export function getPersistentDialogWindow(): DialogWindow | null {
  return isLiveDialogWindow(persistentDialogWindow) ? persistentDialogWindow : null;
}

export function clearPersistentDialogWindow(win?: Window) {
  if (!win || win === persistentDialogWindow) {
    persistentDialogWindow = null;
  }
}

/**
 * Zotero.Utilities.Internal.activate() brings the Zotero process forward on
 * macOS (Carbon) and X11; it registers a one-shot `load` listener for the
 * Carbon call, so it must run *before* the window finishes loading. On Windows
 * it only flashes the taskbar button, so loaded windows also go through
 * raiseLoadedWindow().
 */
function activateWindow(win: Window) {
  try {
    if (typeof Zotero !== "undefined") (Zotero as any)?.Utilities?.Internal?.activate?.(win);
  } catch { /* ignore */ }
}

/** Focus a loaded window and, on Windows, force it in front of other apps. */
function raiseLoadedWindow(win: Window) {
  try { win.focus(); } catch { /* ignore */ }
  forceForeground(win);
}

/** Raise an already loaded window to the foreground. */
function bringToForeground(win: Window) {
  activateWindow(win);
  raiseLoadedWindow(win);
}

// The native window may not be shown yet when `load` fires; try once more.
const FOREGROUND_RETRY_MS = 200;

/**
 * Open a new dialog window, cache it, and wire up its lifecycle. The window is
 * raised to the foreground, because a window opened while another app (Word,
 * LibreOffice, WordCraft) is frontmost otherwise loads behind it.
 */
function createDialogWindow(
  mainWindow: Window & { openDialog: (...args: any[]) => Window },
  onLoad: (win: Window) => void,
  raised = false,
): DialogWindow {
  const win = mainWindow.openDialog(DIALOG_URL, DIALOG_NAME, getDialogFeatures(raised)) as DialogWindow;
  persistentDialogWindow = win;
  // Before load: activate() needs to hook the window's load event itself.
  activateWindow(win);
  win.addEventListener("load", () => {
    raiseLoadedWindow(win);
    onLoad(win);
    try {
      win.setTimeout(() => { if (!(win as any).closed) raiseLoadedWindow(win); }, FOREGROUND_RETRY_MS);
    } catch { /* ignore */ }
  }, { once: true } as any);
  win.addEventListener("unload", () => clearPersistentDialogWindow(win), { once: true } as any);
  return win;
}

export function openOrReuseDialogWindow(
  mainWindow: Window & { openDialog: (...args: any[]) => Window },
  onLoad: (win: Window) => void,
): Window {
  const existing = getPersistentDialogWindow();
  if (existing) {
    bringToForeground(existing);
    return existing;
  }

  return createDialogWindow(mainWindow, onLoad);
}

export function openFreshDialogWindow(
  mainWindow: Window & { openDialog: (...args: any[]) => Window },
  onLoad: (win: Window) => void,
  options: { raised?: boolean } = {},
): Window {
  const existing = getPersistentDialogWindow();
  if (existing) {
    clearPersistentDialogWindow(existing);
    try { existing.close(); } catch { /* ignore */ }
  }

  return createDialogWindow(mainWindow, onLoad, options.raised);
}

export function sendDialogToBackground(win: Window) {
  try { win.blur(); } catch { /* ignore */ }
}

export function __resetPersistentDialogWindowForTests() {
  persistentDialogWindow = null;
}
