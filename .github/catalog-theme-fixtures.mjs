import {readFile, writeFile, mkdir} from "node:fs/promises";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {JSDOM} from "jsdom";
const project = process.argv[2] || process.cwd();
const output = process.argv[3] || join(project, "dist", "theme-qa");
await mkdir(output, {recursive: true});
const css = await readFile(join(project, "styles/term-share.css"), "utf8");
const translations = JSON.parse(await readFile(join(project, "lang/en.json"), "utf8")).TERM_SHARE;
globalThis.DOMParser = new JSDOM().window.DOMParser;
globalThis.game = {i18n: {format: (key, data) => translations[key.replace("TERM_SHARE.", "")].replace("{name}", data.name)}};
const {cardHTML, renderTermMessage} = await import(pathToFileURL(join(project, "scripts/chat.js")).href);
function card(entry, id, legacy = false) {
  const dom = new JSDOM(`<li class="chat-message message flexcol" data-message-id="${id}"></li>`);
  const el = dom.window.document.querySelector("li");
  const content = cardHTML(entry, "Gamemaster");
  el.innerHTML = '<header class="message-header"><strong>작성자</strong><time class="message-timestamp">방금</time><a class="message-delete">삭제</a></header><div class="message-content">' + content + '</div>';
  if (legacy) {
    const article = el.querySelector(".term-share-card");
    const header = dom.window.document.createElement("header"); header.className = "ts-card-header"; header.textContent = "이전 공유 안내";
    const footer = dom.window.document.createElement("footer"); footer.className = "ts-card-footer"; footer.textContent = "용어 사전 · Term Share";
    article.prepend(header); article.append(footer);
  }
  const originalNodes = [...el.querySelectorAll("*")];
  const message = {content, getFlag: (module, key) => module === "term-share" && key === "kind" ? "term" : undefined};
  renderTermMessage(message, el);
  if (message.content !== content || !originalNodes.every(node => el.contains(node))) throw new Error("Saved HTML or native nodes changed");
  el.querySelector(".ts-card-body a")?.classList.add("content-link");
  return el.outerHTML;
}
const normal = card({name: "Library record", description: '<p><strong>Term definition</strong> and related rules, collected for reference.</p><ul><li>Use <em>emphasis</em> for important details.</li><li><a href="https://foundryvtt.com/">Open related document</a></li></ul>'}, "preview");
const stress = card({name: "AnUnbrokenCatalogueTitleThatStillFitsInsideTheNarrowestChatColumn", description: '<p><a href="https://foundryvtt.com/">https://example.invalid/' + "verylongdocumentreference".repeat(8) + '</a></p><p><img src="sample.svg" alt="본문 이미지"></p><pre>' + "Long text ".repeat(18) + '</pre>'}, "stress", true);
const core = `li{list-style:none}body{margin:0;padding:24px;background:#e7e7e7;color:#222}body.theme-dark{background:#171a1f;color:#eee}.channel{width:420px;max-width:100%}.chat-message{box-sizing:border-box;padding:10px;border:1px solid #777;background:#eee;box-shadow:0 2px 4px #0003;margin:8px 0}.theme-dark .chat-message{background:#24282d;color:#eee}h2{border-bottom:2px solid #777;font-size:26px}a.content-link{display:inline-block;white-space:nowrap}p{margin:1em 0}ul{padding-left:22px}`;
function checkStyles(css) {
  const assert = (value, message) => {if (!value) throw new Error(message);};
  const equal = (actual, expected, message) => assert(JSON.stringify(actual) === JSON.stringify(expected), message + ": " + JSON.stringify(actual));
  const metrics = {};
  try {
    const ordinary = document.querySelector("#ordinary");
    const ordinaryStyle = () => {const s=getComputedStyle(ordinary);return [s.backgroundColor,s.color,s.padding,s.border,s.boxShadow];};
    const before = ordinaryStyle();
    const style = document.createElement("style"); style.textContent = css; document.head.append(style);
    equal(ordinaryStyle(), before, "Ordinary chat changed");
    const root = document.querySelector('[data-message-id="preview"]');
    const card = root.querySelector(".term-share-card");
    const notice = card.querySelector(".ts-share-notice"), title = card.querySelector(".ts-card-title"), body = card.querySelector(".ts-card-body");
    const s=getComputedStyle(card), n=getComputedStyle(notice), t=getComputedStyle(title), b=getComputedStyle(body);
    metrics.card={bg:s.backgroundColor,color:s.color,border:s.border,radius:s.borderRadius,shadow:s.boxShadow,padding:s.padding,image:s.backgroundImage};
    metrics.notice={color:n.color,size:n.fontSize,gap:n.marginBottom};
    metrics.title={color:t.color,size:t.fontSize,line:t.lineHeight};
    metrics.body={color:b.color,size:b.fontSize,line:b.lineHeight,divider:b.borderTop,gap:b.paddingTop};
    metrics.fit=[...document.querySelectorAll(".term-share-card")].map(el=>({width:el.clientWidth,scroll:el.scrollWidth,parent:el.parentElement.clientWidth,height:el.getBoundingClientRect().height}));
    metrics.images=[...document.images].map(el=>({width:el.getBoundingClientRect().width,parent:el.parentElement.clientWidth}));
    equal(metrics.card,{bg:"rgb(244, 239, 223)",color:"rgb(49, 45, 37)",border:"1px solid rgb(200, 185, 156)",radius:"2px",shadow:"none",padding:"14px 16px",image:"none"},"Card design");
    equal(metrics.notice,{color:"rgb(112, 100, 82)",size:"11px",gap:"7px"},"Notice design");
    equal(metrics.title,{color:"rgb(49, 45, 37)",size:"20px",line:"28px"},"Title design");
    equal(metrics.body,{color:"rgb(49, 45, 37)",size:"14px",line:"22.4px",divider:"1px solid rgb(200, 185, 156)",gap:"10px"},"Body design");
    assert(metrics.fit.every(x=>x.scroll<=x.width && x.width<=x.parent),"Card or text overflows");
    assert(metrics.images.every(x=>x.width<=x.parent),"Content image overflows");
    assert(root.querySelector(".message-header") && root.querySelector(".message-timestamp"),"Native nodes missing");
    equal(getComputedStyle(root.querySelector(".message-header")).display,"none","Header not safely hidden");
    assert([...document.querySelectorAll(".ts-card-header,.ts-card-footer")].every(el=>getComputedStyle(el).display==="none"),"Legacy chrome visible");
    equal([...card.children].map(el=>el.className),["ts-share-notice","ts-card-title","ts-card-body"],"Card order");
    let clicks=0,menus=0;
    const link=root.querySelector(".ts-card-body a");
    link.addEventListener("click",event=>{event.preventDefault();clicks++;});
    root.addEventListener("contextmenu",event=>{event.preventDefault();menus++;});
    link.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true}));
    card.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));
    equal([clicks,menus],[1,1],"Link or context event lost");
    metrics.ok=true;
  } catch(error) {metrics.ok=false;metrics.error=String(error);}
  const pre=document.createElement("pre");pre.id="qa-metrics";pre.hidden=true;pre.textContent=JSON.stringify(metrics);document.body.append(pre);
  document.documentElement.dataset.qa=metrics.ok?"passed":"failed";
}
for (const [name,theme,width] of [["light","theme-light",420],["dark","theme-dark",420],["narrow","theme-dark",220]]) {
  const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><style>${core}</style><body class="${theme}"><main class="channel" style="width:${width}px"><li class="chat-message" id="ordinary">Ordinary chat message</li>${normal}${stress}</main><script>window.addEventListener('load',()=>(${checkStyles.toString()})(${JSON.stringify(css)}));</script></body></html>`;
  await writeFile(join(output,`${name}.html`),html);
}
await writeFile(join(output,"sample.svg"),'<svg xmlns="http://www.w3.org/2000/svg" width="960" height="120"><rect width="960" height="120" fill="#c8b99c"/></svg>');
console.log("Generated three isolated card-rendering fixtures.");
