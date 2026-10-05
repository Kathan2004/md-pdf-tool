const { test } = require("node:test");
const assert = require("node:assert/strict");
const fn = require("../netlify/functions/md_to_pdf.js");

const hostile = [
  "# Report",
  '<iframe src="file:///etc/passwd"></iframe>',
  "<script>alert(1)</script>",
  "![meta](http://169.254.169.254/latest/meta-data/)",
  "[ok](https://example.com) [bad](javascript:alert(1))",
].join("\n\n");

test("raw HTML is escaped, unsafe links and remote images are dropped", () => {
  const html = fn.buildReadableHtmlFromMarkdown({ markdownText: hostile, title: "t", includeToc: true, tocDepth: 2 });
  assert.ok(!html.includes("<iframe"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("169.254.169.254"));
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes("&lt;iframe"));
});

test("filenames cannot break Content-Disposition", () => {
  assert.equal(fn.safeFilename('a"b\r\nc'), "a_b__c");
  assert.equal(fn.safeFilename(""), "document");
});

test("handler rejects oversized input", async () => {
  const r = await fn.handler({ httpMethod: "POST", body: JSON.stringify({ markdown: "x".repeat(500_001) }) });
  assert.equal(r.statusCode, 413);
});

test("handler HTML output is sanitised", async () => {
  const r = await fn.handler({ httpMethod: "POST", body: JSON.stringify({ markdown: hostile, outputFormat: "html", title: 'x"y' }) });
  assert.equal(r.statusCode, 200);
  assert.ok(!r.body.includes("<script>"));
  assert.equal(r.headers["Content-Disposition"], 'attachment; filename="x_y.html"');
});

test("Chromium render produces a PDF", { skip: !process.env.CHROMIUM_PATH }, async () => {
  const pdf = await fn.renderWithChromium({ markdownText: hostile, title: "t", includeToc: true, tocDepth: 2 });
  assert.equal(Buffer.from(pdf).subarray(0, 4).toString(), "%PDF");
});
