import test, {afterEach} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import "./harness.mjs";
import {RichTextInput} from "../scripts/rich-text-input.js";
import {AutocompleteController} from "../scripts/autocomplete.js";
import {DictionaryStore} from "../scripts/store.js";
import {ChatController} from "../scripts/chat.js";

let editor;
const originalExec = document.execCommand;
afterEach(() => {
  editor?.destroy(); editor?.element.remove(); editor = null;
  if (originalExec === undefined) delete document.execCommand; else document.execCommand = originalExec;
});
function mount(value) { editor = new RichTextInput(value); document.body.append(editor.element); return editor.surface; }

test("dictionary editor mounts a visible native surface with safe rich HTML and real formatting controls", () => {
  const surface = mount('<p><strong>처음 설명</strong></p><script>evil()</script>');
  assert.equal(surface.getAttribute("contenteditable"), "true");
  assert.equal(surface.getAttribute("role"), "textbox");
  assert.equal(surface.getAttribute("aria-multiline"), "true");
  assert.match(editor.value, /<strong>처음 설명<\/strong>/);
  assert.doesNotMatch(editor.value, /script/);
  assert.equal(editor.isDirty(), false);
  assert.equal(editor.element.querySelectorAll("prose-mirror, .ProseMirror").length, 0);
  assert.ok(editor.toolbar.querySelectorAll("button[type=button]").length >= 10);
});

test("editor CSS uses an explicit editing height and paired foreground/background colors in both themes", async () => {
  const css = await readFile(new URL("../styles/term-share.css", import.meta.url), "utf8");
  const style = document.createElement("style"); style.textContent = css; document.head.append(style);
  try {
    const rule = [...style.sheet.cssRules].find(rule => rule.selectorText === ".term-share-app .ts-editor-surface");
    assert.equal(rule.style.getPropertyValue("height"), "300px");
    assert.equal(rule.style.getPropertyValue("min-height"), "280px");
    assert.equal(rule.style.getPropertyValue("color"), "var(--ts-input-fg)");
    assert.equal(rule.style.getPropertyValue("background-color"), "var(--ts-input-bg)");
    assert.match(css, /--ts-input-bg: #faf8f2/); assert.match(css, /--ts-input-fg: #252925/);
    assert.match(css, /--ts-input-bg: #24282d/); assert.match(css, /--ts-input-fg: #ecebe6/);
    assert.doesNotMatch(css, /prose-mirror\s*\{[^}]*height:\s*100%/);
  } finally { style.remove(); }
});

test("Korean composition never appends event.data, resets text, moves the caret or executes formatting", () => {
  const surface = mount("");
  const calls = [];
  document.execCommand = (...args) => { calls.push(args); return true; };
  surface.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true, data: ""}));
  surface.textContent = "ㄱ";
  surface.dispatchEvent(new window.InputEvent("input", {bubbles: true, isComposing: true, inputType: "insertCompositionText", data: "ㄱ"}));
  surface.textContent = "가";
  surface.dispatchEvent(new window.InputEvent("input", {bubbles: true, isComposing: true, inputType: "insertCompositionText", data: "가"}));
  assert.equal(editor.command("bold"), false);
  const observer = new MutationObserver(() => {});
  observer.observe(surface, {childList: true, characterData: true, subtree: true});
  const selection = document.getSelection();
  const range = document.createRange(); range.selectNodeContents(surface); range.collapse(false); selection.removeAllRanges(); selection.addRange(range);
  const anchorNode = selection.anchorNode, anchorOffset = selection.anchorOffset;
  surface.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true, data: "가"}));
  assert.equal(editor.value, "가");
  assert.equal(editor.composing, false);
  assert.equal(observer.takeRecords().length, 0);
  assert.equal(selection.anchorNode, anchorNode); assert.equal(selection.anchorOffset, anchorOffset);
  assert.equal(calls.length, 0);
  observer.disconnect();
});

test("toolbar actions restore the selected text and only run native commands after composition ends", () => {
  const surface = mount("서식 편집");
  const selection = document.getSelection(); const range = document.createRange();
  range.setStart(surface.firstChild, 0); range.setEnd(surface.firstChild, 2);
  selection.removeAllRanges(); selection.addRange(range); editor.rememberSelection();
  const input = document.createElement("input"); document.body.append(input); input.focus();
  const calls = [];
  document.execCommand = (name, unused, value) => { calls.push({name, value, selected: document.getSelection().toString()}); return true; };
  try {
    assert.equal(editor.command("bold"), true);
    assert.deepEqual(calls.map(call => call.name), ["styleWithCSS", "bold"]);
    assert.equal(calls[1].selected, "서식");
    assert.equal(editor.command("arbitraryCommand"), false);
  } finally { input.remove(); }
});

test("pasting rich text is sanitized before insertion, and paste is suppressed during composition", () => {
  const surface = mount(""); const calls = [];
  document.execCommand = (name, unused, value) => { calls.push({name, value}); return true; };
  const paste = () => {
    const event = new Event("paste", {bubbles: true, cancelable: true});
    Object.defineProperty(event, "clipboardData", {value: {getData: type => type === "text/html" ? '<b>본문</b><img src="x" onerror="evil()"><script>evil()</script>' : ""}});
    surface.dispatchEvent(event); return event;
  };
  assert.equal(paste().defaultPrevented, true);
  const insert = calls.find(call => call.name === "insertHTML");
  assert.match(insert.value, /<b>본문<\/b>/); assert.doesNotMatch(insert.value, /onerror|script|evil/);
  const count = calls.length;
  surface.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
  paste(); assert.equal(calls.length, count);
});

test("dictionary editing cannot be mistaken for chat, and editor listeners are removed on destruction", () => {
  const surface = mount("가");
  const store = new DictionaryStore(); const autocomplete = new AutocompleteController(store, new ChatController(store));
  assert.equal(autocomplete.getInput(surface), null);
  const fakeChat = document.createElement("textarea"); fakeChat.id = "chat-message"; editor.element.append(fakeChat);
  assert.equal(autocomplete.getInput(fakeChat), null);
  editor.destroy();
  surface.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
  assert.equal(editor.composing, false);
});
