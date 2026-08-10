# Multi-device deployment (no repeated setup)

This project can be deployed in two practical ways.

## Option A: Portable app on each device (no Python install required)

Use this when each device should auto-convert files locally.

### 1) Build one executable

Run on your main machine:

```powershell
python -m pip install pyinstaller
pyinstaller --noconfirm --onefile --name md2pdf-watcher mdconverter.py
```

Output file:

- `dist\md2pdf-watcher.exe`

### 2) Create a portable bundle folder

Create this structure and copy files:

```text
md2pdf-bundle/
  md2pdf-watcher.exe
  style.css
  tools/
    pandoc/
      pandoc.exe
      ...pandoc files
    wkhtmltopdf/
      wkhtmltopdf.exe
      ...wkhtmltopdf files
```

Notes:
- `mdconverter.py` is already updated to auto-detect these bundled paths.
- No PATH changes are required on target devices.

### 3) Configure each device once

- Copy `md2pdf-bundle` to the same location on each device.
- Edit the watch folder path in `mdconverter.py` before building if each device needs a different folder.

### 4) Auto-start at login (no manual run every time)

Use Task Scheduler one time per device:

```powershell
$exe = "C:\Path\To\md2pdf-bundle\md2pdf-watcher.exe"
schtasks /Create /TN "MD to PDF Watcher" /SC ONLOGON /TR "\"$exe\"" /RL LIMITED /F
```

To remove later:

```powershell
schtasks /Delete /TN "MD to PDF Watcher" /F
```

---

## Option B: One central converter service (best for many devices)

Use this when you want zero installation on user devices.

- Run the converter on one always-on machine/server.
- Devices upload `.md` files to a shared folder or a small web endpoint.
- Server returns/saves generated PDFs.

Benefits:
- Install dependencies only once.
- One place to update style/logic.
- Consistent output everywhere.

---

## Recommended choice

- 2 to 5 devices: Option A is simplest.
- 5+ devices or team usage: Option B is better long-term.

---

## Operational checklist

- Keep `style.css` in the same folder as the executable.
- Keep `tools/pandoc` and `tools/wkhtmltopdf` together with the executable.
- Test with one large markdown report before wide rollout.
- Version your bundle folders (`md2pdf-bundle-v1`, `v2`, etc.) so updates are controlled.
