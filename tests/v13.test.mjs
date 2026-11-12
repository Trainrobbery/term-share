import test, {after} from "node:test";
import assert from "node:assert/strict";
import {definitions, values, messages, createdOptions, Message, menus, chatInput, type, key, tick, notices} from "./harness.mjs";
import {MODULE_ID} from "../scripts/core.js";

game.version = "13.350";
game.release = {generation: 13};
// V13 has patterns and the chatMessage hook, without the V14 command registry.
const patterns = {roll: /^\/r\s+/i, invalid: /^\//, thirdPartyQuestion: /^\/\?(?=\s|$)/g};
const legacyLog = {MESSAGE_PATTERNS: patterns, parse: message => message.startsWith("/") ? ["invalid", message.match(/^\/(.*)/)] : ["other", [message]]};
delete foundry.applications.sidebar.tabs.ChatLog;
globalThis.ChatLog = legacyLog;
const originalCreate = Message.create;
Message.create = async (data, options) => {
  assert.deepEqual(options, {rollMode: "publicroll"}, "V13 must never receive a V14 messageMode option");
  return originalCreate(data, options);
};
await import("../scripts/main.js");
after(() => { Hooks.fire("shutdown"); Message.create = originalCreate; delete globalThis.ChatLog; });

test("V13 lifecycle keeps pattern registrations intact and supports hook commands, textarea autocomplete and public sharing", async () => {
  Hooks.fire("init"); Hooks.fire("ready");
  assert.equal(legacyLog.CHAT_COMMANDS, undefined);
  assert.equal(legacyLog.MESSAGE_PATTERNS, patterns);
  assert.equal(Object.keys(patterns).length, 3, "no patterns are overwritten or inserted");
  assert.equal(patterns.thirdPartyQuestion.lastIndex, 0, "conflict detection must not mutate third-party regex state");
  assert.equal(menus.get("manager").restricted, true);
  assert.equal(definitions.get("autocomplete").scope, "user");
  assert.equal(definitions.get("cardPalette").default, "legacy");
  assert.equal(document.documentElement.dataset.termSharePalette, "legacy");
  await game.settings.set(MODULE_ID, "cardPalette", "catalog");
  assert.equal(document.documentElement.dataset.termSharePalette, "catalog");
  await game.settings.set(MODULE_ID, "cardPalette", "legacy");
  const api = game.modules.get(MODULE_ID).api;
  assert.equal(api.diagnostics().generation, 13);
  assert.equal(api.diagnostics().transport, "chatMessage hook");
  assert.deepEqual(api.diagnostics().commandConflicts, ["/?"]);
  assert.equal(notices.some(notice => notice.level === "warn"), true);
  values.get("dictionary").entries.push({id: "bleeding", name: "출혈", aliases: ["Bleeding"], description: "<p>V13 예시</p>"});
  assert.equal(Hooks.call("chatMessage", legacyLog, "/term Bleeding", {}), false, "cancel the source command synchronously before core can publish it");
  await tick();
  assert.equal(messages.length, 1);
  assert.deepEqual(createdOptions[0], {rollMode: "publicroll"});
  assert.deepEqual(messages[0].whisper, []); assert.equal(messages[0].blind, false);
  assert.equal(Hooks.call("chatMessage", legacyLog, "일반 채팅", {}), undefined);
  const input = chatInput(); type(input, "/? 출");
  assert.equal(document.querySelector(".term-share-autocomplete").hidden, false);
  key(input, "Tab"); assert.equal(input.value, "/? 출혈"); assert.equal(messages.length, 1);
  key(input, "Enter"); await tick(); assert.equal(messages.length, 2); assert.equal(input.value, "");
  await game.settings.set(MODULE_ID, "questionCommand", false);
  assert.equal(Hooks.call("chatMessage", legacyLog, "/? 출혈", {}), undefined);
  assert.equal(Hooks.call("chatMessage", legacyLog, "/term 출혈", {}), false);
  await tick(); assert.equal(messages.length, 3);
  type(input, "/term 없는단어"); key(input, "Enter"); await tick();
  assert.equal(input.value, "/term 없는단어"); assert.equal(messages.length, 3);
  assert.equal(legacyLog.MESSAGE_PATTERNS, patterns);
});

test("V13 GM editor uses the native input surface and preserves rich HTML, dictionary IDs and format", async () => {
  let editor;
  try {
    const {TermEditor} = await import("../scripts/apps.js");
    editor = new TermEditor("bleeding"); await editor.render();
    assert.equal(editor.richEditor.save, undefined);
    editor.richEditor.surface.innerHTML = '<p><strong>V13에서 수정</strong>한 설명</p>';
    await editor.save();
    assert.equal(editor.rendered, false);
    const saved = values.get("dictionary");
    assert.equal(saved.formatVersion, 1);
    assert.equal(saved.entries[0].id, "bleeding");
    assert.match(saved.entries[0].description, /<strong>V13에서 수정<\/strong>/);
  } finally {
    if (editor?.rendered) { editor.saved = true; await editor.close(); }
  }
});
