import {MODULE_ID, suggest} from "./core.js";
import {plainText} from "./html.js";
import {t, report} from "./i18n.js";

/** Delegation survives Foundry sidebar/input replacement without rebinding nodes. */
export class AutocompleteController {
  input = null;
  rows = [];
  index = 0;
  composing = new WeakSet();
  compositionEnded = new WeakMap();
  pending = new WeakSet();
  queuedActions = new Map();
  dismissed = null;
  frame = null;
  previewFrame = null;
  previews = new Map();
  views = new WeakMap();
  constructor(store, chat) { this.store = store; this.chat = chat; }
  getInput(target) {
    if (!target?.closest) return null;
    if (target.closest("#term-share-editor, [data-term-share-editor]")) return null;
    if (target.tagName === "TEXTAREA" && (target.id === "chat-message" || (target.name === "message" && target.closest("#chat, #chat-input, #chat-form, .chat-log, .chat-input, .chat-form, [data-tab='chat']")))) return target;
    const editable = target.closest('.ProseMirror[contenteditable="true"]');
    return editable && editable.closest("prose-mirror[name='message'], #chat-message, #chat-input, #chat-form, #chat, .chat-input, .chat-log, [data-tab='chat']") ? editable : null;
  }
  read(input) {
    const view = this.views.get(input);
    return view ? view.state.doc.textBetween(0, view.state.doc.content.size, "\n", "\n") : input.tagName === "TEXTAREA" ? input.value : input.textContent;
  }
  readForSuggestions(input) {
    // During IME composition the visible DOM can be newer than ProseMirror's
    // committed document. Read it only for filtering; never patch its contents.
    if (this.composing.has(input) && input.tagName !== "TEXTAREA") return input.innerText ?? input.textContent;
    return this.read(input);
  }
  scheduleSuggestions(input) {
    if (this.previewFrame != null) cancelAnimationFrame(this.previewFrame);
    this.previewFrame = requestAnimationFrame(() => {
      this.previewFrame = null;
      if (this.input === input) this.update();
    });
  }
  write(input, text) {
    const view = this.views.get(input);
    if (view) {
      const tr = view.state.tr.insertText(text, 0, view.state.doc.content.size).setMeta(MODULE_ID, true);
      tr.setSelection(view.state.selection.constructor.atEnd(tr.doc));
      view.dispatch(tr);
      view.focus();
    } else if (input.tagName === "TEXTAREA") {
      input.value = text;
      input.setSelectionRange(text.length, text.length);
    } else {
      // Never edit a ProseMirror DOM node behind the editor's state.
      ui.notifications.warn(t("EditorUnavailable"));
      return false;
    }
    input.dispatchEvent(new Event("input", {bubbles: true}));
    return true;
  }
  registerProseMirrorHooks() {
    this.pmHook = Hooks.on("createProseMirrorEditor", (uuid, plugins, options) => {
      // The public hook supplies actual ProseMirror Plugin objects. Reuse their
      // public constructor, avoiding a bundled second copy of ProseMirror.
      const Plugin = [...Object.values(plugins), ...(options?.state?.plugins ?? [])].find(plugin => plugin?.spec && typeof plugin.constructor === "function")?.constructor;
      if (!Plugin) return;
      plugins.termShareInput = new Plugin({view: view => {
        if (this.getInput(view.dom) !== view.dom) return {};
        this.views.set(view.dom, view);
        return {
          update: updatedView => {
            if (this.input === updatedView.dom) this.update();
            this.settleQueuedAction(updatedView.dom);
          },
          destroy: () => {
            this.cancelQueuedAction(view.dom);
            this.views.delete(view.dom);
            if (this.input === view.dom) this.close();
          }
        };
      }});
    });
  }
  start() {
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const doc = document;
    this.popup = doc.createElement("div");
    this.popup.className = "term-share-autocomplete themed";
    this.popup.id = "term-share-autocomplete";
    this.popup.hidden = true;
    this.popup.setAttribute("role", "listbox");
    this.popup.setAttribute("aria-label", t("Suggestions"));
    doc.body.append(this.popup);
    doc.addEventListener("focusin", event => {
      const input = this.getInput(event.target);
      if (input) { this.input = input; this.dismissed = null; this.update(); }
      else if (!this.popup.contains(event.target)) this.close();
    }, {signal});
    doc.addEventListener("focusout", event => {
      if (event.target === this.input && !this.popup.contains(event.relatedTarget)) {
        if (this.queuedActions.get(this.input)?.kind !== "complete") this.cancelQueuedAction(this.input);
        this.close();
      }
    }, {signal});
    doc.addEventListener("input", event => {
      const input = this.getInput(event.target);
      if (!input) return;
      if (event.isComposing) this.composing.add(input);
      this.input = input;
      this.dismissed = null;
      this.index = 0;
      this.update();
      this.settleQueuedAction(input);
    }, {signal});
    doc.addEventListener("beforeinput", event => {
      const input = this.getInput(event.target);
      if (!input || !this.queuedActions.has(input)) return;
      if (["insertLineBreak", "insertParagraph"].includes(event.inputType)) {
        // Cancel only the newline caused by the pending Enter, never IME text.
        event.preventDefault();
        event.stopImmediatePropagation();
      } else if (/^(?:delete|history)|^insertFrom(?:Paste|Drop)/.test(event.inputType ?? "")) {
        this.cancelQueuedAction(input);
      }
    }, {signal, capture: true});
    doc.addEventListener("compositionstart", event => {
      const input = this.getInput(event.target);
      if (input) {
        this.cancelQueuedAction(input);
        this.composing.add(input);
        this.input = input;
        this.dismissed = null;
        this.index = 0;
        this.update();
      }
    }, {signal, capture: true});
    doc.addEventListener("compositionupdate", event => {
      const input = this.getInput(event.target);
      if (!input) return;
      this.composing.add(input);
      this.input = input;
      this.dismissed = null;
      this.index = 0;
      // compositionupdate may precede the browser's DOM edit.
      this.scheduleSuggestions(input);
    }, {signal, capture: true});
    doc.addEventListener("compositionend", event => {
      const input = this.getInput(event.target);
      if (!input) return;
      this.composing.delete(input);
      this.compositionEnded.set(input, performance.now());
      this.input = input;
      this.update();
      this.scheduleSuggestions(input);
      this.settleQueuedAction(input);
    }, {signal, capture: true});
    doc.addEventListener("keydown", event => this.keydown(event), {signal, capture: true});
    doc.addEventListener("pointerdown", event => {
      const item = event.target.closest?.("[data-ts-suggestion]");
      if (!item || !this.popup.contains(item)) return;
      event.preventDefault();
      event.stopPropagation();
      this.index = Number(item.dataset.tsSuggestion);
      this.complete();
    }, {signal});
    window.addEventListener("resize", () => this.position(), {signal});
    window.addEventListener("scroll", () => this.position(), {signal, capture: true});
    this.unsubscribe = this.store.subscribe(() => { this.previews.clear(); this.update(); });
    // Remove a popup immediately when Foundry replaces or hides the input subtree.
    this.observer = new MutationObserver(records => {
      if (records.every(record => record.target === this.popup || this.popup.contains(record.target))) return;
      for (const input of this.queuedActions.keys()) if (!input.isConnected) this.cancelQueuedAction(input);
      if (!this.popup.hidden && this.frame == null) this.frame = requestAnimationFrame(() => {
        this.frame = null;
        if (!this.input?.isConnected || !this.input.getClientRects().length) this.close();
        else this.position();
      });
    });
    this.observer.observe(doc.body, {childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"]});
  }
  keydown(event) {
    const input = this.getInput(event.target);
    if (!input) return;
    const enter = event.key === "Enter" || event.code === "Enter";
    const plainEnter = enter && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
    if (!plainEnter) this.cancelQueuedAction(input);
    const command = this.chat.parse(this.read(input));
    if (!command) { this.cancelQueuedAction(input); return; }
    this.input = input;
    const ime = this.composing.has(input) || event.isComposing || event.keyCode === 229;
    if (plainEnter) {
      // An active IME needs the default key action to commit its final character.
      // The separate beforeinput guard blocks only an accidental newline.
      if (!ime) event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) {
        if (ime || this.queuedActions.has(input) || performance.now() - (this.compositionEnded.get(input) ?? -Infinity) < 80) this.queueAction(input);
        else void this.submit(input, command.query);
      }
      return;
    }
    if (ime) {
      if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !this.popup.hidden && this.rows.length) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.complete();
        return;
      }
      if (enter || event.keyCode === 229) event.stopImmediatePropagation();
      return;
    }
    if (this.popup.hidden || !this.rows.length) return;
    if (["ArrowDown", "ArrowUp", "Tab", "Escape"].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") { this.dismissed = this.read(input); this.close(); }
      else if (event.key === "Tab") this.complete();
      else {
        this.index = (this.index + (event.key === "ArrowDown" ? 1 : -1) + this.rows.length) % this.rows.length;
        this.markSelected();
      }
    }
  }
  queueAction(input, action = {kind: "submit"}) {
    this.cancelQueuedAction(input);
    this.queuedActions.set(input, {...action, timer: null});
    this.settleQueuedAction(input);
  }
  settleQueuedAction(input) {
    const queued = this.queuedActions.get(input);
    if (!queued) return;
    clearTimeout(queued.timer);
    queued.timer = null;
    if (this.composing.has(input)) return;
    // Read the committed textarea/ProseMirror state after final input and view
    // updates settle, instead of dropping Enter during an arbitrary guard window.
    queued.timer = setTimeout(() => {
      if (this.queuedActions.get(input) !== queued) return;
      this.queuedActions.delete(input);
      if (!input.isConnected || this.composing.has(input)) return;
      if (queued.kind === "complete") {
        if (document.activeElement !== input && document.activeElement !== document.body && !this.popup.contains(document.activeElement)) return;
        input.focus();
        if (this.write(input, queued.text)) { this.dismissed = this.read(input); this.close(); }
        return;
      }
      if (document.activeElement !== input) return;
      const command = this.chat.parse(this.read(input));
      if (command) void this.submit(input, command.query);
    }, 30);
  }
  cancelQueuedAction(input) {
    clearTimeout(this.queuedActions.get(input)?.timer);
    this.queuedActions.delete(input);
  }
  async submit(input, query) {
    if (this.pending.has(input)) return;
    this.pending.add(input);
    const original = this.read(input);
    this.close();
    try {
      const ok = await this.chat.share(query, input.id || "chat-input");
      if (ok && input.isConnected && this.read(input) === original) this.write(input, "");
      // Failure keeps the original text and focus for correction.
    } catch (error) { report(error); }
    finally { this.pending.delete(input); }
  }
  update() {
    if (!this.popup) return;
    const input = this.input;
    if (!input?.isConnected || document.activeElement !== input || !game.settings.get(MODULE_ID, "autocomplete")) return this.close();
    const text = this.readForSuggestions(input);
    if (this.dismissed === text) return this.close();
    const command = this.chat.parse(text);
    if (!command) return this.close();
    try { this.rows = suggest(this.store.entries(), command.query); }
    catch (error) { report(error); return this.close(); }
    this.index = Math.min(this.index, Math.max(0, this.rows.length - 1));
    this.popup.replaceChildren();
    if (!this.rows.length) return this.close();
    for (const [index, row] of this.rows.entries()) {
      const item = document.createElement("div");
      item.className = "ts-suggestion";
      item.dataset.tsSuggestion = String(index);
      item.id = `ts-suggestion-${index}`;
      item.setAttribute("role", "option");
      const heading = document.createElement("strong");
      heading.textContent = row.entry.name;
      item.append(heading);
      if (row.alias) {
        const alias = document.createElement("span");
        alias.className = "ts-matched-alias";
        alias.textContent = ` (${row.alias})`;
        item.append(alias);
      }
      const description = document.createElement("small");
      let preview = this.previews.get(row.entry.id);
      if (!preview) { preview = plainText(row.entry.description, 90); this.previews.set(row.entry.id, preview); }
      description.textContent = preview;
      item.append(description);
      this.popup.append(item);
    }
    const count = Math.min(12, Math.max(3, Number(game.settings.get(MODULE_ID, "suggestionCount")) || 6));
    this.popup.style.setProperty("--ts-visible-rows", String(count));
    this.popup.hidden = false;
    input.setAttribute("aria-controls", this.popup.id);
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-autocomplete", "list");
    this.markSelected();
    this.position();
  }
  markSelected() {
    const items = this.popup.querySelectorAll("[role=option]");
    for (const [index, item] of items.entries()) item.setAttribute("aria-selected", String(index === this.index));
    const selected = items[this.index];
    if (selected) {
      this.input.setAttribute("aria-activedescendant", selected.id);
      selected.scrollIntoView?.({block: "nearest"});
    }
  }
  complete() {
    this.cancelQueuedAction(this.input);
    const row = this.rows[this.index];
    const command = this.input && this.chat.parse(this.readForSuggestions(this.input));
    if (!row || !command) return;
    if (this.composing.has(this.input)) {
      this.queueAction(this.input, {kind: "complete", text: `${command.command} ${row.entry.name}`});
      // A deliberate selection commits the native IME by blurring first. The
      // queued completion waits for compositionend and final input/view updates.
      this.input.blur();
      this.close();
      return;
    }
    this.input.focus();
    if (!this.write(this.input, `${command.command} ${row.entry.name}`)) return;
    this.dismissed = this.read(this.input);
    this.close();
  }
  position() {
    if (this.popup.hidden || !this.input?.isConnected) return;
    // The popup lives under body, outside the chat's theme context. Opt into
    // core's standard themed variables and follow the actual input's theme.
    const theme = this.input.closest(".theme-light, .theme-dark");
    for (const name of ["theme-light", "theme-dark"]) this.popup.classList.toggle(name, Boolean(theme?.classList.contains(name)));
    const rect = this.input.getBoundingClientRect();
    if (!rect.width || !this.input.getClientRects().length) return this.close();
    this.popup.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`;
    this.popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`;
    const height = Math.min(52 * Number(this.popup.style.getPropertyValue("--ts-visible-rows")), Math.max(48, rect.top - 12));
    this.popup.style.maxHeight = `${height}px`;
    this.popup.style.top = `${Math.max(8, rect.top - Math.min(this.popup.scrollHeight, height) - 6)}px`;
  }
  close() {
    if (!this.popup) return;
    this.popup.hidden = true;
    if (this.input) {
      this.input.setAttribute("aria-expanded", "false");
      this.input.removeAttribute("aria-activedescendant");
      this.input.removeAttribute("aria-controls");
    }
  }
  destroy() {
    for (const input of this.queuedActions.keys()) this.cancelQueuedAction(input);
    this.close();
    this.abort?.abort();
    this.unsubscribe?.();
    this.observer?.disconnect();
    if (this.pmHook != null) Hooks.off("createProseMirrorEditor", this.pmHook);
    if (this.frame != null) cancelAnimationFrame(this.frame);
    if (this.previewFrame != null) cancelAnimationFrame(this.previewFrame);
    this.popup?.remove();
  }
}
