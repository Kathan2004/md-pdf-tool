import os
import time
import subprocess
import shutil
import sys
from pathlib import Path

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler


# ============================================================
# CONFIGURATION
# ============================================================

WATCH_FOLDER = Path(r"C:\Users\kathansomani\Music")


def runtime_dir() -> Path:
    # Support both source execution and PyInstaller-style frozen builds.
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


RUNTIME_DIR = runtime_dir()

# Optional: CSS file for PDF styling
CSS_FILE = WATCH_FOLDER / "style.css"

PDF_ENGINES = ["wkhtmltopdf", "weasyprint", "xelatex", "pdflatex", "lualatex", "tectonic"]

PDF_ENGINE_PATH_HINTS = {
    "wkhtmltopdf": [
        RUNTIME_DIR / "tools" / "wkhtmltopdf" / "wkhtmltopdf.exe",
        RUNTIME_DIR / "wkhtmltopdf.exe",
        Path(r"C:\Program Files\wkhtmltopdf\bin\wkhtmltopdf.exe"),
        Path(r"C:\Program Files (x86)\wkhtmltopdf\bin\wkhtmltopdf.exe"),
    ],
    "weasyprint": [
        RUNTIME_DIR / "tools" / "weasyprint" / "weasyprint.exe",
        RUNTIME_DIR / "weasyprint.exe",
    ],
    "xelatex": [
        RUNTIME_DIR / "tools" / "miktex" / "miktex" / "bin" / "x64" / "xelatex.exe",
    ],
}


def find_pandoc_executable():
    # Check PATH first, then common per-user install locations.
    path_hit = shutil.which("pandoc")
    if path_hit:
        return path_hit

    local_appdata = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        RUNTIME_DIR,
        RUNTIME_DIR / "tools" / "pandoc",
        Path(local_appdata) / "Pandoc",
        Path(local_appdata) / "Programs" / "Pandoc",
    ]

    for base in candidates:
        if not base.exists():
            continue
        for exe in base.rglob("pandoc.exe"):
            return str(exe)

    return None


def find_pdf_engine():
    for engine in PDF_ENGINES:
        engine_path = shutil.which(engine)
        if engine_path:
            return engine, engine_path

        for hint in PDF_ENGINE_PATH_HINTS.get(engine, []):
            if hint.exists():
                return engine, str(hint)

    return None, None


# ============================================================
# MARKDOWN → PDF
# ============================================================

def convert_to_pdf(md_file: Path):
    pdf_file = md_file.with_suffix(".pdf")
    pandoc_exe = find_pandoc_executable()

    if not pandoc_exe:
        print("[!] Pandoc was not found.")
        print("[!] Install Pandoc and ensure it is available in PATH.")
        return

    pdf_engine_name, pdf_engine_path = find_pdf_engine()
    if not pdf_engine_path:
        print("[!] No supported PDF engine found (xelatex/pdflatex/lualatex/wkhtmltopdf/weasyprint).")
        print("[!] Install MiKTeX/TinyTeX (for xelatex/pdflatex) or wkhtmltopdf/weasyprint.")
        return

    print(f"[+] Detected: {md_file.name}")
    print("[*] Waiting for file copy to finish...")

    # Wait until the file size stops changing
    previous_size = -1

    while True:
        try:
            current_size = md_file.stat().st_size
        except FileNotFoundError:
            return

        if current_size == previous_size:
            break

        previous_size = current_size
        time.sleep(1)

    print(f"[*] Converting {md_file.name} → {pdf_file.name}")

    command = [
        pandoc_exe,
        str(md_file),
        "-o",
        str(pdf_file),
        "--standalone",
        "--from=gfm+pipe_tables+autolink_bare_uris",
        "--wrap=none",
        "--toc",
        "--toc-depth=2",
        "--number-sections",
        "--metadata=toc-title:Index",
        f"--pdf-engine={pdf_engine_path}",
    ]

    if pdf_engine_name in {"wkhtmltopdf", "weasyprint"}:
        if CSS_FILE.exists():
            command.extend(["--css", str(CSS_FILE)])
        if pdf_engine_name == "wkhtmltopdf":
            command.extend([
                "--pdf-engine-opt=--enable-local-file-access",
                "--pdf-engine-opt=--print-media-type",
                "--pdf-engine-opt=--page-size",
                "--pdf-engine-opt=A4",
                "--pdf-engine-opt=--margin-top",
                "--pdf-engine-opt=14mm",
                "--pdf-engine-opt=--margin-right",
                "--pdf-engine-opt=10mm",
                "--pdf-engine-opt=--margin-bottom",
                "--pdf-engine-opt=14mm",
                "--pdf-engine-opt=--margin-left",
                "--pdf-engine-opt=10mm",
            ])

    try:
        subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True
        )

        print(f"[✓] Created: {pdf_file}")

    except subprocess.CalledProcessError as e:
        print("[!] PDF conversion failed")
        print(e.stderr)

    except FileNotFoundError:
        print("[!] Pandoc was not found.")
        print("[!] Make sure Pandoc is installed and available in PATH.")


# ============================================================
# FILE WATCHER
# ============================================================

class MarkdownHandler(FileSystemEventHandler):

    def process_file(self, file_path):
        path = Path(file_path)

        if path.suffix.lower() != ".md":
            return

        # Ignore temporary/hidden files
        if path.name.startswith("~"):
            return

        convert_to_pdf(path)

    def on_created(self, event):
        if not event.is_directory:
            self.process_file(event.src_path)

    def on_moved(self, event):
        if not event.is_directory:
            self.process_file(event.dest_path)


# ============================================================
# MAIN
# ============================================================

def main():

    if not WATCH_FOLDER.exists():
        print(f"[!] Folder does not exist:")
        print(WATCH_FOLDER)
        return

    pandoc_exe = find_pandoc_executable()
    if not pandoc_exe:
        print("[!] Pandoc was not found.")
        print("[!] Install Pandoc and restart your terminal/editor so PATH is refreshed.")
        return

    pdf_engine_name, pdf_engine_path = find_pdf_engine()
    if not pdf_engine_path:
        print("[!] Pandoc is installed, but no PDF engine was found.")
        print("[!] Install MiKTeX/TinyTeX (xelatex/pdflatex) or wkhtmltopdf/weasyprint.")
        return

    print(f"[*] Using pandoc: {pandoc_exe}")
    print(f"[*] Using PDF engine: {pdf_engine_name} ({pdf_engine_path})")

    print("=" * 60)
    print(" Markdown → PDF Automatic Converter")
    print("=" * 60)

    print(f"Watching:")
    print(WATCH_FOLDER)

    print("\nDrop a .md file into this folder.")
    print("A PDF with the same filename will be generated automatically.")
    print("\nPress CTRL+C to stop.\n")

    event_handler = MarkdownHandler()

    observer = Observer()
    observer.schedule(
        event_handler,
        str(WATCH_FOLDER),
        recursive=False
    )

    observer.start()

    try:
        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        print("\n[*] Stopping watcher...")
        observer.stop()

    observer.join()


if __name__ == "__main__":
    main()