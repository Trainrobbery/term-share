import test from "node:test";
import assert from "node:assert/strict";
import {values, messages, notices, chatInput, type, key, clearResults} from "./harness.mjs";
import {MODULE_ID, emptyDictionary} from "../scripts/core.js";
import {DictionaryStore} from "../scripts/store.js";
import {ChatController} from "../scripts/chat.js";
import {AutocompleteController} from "../scripts/autocomplete.js";

const settle = () => new Promise(resolve => setTimeout(resolve, 90));
function setup(query = "/? 출혈") {
  clearResults();
  values.set("dictionary", {...emptyDictionary(), entries: [
    {id: "bleeding", name: "출혈", aliases: ["Bleeding"], description: "<p>설명</p>"},
    {id: "resistance", name: "출혈 저항", aliases: [], description: "<p>저항</p>"}
  ]});
  values.set("questionCommand", true); values.set("autocomplete", true); values.set("suggestionCount", 6);
  const store = new DictionaryStore();
  const controller = new AutocompleteController(store, new ChatController(store));
  controller.start();
  const input = chatInput(); type(input, query);
  return {controller, input};
}
function composition(input, phase) { input.dispatchEvent(new CompositionEvent(phase, {bubbles: true})); }
function before(input, inputType) {
  const event = new window.InputEvent("beforeinput", {bubbles: true, cancelable: true, inputType});
  input.dispatchEvent(event); return event;
}

test("Enter immediately after compositionend prevents the textarea newline and shares without Tab", async () => {
  const {controller, input} = setup();
  try {
    composition(input, "compositionstart"); composition(input, "compositionend");
    const enter = key(input, "Enter");
    if (!enter.defaultPrevented) input.value += "\n"; // Model the browser's default textarea edit.
    assert.equal(enter.defaultPrevented, true);
    await settle();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].flags[MODULE_ID].entryId, "bleeding");
    assert.equal(input.value, "");
  } finally { controller.destroy(); }
});

test("composition Enter preserves the IME commit, blocks only line breaks and submits the final text once", async () => {
  const {controller, input} = setup("/? 출혀");
  try {
    composition(input, "compositionstart");
    const enter = key(input, "Enter", {isComposing: true, keyCode: 229});
    assert.equal(enter.defaultPrevented, false, "native IME commitment must remain possible");
    assert.equal(before(input, "insertCompositionText").defaultPrevented, false);
    assert.equal(before(input, "insertLineBreak").defaultPrevented, true);
    assert.equal(before(input, "insertParagraph").defaultPrevented, true);
    assert.equal(messages.length, 0);
    composition(input, "compositionend");
    input.value = "/? 출血";
    input.dispatchEvent(new window.InputEvent("input", {bubbles: true, inputType: "insertCompositionText"}));
    input.value = "/? 출혈";
    input.dispatchEvent(new window.InputEvent("input", {bubbles: true, inputType: "insertText"}));
    key(input, "Enter", {repeat: true});
    await settle();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].flags[MODULE_ID].entryId, "bleeding");
    assert.equal(input.value, "");
    assert.equal(notices.length, 0);
  } finally { controller.destroy(); }
});

test("compositionend before a Process/229 Enter still submits after the final input event", async () => {
  const {controller, input} = setup("/? 출혀");
  try {
    composition(input, "compositionstart"); composition(input, "compositionend");
    key(input, "Process", {code: "Enter", keyCode: 229});
    setTimeout(() => {
      input.value = "/? 출혈";
      input.dispatchEvent(new window.InputEvent("input", {bubbles: true, inputType: "insertText"}));
    }, 10);
    await settle();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].flags[MODULE_ID].entryId, "bleeding");
    assert.equal(input.value, "");
  } finally { controller.destroy(); }
});

test("pending IME submission is cancelled when the user changes or leaves the input", async () => {
  for (const reason of ["edit", "blur", "compose", "remove", "destroy", "paste", "selection"]) {
    const {controller, input} = setup();
    try {
      composition(input, "compositionstart"); key(input, "Enter", {isComposing: true}); composition(input, "compositionend");
      if (reason === "edit") { key(input, "a"); type(input, "/? 출혈 a"); }
      if (reason === "blur") input.blur();
      if (reason === "compose") { composition(input, "compositionstart"); composition(input, "compositionend"); }
      if (reason === "remove") input.remove();
      if (reason === "destroy") controller.destroy();
      if (reason === "paste") before(input, "insertFromPaste");
      if (reason === "selection") controller.popup.querySelector("[data-ts-suggestion]").dispatchEvent(new Event("pointerdown", {bubbles: true, cancelable: true}));
      await settle();
      assert.equal(messages.length, 0, reason);
    } finally {
      controller.destroy();
      if (!input.isConnected) document.querySelector("#chat").append(input);
    }
  }
});

test("IME Enter keeps unknown or partial queries for correction and works with autocomplete disabled", async () => {
  for (const query of ["출", "없는단어", "출혈"]) {
    const {controller, input} = setup(`/? ${query}`);
    try {
      values.set("autocomplete", false);
      composition(input, "compositionstart"); key(input, "Enter", {isComposing: true}); composition(input, "compositionend");
      await settle();
      const known = query === "출혈";
      assert.equal(messages.length, known ? 1 : 0);
      assert.equal(input.value, known ? "" : `/? ${query}`);
      if (!known) assert.equal(notices.at(-1).level, "warn");
    } finally { controller.destroy(); }
  }
});

test("ordinary composition and Shift+Enter do not request sharing", async () => {
  const {controller, input} = setup();
  try {
    composition(input, "compositionstart");
    key(input, "Process", {code: "KeyF", keyCode: 229, isComposing: true});
    composition(input, "compositionend");
    await settle(); assert.equal(messages.length, 0);
    assert.equal(key(input, "Enter", {shiftKey: true}).defaultPrevented, false);
    assert.equal(before(input, "insertLineBreak").defaultPrevented, false);
    await settle(); assert.equal(messages.length, 0);
  } finally { controller.destroy(); }
});
