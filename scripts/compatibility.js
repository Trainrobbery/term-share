/** Public API differences between Foundry V13 and V14. */
export function foundryGeneration() {
  return Number(game.release?.generation) || Number.parseInt(game.version, 10) || 13;
}

export function chatLogClass() {
  return foundry.applications?.sidebar?.tabs?.ChatLog ?? globalThis.ChatLog;
}

export function publicChatOptions() {
  return foundryGeneration() >= 14 ? {messageMode: "public"} : {rollMode: "publicroll"};
}

