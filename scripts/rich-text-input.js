import {escapeHTML, safeURL, sanitizeHTML} from "./html.js";
import {t, report} from "./i18n.js";

/** Browser-owned editing: no state reconciliation or DOM writes during IME input. */
export class RichTextInput {
  composing = false;
  range = null;
  constructor(value = "") {
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.element = document.createElement("div");
    this.element.className = "ts-rich-input";
    this.element.dataset.termShareEditor = "true";
    this.toolbar = document.createElement("div");
    this.toolbar.className = "ts-rich-toolbar";
    this.toolbar.setAttribute("role", "toolbar");
    this.toolbar.setAttribute("aria-label", t("FormattingToolbar"));
    const tools = [
      ["bold", "Bold", "fa-bold"], ["italic", "Italic", "fa-italic"],
      ["underline", "Underline", "fa-underline"], ["strikeThrough", "Strikethrough", "fa-strikethrough"],
      ["heading", "Heading", "fa-heading"], ["paragraph", "Paragraph", "fa-paragraph"],
      ["insertUnorderedList", "BulletList", "fa-list-ul"], ["insertOrderedList", "NumberedList", "fa-list-ol"],
      ["link", "InsertLink", "fa-link"], ["image", "InsertImage", "fa-image"],
      ["removeFormat", "ClearFormatting", "fa-eraser"], ["undo", "Undo", "fa-rotate-left"], ["redo", "Redo", "fa-rotate-right"]
    ];
    for (const [action, label, icon] of tools) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.richAction = action;
      button.title = t(label);
      button.setAttribute("aria-label", t(label));
      button.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i>`;
      this.toolbar.append(button);
    }
    const color = document.createElement("input");
    color.type = "color";
    color.value = "#9b4c3f";
    color.title = t("TextColor");
    color.setAttribute("aria-label", t("TextColor"));
    color.className = "ts-text-color";
    this.toolbar.append(color);
    this.surface = document.createElement("div");
    this.surface.className = "ts-editor-surface";
    this.surface.setAttribute("contenteditable", "true");
    this.surface.setAttribute("role", "textbox");
    this.surface.setAttribute("aria-label", t("Description"));
    this.surface.setAttribute("aria-multiline", "true");
    this.surface.setAttribute("spellcheck", "true");
    this.surface.innerHTML = sanitizeHTML(value);
    this.initialHTML = this.surface.innerHTML;
    this.element.append(this.toolbar, this.surface);
    this.surface.addEventListener("compositionstart", () => {
      this.composing = true;
      this.enableTools(false);
    }, {signal});
    this.surface.addEventListener("compositionend", () => {
      this.composing = false;
      this.enableTools(true);
      // In particular, do not append event.data or reset innerHTML here.
    }, {signal});
    document.addEventListener("selectionchange", () => this.rememberSelection(), {signal});
    this.toolbar.addEventListener("pointerdown", event => {
      this.rememberSelection();
      if (event.target.closest("button")) event.preventDefault();
    }, {signal});
    this.toolbar.addEventListener("click", event => {
      const button = event.target.closest("button[data-rich-action]");
      if (button) void this.action(button.dataset.richAction).catch(report);
    }, {signal});
    color.addEventListener("input", () => this.command("foreColor", color.value), {signal});
    this.surface.addEventListener("paste", event => {
      event.preventDefault();
      if (this.composing) return;
      const html = event.clipboardData?.getData("text/html");
      const plain = event.clipboardData?.getData("text/plain") ?? "";
      this.command("insertHTML", html ? sanitizeHTML(html) : escapeHTML(plain).replace(/\r?\n/g, "<br>"));
    }, {signal});
    // Use the image picker instead of executing arbitrary dropped HTML.
    this.surface.addEventListener("drop", event => event.preventDefault(), {signal});
  }
  get value() { return this.surface.innerHTML; }
  isDirty() { return this.value !== this.initialHTML; }
  enableTools(enabled) {
    for (const control of this.toolbar.querySelectorAll("button, input")) control.disabled = !enabled;
  }
  rememberSelection() {
    if (this.composing) return;
    const selection = document.getSelection();
    if (selection?.rangeCount && this.surface.contains(selection.getRangeAt(0).commonAncestorContainer)) this.range = selection.getRangeAt(0).cloneRange();
  }
  restoreSelection() {
    this.surface.focus({preventScroll: true});
    const selection = document.getSelection();
    const range = this.range?.commonAncestorContainer?.isConnected && this.surface.contains(this.range.commonAncestorContainer) ? this.range.cloneRange() : document.createRange();
    if (!this.range || !this.surface.contains(range.commonAncestorContainer)) { range.selectNodeContents(this.surface); range.collapse(false); }
    selection.removeAllRanges();
    selection.addRange(range);
  }
  command(command, value = null) {
    const allowed = new Set(["bold", "italic", "underline", "strikeThrough", "formatBlock", "insertUnorderedList", "insertOrderedList", "createLink", "insertHTML", "foreColor", "removeFormat", "undo", "redo"]);
    if (this.composing || !allowed.has(command)) return false;
    if (typeof document.execCommand !== "function") { ui.notifications.warn(t("FormattingUnavailable")); return false; }
    this.restoreSelection();
    // Native editing commands preserve the browser's undo history. Only explicit
    // toolbar/paste actions call them; input and composition events never do.
    if (!["undo", "redo"].includes(command)) document.execCommand("styleWithCSS", false, true);
    const changed = document.execCommand(command, false, value);
    this.rememberSelection();
    return changed;
  }
  async action(action) {
    if (this.composing) return;
    if (action === "heading") return this.command("formatBlock", "h2");
    if (action === "paragraph") return this.command("formatBlock", "p");
    if (action === "link") {
      this.rememberSelection();
      const fields = await foundry.applications.api.DialogV2.input({
        window: {title: t("InsertLink")},
        content: `<label>${escapeHTML(t("LinkAddress"))}<input type="text" name="url" required></label>`,
        rejectClose: false
      });
      if (!fields?.url || !this.element.isConnected || this.composing) return;
      const url = fields.url.trim();
      if (!safeURL(url)) { ui.notifications.warn(t("InvalidAddress")); return; }
      this.restoreSelection();
      if (document.getSelection().isCollapsed) this.command("insertHTML", `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(url)}</a>`);
      else this.command("createLink", url);
      return;
    }
    if (action === "image") {
      this.rememberSelection();
      const Picker = foundry.applications.apps?.FilePicker?.implementation ?? foundry.applications.apps?.FilePicker ?? globalThis.FilePicker;
      if (Picker) {
        const picker = new Picker({type: "image", callback: path => this.insertImage(path)});
        await picker.browse();
      } else {
        const fields = await foundry.applications.api.DialogV2.input({window: {title: t("InsertImage")}, content: `<label>${escapeHTML(t("ImageAddress"))}<input type="text" name="path" required></label>`, rejectClose: false});
        if (fields?.path) this.insertImage(fields.path);
      }
      return;
    }
    return this.command(action);
  }
  insertImage(path) {
    if (!this.element.isConnected || this.composing) return;
    if (!safeURL(path, true)) { ui.notifications.warn(t("InvalidAddress")); return; }
    this.command("insertHTML", `<img src="${escapeHTML(path)}" alt="">`);
  }
  destroy() { this.abort.abort(); }
}
