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
const dropZone = document.getElementById("dropZone");
const FUNCTION_ENDPOINT = "/.netlify/functions/md_to_pdf";

function setStatus(text, state = "idle") {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function setLoading(loading) {
  convertBtn.disabled = loading;
  convertBtn.textContent = loading ? "Downloading..." : "Download HTML";
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

function renderPreview() {
  const markdown = markdownInput.value || "";
  const includeToc = Boolean(includeTocInput.checked);
  const tocDepth = Number(tocDepthInput.value || 2);

  if (!markdown.trim()) {
    previewCanvas.innerHTML = "";
    previewPanel.classList.add("is-hidden");
    return;
  }

  previewPanel.classList.remove("is-hidden");
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

convertBtn.addEventListener("click", generateHtml);
sampleBtn.addEventListener("click", loadSample);
includeTocInput.addEventListener("change", () => {
  tocDepthInput.disabled = !includeTocInput.checked;
  renderPreview();
});
tocDepthInput.addEventListener("change", renderPreview);
markdownInput.addEventListener("input", renderPreview);

tocDepthInput.disabled = !includeTocInput.checked;
renderPreview();
setStatus("Ready");
