import {MODULE_ID, VERSION, emptyDictionary, clone} from "./core.js";
import {DictionaryStore} from "./store.js";
import {ChatController} from "./chat.js";
import {AutocompleteController} from "./autocomplete.js";
import {DictionaryManager, connectApps} from "./apps.js";
import {t, report} from "./i18n.js";
import {chatLogClass, foundryGeneration} from "./compatibility.js";

const store = new DictionaryStore();
const chat = new ChatController(store);
const autocomplete = new AutocompleteController(store, chat);
let manager;
let lastConflicts = [];
connectApps(store);

function settings() {
  game.settings.register(MODULE_ID, "dictionary", {
    scope: "world", config: false, type: Object, default: emptyDictionary(),
    onChange: () => store.notify()
  });
  game.settings.registerMenu(MODULE_ID, "manager", {
    name: "TERM_SHARE.ManagerTitle", label: "TERM_SHARE.OpenManager", hint: "TERM_SHARE.ManagerSettingHint",
    icon: "fa-solid fa-book-open", type: DictionaryManager, restricted: true
  });
  game.settings.register(MODULE_ID, "questionCommand", {
    name: "TERM_SHARE.QuestionSetting", hint: "TERM_SHARE.QuestionHint", scope: "world", config: true,
    type: Boolean, default: true, onChange: () => { chat.registerCommand(); autocomplete?.update(); checkConflicts(); }
  });
  game.settings.register(MODULE_ID, "autocomplete", {
    name: "TERM_SHARE.AutocompleteSetting", hint: "TERM_SHARE.AutocompleteHint", scope: "user", config: true,
    type: Boolean, default: true, onChange: () => autocomplete?.update()
  });
  game.settings.register(MODULE_ID, "suggestionCount", {
    name: "TERM_SHARE.SuggestionCountSetting", hint: "TERM_SHARE.SuggestionCountHint", scope: "user", config: true,
    type: Number, range: {min: 3, max: 12, step: 1}, default: 6, onChange: () => autocomplete?.update()
  });
}

function checkConflicts() {
  const conflicts = [];
  const Log = chatLogClass();
  if (typeof Log?.parse === "function") {
    for (const command of ["/term", ...(game.settings.get(MODULE_ID, "questionCommand") ? ["/?"] : [])]) {
      try {
        const [name, , callback] = Log.parse(`${command} TermShareConflictProbe`);
        if (typeof callback === "function" && callback !== chat.nativeHandler && !["other", "ooc", "ic", "invalid"].includes(name)) conflicts.push(command);
      } catch { /* Unknown slash commands are expected before our chatMessage hook. */ }
    }
  }
  for (const [name, entry] of Object.entries(Log?.CHAT_COMMANDS ?? {})) {
    if (name === MODULE_ID || ["other", "ooc", "ic", "invalid"].includes(name) || !(entry?.rgx instanceof RegExp)) continue;
    const regex = new RegExp(entry.rgx.source, entry.rgx.flags.replace(/[gy]/g, ""));
    for (const command of ["/term", ...(game.settings.get(MODULE_ID, "questionCommand") ? ["/?"] : [])]) {
      if (regex.test(`${command} TermShareConflictProbe`)) conflicts.push(command);
    }
  }
  for (const [name, pattern] of Object.entries(Log?.MESSAGE_PATTERNS ?? {})) {
    if (["other", "ooc", "ic", "invalid"].includes(name) || !(pattern instanceof RegExp)) continue;
    const regex = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
    for (const command of ["/term", ...(game.settings.get(MODULE_ID, "questionCommand") ? ["/?"] : [])]) {
      if (regex.test(`${command} TermShareConflictProbe`)) conflicts.push(command);
    }
  }
  // Known chat-completion modules may intercept commands outside the core registry.
  const externalCompletion = game.modules.get("_chatcommands")?.active;
  lastConflicts = [...new Set(conflicts)];
  if (game.user?.isGM && (conflicts.length || externalCompletion)) {
    ui.notifications.warn(t("ConflictWarning", {commands: conflicts.join(", ") || "Chat Commander"}));
  }
  return lastConflicts;
}

Hooks.once("init", () => {
  settings();
  chat.registerHooks();
  autocomplete.registerProseMirrorHooks();
  game.modules.get(MODULE_ID).api = Object.freeze({
    version: VERSION,
    share: query => chat.share(String(query ?? "")),
    getTerms: () => clone(store.entries()),
    openManager: async () => {
      store.assertGM();
      if (!manager?.rendered) manager = new DictionaryManager();
      await manager.render({force: true});
      manager.bringToFront();
      return manager;
    },
    diagnostics: () => ({version: VERSION, foundry: game.version, generation: foundryGeneration(), entries: store.entries().length, commandConflicts: [...lastConflicts], transport: chat.nativeRegistered ? "CHAT_COMMANDS" : "chatMessage hook"})
  });
});

Hooks.once("ready", () => {
  try {
    store.snapshot();
    autocomplete.start();
    checkConflicts();
    console.info(`Term Share | ${VERSION} ready`);
  } catch (error) { report(error); }
});

Hooks.once("shutdown", () => { autocomplete?.destroy(); chat.destroy(); });
