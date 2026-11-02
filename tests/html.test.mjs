import test from "node:test";
import assert from "node:assert/strict";
import {JSDOM} from "jsdom";
import {sanitizeHTML, plainText, safeURL, hasContent, escapeHTML} from "../scripts/html.js";
globalThis.DOMParser = new JSDOM("").window.DOMParser;

test("rich formatting, Unicode, ordinary links, tables, and local images survive", () => {
  const html = sanitizeHTML('<h2>출혈</h2><p><strong>강조</strong> <em>기울임</em><span style="color:red;text-align:center">빨강</span><a href="https://example.org/rules">규칙</a></p><ul><li>하나</li></ul><table><tr><td colspan="2">표</td></tr></table><img src="worlds/test/한글 이미지.webp" width="800">');
  assert.match(html, /<strong>강조<\/strong>/);
  assert.match(html, /color: red/);
  assert.match(html, /noopener noreferrer/);
  assert.match(html, /colspan="2"/);
  assert.match(html, /한글 이미지.webp/);
  assert.equal(hasContent('<img src="icons/book.webp">'), true);
  assert.equal(hasContent("<p><br></p>"), false);
});

test("scripts, event attributes, dangerous schemes, embedded documents and secret blocks are removed", () => {
  const html = sanitizeHTML('<p onclick="evil()">안전</p><script>evil()</script><img src="x" onerror="evil()"><a href="jav&#97;script:evil()">bad</a><iframe src="x">private</iframe><section class="secret revealed">비밀</section><div class="content-embed">비공개 저널</div><p>@Embed[JournalEntry.secret]</p><svg onload="evil()"></svg><span style="background-image:url(javascript:evil());position:fixed">글</span>');
  assert.doesNotMatch(html, /onclick|onerror|javascript|iframe|<script|<svg|비밀|비공개 저널|@Embed|position:|background-image/);
  assert.match(html, /안전/);
  assert.match(html, /Embed omitted/);
});

test("URL validation blocks mixed case and control character schemes while allowing asset paths", () => {
  for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\nscript:evil()", "data:text/html,x", "//evil.test", "\\\\evil.test", "https://user:pass@example.com/"]) assert.equal(safeURL(url), false, url);
  for (const url of ["icons/svg/book.svg", "worlds/test/my image.png", "/assets/book.webp", "https://example.org/image.png", "#section"]) assert.equal(safeURL(url), true, url);
  assert.equal(safeURL("mailto:gm@example.org"), true);
  assert.equal(safeURL("mailto:gm@example.org", true), false);
});

test("previews contain only text, preserve word boundaries and truncate", () => {
  assert.equal(plainText("<p>첫째</p><p><b>둘째</b></p>"), "첫째 둘째");
  assert.equal(plainText("<script>evil()</script><p>안전한 설명</p>", 3), "안전한…");
  assert.equal(escapeHTML('<img a="x">&'), "&lt;img a=&quot;x&quot;&gt;&amp;");
  assert.equal(sanitizeHTML(sanitizeHTML('<p style="color:red"><b>중복 정제</b></p>')), sanitizeHTML('<p style="color:red"><b>중복 정제</b></p>'));
});
