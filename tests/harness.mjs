/** Contract fixture only: this is not a Foundry server or a real ProseMirror editor. */
import {JSDOM} from "jsdom";
import Handlebars from "handlebars";
import {readFile} from "node:fs/promises";
import {randomBytes} from "node:crypto";
const dom = new JSDOM('<!doctype html><html><body><section id="chat"><textarea id="chat-message" name="message"></textarea></section></body></html>', {url: "https://foundry.test/", pretendToBeVisual: true});
for (const key of ["window", "document", "DOMParser", "HTMLElement", "MutationObserver", "Event", "KeyboardEvent", "CompositionEvent", "AbortController", "Blob", "File"]) globalThis[key] = dom.window[key];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
export const translation = JSON.parse(await readFile(new URL("../lang/ko.json", import.meta.url))).TERM_SHARE;
const hookMap = new Map();
let hookId = 0;
globalThis.Hooks = {
  on(name, fn) { const id = ++hookId; if (!hookMap.has(name)) hookMap.set(name, []); hookMap.get(name).push({id, fn}); return id; },
  off(name, id) { hookMap.set(name, (hookMap.get(name) ?? []).filter(item => item.id !== id)); },
  call(name, ...args) { let result; for (const {fn} of hookMap.get(name) ?? []) { if (fn(...args) === false) result = false; } return result; },
  fire(name, ...args) { for (const {fn} of [...(hookMap.get(name) ?? [])]) fn(...args); }
};
// Define once separately so the ID is captured before the hook fires.
Hooks.once = function(name, fn) { const id = this.on(name, (...args) => { this.off(name, id); return fn(...args); }); return id; };
export const values = new Map();
export const definitions = new Map();
export const notices = [];
export const messages = [];
export const confirms = [];
export const menus = new Map();
export const createdOptions = [];
globalThis.ui = {notifications: Object.fromEntries(["info", "warn", "error"].map(level => [level, message => notices.push({level, message})]))};
globalThis.game = {
  user: {id: "gm", name: "플레이어 A", isGM: true}, version: "14-contract-fixture",
  i18n: {format(key, data) { return (translation[key.replace(/^TERM_SHARE\./, "")] ?? key).replace(/\{(\w+)\}/g, (all, key) => String(data[key] ?? all)); }},
  modules: new Map([["term-share", {active: true}]]),
  settings: {
    register(module, key, definition) { definitions.set(key, definition); if (!values.has(key)) values.set(key, structuredClone(definition.default)); },
    registerMenu(module, key, options) { menus.set(key, options); },
    get(module, key) { return values.get(key); },
    async set(module, key, value) { if (definitions.get(key)?.scope === "world" && !game.user.isGM) throw new Error("server rejected"); values.set(key, structuredClone(value)); definitions.get(key)?.onChange?.(value); return value; }
  }
};
class Application {
  static DEFAULT_OPTIONS = {};
  constructor(options = {}) { this.options = {...this.constructor.DEFAULT_OPTIONS, ...options}; this.rendered = false; }
  async _canRender() { return true; }
  async render(options = {}) {
    await this._canRender(options);
    const context = await this._prepareContext(options);
    const path = this.constructor.PARTS.main.template.replace("modules/term-share/", "../");
    const template = await readFile(new URL(path, import.meta.url), "utf8");
    this.element?.remove();
    this.element = document.createElement("div");
    this.element.className = this.options.classes.join(" ");
    this.element.id = this.options.id;
    this.element.innerHTML = Handlebars.compile(template)(context);
    document.body.append(this.element);
    this.rendered = true;
    this._onRender(context, options);
    return this;
  }
  _onRender() {}
  _onClose() {}
  async close(options = {}) { this.rendered = false; this._onClose(options); this.element?.remove(); return this; }
  bringToFront() {}
}
export const editorFactory = {
  create({value}) {
    const element = document.createElement("div");
    element.setAttribute("data-mock-editor", "");
    element.innerHTML = value;
    element.value = value;
    element.save = () => { element.value = element.innerHTML; };
    element.isDirty = () => element.innerHTML !== value;
    return element;
  }
};
export const Message = {
  async create(data, options) { const copy = structuredClone(data); messages.push(copy); createdOptions.push(options); return {id: String(messages.length), ...copy}; }
};
globalThis.CONFIG = {ChatMessage: {documentClass: Message}};
globalThis.CONST = {CHAT_MESSAGE_STYLES: {OTHER: 0}};
globalThis.foundry = {
  utils: {randomID: () => randomBytes(8).toString("hex")},
  applications: {
    api: {ApplicationV2: Application, HandlebarsApplicationMixin: cls => cls, DialogV2: {async confirm() { return confirms.shift() ?? false; }}},
    elements: {HTMLProseMirrorElement: editorFactory},
    sidebar: {tabs: {ChatLog: {parse: () => ["invalid", [], undefined]}}}
  }
};
export function chatInput() {
  let input = document.querySelector("#chat-message");
  input.getBoundingClientRect = () => ({width: 320, left: 700, top: 600, bottom: 660});
  input.getClientRects = () => [input.getBoundingClientRect()];
  return input;
}
export const tick = () => new Promise(resolve => setTimeout(resolve, 5));
export function type(input, value) { input.focus(); input.value = value; input.dispatchEvent(new Event("input", {bubbles: true})); }
export function key(input, key, extra = {}) { const event = new KeyboardEvent("keydown", {key, code: key, bubbles: true, cancelable: true, ...extra}); input.dispatchEvent(event); return event; }
export function clearResults() { notices.length = 0; messages.length = 0; createdOptions.length = 0; }
