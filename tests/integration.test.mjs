import test, {beforeEach, afterEach} from "node:test";
import assert from "node:assert/strict";
import {values, notices, messages, confirms, createdOptions, Message, chatInput, type, key, tick, clearResults} from "./harness.mjs";
import {MODULE_ID, emptyDictionary, fingerprint, validateEntries, exportDictionary} from "../scripts/core.js";
import {DictionaryStore} from "../scripts/store.js";
import {ChatController, cardHTML} from "../scripts/chat.js";
import {AutocompleteController} from "../scripts/autocomplete.js";

const {DictionaryManager, TermEditor, DictionaryImporter, connectApps} = await import("../scripts/apps.js");
const store = new DictionaryStore();
connectApps(store);
const chat = new ChatController(store);
let autocomplete;
let app;
const entries = () => validateEntries([
  {id: "bleeding", name: "출혈", aliases: ["Bleeding"], description: "<p><strong>매 턴</strong> 지속 피해를 받습니다.</p>"},
  {id: "resistance", name: "출혈 저항", aliases: [], description: "<p>출혈을 저항합니다.</p>"},
  {id: "focus", name: "집중", aliases: ["Concentration"], description: "<p>집중 상태를 유지합니다.</p>"}
]);
beforeEach(() => {
  game.user = {id: "gm", name: "플레이어 A", isGM: true};
  game.settings.register(MODULE_ID, "dictionary", {scope: "world", default: emptyDictionary(), onChange: () => store.notify()});
  values.set("dictionary", {...emptyDictionary(), entries: entries()});
  values.set("questionCommand", true);
  values.set("autocomplete", true);
  values.set("suggestionCount", 6);
  clearResults();
});
afterEach(async () => {
  autocomplete?.destroy(); autocomplete = null;
  if (app?.rendered) { if (app instanceof TermEditor) app.saved = true; await app.close(); } app = null;
  chat.destroy();
  confirms.length = 0;
});

test("players can share one public snapshot using their user name, independent of token or mode", async () => {
  game.user = {id: "player1", name: '<img src=x onerror=evil()>', isGM: false};
  assert.equal(await chat.share("BLEEDING"), true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].user, "player1");
  assert.deepEqual(messages[0].speaker, {alias: game.user.name});
  assert.deepEqual(messages[0].whisper, []);
  assert.equal(messages[0].blind, false);
  assert.equal(createdOptions[0].messageMode, "public");
  const rendered = document.createElement("div"); rendered.innerHTML = messages[0].content;
  assert.equal(rendered.querySelector(".ts-share-notice").textContent, `${game.user.name}님이 다음 지식을 공유했습니다.`);
  assert.doesNotMatch(messages[0].content, /<img src=x/);
  assert.match(messages[0].content, /<strong>매 턴<\/strong>/);
  assert.equal(messages[0].flags[MODULE_ID].entryId, "bleeding");
  const content = messages[0].content;
  values.get("dictionary").entries[0].description = "<p>수정</p>";
  assert.equal(messages[0].content, content);
  assert.equal(await chat.share("출혈"), true);
  assert.equal(messages.length, 2, "repeat sharing is permitted");
});

test("term cards show an escaped player notice above the title and rich description without a dictionary footer", () => {
  const content = cardHTML({name: '<img src=x onerror="evil()">', description: '<p><strong>용어 설명</strong></p>'}, '<b>플레이어</b>');
  const root = document.createElement("div"); root.innerHTML = content;
  const card = root.querySelector(".term-share-card");
  const notice = root.querySelector(".ts-share-notice");
  assert.equal(notice.textContent, '<b>플레이어</b>님이 다음 지식을 공유했습니다.');
  assert.equal(notice.querySelector("b"), null);
  assert.equal(notice.parentElement, card, "notice is inside the bordered card");
  assert.equal(notice.nextElementSibling, card.querySelector(".ts-card-title"), "notice is directly above the title");
  assert.equal(card.querySelector("h2").textContent, '<img src=x onerror="evil()">');
  assert.equal(card.querySelector("img"), null);
  assert.equal(card.querySelector("strong").textContent, "용어 설명");
  assert.equal(card.children.length, 3);
  assert.equal(card.querySelector("header, footer"), null);
  assert.doesNotMatch(content, /용어 사전|Dictionary|Term Share|ts-card-footer|ts-card-header/);
});

test("rendering shows only the term card while preserving message IDs, enriched links, old snapshots and ordinary chat", () => {
  chat.registerHooks();
  for (const nested of [false, true]) {
    const root = document.createElement("li");
    root.className = "chat-message message flexcol";
    root.dataset.messageId = "saved-message";
    const legacy = '<article class="term-share-card"><header class="ts-card-header">플레이어가 공유했습니다.</header><h2 class="ts-card-title">출혈</h2><div class="ts-card-body"><p><a href="#rules">설명 링크</a></p></div><footer class="ts-card-footer">용어 사전 · Term Share</footer></article>';
    const content = `<div class="message-content">${legacy}</div>`;
    root.innerHTML = `<header class="message-header"><h4>플레이어</h4><time>12:00</time></header>${nested ? `<section class="native-message-body"><span class="flavor-text">추가 틀</span>${content}</section>` : content}`;
    const card = root.querySelector(".term-share-card");
    const container = root.querySelector(".message-content");
    const link = root.querySelector("a"); let clicked = 0;
    link.addEventListener("click", event => { event.preventDefault(); clicked++; });
    const message = {content: legacy, getFlag: (module, key) => module === MODULE_ID && key === "kind" ? "term" : undefined};
    Hooks.call("renderChatMessageHTML", message, root);
    assert.equal(root.dataset.messageId, "saved-message");
    assert.equal(root.querySelector(".message-content"), container);
    assert.equal(root.querySelector(".term-share-card"), card);
    assert.equal(root.querySelector("a"), link);
    assert.ok(root.querySelector(".message-header"), "native header stays available to later render consumers");
    for (const element of root.querySelectorAll(".message-header, .flavor-text, .ts-card-header, .ts-card-footer")) {
      assert.equal(element.classList.contains("ts-card-chrome"), true, "only the presentation is hidden");
    }
    link.dispatchEvent(new window.MouseEvent("click", {bubbles: true, cancelable: true}));
    assert.equal(clicked, 1);
    const rendered = root.innerHTML;
    Hooks.call("renderChatMessageHTML", message, root);
    assert.equal(root.innerHTML, rendered);
    assert.equal(message.content, legacy, "old saved HTML must remain unchanged");
  }
  const normal = document.createElement("li");
  normal.innerHTML = '<header class="message-header">일반 채팅</header><div class="message-content">본문</div>';
  const original = normal.outerHTML;
  Hooks.call("renderChatMessageHTML", {getFlag: () => undefined}, normal);
  assert.equal(normal.outerHTML, original);
});

test("empty and unknown queries notify locally and never create a message", async () => {
  assert.equal(await chat.share(""), false);
  assert.equal(await chat.share("없는단어"), false);
  assert.equal(messages.length, 0);
  assert.equal(notices.length, 2);
  assert.equal(notices[1].level, "warn");
});

test("official chatMessage hook cancels only our commands synchronously", async () => {
  chat.registerHooks();
  assert.equal(Hooks.call("chatMessage", {}, "일반 채팅", {}), undefined);
  assert.equal(Hooks.call("chatMessage", {}, "/r 1d20", {}), undefined);
  assert.equal(Hooks.call("chatMessage", {}, "/? 출혈", {}), false);
  await tick();
  assert.equal(messages.length, 1);
  values.set("questionCommand", false);
  assert.equal(Hooks.call("chatMessage", {}, "/? 출혈", {}), undefined);
  assert.equal(Hooks.call("chatMessage", {}, "/term 출혈", {}), false);
  await tick();
  assert.equal(messages.length, 2);
});

test("an in-flight duplicate produces one card; later invocations can share again", async () => {
  const originalCreate = Message.create;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  Message.create = async (...args) => { await barrier; return originalCreate(...args); };
  try {
    const first = chat.share("출혈", "same-input");
    const second = chat.share("출혈", "same-input");
    release();
    await Promise.all([first, second]);
    assert.equal(messages.length, 1);
  } finally { Message.create = originalCreate; }
  await chat.share("출혈", "same-input");
  assert.equal(messages.length, 2);
});

test("world saves block players, stale editors and malformed imports without changing data", async () => {
  const before = store.snapshot();
  game.user.isGM = false;
  await assert.rejects(store.save([], fingerprint(before)), error => error.key === "GMOnly");
  assert.throws(() => store.prepareImport("{}", "replace"), error => error.key === "GMOnly");
  game.user.isGM = true;
  await store.save(before.entries, fingerprint(before));
  await assert.rejects(store.save([], fingerprint(before)), error => error.key === "StaleData");
  const snapshot = fingerprint(store.snapshot());
  assert.throws(() => store.prepareImport("not-json", "replace"), error => error.key === "InvalidJSON");
  const conflict = exportDictionary([{id: "new", name: "Bleeding", aliases: [], description: "<p>충돌</p>"}]);
  assert.throws(() => store.prepareImport(JSON.stringify(conflict), "merge"), error => error.key === "NameConflict");
  assert.equal(fingerprint(store.snapshot()), snapshot);
});

test("export/import preserves safe rich text and preview is read only", async () => {
  const before = store.snapshot();
  const plan = store.prepareImport(store.export(), "replace");
  assert.equal(fingerprint(store.snapshot()), fingerprint(before));
  await store.save(plan.entries, plan.base);
  assert.deepEqual(store.entries().map(entry => entry.aliases), before.entries.map(entry => entry.aliases));
  assert.match(store.entries()[0].description, /<strong>매 턴<\/strong>/);
  const malicious = {...exportDictionary(entries()), entries: [{...entries()[0], description: '<p>공개</p><section class="secret">비밀</section><script>x()</script>'}]};
  const sanitized = store.prepareImport(JSON.stringify(malicious), "replace");
  assert.equal(sanitized.entries[0].description, "<p>공개</p>");
  assert.equal(sanitized.cleaned, 1);
});

test("autocomplete uses Tab for completion, arrows for selection, Enter for exact sharing only", async () => {
  autocomplete = new AutocompleteController(store, chat); autocomplete.start();
  const input = chatInput();
  type(input, "/? 출");
  assert.equal(autocomplete.popup.hidden, false);
  assert.equal(autocomplete.rows.length, 2);
  assert.equal(key(input, "Tab").defaultPrevented, true);
  assert.equal(input.value, "/? 출혈");
  assert.equal(messages.length, 0);
  key(input, "Enter"); await tick();
  assert.equal(messages.length, 1);
  assert.equal(input.value, "");
  type(input, "/term 출");
  key(input, "ArrowDown"); key(input, "Tab");
  assert.equal(input.value, "/term 출혈 저항");
  type(input, "/? 출");
  key(input, "Enter"); await tick();
  assert.equal(input.value, "/? 출");
  assert.equal(messages.length, 1, "partial match must not share the selected suggestion");
  assert.equal(notices.at(-1).level, "warn");
});

test("Escape, mouse completion, disabled autocomplete, disabled /? and ordinary chat are isolated", async () => {
  autocomplete = new AutocompleteController(store, chat); autocomplete.start();
  const input = chatInput();
  type(input, "/? 출"); key(input, "Escape");
  assert.equal(autocomplete.popup.hidden, true);
  type(input, "/? 집");
  autocomplete.popup.querySelector("[data-ts-suggestion]").dispatchEvent(new Event("pointerdown", {bubbles: true, cancelable: true}));
  assert.equal(input.value, "/? 집중");
  assert.equal(messages.length, 0);
  values.set("autocomplete", false);
  type(input, "/term 출혈");
  assert.equal(autocomplete.popup.hidden, true);
  key(input, "Enter"); await tick();
  assert.equal(messages.length, 1);
  values.set("questionCommand", false);
  type(input, "/? 출혈"); assert.equal(key(input, "Enter").defaultPrevented, false);
  type(input, "hello"); assert.equal(key(input, "Enter").defaultPrevented, false);
  type(input, "/r 1d20"); assert.equal(key(input, "Enter").defaultPrevented, false);
});

test("Korean IME Enter waits for the committed character then shares once without another Enter", async () => {
  autocomplete = new AutocompleteController(store, chat); autocomplete.start();
  const input = chatInput(); type(input, "/? 출혈");
  input.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
  let coreCalled = 0;
  const coreHandler = () => coreCalled++;
  input.addEventListener("keydown", coreHandler);
  key(input, "Enter", {isComposing: true}); await tick();
  assert.equal(coreCalled, 0);
  assert.equal(messages.length, 0);
  input.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
  await new Promise(resolve => setTimeout(resolve, 90));
  assert.equal(messages.length, 1);
  assert.equal(input.value, "");
  input.removeEventListener("keydown", coreHandler);
});

test("input replacement and controller cleanup do not leave duplicate popups or handlers", async () => {
  autocomplete = new AutocompleteController(store, chat); autocomplete.start();
  let input = chatInput(); type(input, "/? 출");
  input.outerHTML = '<textarea id="chat-message" name="message"></textarea>';
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(autocomplete.popup.hidden, true);
  input = chatInput(); type(input, "/? 출血");
  assert.equal(autocomplete.popup.hidden, true);
  type(input, "/? 출혈"); key(input, "Enter"); await tick();
  assert.equal(messages.length, 1);
  autocomplete.destroy(); autocomplete = null;
  assert.equal(document.querySelectorAll(".term-share-autocomplete").length, 0);
  type(input, "/? 출혈"); assert.equal(key(input, "Enter").defaultPrevented, false);
});

test("manager filtering can be cleared without losing rows, and players cannot render management", async () => {
  app = new DictionaryManager(); await app.render();
  const search = app.element.querySelector('[data-field="search"]');
  search.value = "집중"; search.dispatchEvent(new Event("input", {bubbles: true}));
  assert.equal([...app.element.querySelectorAll("[data-term-row]")].filter(row => !row.hidden).length, 1);
  search.value = ""; search.dispatchEvent(new Event("input", {bubbles: true}));
  assert.equal([...app.element.querySelectorAll("[data-term-row]")].filter(row => !row.hidden).length, 3);
  await app.act("select", "bleeding");
  assert.equal(app.element.querySelector("h2").textContent, "출혈");
  game.user.isGM = false;
  await assert.rejects(new DictionaryManager().render(), error => error.key === "GMOnly");
});

test("editor saves the active rich text value, validates duplicates and preserves unsaved data on stale save", async () => {
  app = new TermEditor("bleeding"); await app.render();
  app.richEditor.surface.innerHTML = "<p><b>수정 설명</b></p>";
  await app.save();
  assert.equal(app.rendered, false);
  assert.equal(store.entries()[0].description, "<p><b>수정 설명</b></p>");
  app = new TermEditor(); await app.render();
  app.element.querySelector('[name="name"]').value = "집중";
  app.richEditor.surface.innerHTML = "<p>새 설명</p>";
  await assert.rejects(app.save(), error => error.key === "NameConflict");
  assert.equal(app.rendered, true);
  app.element.querySelector('[name="name"]').value = "기절";
  const current = store.snapshot(); await store.save(current.entries, fingerprint(current));
  assert.equal(app.element.querySelector(".ts-stale-notice").hidden, false);
  await assert.rejects(app.save(), error => error.key === "StaleData");
  assert.equal(app.element.querySelector('[name="name"]').value, "기절");
  confirms.push(false); await app.close(); assert.equal(app.rendered, true);
  confirms.push(true); await app.close(); assert.equal(app.rendered, false);
});

test("dictionary rerenders and Save cannot replace an active Korean composition node", async () => {
  app = new TermEditor("bleeding"); await app.render();
  const root = app.element;
  const surface = app.richEditor.surface;
  const before = fingerprint(store.snapshot());
  surface.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
  surface.textContent = "가";
  await app.render({force: true});
  assert.equal(app.element, root); assert.equal(app.richEditor.surface, surface);
  assert.equal(surface.textContent, "가");
  await app.save();
  assert.equal(fingerprint(store.snapshot()), before);
  assert.equal(app.rendered, true); assert.equal(notices.at(-1).level, "warn");
  surface.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true, data: "가"}));
  app.lastCompositionEnd = -Infinity;
  await app.save();
  assert.equal(store.entries()[0].description, "가");
});

test("term-name IME input also prevents premature form saves and preserves the final character", async () => {
  app = new TermEditor("bleeding"); await app.render();
  const input = app.element.querySelector('[name="name"]');
  input.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
  input.value = "가";
  await app.save(); assert.equal(store.entries()[0].name, "출혈");
  input.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true, data: "가"}));
  await app.save(); assert.equal(store.entries()[0].name, "출혈", "a trailing composition Enter must not save immediately");
  app.lastCompositionEnd = -Infinity;
  await app.save(); assert.equal(store.entries()[0].name, "가");
});

test("a deliberate Save click after IME commit saves the final text without requiring a second click", async () => {
  app = new TermEditor("bleeding"); await app.render();
  const surface = app.richEditor.surface;
  surface.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
  surface.textContent = "가";
  surface.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true, data: "가"}));
  app.element.querySelector('[data-ts-action="save"]').dispatchEvent(new window.MouseEvent("click", {bubbles: true, cancelable: true, detail: 1}));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(store.entries()[0].description, "가");
  assert.equal(app.rendered, false);
  app = new TermEditor("bleeding"); await app.render();
  app.richEditor.surface.textContent = "닫힌 창의 변경";
  app.element.querySelector('[data-ts-action="save"]').dispatchEvent(new window.MouseEvent("click", {bubbles: true, cancelable: true, detail: 1}));
  app.saved = true; await app.close();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(store.entries()[0].description, "가", "a pending click must not save after the editor closes");
});

test("import screen previews replacement deletions, rejects bad files and applies only after explicit action", async () => {
  app = new DictionaryImporter(); await app.render();
  app.element.querySelector('[name="backup"]').checked = false;
  app.element.querySelector('[name="mode"]').value = "replace";
  const text = JSON.stringify(exportDictionary([entries()[0]]));
  await app.loadFile({size: text.length, text: async () => text});
  assert.equal(app.plan.removed, 2);
  assert.equal(store.entries().length, 3);
  assert.match(app.element.querySelector(".ts-import-summary").textContent, /삭제 2개/);
  await app.apply();
  assert.equal(store.entries().length, 1);
  assert.equal(app.rendered, false);
  app = new DictionaryImporter(); await app.render();
  await app.loadFile({size: 3, text: async () => "bad"});
  assert.equal(app.plan, null);
  assert.equal(app.element.querySelector('[data-ts-action="apply"]').disabled, true);
  assert.equal(store.entries().length, 1);
  let release;
  const pending = app.loadFile({size: text.length, text: () => new Promise(resolve => { release = resolve; })});
  await app.loadFile(undefined);
  release(text); await pending;
  assert.equal(app.plan, null, "a stale file read must not replace a newer empty selection");
});

test("deleting a term requires confirmation and does not alter already shared cards", async () => {
  await chat.share("출혈");
  const card = messages[0].content;
  app = new DictionaryManager(); await app.render(); app.selectedId = "bleeding";
  confirms.push(false); await app.act("delete"); assert.equal(store.entries().length, 3);
  confirms.push(true); await app.act("delete"); assert.equal(store.entries().length, 2);
  assert.equal(messages[0].content, card);
});
