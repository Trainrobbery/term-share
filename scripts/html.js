/** Allowlisted rich HTML. Never enrich as the GM before sharing it. */
const ALLOWED = new Set("P BR STRONG B EM I U S STRIKE H1 H2 H3 H4 H5 H6 UL OL LI BLOCKQUOTE PRE CODE HR SPAN DIV A IMG TABLE THEAD TBODY TFOOT TR TH TD CAPTION FIGURE FIGCAPTION SUP SUB DL DT DD".split(" "));
const DROP = new Set("SCRIPT STYLE IFRAME OBJECT EMBED SVG MATH FORM INPUT BUTTON SELECT TEXTAREA TEMPLATE LINK META VIDEO AUDIO SOURCE".split(" "));

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[char]));
}

export function safeURL(value, image = false) {
  const url = String(value ?? "").trim();
  // Permit Foundry asset paths and ordinary web links; reject ambiguous schemes.
  if (!url || /[\u0000-\u001f\u007f\\]/u.test(url) || url.startsWith("//")) return false;
  if (/^https?:\/\//i.test(url)) {
    try { const parsed = new URL(url); return Boolean(parsed.hostname) && !parsed.username && !parsed.password; }
    catch { return false; }
  }
  if (!image && /^mailto:[^:]+@[^:]+$/i.test(url)) return true;
  if (/^[^/?#]*:/u.test(url)) return false;
  return true;
}

function safeStyles(source, target) {
  for (const property of ["color", "background-color", "text-align", "font-weight", "font-style", "text-decoration", "font-size"]) {
    const value = source.style.getPropertyValue(property);
    if (!value || /url|expression|var\(|[{}<>\\]/i.test(value)) continue;
    if (property === "font-size" && !/^(?:[8-9]|[1-3]\d|40)px$|^(?:0\.[7-9]|1(?:\.\d)?|2)(?:em|rem)$/u.test(value)) continue;
    target.style.setProperty(property, value);
  }
}

export function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(String(html ?? ""), "text/html");
  const output = doc.createElement("div");
  function copy(node, parent) {
    if (node.nodeType === 3) {
      // Do not let private document embeds become public HTML during chat rendering.
      parent.append(doc.createTextNode(node.textContent.replace(/@Embed\[[^\]]*\](?:\{[^}]*\})?/gi, "[Embed omitted]")));
      return;
    }
    if (node.nodeType !== 1 || DROP.has(node.tagName) || node.classList.contains("secret") || node.classList.contains("content-embed") || node.hasAttribute("data-secret")) return;
    if (!ALLOWED.has(node.tagName)) {
      for (const child of node.childNodes) copy(child, parent);
      return;
    }
    const element = doc.createElement(node.tagName.toLowerCase());
    safeStyles(node, element);
    if (node.tagName === "A") {
      const href = node.getAttribute("href");
      if (safeURL(href)) {
        element.setAttribute("href", href);
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      }
      if (node.title) element.title = node.title;
    }
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src");
      if (!safeURL(src, true)) return;
      element.setAttribute("src", src);
      element.setAttribute("alt", node.getAttribute("alt") ?? "");
      element.setAttribute("loading", "lazy");
      for (const attribute of ["width", "height"]) {
        const value = Number(node.getAttribute(attribute));
        if (value > 0 && value <= 4096) element.setAttribute(attribute, String(Math.floor(value)));
      }
    }
    if (["TD", "TH"].includes(node.tagName)) {
      for (const attribute of ["colspan", "rowspan"]) {
        const value = Number(node.getAttribute(attribute));
        if (Number.isInteger(value) && value > 0 && value <= 50) element.setAttribute(attribute, String(value));
      }
    }
    if (node.tagName === "OL" && /^\d{1,5}$/.test(node.getAttribute("start") ?? "")) element.setAttribute("start", node.getAttribute("start"));
    for (const child of node.childNodes) copy(child, element);
    parent.append(element);
  }
  for (const node of doc.body.childNodes) copy(node, output);
  return output.innerHTML;
}

export function plainText(html, max = 100) {
  const doc = new DOMParser().parseFromString(sanitizeHTML(html), "text/html");
  for (const element of doc.querySelectorAll("br, p, div, li, h1, h2, h3, h4, tr")) element.append(doc.createTextNode(" "));
  const text = doc.body.textContent.replace(/\s+/gu, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function hasContent(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Boolean(doc.body.textContent.trim() || doc.body.querySelector("img[src]"));
}
