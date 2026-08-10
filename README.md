# Markdown to HTML Studio

A lightweight Netlify-hosted tool to convert Markdown into a clean, readable HTML document.

## Version

- Current version: `1.0.0`
- Release tag: `v1.0.0`

## What This Project Includes

- Browser UI with drag-and-drop Markdown upload
- Live Markdown preview with optional TOC
- Serverless conversion endpoint via Netlify Functions
- Downloadable HTML output (`.html`) with readable formatting

## Tech Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Netlify Functions (Node.js)
- Parsing/rendering libs: `marked`
- Optional PDF renderer components present in backend dependencies

## Project Structure

- `index.html`: Main web UI
- `ui.css`: UI styling
- `ui.js`: Client-side behavior and export flow
- `netlify/functions/md_to_pdf.js`: Serverless conversion function
- `netlify.toml`: Netlify build/function config
- `package.json`: Scripts and dependencies

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Start Netlify dev server:

```bash
npm run dev
```

3. Open the local URL shown by Netlify CLI.

## API Request Contract

POST to `/.netlify/functions/md_to_pdf`

Example payload:

```json
{
  "title": "quick-report",
  "markdown": "# Hello\n\nSample content",
  "includeToc": true,
  "tocDepth": 2,
  "outputFormat": "html"
}
```

## Deployment

This project is configured for Netlify deployment.

- Build command: none required
- Publish directory: repository root
- Functions directory: `netlify/functions`

See `NETLIFY_DEPLOY.md` for deployment steps.

## Notes

- `outputFormat: "html"` is the default reliable output mode.
- Keep large generated folders such as `node_modules/` out of version control.

## Author

Made by Kathan Somani
