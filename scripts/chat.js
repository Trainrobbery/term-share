import {MODULE_ID, VERSION, exactMatch, parseCommand, TermShareError} from "./core.js";
import {escapeHTML, sanitizeHTML} from "./html.js";
import {t, report} from "./i18n.js";
import {chatLogClass, publicChatOptions} from "./compatibility.js";

export function cardHTML(entry, sharedBy) {
  const notice = sharedBy ? `<p class="ts-share-notice">${escapeHTML(t("KnowledgeShared", {name: sharedBy}))}</p>` : "";
  return `<article class="term-share-card">${notice}<h2 class="ts-card-title">${escapeHTML(entry.name)}</h2><div class="ts-card-body">${sanitizeHTML(entry.description)}</div></article>`;
}

export function renderTermMessage(message, html) {
  if (message?.getFlag?.(MODULE_ID, "kind") !== "term") return;
  // The public hook supplies an HTMLElement. Also tolerate wrappers from legacy
  // integrations, but never treat a whole chat log as a single message.
  const root = html?.nodeType === 1 ? html : html?.[0];
  if (root?.nodeType !== 1 || !root.matches(".chat-message, .message[data-message-id], .term-share-card")) return;
  const card = root.matches(".term-share-card") ? root : root.querySelector(".term-share-card");
  if (!card) return;
  if (card !== root && card.closest(".chat-message, .message[data-message-id]") !== root) return;
  const path = [];
  // Retain the outer wrapper used by alpha.6 snapshots.
  const content = card !== root && card.parentElement?.matches(".term-share-content") ? card.parentElement : card;
  let child = content;
  while (child !== root) {
    const parent = child.parentElement;
    if (!parent || !root.contains(parent)) return;
    path.push({child, parent});
    child = parent;
  }
  root.classList.add("term-share-message");
  // Move only our own alpha.6 notice inside the box; keep native chat nodes and
  // saved message HTML intact, along with the notice's existing listeners.
  const oldNotice = content !== card ? content.querySelector(":scope > .ts-share-notice") : null;
  if (oldNotice && !card.querySelector(":scope > .ts-share-notice")) {
    oldNotice.classList.remove("ts-card-chrome");
    card.prepend(oldNotice);
  }
  // Headers, timestamps and buttons remain in the DOM: core and subsequent
  // render hooks may still access them after this hook. Only hide their visual
  // chrome, retaining every node, listener and saved snapshot.
  for (const {child, parent} of path) {
    child.classList.remove("ts-card-chrome");
    for (const sibling of parent.children) if (sibling !== child) sibling.classList.add("ts-card-chrome");
    if (parent !== root) parent.classList.add("ts-card-container");
  }
  for (const element of card.children) {
    if (element.matches(".ts-card-header, .ts-card-footer")) element.classList.add("ts-card-chrome");
  }
}

export class ChatController {
  #pending = new Map();
  constructor(store) { this.store = store; }
  parse(text) { return parseCommand(text, game.settings.get(MODULE_ID, "questionCommand")); }

  async share(query, sourceKey = "api") {
    const key = `${sourceKey}:${query}`;
    // Only coalesce an in-flight duplicate from the same input source.
    if (this.#pending.has(key)) return this.#pending.get(key);
    const operation = this.#share(query).finally(() => this.#pending.delete(key));
    this.#pending.set(key, operation);
    return operation;
  }
  async #share(query) {
    try {
      if (!query.trim()) throw new TermShareError("QueryRequired");
      const entry = exactMatch(this.store.entries(), query);
      if (!entry) throw new TermShareError("NotFound", {query});
      const user = game.user;
      // Create only on the sending client. Do not inherit token speaker or whisper mode.
      const Message = CONFIG.ChatMessage.documentClass;
      const message = await Message.create({
        user: user.id,
        speaker: {alias: user.name},
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        whisper: [],
        blind: false,
        content: cardHTML(entry, user.name),
        flags: {[MODULE_ID]: {kind: "term", version: VERSION, entryId: entry.id, entryName: entry.name, sharedBy: user.id}}
      }, publicChatOptions());
      if (!message) throw new TermShareError("MessageFailed");
      return true;
    } catch (error) {
      if (error?.key === "QueryRequired" || error?.key === "NotFound") ui.notifications.warn(t(error.key, error.data));
      else report(error);
      return false;
    }
  }
  registerHooks() {
    this.registerCommand();
    // Hooks are synchronous. Returning a Promise here would leak the original command.
    this.chatHook = Hooks.on("chatMessage", (log, message) => {
      if (this.nativeRegistered) return;
      const command = this.parse(message);
      if (!command) return;
      void this.share(command.query, "chat-hook");
      return false;
    });
    this.renderHook = Hooks.on("renderChatMessageHTML", renderTermMessage);
  }
  registerCommand() {
    const Log = chatLogClass();
    if (!Log?.CHAT_COMMANDS) { this.nativeRegistered = false; return; }
    this.nativeHandler ??= async (command, match) => {
      const parsed = this.parse(match[0]);
      if (parsed) await this.share(parsed.query, "native-command");
      return false; // We create the independent card ourselves; suppress the source message.
    };
    this.nativeEntry = {
      rgx: game.settings.get(MODULE_ID, "questionCommand") ? /^\/(\?|term)(?=\s|$)([\s\S]*)$/i : /^\/(term)(?=\s|$)([\s\S]*)$/i,
      fn: this.nativeHandler
    };
    Log.CHAT_COMMANDS[MODULE_ID] = this.nativeEntry;
    this.nativeRegistered = true;
  }
  destroy() {
    if (this.chatHook != null) Hooks.off("chatMessage", this.chatHook);
    if (this.renderHook != null) Hooks.off("renderChatMessageHTML", this.renderHook);
    const registry = chatLogClass()?.CHAT_COMMANDS;
    if (registry && this.nativeEntry && registry[MODULE_ID] === this.nativeEntry) delete registry[MODULE_ID];
    this.nativeRegistered = false;
  }
}
