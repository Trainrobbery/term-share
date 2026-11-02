import {MODULE_ID, FORMAT_VERSION, LIMITS, TermShareError, clone, emptyDictionary, fingerprint, validateEntries, readImport, planImport, exportDictionary} from "./core.js";
import {sanitizeHTML, hasContent} from "./html.js";

export const newId = () => foundry.utils.randomID();

export class DictionaryStore {
  #writing = false;
  #listeners = new Set();
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  notify() { for (const listener of this.#listeners) listener(); }
  snapshot() {
    const data = game.settings.get(MODULE_ID, "dictionary") ?? emptyDictionary();
    if (data.formatVersion !== FORMAT_VERSION || !Array.isArray(data.entries)) throw new TermShareError("InvalidFormat");
    return clone(data);
  }
  entries() { return this.snapshot().entries; }
  assertGM() { if (!game.user?.isGM) throw new TermShareError("GMOnly"); }
  clean(entries) {
    const validated = validateEntries(entries, {idFactory: newId});
    return validated.map(entry => {
      const description = sanitizeHTML(entry.description);
      if (!hasContent(description)) throw new TermShareError("DescriptionRequired", {name: entry.name});
      return {...entry, description};
    });
  }
  async save(entries, expected) {
    this.assertGM();
    if (this.#writing) throw new TermShareError("SaveBusy");
    this.#writing = true;
    try {
      const current = this.snapshot();
      if (fingerprint(current) !== expected) throw new TermShareError("StaleData");
      const next = {formatVersion: FORMAT_VERSION, revision: (Number(current.revision) || 0) + 1, entries: this.clean(entries)};
      if (new TextEncoder().encode(JSON.stringify(next)).length > LIMITS.bytes) throw new TermShareError("FileTooLarge", {max: 5});
      await game.settings.set(MODULE_ID, "dictionary", next);
      return next;
    } finally { this.#writing = false; }
  }
  prepareImport(text, mode) {
    this.assertGM();
    if (new TextEncoder().encode(text).length > LIMITS.bytes) throw new TermShareError("FileTooLarge", {max: 5});
    let raw;
    try { raw = JSON.parse(text); } catch { throw new TermShareError("InvalidJSON"); }
    const incoming = readImport(raw, {idFactory: newId});
    const cleanIncoming = this.clean(incoming);
    const current = this.snapshot();
    const plan = planImport(current.entries, cleanIncoming, mode, {idFactory: newId});
    return {...plan, base: fingerprint(current), cleaned: incoming.filter((entry, i) => entry.description !== cleanIncoming[i].description).length};
  }
  export() { this.assertGM(); return JSON.stringify(exportDictionary(this.entries()), null, 2); }
}

export function downloadJSON(text, filename) {
  const blob = new Blob([text], {type: "application/json;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function backupName() {
  return `term-share-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
}
