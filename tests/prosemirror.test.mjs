import test from "node:test";
import assert from "node:assert/strict";
import {values, messages, notices, key, tick, clearResults} from "./harness.mjs";
import {EditorState, Plugin} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {Schema} from "prosemirror-model";
import {schema as blockSchema} from "prosemirror-schema-basic";
import {AutocompleteController} from "../scripts/autocomplete.js";
import {ChatController} from "../scripts/chat.js";
import {DictionaryStore} from "../scripts/store.js";
import {emptyDictionary, MODULE_ID} from "../scripts/core.js";

function fixture(schema) {
  clearResults();
  values.set("dictionary", {...emptyDictionary(), entries: [{id: "a", name: "출혈", aliases: ["Bleeding"], description: "<p>설명</p>"}]});
  values.set("questionCommand", true); values.set("autocomplete", true); values.set("suggestionCount", 6);
  const store = new DictionaryStore();
  const controller = new AutocompleteController(store, new ChatController(store));
  // The hook must be registered before Foundry creates its native chat view.
  controller.registerProseMirrorHooks();
  const plugins = {base: new Plugin({})};
  Hooks.fire("createProseMirrorEditor", "chat-test", plugins, {});
  const host = document.createElement("prose-mirror"); host.setAttribute("name", "message"); host.id = "chat-input";
  document.body.append(host);
  const view = new EditorView(host, {state: EditorState.create({schema, plugins: Object.values(plugins)})});
  view.dom.getBoundingClientRect = () => ({width: 320, left: 700, top: 600, bottom: 660});
  view.dom.getClientRects = () => [view.dom.getBoundingClientRect()];
  controller.start(); view.focus();
  return {controller, view, cleanup() { view.destroy(); controller.destroy(); host.remove(); }};
}

test("V14 inline ProseMirror state completes with Tab and clears after exactly one public share", async () => {
  const schema = new Schema({nodes: {doc: {content: "text*"}, text: {group: "inline"}}});
  const {controller, view, cleanup} = fixture(schema);
  try {
    view.dispatch(view.state.tr.insertText("/? 출"));
    assert.equal(controller.read(view.dom), "/? 출");
    // The native PM plugin update (without a textarea input event) refreshes suggestions.
    assert.equal(controller.input, view.dom);
    assert.equal(controller.popup.hidden, false);
    key(view.dom, "Tab");
    assert.equal(view.state.doc.textContent, "/? 출혈");
    assert.equal(view.state.selection.to, view.state.doc.content.size);
    assert.equal(messages.length, 0);
    key(view.dom, "Enter"); await tick();
    assert.equal(messages.length, 1);
    assert.equal(view.state.doc.textContent, "");
    assert.equal(view.dom.textContent, "");
  } finally { cleanup(); }
});

test("ProseMirror paragraph schemas and marks use transactions; a failed search keeps the native document", async () => {
  const {controller, view, cleanup} = fixture(blockSchema);
  try {
    view.dispatch(view.state.tr.insertText("/term Bleed"));
    assert.equal(controller.input, view.dom);
    key(view.dom.firstChild, "Tab");
    assert.equal(view.state.doc.textContent, "/term 출혈");
    assert.equal(view.state.doc.firstChild.type.name, "paragraph");
    controller.write(view.dom, "/? 없는단어");
    key(view.dom, "Enter"); await tick();
    assert.equal(view.state.doc.textContent, "/? 없는단어");
    assert.equal(messages.length, 0);
    assert.equal(notices.at(-1).level, "warn");
    view.dom.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    key(view.dom, "Enter", {isComposing: true});
    assert.equal(messages.length, 0);
  } finally { cleanup(); }
});

test("journal ProseMirror views are never treated as chat inputs", () => {
  const store = new DictionaryStore();
  const controller = new AutocompleteController(store, new ChatController(store));
  const host = document.createElement("div"); host.className = "journal-sheet";
  document.body.append(host);
  const view = new EditorView(host, {state: EditorState.create({schema: blockSchema})});
  try { assert.equal(controller.getInput(view.dom), null); }
  finally { view.destroy(); host.remove(); }
});

test("ProseMirror shares the final committed Korean state after a single composition Enter", async () => {
  const {controller, view, cleanup} = fixture(blockSchema);
  try {
    view.dispatch(view.state.tr.insertText("/? 출혀"));
    view.dom.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    const enter = key(view.dom, "Enter", {isComposing: true, keyCode: 229});
    assert.equal(enter.defaultPrevented, false);
    view.dom.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    const newline = new window.InputEvent("beforeinput", {inputType: "insertParagraph", bubbles: true, cancelable: true});
    view.dom.dispatchEvent(newline);
    assert.equal(newline.defaultPrevented, true);
    view.dispatch(view.state.tr.insertText("/? 출혈", 0, view.state.doc.content.size));
    await new Promise(resolve => setTimeout(resolve, 90));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].flags[MODULE_ID].entryId, "a");
    assert.equal(controller.read(view.dom), "");
    assert.equal(view.state.doc.textContent, "");
  } finally { cleanup(); }
});

test("ProseMirror suggestions read the live composing DOM while the committed model is still behind", () => {
  const inline = new Schema({nodes: {doc: {content: "text*"}, text: {group: "inline"}}});
  for (const schema of [inline, blockSchema]) {
    const {controller, view, cleanup} = fixture(schema);
    try {
      values.get("dictionary").entries.push(
        {id: "poison", name: "중독", aliases: [], description: "<p>중독</p>"},
        {id: "resist", name: "중독 저항", aliases: [], description: "<p>저항</p>"}
      );
      view.dispatch(view.state.tr.insertText("/? "));
      view.dom.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
      const committed = view.state;
      const text = schema === inline ? view.dom.firstChild : view.dom.firstChild.firstChild;
      text.data = "/? 중"; // Browser edit before ProseMirror flushes its observer.
      controller.update();
      assert.equal(controller.popup.hidden, false);
      assert.deepEqual(controller.rows.map(row => row.entry.name), ["중독", "중독 저항"]);
      assert.equal(view.state, committed, "preview must not dispatch a transaction");
      assert.equal(view.state.doc.textContent, "/? ");
      assert.equal(text.data, "/? 중");
      text.data = "/? 중독 저";
      controller.update();
      assert.deepEqual(controller.rows.map(row => row.entry.name), ["중독 저항"]);
      assert.equal(messages.length, 0);
    } finally { cleanup(); }
  }
});

test("ProseMirror Tab or mouse completion does not rewrite an active IME document", async () => {
  for (const selection of ["Tab", "mouse"]) {
    const {controller, view, cleanup} = fixture(blockSchema);
    try {
      view.dispatch(view.state.tr.insertText("/? 출"));
      view.dom.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
      controller.update();
      const composingState = view.state;
      if (selection === "Tab") key(view.dom, "Tab");
      else controller.popup.querySelector("[data-ts-suggestion]").dispatchEvent(new Event("pointerdown", {bubbles: true, cancelable: true}));
      assert.equal(view.state, composingState);
      assert.equal(view.dom.textContent, "/? 출");
      view.dom.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
      await new Promise(resolve => setTimeout(resolve, 90));
      assert.equal(view.state.doc.textContent, "/? 출혈");
      assert.equal(view.dom.textContent, "/? 출혈");
      assert.equal(document.activeElement, view.dom);
      assert.equal(messages.length, 0);
    } finally { cleanup(); }
  }
});
