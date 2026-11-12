/** Pure dictionary rules, shared by Foundry and the test runner. */
export const MODULE_ID = "term-share";
export const VERSION = "0.1.0-alpha.11";
export const FORMAT_VERSION = 1;
export const LIMITS = Object.freeze({entries: 1000, aliases: 30, name: 120, description: 100000, bytes: 5 * 1024 * 1024});

export class TermShareError extends Error {
  constructor(key, data = {}) {
    super(key);
    this.name = "TermShareError";
    this.key = key;
    this.data = data;
  }
}

export const displayName = value => String(value ?? "").normalize("NFC").trim().replace(/\s+/gu, " ");
export const normalize = value => displayName(value).toLocaleLowerCase("en-US");
export const clone = value => JSON.parse(JSON.stringify(value));
export const fingerprint = value => JSON.stringify(value);
export const emptyDictionary = () => ({formatVersion: FORMAT_VERSION, revision: 0, entries: []});

export function parseCommand(message, questionEnabled = true) {
  if (typeof message !== "string") return null;
  const match = message.trim().match(/^\/(\?|term)(?=\s|$)([\s\S]*)$/i);
  if (!match || (match[1] === "?" && !questionEnabled)) return null;
  return {command: match[1] === "?" ? "/?" : "/term", query: displayName(match[2])};
}

export function validateEntries(input, {idFactory, now = new Date().toISOString()} = {}) {
  if (!Array.isArray(input)) throw new TermShareError("InvalidEntries");
  if (input.length > LIMITS.entries) throw new TermShareError("TooManyEntries", {max: LIMITS.entries});
  const names = new Map();
  const ids = new Set();
  return input.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TermShareError("InvalidEntry", {index: index + 1});
    if (typeof raw.name !== "string" || !displayName(raw.name)) throw new TermShareError("NameRequired");
    const name = displayName(raw.name);
    if (name.length > LIMITS.name) throw new TermShareError("NameTooLong", {max: LIMITS.name});
    if (!Array.isArray(raw.aliases ?? [])) throw new TermShareError("InvalidAliases", {name});
    if ((raw.aliases ?? []).length > LIMITS.aliases) throw new TermShareError("TooManyAliases", {max: LIMITS.aliases});
    const aliases = (raw.aliases ?? []).map(alias => {
      if (typeof alias !== "string" || !displayName(alias) || displayName(alias).length > LIMITS.name) {
        throw new TermShareError("InvalidAliases", {name});
      }
      return displayName(alias);
    });
    if (typeof raw.description !== "string" || !raw.description.trim()) throw new TermShareError("DescriptionRequired", {name});
    if (raw.description.length > LIMITS.description) throw new TermShareError("DescriptionTooLong", {max: LIMITS.description});
    for (const label of [name, ...aliases]) {
      const key = normalize(label);
      if (names.has(key)) throw new TermShareError("NameConflict", {label, name: names.get(key)});
      names.set(key, name);
    }
    const id = raw.id ?? idFactory?.();
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new TermShareError("InvalidId", {name});
    if (ids.has(id)) throw new TermShareError("DuplicateId", {name});
    ids.add(id);
    const date = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : now;
    return {id, name, aliases, description: raw.description, createdAt: date(raw.createdAt), updatedAt: date(raw.updatedAt)};
  });
}

export function exactMatch(entries, query) {
  const key = normalize(query);
  if (!key) return null;
  return entries.find(entry => [entry.name, ...entry.aliases].some(label => normalize(label) === key)) ?? null;
}

const collator = new Intl.Collator("ko", {numeric: true, sensitivity: "base"});
export function suggest(entries, query) {
  const key = normalize(query);
  return entries.map(entry => {
    let best = null;
    for (const [i, label] of [entry.name, ...entry.aliases].entries()) {
      const normalized = normalize(label);
      const rank = !key ? 0 : normalized === key ? 0 : normalized.startsWith(key) ? 1 : normalized.includes(key) ? 2 : 3;
      if (rank < 3 && (!best || rank < best.rank)) best = {entry, rank, alias: i > 0 ? label : ""};
    }
    return best;
  }).filter(Boolean).sort((a, b) => a.rank - b.rank || collator.compare(a.entry.name, b.entry.name));
}

export function readImport(raw, options) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.module !== MODULE_ID || raw.formatVersion !== FORMAT_VERSION) {
    throw new TermShareError("InvalidFormat");
  }
  return validateEntries(raw.entries, options);
}

export function planImport(current, incoming, mode, {idFactory} = {}) {
  if (!["merge", "replace"].includes(mode)) throw new TermShareError("InvalidFormat");
  let added = 0, updated = 0;
  const currentByName = new Map(current.map(entry => [normalize(entry.name), entry]));
  const next = mode === "replace" ? [] : clone(current);
  const occupiedIds = new Set(current.map(entry => entry.id));
  const changes = [];
  for (const entry of incoming) {
    const existing = currentByName.get(normalize(entry.name));
    const replacement = clone(entry);
    if (existing) {
      replacement.id = existing.id;
      replacement.createdAt = existing.createdAt;
      updated++;
    } else {
      if (occupiedIds.has(replacement.id)) replacement.id = idFactory?.();
      added++;
    }
    occupiedIds.add(replacement.id);
    changes.push({name: entry.name, kind: existing ? "updated" : "added"});
    const index = next.findIndex(item => item.id === replacement.id);
    if (mode === "merge" && index >= 0) next[index] = replacement;
    else next.push(replacement);
  }
  const validated = validateEntries(next, {idFactory});
  const incomingNames = new Set(incoming.map(entry => normalize(entry.name)));
  const removed = mode === "replace" ? current.filter(entry => !incomingNames.has(normalize(entry.name))) : [];
  changes.push(...removed.map(entry => ({name: entry.name, kind: "removed"})));
  return {entries: validated, added, updated, removed: removed.length, changes};
}

export function exportDictionary(entries, now = new Date().toISOString()) {
  return {module: MODULE_ID, formatVersion: FORMAT_VERSION, moduleVersion: VERSION, exportedAt: now, entries: clone(entries)};
}
