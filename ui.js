const titleInput = document.getElementById("title");
const markdownInput = document.getElementById("markdown");
const fileInput = document.getElementById("fileInput");
const convertBtn = document.getElementById("convertBtn");
const sampleBtn = document.getElementById("sampleBtn");
const statusEl = document.getElementById("status");
const downloadLink = document.getElementById("downloadLink");
const includeTocInput = document.getElementById("includeToc");
const tocDepthInput = document.getElementById("tocDepth");
const previewCanvas = document.getElementById("previewCanvas");
const previewPanel = document.getElementById("previewPanel");
const splitView = document.querySelector(".split-view");
const dropZone = document.getElementById("dropZone");
const multiFileInput = document.getElementById("multiFileInput");
const pickMultiBtn = document.getElementById("pickMultiBtn");
const clearMultiBtn = document.getElementById("clearMultiBtn");
const downloadJsonBtn = document.getElementById("downloadJsonBtn");
const downloadExcelBtn = document.getElementById("downloadExcelBtn");
const multiDropZone = document.getElementById("multiDropZone");
const multiFileList = document.getElementById("multiFileList");
const jsonPreview = document.getElementById("jsonPreview");
const excelPreview = document.getElementById("excelPreview");
const pipelineStatusEl = document.getElementById("pipelineStatus");
const FUNCTION_ENDPOINT = "/.netlify/functions/md_to_pdf";
const pipelineFiles = [];
let latestPipelineData = { schemaVersion: "1.0", generatedAt: "", fileCount: 0, files: [] };

function setStatus(text, state = "idle") {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function setLoading(loading) {
  convertBtn.disabled = loading;
  convertBtn.textContent = loading ? "Downloading..." : "Download HTML";
}

function setPipelineStatus(text, state = "idle") {
  pipelineStatusEl.textContent = text;
  pipelineStatusEl.dataset.state = state;
}

function safeFilename(name) {
  const cleaned = String(name || "report").trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return cleaned || "report";
}

function downloadBlob(blob, filename) {
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  downloadLink.href = blobUrl;
  downloadLink.download = filename;
  downloadLink.classList.remove("hidden");
  downloadLink.textContent = `Download again: ${filename}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
  return html;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-") || "section";
}

function extractHeadings(markdown, maxDepth) {
  const headings = [];
  const slugCounts = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (!match) continue;
    const level = match[1].length;
    if (level > maxDepth) continue;
    const text = match[2].trim();
    const baseSlug = slugify(text);
    const count = slugCounts.get(baseSlug) || 0;
    slugCounts.set(baseSlug, count + 1);
    headings.push({ level, text, slug: count ? `${baseSlug}-${count + 1}` : baseSlug });
  }
  return headings;
}

function addHeadingAnchors(html, headings) {
  let index = 0;
  return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (full, level, content) => {
    const target = headings[index];
    if (!target || Number(level) !== target.level) return full;
    index += 1;
    return `<h${level} id="${target.slug}">${content}</h${level}>`;
  });
}

function parseTableRow(line) {
  const raw = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return raw.split("|").map((cell) => inlineMarkdown(cell.trim()));
}

function parseTableRowPlain(line) {
  const raw = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return raw.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line) {
  const raw = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  if (!raw.includes("-")) return false;
  return raw.split("|").every((part) => /^:?-{3,}:?$/.test(part.trim()));
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let i = 0;
  let inCode = false;
  const paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      if (!inCode) {
        inCode = true;
        html.push("<pre><code>");
      } else {
        inCode = false;
        html.push("</code></pre>");
      }
      i += 1;
      continue;
    }

    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      i += 1;
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      html.push(`<blockquote>${inlineMarkdown(trimmed.replace(/^>\s?/, ""))}</blockquote>`);
      i += 1;
      continue;
    }

    const ulItem = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (ulItem) {
      flushParagraph();
      const items = [];
      while (i < lines.length) {
        const m = /^[-*+]\s+(.*)$/.exec(lines[i].trim());
        if (!m) break;
        items.push(`<li>${inlineMarkdown(m[1])}</li>`);
        i += 1;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const olItem = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (olItem) {
      flushParagraph();
      const items = [];
      while (i < lines.length) {
        const m = /^\d+\.\s+(.*)$/.exec(lines[i].trim());
        if (!m) break;
        items.push(`<li>${inlineMarkdown(m[1])}</li>`);
        i += 1;
      }
      html.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    const next = i + 1 < lines.length ? lines[i + 1] : "";
    if (line.includes("|") && isTableSeparator(next)) {
      flushParagraph();
      const headers = parseTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }
      const thead = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>`;
      html.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    paragraph.push(trimmed);
    i += 1;
  }

  flushParagraph();
  return html.join("\n");
}

function buildTocHtml(headings) {
  if (!headings.length) return "";
  const items = headings
    .map((heading) => {
      const indent = Math.max(0, heading.level - 1) * 14;
      return `<li style="margin-left:${indent}px"><a href="#${heading.slug}">${heading.text}</a></li>`;
    })
    .join("");
  return `<nav id="TOC" role="doc-toc"><h2>Index</h2><ul>${items}</ul></nav>`;
}

function buildDocumentHtml(markdown, includeToc, tocDepth) {
  const headings = extractHeadings(markdown, tocDepth);
  const rendered = renderMarkdown(markdown);
  const anchoredHtml = addHeadingAnchors(rendered, headings);
  const tocHtml = includeToc ? buildTocHtml(headings) : "";
  return `<div class="doc">${tocHtml}${anchoredHtml}</div>`;
}

function parseMarkdownForPipeline(markdown) {
  const lines = markdown.split(/\r?\n/);
  const rows = [];
  const tables = [];
  let i = 0;
  let inCode = false;
  let codeLines = [];

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCode) {
        rows.push({ type: "text", format: "code", content: codeLines.join("\n") });
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      i += 1;
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      i += 1;
      continue;
    }

    if (!trimmed) {
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      rows.push({ type: "text", format: `h${heading[1].length}`, content: heading[2].trim() });
      i += 1;
      continue;
    }

    const blockquote = /^>\s?(.*)$/.exec(trimmed);
    if (blockquote) {
      rows.push({ type: "text", format: "blockquote", content: blockquote[1].trim() });
      i += 1;
      continue;
    }

    const ulItem = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (ulItem) {
      while (i < lines.length) {
        const m = /^[-*+]\s+(.*)$/.exec(lines[i].trim());
        if (!m) break;
        rows.push({ type: "text", format: "list", content: m[1].trim() });
        i += 1;
      }
      continue;
    }

    const olItem = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (olItem) {
      while (i < lines.length) {
        const m = /^\d+\.\s+(.*)$/.exec(lines[i].trim());
        if (!m) break;
        rows.push({ type: "text", format: "list_ordered", content: m[1].trim() });
        i += 1;
      }
      continue;
    }

    const next = i + 1 < lines.length ? lines[i + 1] : "";
    if (line.includes("|") && isTableSeparator(next)) {
      const headers = parseTableRowPlain(line);
      const tableRows = [];
      rows.push({ type: "table_header", cells: headers });
      i += 2;
      while (i < lines.length && lines[i].includes("|")) {
        const cells = parseTableRowPlain(lines[i]);
        rows.push({ type: "table_row", cells });
        tableRows.push(cells);
        i += 1;
      }
      tables.push({ headers, rows: tableRows });
      continue;
    }

    const paragraphLines = [trimmed];
    i += 1;
    while (i < lines.length) {
      const probe = lines[i].trim();
      const probeNext = i + 1 < lines.length ? lines[i + 1] : "";
      if (!probe) break;
      if (/^(#{1,6})\s+/.test(probe)) break;
      if (/^>\s?/.test(probe)) break;
      if (/^[-*+]\s+/.test(probe)) break;
      if (/^\d+\.\s+/.test(probe)) break;
      if (probe.startsWith("```")) break;
      if (lines[i].includes("|") && isTableSeparator(probeNext)) break;
      paragraphLines.push(probe);
      i += 1;
    }
    rows.push({ type: "text", format: "paragraph", content: paragraphLines.join(" ") });
  }

  const plainText = rows
    .filter((row) => row.type === "text")
    .map((row) => row.content)
    .join("\n");

  return { rows, tables, plainText };
}

function buildPipelineData() {
  const files = pipelineFiles.map((file) => {
    const parsed = parseMarkdownForPipeline(file.markdown);
    const nameWithoutExtension = file.name.replace(/\.[^.]+$/, "") || file.name;
    return {
      fileName: file.name,
      documentId: safeFilename(nameWithoutExtension),
      rowCount: parsed.rows.length,
      tableCount: parsed.tables.length,
      plainText: parsed.plainText,
      rows: parsed.rows,
      tables: parsed.tables,
    };
  });

  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    files,
  };
}

function renderMultiFileList() {
  if (!pipelineFiles.length) {
    multiFileList.innerHTML = '<li class="empty">No files selected.</li>';
    return;
  }

  multiFileList.innerHTML = pipelineFiles
    .map((file) => `<li>${escapeHtml(file.name)} <span>${file.markdown.length} chars</span></li>`)
    .join("");
}

function escapeCell(value) {
  return escapeHtml(String(value == null ? "" : value));
}

function buildExcelTableRows(data) {
  const rows = [];

  for (const file of data.files) {
    const maxColumns = Math.max(
      1,
      ...file.rows.map((row) => (row.cells && row.cells.length ? row.cells.length : 1)),
    );

    rows.push(
      `<tr><td class="excel-file" colspan="${maxColumns}">File: ${escapeCell(file.fileName)}</td></tr>`,
    );

    for (const row of file.rows) {
      if (row.type === "text") {
        rows.push(`<tr><td class="excel-text" colspan="${maxColumns}">${escapeCell(row.content)}</td></tr>`);
        continue;
      }

      if (row.type === "table_header") {
        const headerCells = row.cells
          .map((cell) => `<th class="excel-table-head">${escapeCell(cell)}</th>`)
          .join("");
        rows.push(`<tr>${headerCells}</tr>`);
        continue;
      }

      if (row.type === "table_row") {
        const tableCells = row.cells
          .map((cell) => `<td class="excel-table-cell">${escapeCell(cell)}</td>`)
          .join("");
        rows.push(`<tr>${tableCells}</tr>`);
      }
    }

    rows.push(`<tr><td class="excel-spacer" colspan="${maxColumns}"></td></tr>`);
  }

  return rows.join("\n");
}

function buildExcelPreview(data) {
  if (!data.files.length) {
    return "";
  }

  const tableRows = buildExcelTableRows(data);
  return `<table class="pipeline-sheet"><tbody>${tableRows}</tbody></table>`;
}

function buildExcelDocument(data) {
  const tableRows = buildExcelTableRows(data);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    table { border-collapse: collapse; width: 100%; font-family: Calibri, Arial, sans-serif; font-size: 12pt; }
    .excel-file { font-weight: bold; background: #eef3f8; border: 1px solid #a3b3c2; padding: 6px; }
    .excel-text { border: none; padding: 5px 6px; white-space: pre-wrap; }
    .excel-table-head { border: 1px solid #7f96ad; background: #d9e3ec; font-weight: bold; padding: 5px 6px; }
    .excel-table-cell { border: 1px solid #7f96ad; padding: 5px 6px; }
    .excel-spacer { border: none; padding: 7px 0; }
  </style>
</head>
<body>
  <table>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
</body>
</html>`;
}

function refreshPipelineViews() {
  latestPipelineData = buildPipelineData();
  renderMultiFileList();
  jsonPreview.textContent = JSON.stringify(latestPipelineData, null, 2);
  excelPreview.innerHTML = buildExcelPreview(latestPipelineData);

  const hasFiles = latestPipelineData.fileCount > 0;
  downloadJsonBtn.disabled = !hasFiles;
  downloadExcelBtn.disabled = !hasFiles;

  if (!hasFiles) {
    setPipelineStatus("No files loaded.");
    return;
  }

  setPipelineStatus(`Prepared ${latestPipelineData.fileCount} file(s) for JSON/Excel export.`);
}

async function addPipelineFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const markdownFiles = files.filter((file) => /\.(md|markdown|txt)$/i.test(file.name));
  if (!markdownFiles.length) {
    setPipelineStatus("Only .md, .markdown, or .txt files are supported.", "error");
    return;
  }

  const loaded = await Promise.all(
    markdownFiles.map(async (file) => ({
      name: file.name,
      markdown: await file.text(),
    })),
  );

  pipelineFiles.push(...loaded);
  setPipelineStatus(`Loaded ${loaded.length} file(s).`);
  refreshPipelineViews();
}

function clearPipelineFiles() {
  pipelineFiles.length = 0;
  multiFileInput.value = "";
  refreshPipelineViews();
}

function downloadPipelineJson() {
  if (!latestPipelineData.fileCount) {
    setPipelineStatus("Load files before downloading JSON.", "error");
    return;
  }

  const blob = new Blob([JSON.stringify(latestPipelineData, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const fileName = `pipeline-${Date.now()}.json`;
  downloadBlob(blob, fileName);
  setPipelineStatus(`Downloaded ${fileName}`);
}

function downloadPipelineExcel() {
  if (!latestPipelineData.fileCount) {
    setPipelineStatus("Load files before downloading Excel.", "error");
    return;
  }

  const excelHtml = buildExcelDocument(latestPipelineData);
  const blob = new Blob([excelHtml], { type: "application/vnd.ms-excel;charset=utf-8" });
  const fileName = `pipeline-${Date.now()}.xls`;
  downloadBlob(blob, fileName);
  setPipelineStatus(`Downloaded ${fileName}`);
}

function renderPreview() {
  const markdown = markdownInput.value || "";
  const includeToc = Boolean(includeTocInput.checked);
  const tocDepth = Number(tocDepthInput.value || 2);

  if (!markdown.trim()) {
    previewCanvas.innerHTML = "";
    previewPanel.classList.add("is-hidden");
    splitView.classList.add("editor-wide");
    return;
  }

  previewPanel.classList.remove("is-hidden");
  splitView.classList.remove("editor-wide");
  previewCanvas.innerHTML = buildDocumentHtml(markdown, includeToc, tocDepth);
}

async function generateHtml() {
  const markdown = markdownInput.value;
  const filenameBase = safeFilename(titleInput.value || "report");
  const includeToc = Boolean(includeTocInput.checked);
  const tocDepth = Number(tocDepthInput.value || 2);

  if (!markdown.trim()) {
    setStatus("Paste markdown content first.", "error");
    return;
  }

  setLoading(true);
  setStatus("Generating HTML...", "busy");

  try {
    const response = await fetch(FUNCTION_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        markdown,
        title: filenameBase,
        includeToc,
        tocDepth,
        outputFormat: "html",
      }),
    });

    if (!response.ok) {
      let details = "";
      try {
        const errorText = await response.text();
        if (errorText) {
          try {
            const errJson = JSON.parse(errorText);
            details = errJson.details || errJson.error || JSON.stringify(errJson);
          } catch {
            details = errorText;
          }
        }
      } catch {
        details = "";
      }
      throw new Error(details || `Request failed (${response.status})`);
    }

    const blob = await response.blob();
    downloadBlob(blob, `${filenameBase}.html`);
    setStatus("HTML downloaded.");
  } catch (error) {
    setStatus(`Conversion failed: ${error.message}`, "error");
  } finally {
    setLoading(false);
  }
}

function loadSample() {
  titleInput.value = "quick-report";
  includeTocInput.checked = true;
  tocDepthInput.value = "2";
  tocDepthInput.disabled = false;
  markdownInput.value = `# Quick Report\n\n## Summary\nThis HTML file is generated by a Netlify serverless function and downloaded directly.\n\n## Highlights\n- Works across devices\n- Netlify serverless backend\n- No local install needed\n\n## Data\n| Metric | Value |\n|---|---:|\n| Uptime | 99.95% |\n| Requests | 1,250 |\n`;
  renderPreview();
  setStatus("Sample loaded.");
}

async function loadMarkdownFile(file) {
  const text = await file.text();
  markdownInput.value = text;
  titleInput.value = file.name.replace(/\.[^.]+$/, "");
  dropZone.innerHTML = `<p class="drop-title">${file.name}</p><p class="drop-subtitle">Loaded successfully. Drop another file or click to replace.</p>`;
  setStatus(`Loaded ${file.name}`);
  renderPreview();
}

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }
  await loadMarkdownFile(file);
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("is-dragover");
});

dropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragover");
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) {
    return;
  }
  if (!/\.(md|markdown|txt)$/i.test(file.name)) {
    setStatus("Only .md, .markdown, or .txt files are supported.", "error");
    return;
  }
  await loadMarkdownFile(file);
});

dropZone.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  fileInput.click();
});

dropZone.addEventListener("click", () => {
  fileInput.click();
});

multiFileInput.addEventListener("change", async (event) => {
  await addPipelineFiles(event.target.files);
});

multiDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  multiDropZone.classList.add("is-dragover");
});

multiDropZone.addEventListener("dragleave", () => {
  multiDropZone.classList.remove("is-dragover");
});

multiDropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  multiDropZone.classList.remove("is-dragover");
  await addPipelineFiles(event.dataTransfer && event.dataTransfer.files);
});

multiDropZone.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  multiFileInput.click();
});

multiDropZone.addEventListener("click", () => {
  multiFileInput.click();
});

convertBtn.addEventListener("click", generateHtml);
sampleBtn.addEventListener("click", loadSample);
pickMultiBtn.addEventListener("click", () => multiFileInput.click());
clearMultiBtn.addEventListener("click", clearPipelineFiles);
downloadJsonBtn.addEventListener("click", downloadPipelineJson);
downloadExcelBtn.addEventListener("click", downloadPipelineExcel);
includeTocInput.addEventListener("change", () => {
  tocDepthInput.disabled = !includeTocInput.checked;
  renderPreview();
});
tocDepthInput.addEventListener("change", renderPreview);
markdownInput.addEventListener("input", renderPreview);

tocDepthInput.disabled = !includeTocInput.checked;
renderPreview();
setStatus("Ready");
refreshPipelineViews();
