/**
 * Settings dialog — modal overlay within the search dialog.
 * Reads/writes preferences via the preferences module.
 */

import {
  getPref, setPref,
  getDisabledSources, setDisabledSources,
  getDefaultWordCraftShortcut,
  PREF_DEFS, ALL_SOURCE_NAMES,
} from "./preferences";
import {
  installWordCraftShortcut, uninstallWordCraftShortcut,
  getWordCraftManualInstructions,
} from "./wordcraft-shortcut";
import { detectPlatform, isWordCraftSupported } from "./platform";

/**
 * Open the settings dialog as a modal overlay inside the given document.
 * @param onClose - callback after settings are saved (to apply changes)
 */
export function openSettingsDialog(doc: Document, onClose?: () => void) {
  // --- Build modal overlay ---
  const overlay = doc.createElement("div");
  overlay.className = "edit-overlay";

  const modal = doc.createElement("div");
  modal.className = "edit-modal settings-modal";

  // Header
  const header = doc.createElement("div");
  header.className = "edit-modal-header";
  header.textContent = "InstantCite Settings";
  modal.appendChild(header);

  // Form
  const form = doc.createElement("div");
  form.className = "edit-modal-form";

  // --- Default sources section ---
  const sourcesSection = doc.createElement("div");
  sourcesSection.className = "settings-section";

  const sourcesTitle = doc.createElement("div");
  sourcesTitle.className = "settings-section-title";
  sourcesTitle.textContent = "Default Search Sources";
  sourcesSection.appendChild(sourcesTitle);

  const sourcesDesc = doc.createElement("div");
  sourcesDesc.className = "settings-description";
  sourcesDesc.textContent = "Sources enabled by default when opening the search dialog";
  sourcesSection.appendChild(sourcesDesc);

  const disabledSources = new Set(getDisabledSources());
  const sourceCheckboxes: Array<{ id: string; checkbox: HTMLInputElement }> = [];

  const sourcesGrid = doc.createElement("div");
  sourcesGrid.className = "settings-sources-grid";

  for (const source of ALL_SOURCE_NAMES) {
    const wrapper = doc.createElement("label");
    wrapper.className = "settings-checkbox-label";

    const cb = doc.createElement("input") as HTMLInputElement;
    cb.type = "checkbox";
    cb.checked = !disabledSources.has(source.id);
    sourceCheckboxes.push({ id: source.id, checkbox: cb });

    wrapper.appendChild(cb);
    wrapper.appendChild(doc.createTextNode(" " + source.label));
    sourcesGrid.appendChild(wrapper);
  }
  sourcesSection.appendChild(sourcesGrid);
  form.appendChild(sourcesSection);

  // --- Separator ---
  form.appendChild(createSeparator(doc));

  // --- Other preferences ---
  const inputMap = new Map<string, HTMLInputElement | HTMLSelectElement>();

  for (const pref of PREF_DEFS) {
    const row = doc.createElement("div");
    row.className = "settings-row";

    const labelDiv = doc.createElement("div");
    labelDiv.className = "settings-row-label";

    const label = doc.createElement("div");
    label.className = "settings-label";
    label.textContent = pref.label;
    labelDiv.appendChild(label);

    if (pref.description) {
      const desc = doc.createElement("div");
      desc.className = "settings-description";
      desc.textContent = pref.description;
      labelDiv.appendChild(desc);
    }
    row.appendChild(labelDiv);

    const controlDiv = doc.createElement("div");
    controlDiv.className = "settings-row-control";

    if (pref.type === "boolean") {
      const toggle = doc.createElement("input") as HTMLInputElement;
      toggle.type = "checkbox";
      toggle.className = "settings-toggle";
      toggle.checked = getPref<boolean>(pref.name);
      controlDiv.appendChild(toggle);
      inputMap.set(pref.name, toggle);
    } else if (pref.type === "number") {
      const wrapper = doc.createElement("div");
      wrapper.className = "settings-number-wrapper";

      const input = doc.createElement("input") as HTMLInputElement;
      input.type = "number";
      input.className = "settings-number-input";
      input.min = String(pref.min ?? 1);
      input.max = String(pref.max ?? 100);
      input.value = String(getPref<number>(pref.name));
      wrapper.appendChild(input);

      if (pref.unit) {
        const unit = doc.createElement("span");
        unit.className = "settings-unit";
        unit.textContent = pref.unit;
        wrapper.appendChild(unit);
      }

      controlDiv.appendChild(wrapper);
      inputMap.set(pref.name, input);
    } else if (pref.type === "select") {
      const select = doc.createElement("select") as HTMLSelectElement;
      select.className = "settings-select";
      for (const opt of pref.options ?? []) {
        const option = doc.createElement("option");
        option.value = opt.value;
        option.textContent = opt.label;
        select.appendChild(option);
      }
      select.value = getPref<string>(pref.name);
      controlDiv.appendChild(select);
      inputMap.set(pref.name, select);
    }

    row.appendChild(controlDiv);
    form.appendChild(row);
  }

  const platform = detectPlatform();
  const wordcraftDefaultShortcut = getDefaultWordCraftShortcut(platform);

  // --- WordCraft Integration section ---
  if (isWordCraftSupported(platform)) {
    form.appendChild(createSeparator(doc));

    const wordSection = doc.createElement("div");
    wordSection.className = "settings-section";

    const wordTitle = doc.createElement("div");
    wordTitle.className = "settings-section-title";
    wordTitle.textContent = "WordCraft Integration";
    wordSection.appendChild(wordTitle);

    const wordDesc = doc.createElement("div");
    wordDesc.className = "settings-description";
    wordDesc.textContent =
      "Install a keyboard shortcut in WordCraft that triggers Zotero Add/Edit Citation. " +
      "WordCraft must be closed while the shortcut is installed; it picks the shortcut up on its next start.";
    wordSection.appendChild(wordDesc);

    // Shortcut input row
    const shortcutRow = doc.createElement("div");
    shortcutRow.style.cssText = "display:flex;gap:8px;margin-top:8px;align-items:center;";
    const shortcutLabel = doc.createElement("span");
    shortcutLabel.className = "settings-label";
    shortcutLabel.textContent = "Shortcut:";
    shortcutRow.appendChild(shortcutLabel);
    const shortcutInput = doc.createElement("input") as HTMLInputElement;
    shortcutInput.type = "text";
    shortcutInput.className = "settings-number-input";
    shortcutInput.style.cssText = "width:160px;font-family:monospace;";
    shortcutInput.value = getPref<string>("wordcraftShortcut") || wordcraftDefaultShortcut;
    shortcutInput.placeholder = wordcraftDefaultShortcut;
    shortcutRow.appendChild(shortcutInput);
    wordSection.appendChild(shortcutRow);

    const wordBtnRow = doc.createElement("div");
    wordBtnRow.style.cssText = "display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap;";

    const installBtn = doc.createElement("button");
    installBtn.className = "footer-btn primary";
    installBtn.textContent = "Install Shortcut";
    installBtn.style.cssText = "margin:0;";

    const removeBtn = doc.createElement("button");
    removeBtn.className = "footer-btn";
    removeBtn.textContent = "Remove";
    removeBtn.style.cssText = "margin:0;";

    const manualBtn = doc.createElement("button");
    manualBtn.className = "footer-btn";
    manualBtn.textContent = "Manual Setup";
    manualBtn.style.cssText = "margin:0;";

    const wordStatus = doc.createElement("div");
    wordStatus.className = "settings-description";
    wordStatus.style.cssText = "margin-top:6px;white-space:pre-wrap;max-height:200px;overflow-y:auto;";

    installBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const shortcut = shortcutInput.value.trim() || wordcraftDefaultShortcut;
      installBtn.disabled = true;
      installBtn.textContent = "Installing...";
      wordStatus.textContent = "";
      try {
        let res = await installWordCraftShortcut(shortcut);
        if (res.needsClosedConfirmation && confirmWordCraftClosed(doc, res.message)) {
          res = await installWordCraftShortcut(shortcut, { assumeClosed: true });
        }
        wordStatus.textContent = res.message;
        wordStatus.style.color = res.success ? "#4caf50" : "#f44336";
        if (res.success) {
          setPref("wordcraftShortcut", shortcut);
        }
        if (res.showManual) {
          manualBtn.style.display = "";
        }
      } catch (err) {
        wordStatus.textContent = "Error: " + err;
        wordStatus.style.color = "#f44336";
      }
      installBtn.disabled = false;
      installBtn.textContent = "Install Shortcut";
    });

    removeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      removeBtn.disabled = true;
      removeBtn.textContent = "Removing...";
      wordStatus.textContent = "";
      try {
        let res = await uninstallWordCraftShortcut();
        if (res.needsClosedConfirmation && confirmWordCraftClosed(doc, res.message)) {
          res = await uninstallWordCraftShortcut({ assumeClosed: true });
        }
        wordStatus.textContent = res.message;
        wordStatus.style.color = res.success ? "#4caf50" : "#f44336";
      } catch (err) {
        wordStatus.textContent = "Error: " + err;
        wordStatus.style.color = "#f44336";
      }
      removeBtn.disabled = false;
      removeBtn.textContent = "Remove";
    });

    manualBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const shortcut = shortcutInput.value.trim() || wordcraftDefaultShortcut;
      wordStatus.textContent = getWordCraftManualInstructions(shortcut);
      wordStatus.style.color = "";
    });

    // Hide manual button initially — shown on error
    manualBtn.style.display = "none";

    wordBtnRow.appendChild(installBtn);
    wordBtnRow.appendChild(removeBtn);
    wordBtnRow.appendChild(manualBtn);
    wordSection.appendChild(wordBtnRow);
    wordSection.appendChild(wordStatus);
    form.appendChild(wordSection);
  }


  modal.appendChild(form);

  // Footer
  const footer = doc.createElement("div");
  footer.className = "edit-modal-footer";

  const cancelBtn = doc.createElement("button");
  cancelBtn.className = "footer-btn";
  cancelBtn.textContent = "Cancel";
  footer.appendChild(cancelBtn);

  const saveBtn = doc.createElement("button");
  saveBtn.className = "footer-btn primary";
  saveBtn.textContent = "Save";
  footer.appendChild(saveBtn);

  modal.appendChild(footer);
  overlay.appendChild(modal);
  doc.body.appendChild(overlay);

  // --- Event handlers ---
  const closeModal = () => {
    overlay.remove();
  };

  const saveAndClose = () => {
    // Save sources
    const newDisabled: string[] = [];
    for (const { id, checkbox } of sourceCheckboxes) {
      if (!checkbox.checked) newDisabled.push(id);
    }
    setDisabledSources(newDisabled);

    // Save other preferences
    for (const pref of PREF_DEFS) {
      const input = inputMap.get(pref.name);
      if (!input) continue;

      if (pref.type === "boolean") {
        setPref(pref.name, (input as HTMLInputElement).checked);
      } else if (pref.type === "number") {
        let val = parseInt((input as HTMLInputElement).value, 10);
        if (isNaN(val)) val = getPref<number>(pref.name);
        if (pref.min !== undefined) val = Math.max(pref.min, val);
        if (pref.max !== undefined) val = Math.min(pref.max, val);
        setPref(pref.name, val);
      } else if (pref.type === "select") {
        setPref(pref.name, (input as HTMLSelectElement).value);
      }
    }

    Zotero.log("[InstantCite WordCraft] Settings saved");
    closeModal();
    if (onClose) onClose();
  };

  cancelBtn.addEventListener("click", (e) => { e.stopPropagation(); closeModal(); });
  saveBtn.addEventListener("click", (e) => { e.stopPropagation(); saveAndClose(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

  overlay.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); closeModal(); }
    if (e.key === "Enter" && (e.target as HTMLElement)?.tagName !== "TEXTAREA") {
      e.preventDefault();
      saveAndClose();
    }
  });
}

function confirmWordCraftClosed(doc: Document, message: string): boolean {
  try {
    return Services.prompt.confirm(doc.defaultView as any, "Instant Cite for WordCraft", message);
  } catch {
    return false;
  }
}

function createSeparator(doc: Document): HTMLElement {
  const sep = doc.createElement("div");
  sep.className = "settings-separator";
  return sep;
}
