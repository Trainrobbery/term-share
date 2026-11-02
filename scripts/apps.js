import {MODULE_ID, LIMITS, TermShareError, fingerprint, clone, displayName, suggest} from "./core.js";
import {escapeHTML, plainText} from "./html.js";
import {newId, downloadJSON, backupName} from "./store.js";
import {t, report} from "./i18n.js";
import {RichTextInput} from "./rich-text-input.js";

const {ApplicationV2, HandlebarsApplicationMixin, DialogV2} = foundry.applications.api;
const Base = HandlebarsApplicationMixin(ApplicationV2);
let store;
export function connectApps(value) { store = value; }
const labels = keys => Object.fromEntries(keys.split(" ").map(key => [key, t(key)]));

export class DictionaryManager extends Base {
  static DEFAULT_OPTIONS = {
    id: "term-share-manager", tag: "div", classes: ["term-share-app", "ts-manager"],
    window: {title: "TERM_SHARE.ManagerTitle", icon: "fa-solid fa-book-open", resizable: true},
    position: {width: 880, height: 660}
  };
  static PARTS = {main: {template: "modules/term-share/templates/manager.hbs"}};
  search = "";
  selectedId = null;
  listeners;
  editor = null;
  importer = null;

  async _canRender(options) { store.assertGM(); return super._canRender(options); }
  async _prepareContext() {
    const all = store.entries();
    const visible = new Set(suggest(all, this.search).map(({entry}) => entry.id));
    const entries = suggest(all, "").map(({entry}) => ({...entry, aliasText: entry.aliases.join(" · "), selected: entry.id === this.selectedId, hidden: !visible.has(entry.id)}));
    const selected = store.entries().find(entry => entry.id === this.selectedId);
    return {
      entries, search: this.search, count: t("EntryCount", {count: store.entries().length}),
      selected: selected ? {...selected, aliasText: selected.aliases.join(" · "), preview: plainText(selected.description, 2400)} : null,
      labels: labels("NewTerm Import Export SearchTerms PublicNotice EmptyDictionary NoSelection Edit Delete Aliases NoAliases PreviewDescription ManagerHint")
    };
  }
  _onRender(context, options) {
    super._onRender(context, options);
    this.listeners?.abort();
    this.listeners = new AbortController();
    const signal = this.listeners.signal;
    this.element.addEventListener("click", event => {
      const target = event.target.closest("[data-ts-action]");
      if (target) void this.act(target.dataset.tsAction, target.dataset.id).catch(report);
    }, {signal});
    const search = this.element.querySelector('[data-field="search"]');
    search.addEventListener("input", () => {
      this.search = search.value;
      // Filter rows in place so typing never loses focus on a full app render.
      const visible = new Set(suggest(store.entries(), this.search).map(({entry}) => entry.id));
      for (const row of this.element.querySelectorAll("[data-term-row]")) row.hidden = !visible.has(row.dataset.termRow);
    }, {signal});
    if (!this.unsubscribe) this.unsubscribe = store.subscribe(() => {
      if (this.rendered) void this.render({force: true}).catch(report);
    });
  }
  async act(action, id) {
    store.assertGM();
    if (action === "select") { this.selectedId = id; await this.render({force: true}); }
    if (action === "new" || action === "edit") {
      if (this.editor?.rendered) { this.editor.bringToFront(); return; }
      this.editor = new TermEditor(action === "edit" ? this.selectedId : null);
      await this.editor.render({force: true});
    }
    if (action === "export") downloadJSON(store.export(), backupName());
    if (action === "import") {
      if (this.importer?.rendered) this.importer.bringToFront();
      else { this.importer = new DictionaryImporter(); await this.importer.render({force: true}); }
    }
    if (action === "delete") {
      const current = store.snapshot();
      const entry = current.entries.find(item => item.id === this.selectedId);
      if (!entry) return;
      const accepted = await DialogV2.confirm({window: {title: t("Delete")}, content: `<p>${escapeHTML(t("ConfirmDelete", {name: entry.name}))}</p>`, rejectClose: false, modal: true});
      if (!accepted) return;
      await store.save(current.entries.filter(item => item.id !== entry.id), fingerprint(current));
      this.selectedId = null;
      ui.notifications.info(t("Deleted"));
      await this.render({force: true});
    }
  }
  _onClose(options) {
    this.listeners?.abort();
    this.unsubscribe?.();
    this.unsubscribe = null;
    super._onClose(options);
  }
}

export class TermEditor extends Base {
  static DEFAULT_OPTIONS = {
    id: "term-share-editor", tag: "div", classes: ["term-share-app", "ts-editor"],
    window: {title: "TERM_SHARE.EditorTitle", icon: "fa-solid fa-pen-to-square", resizable: true},
    position: {width: 730, height: 680}
  };
  static PARTS = {main: {template: "modules/term-share/templates/editor.hbs"}};
  constructor(id = null, options = {}) {
    super(options);
    this.base = store.snapshot();
    const found = this.base.entries.find(entry => entry.id === id);
    if (id && !found) throw new TermShareError("StaleData");
    this.original = clone(found ?? {id: newId(), name: "", aliases: [], description: "", createdAt: new Date().toISOString()});
    this.isNew = !found;
    this.busy = false;
    this.saved = false;
    this.composingFields = new Set();
    this.lastCompositionEnd = -Infinity;
  }
  async render(options = {}) {
    // A second render must not replace an active native IME text node.
    if (this.rendered) { this.bringToFront(); return this; }
    return super.render(options);
  }
  async _canRender(options) { store.assertGM(); return super._canRender(options); }
  async _prepareContext() {
    return {...this.original, aliasText: this.original.aliases.join("\n"), maxName: LIMITS.name,
      labels: labels("TermName Aliases AliasHint Description RichTextHint Save Cancel PublicNotice StaleNotice EditorLoading")};
  }
  _onRender(context, options) {
    super._onRender(context, options);
    const form = this.element.querySelector("form");
    const mount = this.element.querySelector(".ts-editor-mount");
    try {
      this.richEditor = new RichTextInput(this.original.description);
      mount.replaceChildren(this.richEditor.element);
      this.element.querySelector('[data-ts-action="save"]').disabled = false;
    } catch (error) { report(error); }
    form.addEventListener("submit", event => { event.preventDefault(); event.stopPropagation(); void this.save().catch(report); });
    this.element.querySelector('[data-ts-action="save"]').addEventListener("click", event => {
      event.preventDefault();
      const explicit = event.detail > 0;
      void (async () => {
        // A deliberate click can blur/commit an IME. Let its final input settle
        // before reading, without treating a composition Enter as a save click.
        if (explicit) await new Promise(resolve => requestAnimationFrame(resolve));
        await this.save({explicit});
      })().catch(report);
    });
    form.addEventListener("compositionstart", event => { this.composingFields.add(event.target); });
    form.addEventListener("compositionend", event => { this.composingFields.delete(event.target); this.lastCompositionEnd = performance.now(); });
    this.element.querySelector('[data-ts-action="cancel"]').addEventListener("click", () => { void this.close().catch(report); });
    this.unsubscribe = store.subscribe(() => {
      if (!this.saved && fingerprint(store.snapshot()) !== fingerprint(this.base)) this.element.querySelector(".ts-stale-notice").hidden = false;
    });
  }
  dirty() {
    if (!this.rendered || this.saved) return false;
    const name = this.element.querySelector('[name="name"]').value;
    const aliases = this.element.querySelector('[name="aliases"]').value;
    return name !== this.original.name || aliases !== this.original.aliases.join("\n") || Boolean(this.richEditor?.isDirty());
  }
  async save({explicit = false} = {}) {
    if (!this.rendered || this.busy || !this.richEditor) return;
    if (this.richEditor.composing || this.composingFields.size || (!explicit && performance.now() - this.lastCompositionEnd < 80)) {
      ui.notifications.warn(t("FinishComposition"));
      return;
    }
    store.assertGM();
    this.busy = true;
    const button = this.element.querySelector('[data-ts-action="save"]');
    button.disabled = true;
    try {
      const description = this.richEditor.value;
      const entry = {...this.original,
        name: this.element.querySelector('[name="name"]').value,
        aliases: this.element.querySelector('[name="aliases"]').value.split(/\r?\n/).map(displayName).filter(Boolean),
        description, updatedAt: new Date().toISOString()
      };
      const entries = clone(this.base.entries);
      const index = entries.findIndex(item => item.id === entry.id);
      if (index >= 0) entries[index] = entry;
      else entries.push(entry);
      await store.save(entries, fingerprint(this.base));
      this.saved = true;
      ui.notifications.info(t("Saved"));
    } finally { this.busy = false; button.disabled = false; }
    await this.close();
  }
  async close(options = {}) {
    if (this.busy) return this;
    if (this.dirty()) {
      const discard = await DialogV2.confirm({window: {title: t("UnsavedTitle")}, content: `<p>${escapeHTML(t("DiscardChanges"))}</p>`, rejectClose: false, modal: true});
      if (!discard) return this;
    }
    return super.close(options);
  }
  _onClose(options) {
    this.richEditor?.destroy();
    this.unsubscribe?.();
    super._onClose(options);
  }
}

export class DictionaryImporter extends Base {
  static DEFAULT_OPTIONS = {
    id: "term-share-importer", tag: "div", classes: ["term-share-app", "ts-importer"],
    window: {title: "TERM_SHARE.Import", icon: "fa-solid fa-file-import", resizable: true},
    position: {width: 640, height: 560}
  };
  static PARTS = {main: {template: "modules/term-share/templates/importer.hbs"}};
  plan = null;
  text = "";
  busy = false;
  async _canRender(options) { store.assertGM(); return super._canRender(options); }
  async _prepareContext() {
    return {labels: labels("ChooseFile ImportMode Merge Replace MergeHint BackupBeforeImport ImportPreview ImportHelp ApplyImport Cancel NoFile")};
  }
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('[name="file"]').addEventListener("change", event => { void this.loadFile(event.target.files[0]).catch(report); });
    this.element.querySelector('[name="mode"]').addEventListener("change", () => this.preview());
    this.element.querySelector('[data-ts-action="apply"]').addEventListener("click", () => { void this.apply().catch(report); });
    this.element.querySelector('[data-ts-action="cancel"]').addEventListener("click", () => { void this.close(); });
  }
  async loadFile(file) {
    const request = this.fileRequest = Symbol();
    this.plan = null;
    this.text = "";
    this.element.querySelector('[data-ts-action="apply"]').disabled = true;
    this.element.querySelector(".ts-import-summary").textContent = t("NoFile");
    this.element.querySelector(".ts-import-changes").replaceChildren();
    if (!file) return;
    if (file.size > LIMITS.bytes) throw new TermShareError("FileTooLarge", {max: 5});
    const text = await file.text();
    if (this.fileRequest !== request || !this.rendered) return;
    this.text = text;
    this.preview();
  }
  preview() {
    const button = this.element.querySelector('[data-ts-action="apply"]');
    const summary = this.element.querySelector(".ts-import-summary");
    const list = this.element.querySelector(".ts-import-changes");
    this.plan = null;
    button.disabled = true;
    list.replaceChildren();
    if (!this.text) return;
    try {
      const mode = this.element.querySelector('[name="mode"]').value;
      this.plan = store.prepareImport(this.text, mode);
      summary.textContent = t("ImportSummary", this.plan) + (this.plan.cleaned ? ` ${t("CleanedSummary", {count: this.plan.cleaned})}` : "");
      for (const change of this.plan.changes) {
        const item = document.createElement("li");
        item.textContent = `${t(`Change_${change.kind}`)} · ${change.name}`;
        list.append(item);
      }
      button.disabled = false;
    } catch (error) { summary.textContent = error.key ? t(error.key, error.data) : t("UnexpectedError"); }
  }
  async apply() {
    if (this.busy || !this.plan) return;
    store.assertGM();
    this.busy = true;
    const button = this.element.querySelector('[data-ts-action="apply"]');
    button.disabled = true;
    try {
      if (fingerprint(store.snapshot()) !== this.plan.base) throw new TermShareError("StaleData");
      if (this.element.querySelector('[name="backup"]').checked) downloadJSON(store.export(), backupName());
      await store.save(this.plan.entries, this.plan.base);
      ui.notifications.info(t("Imported"));
    } finally { this.busy = false; button.disabled = false; }
    await this.close();
  }
  async close(options = {}) { if (this.busy) return this; return super.close(options); }
}
