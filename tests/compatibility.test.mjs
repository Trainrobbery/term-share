import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import "./harness.mjs";
import {foundryGeneration, chatLogClass, publicChatOptions} from "../scripts/compatibility.js";

test("Foundry generation selects the correct public message option", () => {
  const originalVersion = game.version;
  const originalRelease = game.release;
  try {
    game.release = {generation: 13}; game.version = "14.368";
    assert.equal(foundryGeneration(), 13, "the release generation is authoritative");
    assert.deepEqual(publicChatOptions(), {rollMode: "publicroll"});
    game.release = {generation: 14};
    assert.deepEqual(publicChatOptions(), {messageMode: "public"});
    delete game.release; game.version = "13.350";
    assert.equal(foundryGeneration(), 13);
    assert.deepEqual(publicChatOptions(), {rollMode: "publicroll"});
  } finally { game.version = originalVersion; if (originalRelease === undefined) delete game.release; else game.release = originalRelease; }
});

test("ChatLog supports either namespace or global export", () => {
  const namespaced = foundry.applications.sidebar.tabs.ChatLog;
  try {
    globalThis.ChatLog = {legacy: true};
    assert.equal(chatLogClass(), namespaced);
    delete foundry.applications.sidebar.tabs.ChatLog;
    assert.equal(chatLogClass(), globalThis.ChatLog);
  } finally { foundry.applications.sidebar.tabs.ChatLog = namespaced; delete globalThis.ChatLog; }
});

test("the install manifest and version metadata cover V13 and retain V14", async () => {
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url)));
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url)));
  assert.deepEqual(manifest.compatibility, {minimum: "13", maximum: "14"});
  assert.equal(manifest.version, "0.1.0-alpha.14");
  assert.equal(pkg.version, manifest.version); assert.equal(lock.version, manifest.version);
  assert.deepEqual(manifest.styles, ["styles/term-share.css"]);
});
