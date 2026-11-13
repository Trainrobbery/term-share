import {readFile, writeFile, mkdir} from "node:fs/promises";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
const project = resolve(process.argv[2] || "term-share");
const output = resolve(process.argv[3] || join(project, "dist", "theme-qa"));
await mkdir(output, {recursive: true});
const css = await readFile(join(project, "styles/term-share.css"), "utf8");
const {values, chatInput, type} = await import(pathToFileURL(join(project, "tests/harness.mjs")));
const en = JSON.parse(await readFile(join(project, "lang/en.json"), "utf8")).TERM_SHARE;
game.i18n.format = (key, data = {}) => (en[key.replace(/^TERM_SHARE\./, "")] || key).replace(/\{(\w+)\}/g, (all, k) => String(data[k] ?? all));
await import(pathToFileURL(join(project, "scripts/main.js")));
const {cardHTML, renderTermMessage} = await import(pathToFileURL(join(project, "scripts/chat.js")));
const {DictionaryManager, TermEditor, DictionaryImporter} = await import(pathToFileURL(join(project, "scripts/apps.js")));
Hooks.fire("init"); Hooks.fire("ready");
const body = '<p>A concise description with <strong>emphasis</strong> and <a href="#rules">a document link</a>.</p><ul><li>First point<ul><li>Nested point</li></ul></li><li>Second point</li></ul><ol><li>Numbered point</li></ol>';
const entry = {id: "preview", name: "Library record", aliases: ["Record"], description: body};
values.get("dictionary").entries.push(entry, {...entry, id: "second", name: "Library rules", aliases: []});
const manager = new DictionaryManager(); manager.selectedId = "preview";
const editor = new TermEditor("preview"), importer = new DictionaryImporter();
await manager.render(); await editor.render(); await importer.render();
for (const app of [manager, editor, importer]) {
  const wrapper = document.createElement("section"); wrapper.className = "window-content";
  wrapper.append(...app.element.childNodes); app.element.append(wrapper); app.element.classList.add("application");
}
const input = chatInput(); type(input, "/? Lib");
const popup = document.querySelector(".term-share-autocomplete");
const root = document.createElement("li"); root.className = "chat-message message"; root.dataset.messageId = "preview";
root.innerHTML = `<header class="message-header"><time>12:00</time></header><div class="message-content">${cardHTML(entry, "Gamemaster")}</div>`;
renderTermMessage({getFlag: (m, k) => m === "term-share" && k === "kind" ? "term" : undefined}, root);
const ordinary = `<li id="ordinary" class="chat-message"><div class="message-content">${body}</div></li>`;
const markup = `<main><section class="column"><h1>Chat</h1>${ordinary}${root.outerHTML}<h1>Autocomplete</h1>${popup.outerHTML}<h1>Import</h1>${importer.element.outerHTML}</section><section class="column"><h1>Dictionary</h1>${manager.element.outerHTML}<h1>Editor</h1>${editor.element.outerHTML}</section></main>`;
// Representative core rules, deliberately separate from actual Foundry execution.
const core = `*{box-sizing:border-box}body{font:14px/1.5 Arial,sans-serif;margin:0;padding:20px}body.theme-light{background:#deddd8;--background:#f0eee6;--color-text-primary:#272727;--color-text-secondary:#65635e;--color-border:#99958c;--color-border-light-2:#99958c;--color-border-highlight:#d66317;--input-background-color:#ffffff;--input-text-color:#272727;--color-cool-5-25:rgba(0,0,0,.08)}body.theme-dark{background:#15161b;--background:#272931;--color-text-primary:#e6e6e6;--color-text-secondary:#b5b3ac;--color-border:#65636c;--color-border-light-2:#65636c;--color-border-highlight:#f58a35;--input-background-color:#343641;--input-text-color:#e6e6e6;--color-cool-5-25:rgba(255,255,255,.1)}body{color:var(--color-text-primary)}main{display:grid;grid-template-columns:340px 650px;gap:24px}.column{min-width:0}h1{font-size:16px;margin:8px 0}h2{font-size:22px;line-height:1.3;border-bottom:1px solid var(--color-border);margin:10px 0;color:var(--color-text-primary)}p{margin:8px 0}.chat-message{list-style:none;background:var(--background);color:var(--color-text-primary);border:1px solid var(--color-border);border-radius:5px;padding:8px;margin:6px 0;box-shadow:0 1px 2px #0004}.message-content{font-size:14px;line-height:1.5}.message-content ul{list-style-type:disc;padding-left:24px}.message-content ol{list-style-type:decimal;padding-left:24px}.message-content li{background:transparent;border:0;border-radius:0}.application{background:var(--background);color:var(--color-text-primary);border:1px solid var(--color-border);margin:8px 0}.application .window-content{background:var(--background);padding:12px}input,select,textarea,button{font:inherit;color:var(--input-text-color);background:var(--input-background-color);border:1px solid var(--color-border);border-radius:3px;padding:4px}button{cursor:pointer}button:disabled{opacity:.5}input[type=color]{padding:0}.term-share-autocomplete{position:static!important;width:100%!important;max-height:none!important}.term-share-app{min-width:0}.term-share-app .ts-shell{min-height:300px}.term-share-app .ts-empty-detail>i{font-size:14px}a{color:var(--color-text-primary);text-decoration:underline}`;
function check() {
  const metrics = {};
  const assert = (x, m) => {if (!x) throw new Error(m);};
  const equal = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), m + ": " + JSON.stringify(a));
  const s = el => getComputedStyle(el);
  const frame = document.querySelector('[data-message-id="preview"]'), card = frame.querySelector(".term-share-card"), ordinary = document.querySelector("#ordinary");
  const apps = [...document.querySelectorAll(".term-share-app")], popup = document.querySelector(".term-share-autocomplete");
  const selected = popup.querySelector('[aria-selected="true"]'), row = document.querySelector(".ts-term-row.is-selected");
  try {
    for (const palette of ["native", "legacy", "catalog"]) {
      document.documentElement.dataset.termSharePalette = palette;
      const colors = apps.map(el => [s(el).backgroundColor, s(el).color]);
      metrics[palette] = {apps: colors, popup: [s(popup).backgroundColor,s(popup).color], input:[s(document.querySelector(".ts-editor-surface")).backgroundColor,s(document.querySelector(".ts-editor-surface")).color], selection:[s(selected).backgroundColor,s(row).backgroundColor], card:[s(card).backgroundColor,s(card).color], frame:[s(frame).backgroundColor,s(frame).padding,s(frame).borderRadius]};
      for (const color of colors) equal(color, metrics[palette].popup, palette + " UI mismatch");
      assert(metrics[palette].input[0] !== "rgba(0, 0, 0, 0)" && metrics[palette].input[0] !== metrics[palette].input[1], palette + " editor contrast");
      equal(metrics[palette].selection[0], metrics[palette].selection[1], palette + " list selection mismatch");
      equal(s(selected).borderRadius, "0px", palette + " list is not a plain row");
      if (palette === "native") {
        for (const key of ["backgroundColor","color","padding","margin","border","borderRadius","boxShadow"]) equal(s(frame)[key],s(ordinary)[key],"Native frame: "+key);
        equal(s(card).backgroundColor,"rgba(0, 0, 0, 0)","Native adds another card");
        for (const list of ["ul","ul ul","ol","li"]) {
          const a=card.querySelector(list),b=ordinary.querySelector(list);
          for (const key of ["listStyleType","paddingLeft","backgroundColor","borderRadius"]) equal(s(a)[key],s(b)[key],"Core list: "+list+key);
        }
      } else {
        const dark = document.body.classList.contains("theme-dark");
        const expected = palette === "catalog" ? ["rgb(244, 239, 223)","rgb(49, 45, 37)"] : dark ? ["rgb(36, 40, 45)","rgb(236, 235, 230)"] : ["rgb(244, 241, 232)","rgb(37, 41, 37)"];
        equal(metrics[palette].card,expected,palette+" card colors");
        equal(s(card.querySelector("a")).color,expected[1],palette+" link contrast");
        equal(colors[0],expected,palette+" app colors");
        equal(s(card).padding,"10px 16px",palette+" compact padding");
        equal(s(card).borderRadius,"2px",palette+" compact corners");
        equal(s(card.querySelector(".ts-card-title")).fontSize,"20px",palette+" title size");
      }
      assert(card.scrollWidth<=card.clientWidth,"Card overflow");
    }
    metrics.ok=true;
  } catch(error) {metrics.ok=false;metrics.error=String(error);}
  const pre=document.createElement("pre");pre.id="qa-metrics";pre.hidden=true;pre.textContent=JSON.stringify(metrics);document.body.append(pre);
  document.documentElement.dataset.termSharePalette=["native","legacy","catalog"].includes(location.hash.slice(1))?location.hash.slice(1):"native";
}
for (const theme of ["light","dark"]) await writeFile(join(output,theme+".html"),`<!doctype html><html lang="en"><meta charset="utf-8"><style>${core}</style><style>${css}</style><body class="theme-${theme}">${markup.replace('term-share-autocomplete themed', 'term-share-autocomplete themed theme-' + theme)}<script>window.addEventListener('load',${check.toString()});</script></body></html>`);
Hooks.fire("shutdown");
console.log("Generated native/legacy/catalog UI fixtures in two core theme contexts.");
