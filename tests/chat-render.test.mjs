import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import "./harness.mjs";
import {MODULE_ID} from "../scripts/core.js";
import {ChatController, cardHTML, renderTermMessage} from "../scripts/chat.js";

const message = {getFlag: (module, key) => module === MODULE_ID && key === "kind" ? "term" : undefined};
const style = document.createElement("style");
style.textContent = await readFile(new URL("../styles/term-share.css", import.meta.url), "utf8");
document.head.append(style);

function fixture() {
  const root = document.createElement("li");
  root.className = "chat-message message flexcol";
  root.dataset.messageId = "term-snapshot";
  root.innerHTML = `<header class="message-header"><h4 class="message-sender">플레이어</h4><time class="message-timestamp">12:00</time><a class="message-delete">삭제</a></header><section class="native-message-body"><span class="flavor-text">추가 틀</span><div class="message-content">${cardHTML({name: "출혈", description: '<p><a href="#rules">용어 설명</a></p>'}, "플레이어 A")}</div></section>`;
  document.body.append(root);
  return root;
}

test("later render consumers can still update native header and timestamp after the term hook", () => {
  const chat = new ChatController({});
  const root = fixture();
  const header = root.querySelector(".message-header");
  const timestamp = root.querySelector(".message-timestamp");
  const childNodes = [...root.childNodes];
  chat.registerHooks();
  // An independent downstream DOM consumer, not a copy of Foundry internals.
  const nextHook = Hooks.on("renderChatMessageHTML", (doc, html) => {
    html.querySelector(".message-header").dataset.ready = "true";
    html.querySelector(".message-timestamp").textContent = "방금";
  });
  try {
    assert.doesNotThrow(() => Hooks.call("renderChatMessageHTML", message, root));
    assert.deepEqual([...root.childNodes], childNodes);
    assert.equal(root.querySelector(".message-header"), header);
    assert.equal(root.querySelector(".message-timestamp"), timestamp);
    assert.equal(timestamp.textContent, "방금");
    assert.equal(getComputedStyle(header).display, "none");
    assert.equal(getComputedStyle(root.querySelector(".flavor-text")).display, "none");
    const card = root.querySelector(".term-share-card");
    const notice = root.querySelector(".ts-share-notice");
    assert.equal(notice.parentElement, card);
    assert.equal(notice.nextElementSibling, card.querySelector(".ts-card-title"));
    assert.equal(notice.textContent, "플레이어 A님이 다음 지식을 공유했습니다.");
    assert.notEqual(getComputedStyle(notice).display, "none");
    assert.equal(getComputedStyle(notice).fontSize, "11px");
    for (let node = card; node !== root.parentElement; node = node.parentElement) {
      assert.notEqual(getComputedStyle(node).display, "none", "the entire path to the card stays visible");
    }
  } finally { Hooks.off("renderChatMessageHTML", nextHook); chat.destroy(); root.remove(); }
});

test("presentation accepts a wrapped native message without replacing its content or links", () => {
  for (const legacyNotice of [false, true]) {
  const root = fixture();
  try {
    const card = root.querySelector(".term-share-card");
    const notice = card.querySelector(".ts-share-notice");
    if (legacyNotice) {
      const wrapper = document.createElement("div");
      wrapper.className = "term-share-content";
      card.before(wrapper); wrapper.append(notice, card);
    }
    const link = root.querySelector(".ts-card-body a");
    let clicks = 0;
    link.addEventListener("click", event => { event.preventDefault(); clicks++; });
    renderTermMessage(message, {0: root, length: 1});
    assert.equal(root.classList.contains("term-share-message"), true);
    assert.equal(root.querySelector(".term-share-card"), card);
    assert.equal(card.querySelector(".ts-share-notice"), notice);
    assert.equal(notice.nextElementSibling, card.querySelector(".ts-card-title"));
    assert.notEqual(getComputedStyle(notice).display, "none");
    assert.equal(root.querySelector(".ts-card-body a"), link);
    link.click(); assert.equal(clicks, 1);
    const once = root.outerHTML;
    renderTermMessage(message, root);
    assert.equal(root.outerHTML, once);
  } finally { root.remove(); }
  }
});

test("unexpected render roots never prune the chat log or touch neighbouring messages", () => {
  const log = document.createElement("ol");
  log.id = "chat-log";
  const term = fixture();
  const ordinary = document.createElement("li");
  ordinary.className = "chat-message";
  ordinary.dataset.messageId = "ordinary";
  ordinary.textContent = "일반 채팅";
  log.append(term, ordinary); document.body.append(log);
  try {
    const before = log.outerHTML;
    renderTermMessage(message, log);
    assert.equal(log.outerHTML, before, "a log root must not be styled as one term message");
    for (const value of [null, undefined, {}, {0: null}, document.createElement("div")]) {
      assert.doesNotThrow(() => renderTermMessage(message, value));
    }
    renderTermMessage(message, term);
    assert.equal(log.children.length, 2);
    assert.equal(ordinary.textContent, "일반 채팅");
    assert.notEqual(getComputedStyle(ordinary).display, "none");
  } finally { log.remove(); }
});
