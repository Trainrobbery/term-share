import test from "node:test";
import assert from "node:assert/strict";
import {values, messages, chatInput, type, key, clearResults} from "./harness.mjs";
import {emptyDictionary} from "../scripts/core.js";
import {DictionaryStore} from "../scripts/store.js";
import {ChatController} from "../scripts/chat.js";
import {AutocompleteController} from "../scripts/autocomplete.js";

const wait = () => new Promise(resolve => setTimeout(resolve, 90));
function setup() {
  clearResults();
  values.set("dictionary", {...emptyDictionary(), entries: [
    {id: "poison", name: "중독", aliases: [], description: "<p>중독 설명</p>"},
    {id: "resist", name: "중독 저항", aliases: [], description: "<p>저항 설명</p>"},
    {id: "bleed", name: "출혈", aliases: [], description: "<p>출혈 설명</p>"}
  ]});
  values.set("questionCommand", true); values.set("autocomplete", true); values.set("suggestionCount", 6);
  const store = new DictionaryStore();
  const controller = new AutocompleteController(store, new ChatController(store)); controller.start();
  const input = chatInput(); type(input, "/? ");
  return {controller, input};
}
const compose = (input, phase, data = "") => input.dispatchEvent(new CompositionEvent(phase, {bubbles: true, data}));
function composingText(input, value) {
  input.value = value;
  input.dispatchEvent(new window.InputEvent("input", {bubbles: true, inputType: "insertCompositionText", isComposing: true}));
}
const names = controller => controller.rows.map(row => row.entry.name);

test("Korean suggestions appear and filter during composition without a trailing space", () => {
  const {controller, input} = setup();
  try {
    compose(input, "compositionstart");
    composingText(input, "/? 중");
    assert.equal(controller.popup.hidden, false);
    assert.deepEqual(names(controller), ["중독", "중독 저항"]);
    const selection = [input.selectionStart, input.selectionEnd];
    controller.update();
    assert.equal(input.value, "/? 중");
    assert.deepEqual([input.selectionStart, input.selectionEnd], selection);
    composingText(input, "/? 중독 저");
    assert.equal(controller.popup.hidden, false);
    assert.deepEqual(names(controller), ["중독 저항"]);
    composingText(input, "/? 중");
    assert.deepEqual(names(controller), ["중독", "중독 저항"]);
    assert.equal(messages.length, 0);
  } finally { controller.destroy(); }
});

test("compositionupdate reads the actual value after the browser edit and never appends event.data", async () => {
  const {controller, input} = setup();
  try {
    compose(input, "compositionstart");
    compose(input, "compositionupdate", "중");
    input.value = "/? 중"; // Some IMEs update the DOM after compositionupdate.
    await wait();
    assert.equal(controller.popup.hidden, false);
    assert.deepEqual(names(controller), ["중독", "중독 저항"]);
    assert.equal(input.value, "/? 중");
    assert.equal(messages.length, 0);
  } finally { controller.destroy(); }
});

test("live composition respects disabled suggestions, missing matches and input focus", async () => {
  const {controller, input} = setup();
  try {
    compose(input, "compositionstart");
    composingText(input, "/? 중"); assert.equal(controller.popup.hidden, false);
    composingText(input, "/? 없는"); assert.equal(controller.popup.hidden, true);
    values.set("autocomplete", false);
    composingText(input, "/? 중"); assert.equal(controller.popup.hidden, true);
    values.set("autocomplete", true);
    composingText(input, "/? 중"); assert.equal(controller.popup.hidden, false);
    compose(input, "compositionupdate", "중");
    input.blur();
    await wait(); assert.equal(controller.popup.hidden, true);
    assert.equal(messages.length, 0);
  } finally { controller.destroy(); }
});

test("Tab and mouse selection wait for composition to end before replacing the input", async () => {
  for (const selection of ["Tab", "mouse"]) {
    const {controller, input} = setup();
    try {
      compose(input, "compositionstart"); composingText(input, "/? 중");
      assert.equal(controller.popup.hidden, false);
      if (selection === "Tab") assert.equal(key(input, "Tab").defaultPrevented, true);
      else controller.popup.querySelector("[data-ts-suggestion]").dispatchEvent(new Event("pointerdown", {bubbles: true, cancelable: true}));
      assert.equal(input.value, "/? 중", "do not rewrite an active composition");
      compose(input, "compositionend", "중");
      input.dispatchEvent(new window.InputEvent("input", {bubbles: true, inputType: "insertText"}));
      await wait();
      assert.equal(input.value, "/? 중독");
      assert.equal(document.activeElement, input);
      assert.equal(messages.length, 0, "completion never shares automatically");
    } finally { controller.destroy(); }
  }
});
