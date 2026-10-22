import Addon from "./addon";
import * as hooks from "./hooks";

// Register global addon instance
if (!Zotero.InstantCiteWordCraft) {
  const addon = new Addon();
  Zotero.InstantCiteWordCraft = addon;
  // Expose lifecycle hooks for bootstrap.js
  (Zotero.InstantCiteWordCraft as any).hooks = hooks;
}
