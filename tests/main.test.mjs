import test from "node:test";
import assert from "node:assert/strict";
import {definitions, menus, values, messages, type, key, tick, chatInput} from "./harness.mjs";
import {MODULE_ID} from "../scripts/core.js";
await import("../scripts/main.js");

test("lifecycle registers GM menu, world data, user preferences and public API; starts once and shuts down", async () => {
  const Log = foundry.applications.sidebar.tabs.ChatLog;
  Log.CHAT_COMMANDS = {};
  Log.parse = message => {
    for (const [name, {rgx, fn}] of Object.entries(Log.CHAT_COMMANDS)) {
      const match = message.match(rgx);
      if (match) return [name, match, fn];
    }
    return ["invalid", [], undefined];
  };
  Hooks.fire("init");
  assert.equal(definitions.get("dictionary").scope, "world");
  assert.equal(definitions.get("dictionary").config, false);
  assert.equal(menus.get("manager").restricted, true);
  assert.equal(definitions.get("autocomplete").scope, "user");
  assert.equal(definitions.get("questionCommand").default, true);
  const api = game.modules.get(MODULE_ID).api;
  assert.equal(api.version, "0.1.0-alpha.12");
  assert.equal(api.diagnostics().transport, "CHAT_COMMANDS");
  Hooks.fire("ready"); Hooks.fire("ready");
  assert.equal(document.querySelectorAll(".term-share-autocomplete").length, 1);
  const manager = await api.openManager(); assert.equal(manager.rendered, true);
  await manager.close();
  values.get("dictionary").entries.push({id: "a", name: "출혈", aliases: [], description: "<p>설명</p>"});
  const returned = api.getTerms(); returned[0].name = "변조";
  assert.equal(api.getTerms()[0].name, "출혈");
  const [command, match, callback] = Log.parse("/term 출혈");
  assert.equal(await callback(command, match, {}, {}), false);
  assert.equal(messages.length, 1);
  assert.equal(Hooks.call("chatMessage", {}, "/term 출혈", {}), undefined, "fallback must not execute a registered native command twice");
  await game.settings.set(MODULE_ID, "questionCommand", false);
  assert.equal(Log.parse("/? 출혈")[0], "invalid");
  assert.equal(Log.parse("/term 출혈")[0], MODULE_ID);
  await game.settings.set(MODULE_ID, "questionCommand", true);
  game.user.isGM = false;
  const input = chatInput(); type(input, "/? 출혈"); key(input, "Enter"); await tick();
  assert.equal(messages.length, 2);
  await assert.rejects(api.openManager(), error => error.key === "GMOnly");
  Hooks.fire("shutdown");
  assert.equal(document.querySelectorAll(".term-share-autocomplete").length, 0);
  assert.equal(Log.CHAT_COMMANDS[MODULE_ID], undefined);
});
