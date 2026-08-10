const PDFDocument = require("pdfkit");
const { marked } = require("marked");
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const THEME = {
  colors: {
    text: "#14212e",
    heading: "#0f2740",
    muted: "#4f667d",
    line: "#8fa4b8",
    tocBg: "#edf3f8",
    tocBorder: "#8fa5ba",
    tableHeadBg: "#d9e5f0",
    tableBorder: "#7f96ad",
    quote: "#1f3a56",
    quoteBorder: "#6f88a1",
    codeBg: "#e7eef4",
    codeBorder: "#b4c2cf",
  },
  page: {
    size: "A4",
    margins: { top: 44, right: 38, bottom: 44, left: 38 },
  },
  font: {
    body: 10.8,
    h1: 21,
    h2: 16,
    h3: 13,
    h4: 11.5,
    code: 9,
  },
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  };
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripInlineMarkdown(text) {
  return String(text || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
}

function softWrapLongTokens(text) {
  const wrapToken = (token) => {
    const plain = String(token || "");
    if (plain.length < 30) return plain;
    let wrapped = plain.replace(/([/@._:?&=#%+-])/g, "$1\u200B");
    if (!wrapped.includes("\u200B")) {
      wrapped = wrapped.replace(/(.{22})/g, "$1\u200B");
    }
    return wrapped;
  };

  return String(text || "")
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : wrapToken(part)))
    .join("");
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-") || "section";
}

function extractHeadings(markdownText, maxDepth) {
  const headings = [];
  const slugCounts = new Map();

  for (const line of String(markdownText || "").split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (!match) continue;

    const level = match[1].length;
    if (level > maxDepth) continue;

    const text = stripInlineMarkdown(match[2].trim());
    const base = slugify(text);
    const count = slugCounts.get(base) || 0;
    slugCounts.set(base, count + 1);

    headings.push({
      level,
      text,
      slug: count ? `${base}-${count + 1}` : base,
    });
  }

  return headings;
}

function addHeadingAnchorsToHtml(html, headings) {
  let index = 0;
  return String(html || "").replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (full, level, content) => {
    const h = headings[index];
    if (!h || Number(level) !== h.level) return full;
    index += 1;
    return `<h${level} id="${h.slug}">${content}</h${level}>`;
  });
}

function wrapTables(html) {
  return String(html || "").replace(/(<table[\s\S]*?<\/table>)/gi, '<div class="table-wrap">$1</div>');
}

function buildTocHtml(headings) {
  if (!headings.length) return "";

  const items = headings
    .map((h) => `<li class="toc-l${h.level}">${escapeHtml(h.text)}</li>`)
    .join("");

  return `<section class="toc"><h2>Index</h2><ul>${items}</ul></section>`;
}

function buildHtmlTemplate({ title, bodyHtml, tocHtml }) {
  const safeTitle = escapeHtml(title || "document");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    @page { size: A4; margin: 18mm 14mm 18mm 14mm; }
    *, *::before, *::after { box-sizing: border-box; }

    body {
      font-family: "Segoe UI", Arial, Helvetica, "Noto Sans", sans-serif;
      color: #132030;
      font-size: 11pt;
      line-height: 1.48;
      margin: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .doc { width: 100%; }

    .toc {
      margin: 0 0 18px 0;
      padding: 12px 16px;
      background: #edf3f8;
      border: 1px solid #8fa5ba;
      border-radius: 7px;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .toc h2 {
      margin: 0 0 8px 0;
      font-size: 14pt;
      color: #0f2740;
      border: none;
      padding: 0;
    }

    .toc ul { margin: 0; padding-left: 20px; }
    .toc li { margin: 3px 0; color: #4f667d; overflow-wrap: anywhere; }
    .toc-l2 { padding-left: 12px; }
    .toc-l3 { padding-left: 24px; }
    .toc-l4 { padding-left: 36px; }

    h1, h2, h3, h4, h5, h6 {
      color: #0f2740;
      line-height: 1.24;
      margin-top: 16px;
      margin-bottom: 7px;
      overflow-wrap: anywhere;
      page-break-after: avoid;
      break-after: avoid;
    }

    h1 { font-size: 22pt; border-bottom: 1.5px solid #8fa4b8; padding-bottom: 4px; margin-top: 0; }
    h2 { font-size: 17pt; border-bottom: 1px solid #9db0c2; padding-bottom: 3px; }
    h3 { font-size: 14pt; }
    h4 { font-size: 12pt; }

    p {
      margin: 0 0 9px 0;
      overflow-wrap: anywhere;
      orphans: 3;
      widows: 3;
    }

    ul, ol { margin: 0 0 11px 0; padding-left: 22px; }
    li { margin: 2px 0; }

    blockquote {
      margin: 8px 0 10px 0;
      padding: 7px 12px;
      border-left: 3px solid #6f88a1;
      color: #1f3a56;
      background: #f4f8fb;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    code {
      font-family: "Courier New", monospace;
      background: #eef2f6;
      padding: 1px 4px;
      border-radius: 3px;
    }

    pre {
      margin: 8px 0 12px 0;
      padding: 10px 12px;
      border: 1px solid #b4c2cf;
      border-radius: 4px;
      background: #e7eef4;
      font-family: "Courier New", monospace;
      font-size: 9pt;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    pre code { background: transparent; padding: 0; }

    .table-wrap { width: 100%; margin: 8px 0 14px 0; }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 9.4pt;
    }

    thead { display: table-header-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }

    th, td {
      border: 1px solid #7f96ad;
      padding: 6px 8px;
      vertical-align: top;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    th {
      background: #d9e5f0;
      color: #0f2740;
      font-weight: 700;
    }

    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 8px auto;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    hr { border: 0; border-top: 1px solid #8fa4b8; margin: 12px 0; }
  </style>
</head>
<body>
  <article class="doc">${tocHtml}${bodyHtml}</article>
</body>
</html>`;
}

function buildReadableHtmlFromMarkdown({ markdownText, title, includeToc, tocDepth }) {
  marked.setOptions({ gfm: true, breaks: false, headerIds: false });

  const headings = extractHeadings(markdownText, tocDepth);
  const parsedHtml = marked.parse(markdownText || "");
  const anchoredHtml = addHeadingAnchorsToHtml(parsedHtml, headings);
  const wrappedHtml = wrapTables(anchoredHtml);
  const tocHtml = includeToc ? buildTocHtml(headings) : "";

  return buildHtmlTemplate({
    title,
    bodyHtml: wrappedHtml,
    tocHtml,
  });
}

async function renderWithChromium({ markdownText, title, includeToc, tocDepth }) {
  const html = buildReadableHtmlFromMarkdown({ markdownText, title, includeToc, tocDepth });

  const executablePath = await chromium.executablePath();
  if (!executablePath) {
    throw new Error("Chromium executable path unavailable");
  }

  const browser = await puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
    executablePath,
    defaultViewport: chromium.defaultViewport,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }
}

function resetX(doc) {
  doc.x = doc.page.margins.left;
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function bottomLimit(doc) {
  return doc.page.height - doc.page.margins.bottom;
}

function ensureSpace(doc, needed) {
  if (doc.y + needed <= bottomLimit(doc)) return;
  doc.addPage();
  resetX(doc);
}

function writeBodyText(doc, text, opts = {}) {
  resetX(doc);
  doc
    .font("Helvetica")
    .fontSize(THEME.font.body)
    .fillColor(THEME.colors.text)
    .text(softWrapLongTokens(text), {
      width: contentWidth(doc),
      align: "left",
      lineGap: 2,
      ...opts,
    });
}

function tokenToText(token) {
  if (!token) return "";
  if (typeof token === "string") return stripInlineMarkdown(token);
  if (Array.isArray(token)) return token.map(tokenToText).join("");
  if (token.text) return stripInlineMarkdown(token.text);
  if (token.tokens) return token.tokens.map(tokenToText).join("");
  if (token.raw && typeof token.raw === "string") return stripInlineMarkdown(token.raw);
  return "";
}

function listItemToText(item) {
  if (!item) return "";
  if (!item.tokens || !item.tokens.length) {
    return stripInlineMarkdown(item.text || "");
  }

  return item.tokens
    .filter((t) => t.type !== "list")
    .map((t) => {
      if (t.type === "paragraph" || t.type === "text") {
        return tokenToText(t.tokens && t.tokens.length ? t.tokens : t.text || "");
      }
      return tokenToText(t);
    })
    .join("\n")
    .trim();
}

function drawHeadingRule(doc, width = 0.6) {
  const y = doc.y + 2;
  doc.save();
  doc.lineWidth(width);
  doc.strokeColor(THEME.colors.line);
  doc.moveTo(doc.page.margins.left, y);
  doc.lineTo(doc.page.width - doc.page.margins.right, y);
  doc.stroke();
  doc.restore();
  doc.moveDown(0.25);
}

function fitHeadingSize(doc, text, maxSize, minSize, maxLines) {
  let size = maxSize;
  while (size >= minSize) {
    doc.font("Helvetica-Bold").fontSize(size);
    const height = doc.heightOfString(text, { width: contentWidth(doc), lineGap: 2 });
    const lineHeight = Math.max(1, doc.currentLineHeight() + 2);
    const lines = Math.ceil(height / lineHeight);
    if (lines <= maxLines) return size;
    size -= 0.5;
  }
  return minSize;
}

function computeTableColumnWidths(doc, headers, rows, availableWidth) {
  const columnCount = Math.max(headers.length, ...(rows.map((r) => r.length)), 1);
  const columns = Array.from({ length: columnCount }, () => []);

  headers.forEach((value, i) => columns[i].push(String(value || "")));
  rows.forEach((row) => row.forEach((value, i) => columns[i].push(String(value || ""))));

  doc.font("Helvetica").fontSize(9.2);

  const raw = columns.map((cells) => {
    let max = 56;
    cells.forEach((cell) => {
      const sample = softWrapLongTokens(cell).replace(/\u200B/g, "").slice(0, 130);
      const measured = doc.widthOfString(sample || " ");
      max = Math.max(max, Math.min(330, measured + 16));
    });
    return max;
  });

  const totalRaw = raw.reduce((a, b) => a + b, 0) || 1;
  let widths = raw.map((v) => (v / totalRaw) * availableWidth);

  const min = Math.max(62, Math.min(92, (availableWidth / columnCount) * 0.55));
  const max = Math.max(120, availableWidth * 0.55);

  widths = widths.map((w) => Math.max(min, Math.min(max, w)));

  let sum = widths.reduce((a, b) => a + b, 0);
  const diff = availableWidth - sum;
  if (Math.abs(diff) > 0.1) {
    const per = diff / widths.length;
    widths = widths.map((w) => w + per);
  }

  return widths;
}

function renderTable(doc, token) {
  resetX(doc);

  const headers = (token.header || []).map((cell) => stripInlineMarkdown(cell.text || cell));
  const rows = (token.rows || []).map((row) => row.map((cell) => stripInlineMarkdown(cell.text || cell)));
  const columnCount = Math.max(headers.length, ...(rows.map((r) => r.length)), 1);
  const tableRows = rows.map((r) => [...r, ...Array(columnCount - r.length).fill("")]);

  const availableWidth = contentWidth(doc);
  const widths = computeTableColumnWidths(doc, headers, tableRows, availableWidth);
  const bodyFontSize = columnCount >= 6 ? 8.2 : columnCount >= 5 ? 8.6 : columnCount >= 4 ? 9 : 9.4;
  const rowGap = 5;

  const xForCol = (index) => doc.page.margins.left + widths.slice(0, index).reduce((a, b) => a + b, 0);

  const getRowHeight = (cells, isHeader) => {
    doc.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(isHeader ? 9.8 : bodyFontSize);
    const heights = cells.map((cell, index) => {
      const value = softWrapLongTokens(cell);
      return doc.heightOfString(value, {
        width: widths[index] - 10,
        align: "left",
        lineGap: 1.2,
      }) + 10;
    });
    return Math.max(24, ...heights);
  };

  const drawRow = (cells, isHeader) => {
    resetX(doc);
    const rowHeight = getRowHeight(cells, isHeader);
    const y = doc.y;

    cells.forEach((cell, index) => {
      const x = xForCol(index);
      const w = widths[index];

      if (isHeader) {
        doc.save();
        doc.fillColor(THEME.colors.tableHeadBg).rect(x, y, w, rowHeight).fill();
        doc.restore();
      }

      doc.save();
      doc.lineWidth(0.4).strokeColor(THEME.colors.tableBorder).rect(x, y, w, rowHeight).stroke();
      doc.restore();

      doc
        .font(isHeader ? "Helvetica-Bold" : "Helvetica")
        .fontSize(isHeader ? 9.8 : bodyFontSize)
        .fillColor(isHeader ? THEME.colors.heading : THEME.colors.text)
        .text(softWrapLongTokens(cell), x + 5, y + 5, {
          width: w - 10,
          align: "left",
          lineGap: 1.2,
        });
    });

    doc.y = y + rowHeight + rowGap;
    resetX(doc);
  };

  const header = headers.length ? headers : Array(columnCount).fill("");

  const headerHeight = getRowHeight(header, true);
  ensureSpace(doc, headerHeight + rowGap + 2);
  drawRow(header, true);

  for (const row of tableRows) {
    const h = getRowHeight(row, false);
    if (doc.y + h + rowGap > bottomLimit(doc)) {
      doc.addPage();
      resetX(doc);
      ensureSpace(doc, headerHeight + rowGap + 2);
      drawRow(header, true);
    }
    drawRow(row, false);
  }

  doc.moveDown(0.35);
  resetX(doc);
}

function renderList(doc, items, ordered, level) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const bullet = ordered ? `${index + 1}.` : "-";
    const text = softWrapLongTokens(listItemToText(item));

    ensureSpace(doc, 22);
    resetX(doc);

    const indentX = doc.page.margins.left + level * 14;
    const bulletWidth = ordered ? 12 : 8;

    doc.font("Helvetica").fontSize(THEME.font.body).fillColor(THEME.colors.text);
    doc.text(bullet, indentX, doc.y, { width: bulletWidth, lineBreak: false });
    doc.text(text, indentX + bulletWidth + 2, doc.y, {
      width: doc.page.width - doc.page.margins.right - (indentX + bulletWidth + 2),
      lineGap: 2,
      align: "left",
    });

    doc.moveDown(0.15);
    resetX(doc);

    if (item.tokens) {
      const nestedLists = item.tokens.filter((t) => t.type === "list");
      nestedLists.forEach((nested) => renderList(doc, nested.items || [], nested.ordered, level + 1));
    }
  }

  doc.moveDown(0.2);
  resetX(doc);
}

function renderTokensWithPdfKit(doc, tokens) {
  for (const token of tokens) {
    resetX(doc);

    switch (token.type) {
      case "space":
        break;

      case "heading": {
        const text = tokenToText(token.tokens && token.tokens.length ? token.tokens : token.text);
        if (token.depth === 1) {
          const size = fitHeadingSize(doc, text, THEME.font.h1, 16, 2);
          ensureSpace(doc, 34);
          doc.font("Helvetica-Bold").fontSize(size).fillColor(THEME.colors.heading).text(text, {
            width: contentWidth(doc),
            lineGap: 2,
          });
          drawHeadingRule(doc, 1);
        } else if (token.depth === 2) {
          const size = fitHeadingSize(doc, text, THEME.font.h2, 12.5, 2);
          ensureSpace(doc, 28);
          doc.font("Helvetica-Bold").fontSize(size).fillColor(THEME.colors.heading).text(text, {
            width: contentWidth(doc),
            lineGap: 2,
          });
          drawHeadingRule(doc, 0.6);
        } else {
          const size = token.depth === 3 ? THEME.font.h3 : THEME.font.h4;
          ensureSpace(doc, 22);
          doc.font("Helvetica-Bold").fontSize(size).fillColor(THEME.colors.heading).text(text, {
            width: contentWidth(doc),
          });
          doc.moveDown(0.2);
        }
        break;
      }

      case "paragraph":
        ensureSpace(doc, 22);
        writeBodyText(doc, tokenToText(token.tokens && token.tokens.length ? token.tokens : token.text));
        doc.moveDown(0.45);
        break;

      case "blockquote": {
        const text = softWrapLongTokens(tokenToText(token.tokens && token.tokens.length ? token.tokens : token.text || ""));
        const width = contentWidth(doc) - 14;
        const textHeight = doc.heightOfString(text, { width, lineGap: 2 });
        const blockHeight = Math.max(22, textHeight + 8);
        ensureSpace(doc, blockHeight + 4);

        const top = doc.y;
        doc.save();
        doc.lineWidth(2).strokeColor(THEME.colors.quoteBorder);
        doc.moveTo(doc.page.margins.left, top).lineTo(doc.page.margins.left, top + blockHeight).stroke();
        doc.restore();

        doc.font("Helvetica-Oblique").fontSize(THEME.font.body).fillColor(THEME.colors.quote);
        doc.text(text, doc.page.margins.left + 10, top + 2, {
          width,
          lineGap: 2,
        });

        doc.y = top + blockHeight;
        doc.moveDown(0.45);
        resetX(doc);
        break;
      }

      case "code": {
        const codeText = String(token.text || "")
          .replace(/\t/g, "    ")
          .replace(/\n{3,}/g, "\n\n")
          .trimEnd();

        const width = contentWidth(doc) - 12;
        const content = codeText || " ";
        const blockHeight = Math.max(22, doc.heightOfString(content, { width, lineGap: 1 }) + 12);
        ensureSpace(doc, blockHeight + 8);

        const top = doc.y;
        doc.save();
        doc.roundedRect(doc.page.margins.left, top, contentWidth(doc), blockHeight, 3)
          .fillAndStroke(THEME.colors.codeBg, THEME.colors.codeBorder);
        doc.restore();

        doc.font("Courier").fontSize(THEME.font.code).fillColor(THEME.colors.text);
        doc.text(content, doc.page.margins.left + 6, top + 6, {
          width,
          lineGap: 1,
          align: "left",
        });

        doc.y = top + blockHeight;
        doc.moveDown(0.8);
        resetX(doc);
        break;
      }

      case "list":
        renderList(doc, token.items || [], token.ordered, 0);
        break;

      case "table":
        renderTable(doc, token);
        break;

      case "hr":
        ensureSpace(doc, 10);
        doc.save();
        doc.lineWidth(0.5).strokeColor(THEME.colors.line);
        doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
        doc.restore();
        doc.moveDown(0.5);
        resetX(doc);
        break;

      default:
        if (token.text) {
          ensureSpace(doc, 20);
          writeBodyText(doc, tokenToText(token.tokens && token.tokens.length ? token.tokens : token.text));
          doc.moveDown(0.35);
        }
        break;
    }
  }
}

async function renderWithPdfKit({ markdownText, title, includeToc, tocDepth }) {
  marked.setOptions({ gfm: true, breaks: false, headerIds: false });
  const tokens = marked.lexer(markdownText);

  const doc = new PDFDocument({
    size: THEME.page.size,
    margins: THEME.page.margins,
    info: { Title: title },
  });

  const buffers = [];
  doc.on("data", (chunk) => buffers.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);
  });

  resetX(doc);

  if (includeToc) {
    const headings = extractHeadings(markdownText, tocDepth);
    if (headings.length) {
      doc.font("Helvetica-Bold").fontSize(13);

      const titleHeight = doc.heightOfString("Index", { width: contentWidth(doc) - 20 });
      let tocHeight = titleHeight + 20;

      headings.forEach((h) => {
        const indent = Math.max(0, h.level - 1) * 12;
        const width = contentWidth(doc) - 20 - indent;
        tocHeight += doc.heightOfString(`- ${h.text}`, { width, lineGap: 1.5 }) + 2;
      });

      ensureSpace(doc, tocHeight + 8);

      const top = doc.y;
      doc.save();
      doc.roundedRect(doc.page.margins.left, top, contentWidth(doc), tocHeight, 6)
        .fillAndStroke(THEME.colors.tocBg, THEME.colors.tocBorder);
      doc.restore();

      let y = top + 10;
      doc.font("Helvetica-Bold").fontSize(13).fillColor(THEME.colors.heading);
      doc.text("Index", doc.page.margins.left + 10, y, { width: contentWidth(doc) - 20 });

      y += titleHeight + 6;

      headings.forEach((h) => {
        const indent = Math.max(0, h.level - 1) * 12;
        const width = contentWidth(doc) - 20 - indent;
        doc.font("Helvetica").fontSize(10).fillColor(THEME.colors.muted);
        doc.text(`- ${h.text}`, doc.page.margins.left + 10 + indent, y, {
          width,
          lineGap: 1.5,
          align: "left",
        });
        y = doc.y + 2;
      });

      doc.y = y + 10;
      resetX(doc);
    }
  }

  renderTokensWithPdfKit(doc, tokens);
  doc.end();
  return await done;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Use POST with JSON body: { markdown }" });
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const markdownText = String(payload.markdown || "");
    const title = String(payload.title || "document");
    const includeToc = payload.includeToc !== false;
    const tocDepth = Math.max(1, Math.min(4, Number(payload.tocDepth) || 2));
    const outputFormat = String(payload.outputFormat || "pdf").toLowerCase();

    if (!markdownText.trim()) {
      return jsonResponse(400, { error: "Missing 'markdown' string in request body" });
    }

    if (outputFormat === "html") {
      const html = buildReadableHtmlFromMarkdown({ markdownText, title, includeToc, tocDepth });
      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="${title}.html"`,
          "X-Renderer-Version": "netlify-html-v1",
        },
        body: html,
      };
    }

    let rendererVersion = "netlify-chromium-v3";
    let fallbackReason = "";
    let pdfBuffer;

    try {
      pdfBuffer = await renderWithChromium({ markdownText, title, includeToc, tocDepth });
    } catch (err) {
      rendererVersion = "netlify-pdfkit-v5-fallback";
      fallbackReason = String(err && err.message ? err.message : err || "unknown render error").slice(0, 180);
      pdfBuffer = await renderWithPdfKit({ markdownText, title, includeToc, tocDepth });
    }

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${title}.pdf"`,
        "X-Renderer-Version": rendererVersion,
        "X-Renderer-Fallback-Reason": fallbackReason || "",
      },
      body: pdfBuffer.toString("base64"),
    };
  } catch (error) {
    return jsonResponse(500, {
      error: "Conversion failed",
      details: error && error.message ? error.message : String(error),
    });
  }
};
