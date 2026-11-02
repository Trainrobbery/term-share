import test from "node:test";
import assert from "node:assert/strict";
import {parseCommand, normalize, validateEntries, exactMatch, suggest, planImport, readImport, exportDictionary, LIMITS} from "../scripts/core.js";

const term = (id, name, aliases = []) => ({id, name, aliases, description: `<p>${name} 설명</p>`});
const rules = key => error => error.key === key;

test("commands recognize only complete command prefixes and support disabling /?", () => {
  assert.deepEqual(parseCommand(" /?   출혈  상태 "), {command: "/?", query: "출혈 상태"});
  assert.deepEqual(parseCommand("/TERM Bleeding"), {command: "/term", query: "Bleeding"});
  assert.equal(parseCommand("/?x"), null);
  assert.equal(parseCommand("/terminal 출혈"), null);
  assert.equal(parseCommand("일반 /? 출혈"), null);
  assert.equal(parseCommand("/? 출혈", false), null);
  assert.equal(parseCommand("/term 출혈", false).query, "출혈");
  assert.equal(parseCommand("/?").query, "");
  assert.equal(parseCommand("/r 1d20"), null);
});

test("normalization handles NFC Korean, spaces, and English case without removing internal spaces", () => {
  assert.equal(normalize(" 출혈   상태 "), "출혈 상태");
  assert.equal(normalize("집중"), normalize("집중"));
  assert.equal(normalize(" BLEEDING "), "bleeding");
  assert.notEqual(normalize("출혈상태"), normalize("출혈 상태"));
});

test("exact execution never shares an ambiguous partial match", () => {
  const entries = [term("a", "출혈", ["Bleeding"]), term("b", "출혈 저항")];
  assert.equal(exactMatch(entries, "출"), null);
  assert.equal(exactMatch(entries, "bleeding").id, "a");
  assert.equal(exactMatch(entries, "출혈 저항").id, "b");
  assert.equal(exactMatch(entries, ""), null);
});

test("suggestions rank exact, prefix, substring and deduplicate aliases", () => {
  const entries = [term("a", "심한 출혈"), term("b", "출혈 저항"), term("c", "출혈", ["출혈 상태", "Bleeding"])];
  assert.deepEqual(suggest(entries, "출혈").map(row => row.entry.id), ["c", "b", "a"]);
  assert.equal(suggest(entries, "bleed")[0].alias, "Bleeding");
  assert.equal(suggest(entries, "출혈").length, 3);
  assert.deepEqual(suggest(entries, "없는단어"), []);
});

test("global canonical/alias collisions are rejected regardless of case or normalization", () => {
  assert.throws(() => validateEntries([term("a", "출혈", ["Bleeding"]), term("b", "BLEEDING")]), rules("NameConflict"));
  assert.throws(() => validateEntries([term("a", "집중"), term("b", "집중")]), rules("NameConflict"));
  assert.throws(() => validateEntries([term("a", "출혈", ["출혈"])]), rules("NameConflict"));
  assert.throws(() => validateEntries([term("a", "A"), term("a", "B")]), rules("DuplicateId"));
});

test("invalid and excessive fields are rejected", () => {
  assert.throws(() => validateEntries([term("a", " ")]), rules("NameRequired"));
  assert.throws(() => validateEntries([{...term("a", "A"), aliases: "bad"}]), rules("InvalidAliases"));
  assert.throws(() => validateEntries([{...term("a", "A"), description: ""}]), rules("DescriptionRequired"));
  assert.throws(() => validateEntries([term("a", "x".repeat(LIMITS.name + 1))]), rules("NameTooLong"));
  assert.throws(() => validateEntries([term("bad id", "A")]), rules("InvalidId"));
});

test("merge keeps existing IDs, updates aliases and descriptions, leaves unrelated entries intact", () => {
  const current = validateEntries([term("a", "출혈", ["Bleeding"]), term("b", "집중")]);
  const incoming = validateEntries([{...term("foreign", "출혈", ["피흘림"]), description: "<p>갱신</p>"}, term("new", "기절")]);
  const result = planImport(current, incoming, "merge");
  assert.deepEqual([result.added, result.updated, result.removed], [1, 1, 0]);
  assert.equal(result.entries[0].id, "a");
  assert.deepEqual(result.entries[0].aliases, ["피흘림"]);
  assert.equal(result.entries[0].description, "<p>갱신</p>");
  assert.equal(result.entries[1].id, "b");
  assert.equal(current[0].description, "<p>출혈 설명</p>");
});

test("replace previews removed terms and collision validation is atomic", () => {
  const current = validateEntries([term("a", "출혈"), term("b", "집중", ["Focus"])]);
  const replace = planImport(current, validateEntries([term("new", "기절")]), "replace");
  assert.equal(replace.removed, 2);
  assert.deepEqual(replace.entries.map(entry => entry.name), ["기절"]);
  assert.throws(() => planImport(current, validateEntries([term("new", "Focus")]), "merge"), rules("NameConflict"));
  assert.equal(current.length, 2);
});

test("foreign ID collision gets a fresh ID; future formats are rejected; export round trips", () => {
  const result = planImport(validateEntries([term("a", "출혈")]), validateEntries([term("a", "집중")]), "merge", {idFactory: () => "fresh"});
  assert.equal(result.entries[1].id, "fresh");
  const exported = exportDictionary(validateEntries([term("a", "출혈", ["Bleeding"])]));
  assert.deepEqual(readImport(JSON.parse(JSON.stringify(exported))), exported.entries);
  assert.throws(() => readImport({...exported, formatVersion: 2}), rules("InvalidFormat"));
  assert.throws(() => readImport({entries: exported.entries}), rules("InvalidFormat"));
});
