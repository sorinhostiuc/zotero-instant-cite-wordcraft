import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/search-dialog", () => ({
  openSearchDialogForCitation: vi.fn(),
  prepareSearchDialogForPendingCitation: vi.fn(),
}));

vi.mock("../src/modules/preferences", () => ({
  isInterceptCitations: vi.fn(() => true),
  isWordCraftOnly: vi.fn(() => true),
}));

vi.mock("../src/modules/wordcraft-detector", () => ({
  isWordCraftSession: vi.fn(async () => true),
}));

import { prepareSearchDialogForPendingCitation } from "../src/modules/search-dialog";
import { isWordCraftOnly } from "../src/modules/preferences";
import { isWordCraftSession } from "../src/modules/wordcraft-detector";
import {
  loadDocumentItemIdsFromCitationIO,
  patchCitationDialog,
  resetDocumentItemIds,
  unpatchCitationDialog,
} from "../src/modules/integration-patch";

describe("integration patch document citation loading", () => {
  it("can return seeded citation IDs without awaiting the full document scan", async () => {
    resetDocumentItemIds(new Set([7, 8]));

    let fullScanResolved = false;
    const fullScanPromise = new Promise(resolve => {
      setTimeout(() => {
        fullScanResolved = true;
        resolve({ "99": [] });
      }, 25);
    });

    const ids = await (loadDocumentItemIdsFromCitationIO as any)(
      { _citationsByItemIDPromise: fullScanPromise },
      { waitForFullScan: false },
    );

    expect([...ids]).toEqual([7, 8]);
    expect(fullScanResolved).toBe(false);
  });

  it("still loads full document citation IDs when explicitly requested", async () => {
    resetDocumentItemIds(new Set([7, 8]));

    const ids = await loadDocumentItemIdsFromCitationIO({
      _citationsByItemIDPromise: Promise.resolve({ "99": [], "100": [] }),
    });

    expect([...ids]).toEqual([99, 100]);
  });
});

describe("integration patch addCitation fast path", () => {
  function installFakeZotero(originalAddCitation = vi.fn()) {
    function Interface() {}
    Interface.prototype.addCitation = originalAddCitation;

    (globalThis as any).Zotero = {
      Integration: {
        displayDialog: vi.fn(),
        Interface,
      },
      log: vi.fn(),
    };

    return { Interface, originalAddCitation };
  }

  it("brings the existing InstantCite window forward before Zotero prepares citation IO", async () => {
    const { Interface } = installFakeZotero(vi.fn(async function () {}));
    patchCitationDialog();

    const session = {
      data: { prefs: { fieldType: "Field", delayCitationUpdates: false } },
      style: {},
      cite: vi.fn(async () => [{ field: {}, fieldIndex: 0 }]),
      updateDocument: vi.fn(),
    };
    const doc = {
      cursorInField: vi.fn(async () => null),
    };

    await Interface.prototype.addCitation.call({ _doc: doc, _session: session });

    expect(prepareSearchDialogForPendingCitation).toHaveBeenCalledTimes(1);
  });

  it("initializes the session before probing for an existing citation field", async () => {
    const originalAddCitation = vi.fn(async function () {});
    const { Interface } = installFakeZotero(originalAddCitation);
    patchCitationDialog();

    const session = {
      data: { prefs: { delayCitationUpdates: false } },
      init: vi.fn(async function () {
        session.data.prefs.fieldType = "Field";
      }),
      style: {},
      cite: vi.fn(async () => [{ field: {}, fieldIndex: 0 }]),
      updateDocument: vi.fn(),
    };
    const docField = { existing: true };
    const doc = {
      cursorInField: vi.fn(async (fieldType: string) => fieldType === "Field" ? docField : null),
    };

    await Interface.prototype.addCitation.call({ _doc: doc, _session: session });

    expect(session.init).toHaveBeenCalledBefore(doc.cursorInField as any);
    expect(doc.cursorInField).toHaveBeenCalledWith("Field");
    expect(session.cite).toHaveBeenCalledWith(docField);
    expect(session.updateDocument).toHaveBeenCalledTimes(1);
    expect(originalAddCitation).not.toHaveBeenCalled();
  });

  it("cites through the initialized session for new citations", async () => {
    const originalAddCitation = vi.fn(async function () {});
    const { Interface } = installFakeZotero(originalAddCitation);
    patchCitationDialog();

    const session = {
      data: { prefs: { fieldType: "Field", delayCitationUpdates: false } },
      init: vi.fn(async function () {}),
      style: {},
      cite: vi.fn(async () => [{ field: {}, fieldIndex: 0 }]),
      updateDocument: vi.fn(),
    };
    const doc = {
      cursorInField: vi.fn(async () => null),
    };

    await Interface.prototype.addCitation.call({ _doc: doc, _session: session });

    expect(session.init).toHaveBeenCalledWith(false, false);
    expect(session.cite).toHaveBeenCalledWith(null);
    expect(session.updateDocument).toHaveBeenCalledTimes(1);
    expect(originalAddCitation).not.toHaveBeenCalled();
  });

  it("falls back to Zotero's original addCitation when the session is not ready", async () => {
    const originalAddCitation = vi.fn(async function () {});
    const { Interface } = installFakeZotero(originalAddCitation);
    patchCitationDialog();

    const session = {
      data: { prefs: {} },
      cite: vi.fn(),
      updateDocument: vi.fn(),
    };
    const doc = {
      cursorInField: vi.fn(async () => null),
    };

    await Interface.prototype.addCitation.call({ _doc: doc, _session: session });

    expect(originalAddCitation).toHaveBeenCalledTimes(1);
    expect(session.cite).not.toHaveBeenCalled();
  });

  it("passes non-WordCraft sessions to the original addCitation", async () => {
    const originalAddCitation = vi.fn(async function () {});
    const { Interface } = installFakeZotero(originalAddCitation);
    patchCitationDialog();
    vi.mocked(isWordCraftSession).mockResolvedValueOnce(false);

    const session = { agent: "WinWord", init: vi.fn(), cite: vi.fn(), data: { prefs: {} } };
    await Interface.prototype.addCitation.call({ _doc: {}, _session: session });

    expect(isWordCraftSession).toHaveBeenCalledWith(session);
    expect(originalAddCitation).toHaveBeenCalledTimes(1);
    expect(session.init).not.toHaveBeenCalled();
    expect(prepareSearchDialogForPendingCitation).not.toHaveBeenCalled();
  });

  it("handles every session without peer detection when WordCraft-only is off", async () => {
    const originalAddCitation = vi.fn(async function () {});
    const { Interface } = installFakeZotero(originalAddCitation);
    patchCitationDialog();
    vi.mocked(isWordCraftOnly).mockReturnValueOnce(false);

    const session = {
      agent: "WinWord",
      data: { prefs: { fieldType: "Field", delayCitationUpdates: false } },
      init: vi.fn(async function () {}),
      cite: vi.fn(async () => []),
    };
    await Interface.prototype.addCitation.call({ _doc: { cursorInField: vi.fn(async () => null) }, _session: session });

    expect(isWordCraftSession).not.toHaveBeenCalled();
    expect(session.cite).toHaveBeenCalledWith(null);
    expect(originalAddCitation).not.toHaveBeenCalled();
  });

  afterEach(() => {
    unpatchCitationDialog();
    vi.clearAllMocks();
    delete (globalThis as any).Zotero;
  });
});

describe("integration patch session gating and unpatching", () => {
  function installFakeZotero() {
    function Interface() {}
    Interface.prototype.addCitation = vi.fn();
    const originalDisplayDialog = vi.fn(async () => "native");
    (globalThis as any).Zotero = {
      Integration: { displayDialog: originalDisplayDialog, Interface, currentSession: { agent: "LibreOffice" } },
      log: vi.fn(),
    };
    return { originalDisplayDialog, Interface };
  }

  afterEach(() => {
    unpatchCitationDialog();
    vi.clearAllMocks();
    delete (globalThis as any).Zotero;
  });

  it("shows Zotero's own citation dialog for sessions that are not WordCraft", async () => {
    const { originalDisplayDialog } = installFakeZotero();
    patchCitationDialog();
    vi.mocked(isWordCraftSession).mockResolvedValueOnce(false);

    const io = { citation: { citationItems: [] } };
    const result = await (globalThis as any).Zotero.Integration.displayDialog("url", "mode", io, "citation");

    expect(result).toBe("native");
    expect(originalDisplayDialog).toHaveBeenCalledWith("url", "mode", io, "citation");
  });

  it("restores the original functions when its wrappers are still outermost", () => {
    const { originalDisplayDialog, Interface } = installFakeZotero();
    const originalAddCitation = Interface.prototype.addCitation;
    patchCitationDialog();
    unpatchCitationDialog();

    expect((globalThis as any).Zotero.Integration.displayDialog).toBe(originalDisplayDialog);
    expect(Interface.prototype.addCitation).toBe(originalAddCitation);
  });

  it("keeps a pass-through wrapper when another plugin wrapped it afterwards", async () => {
    const { originalDisplayDialog } = installFakeZotero();
    patchCitationDialog();
    const integration = (globalThis as any).Zotero.Integration;
    const ours = integration.displayDialog;
    const outer = vi.fn(function (this: any, ...args: any[]) { return ours.apply(this, args); });
    integration.displayDialog = outer;

    unpatchCitationDialog();
    expect(integration.displayDialog).toBe(outer);

    const io = { citation: { citationItems: [] } };
    const result = await integration.displayDialog("url", "mode", io, "citation");
    expect(result).toBe("native");
    expect(originalDisplayDialog).toHaveBeenCalledTimes(1);
    expect(isWordCraftSession).not.toHaveBeenCalled();
  });
});
