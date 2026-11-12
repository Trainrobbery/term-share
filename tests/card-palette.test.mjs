import test, {after} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {definitions, values} from "./harness.mjs";
import {MODULE_ID} from "../scripts/core.js";
import {cardHTML, renderTermMessage} from "../scripts/chat.js";
await import("../scripts/main.js");

const style = document.createElement("style");
style.textContent = await readFile(new URL("../styles/term-share.css", import.meta.url), "utf8");
document.head.append(style);
// Simulate a preference already saved by this user before loading the module.
values.set("cardPalette", "catalog");
Hooks.fire("init"); Hooks.fire("ready");
after(() => { Hooks.fire("shutdown"); style.remove(); });

function fixture() {
  const frame = document.createElement("section");
  frame.innerHTML = `<li class="chat-message" data-message-id="palette"><header class="message-header"><time>12:00</time></header><div class="message-content">${cardHTML({name: "긴 용어 제목", description: '<p><strong>설명</strong>과 <a href="#rules">문서 링크</a></p><p><img src="icons/example.webp"></p>'}, "플레이어")}</div></li><li class="chat-message ordinary">일반 채팅</li>`;
  const root = frame.firstElementChild;
  renderTermMessage({getFlag: (module, key) => module === MODULE_ID && key === "kind" ? "term" : undefined}, root);
  document.body.append(frame);
  return {frame, root, card: root.querySelector(".term-share-card"), ordinary: frame.lastElementChild};
}

function geometry(card) {
  return [card, card.querySelector(".ts-share-notice"), card.querySelector(".ts-card-title"), card.querySelector(".ts-card-body")].map(el => {
    const s = getComputedStyle(el);
    return [s.padding, s.margin, s.fontFamily, s.fontSize, s.lineHeight, s.borderTopWidth, s.borderRadius, s.boxShadow];
  });
}

test("palette preference defaults to alpha.11, restores a saved choice and is editable by a player", async () => {
  const setting = definitions.get("cardPalette");
  assert.equal(setting.default, "legacy");
  assert.equal(setting.scope, "user");
  assert.equal(setting.config, true);
  assert.deepEqual(Object.keys(setting.choices), ["legacy", "catalog"]);
  assert.equal(document.documentElement.dataset.termSharePalette, "catalog", "ready restores the persisted choice");
  game.user.isGM = false;
  await game.settings.set(MODULE_ID, "cardPalette", "legacy");
  assert.equal(document.documentElement.dataset.termSharePalette, "legacy");
});

test("both palettes keep the same compact geometry and follow their light/dark color rules", async () => {
  const {frame, root, card} = fixture();
  try {
    await game.settings.set(MODULE_ID, "cardPalette", "legacy");
    const shape = geometry(card);
    assert.equal(getComputedStyle(card).padding, "10px 16px");
    assert.equal(getComputedStyle(root).margin, "2px 0px");
    assert.equal(getComputedStyle(card).backgroundColor, "rgb(244, 241, 232)");
    assert.equal(getComputedStyle(card).color, "rgb(37, 41, 37)");
    frame.className = "theme-dark";
    assert.equal(getComputedStyle(card).backgroundColor, "rgb(36, 40, 45)");
    assert.equal(getComputedStyle(card).color, "rgb(236, 235, 230)");
    assert.equal(getComputedStyle(card.querySelector(".ts-share-notice")).opacity, "0.75");
    root.classList.add("theme-light");
    assert.equal(getComputedStyle(card).backgroundColor, "rgb(244, 241, 232)", "local light override matches alpha.11");
    await game.settings.set(MODULE_ID, "cardPalette", "catalog");
    for (const theme of ["theme-dark", "theme-light"]) {
      frame.className = theme;
      assert.equal(getComputedStyle(card).backgroundColor, "rgb(244, 239, 223)");
      assert.equal(getComputedStyle(card).color, "rgb(49, 45, 37)");
      const notice = getComputedStyle(card.querySelector(".ts-share-notice"));
      assert.equal(notice.color, "rgb(112, 100, 82)");
      assert.equal(notice.opacity, "1");
      assert.deepEqual(geometry(card), shape, "only the colors may change");
    }
    await game.settings.set(MODULE_ID, "cardPalette", "legacy");
    root.classList.remove("theme-light"); frame.className = "theme-dark";
    assert.equal(getComputedStyle(card).backgroundColor, "rgb(36, 40, 45)");
  } finally { frame.remove(); }
});

test("switching colors updates existing and newly rendered cards without rewriting snapshots or native DOM", async () => {
  const {frame, root, card, ordinary} = fixture();
  const before = root.innerHTML, nodes = [...root.querySelectorAll("*")];
  const dictionary = JSON.stringify(values.get("dictionary"));
  const ordinaryBefore = ordinary.outerHTML, ordinaryStyle = getComputedStyle(ordinary).cssText;
  let clicks = 0, menus = 0;
  const link = root.querySelector("a");
  link.addEventListener("click", event => { event.preventDefault(); clicks++; });
  root.addEventListener("contextmenu", event => { event.preventDefault(); menus++; });
  let next;
  try {
    for (const palette of ["catalog", "legacy", "catalog"]) {
      await game.settings.set(MODULE_ID, "cardPalette", palette);
      assert.equal(root.innerHTML, before);
      assert.deepEqual([...root.querySelectorAll("*")], nodes);
      assert.equal(getComputedStyle(root.querySelector(".message-header")).display, "none");
      assert.equal(JSON.stringify(values.get("dictionary")), dictionary);
      assert.equal(ordinary.outerHTML, ordinaryBefore);
      assert.equal(getComputedStyle(ordinary).cssText, ordinaryStyle);
    }
    next = fixture();
    assert.equal(getComputedStyle(next.card).backgroundColor, getComputedStyle(card).backgroundColor);
    link.click();
    card.dispatchEvent(new Event("contextmenu", {bubbles: true, cancelable: true}));
    assert.deepEqual([clicks, menus], [1, 1]);
  } finally { next?.frame.remove(); frame.remove(); }
});
