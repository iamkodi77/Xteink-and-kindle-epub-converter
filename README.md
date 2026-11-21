# Xteink & Kindle EPUB Converter

**Optimize any epub for Xteink and kindle e-ink readers.**

A Python web app that recreates [epubkit.ink](http://epubkit.ink) as a
server-side app you can run locally with one command. Drop in any EPUB and
get back a clean, optimized file tuned for your e-ink device. A 20-step
pipeline handles everything automatically.

## Devices

| Device | Screen | Size | Grayscale |
|--------|--------|------|-----------|
| Xteink X4 | 480×800 | 4.3″ | 4-level (SSD1677) |
| Xteink X4 Pro | 480×800 | 4.3″ | 4-level (SSD1677) |
| Xteink X3 | 528×792 | 3.7″ | 4-level (SSD1677) |
| Kindle 10th gen | 600×800 | 6.0″ | 16-level |

## Run it

**Linux / macOS:**

```sh
./run.sh
```

**Windows:**

```bat
run.bat
```

Both scripts create a `.venv` virtual environment, install the dependencies
from `requirements.txt`, and start the web app. Then open:

👉 **http://localhost:5000** (override with `PORT=8080 ./run.sh`)

To run manually instead:

```sh
python3 -m venv .venv
source .venv/bin/activate        # .venv\Scripts\activate.bat on Windows
pip install -r requirements.txt
python app.py
```

## Usage

1. **Drop** one or more EPUB files onto the upload zone (up to 100 MB each)
2. **Edit** title/author if needed (auto-detected from metadata)
3. **Pick your device**: Xteink X4, X4 Pro, X3, or Kindle 10th gen
4. **Pick a preset**: Quick (images + text), Full (device-optimized), or Custom
5. **Choose an output filename**: original, title/author presets, title only, or a custom template
6. **Click Optimize** and watch the progress
7. **Download** the optimized EPUB — ready to transfer to your reader

Custom filename templates support `{title}`, `{author}`, `{year}`, `{series}`,
`{series_index}`, `{language}`, and `{original}` placeholders.

## Tools (same as epubkit.ink)

- **Images** — 4-level (Xteink) / 16-level (Kindle) grayscale with Floyd–Steinberg
  dithering, resized to the device screen, baseline JPEG, autocontrast + contrast boost
- **Text** — fixes spacing, OCR errors, smart quotes, mojibake encoding
- **Cleanup** — strips embedded fonts, unused CSS, store metadata, OS artifacts
- **Structure** — repairs HTML, validates TOC, generates covers, fixes references
- **Light Novel Mode** — rotates & splits landscape images for vertical reading
- **JPEG quality** slider + presets, output filename presets/templates

## Processing presets

| Preset | Images | Text | Fonts | CSS | Cover | Metadata | Best for |
|--------|--------|------|-------|-----|-------|----------|----------|
| Quick  | Yes    | Yes  | No    | No  | No    | No       | Fast image + text pass |
| Full   | Yes    | Yes  | Yes   | Yes | Yes   | Yes      | Complete device optimization |
| Custom | Pick   | Pick | Pick  | Pick| Pick  | Pick     | Fine-grained control |

## Tech stack

- **[Flask](https://flask.palletsprojects.com/)** — Python web server (`app.py`)
- **[Pillow](https://python-pillow.org/)** — image processing (quantization, autocontrast)
- **[lxml](https://lxml.de/)** — XML/HTML parsing and repair
- **[cssutils](https://cssutils.readthedocs.io/)** — CSS parsing and cleanup

The processing pipeline modules (`epub_processor.py`, `image_processor.py`,
`epub_structure.py`, `html_cleaner.py`, `text_cleaner.py`, `metadata_handler.py`,
`epub_packager.py`) are adapted from the open-source
[epubkit](https://github.com/b1rdmania/epubkit) project (MIT license).

## Project layout

```
app.py                  Flask web app (upload, inspect, process, download)
templates/index.html    Web UI
static/app.js           Frontend logic
static/style.css        Styles
epub_processor.py       20-step pipeline orchestrator
image_processor.py      Device profiles + image optimization
metadata_handler.py     Metadata read/edit/strip + filename formatting
epub_structure.py       OPF/manifest/TOC/reference handling
html_cleaner.py         HTML repair, CSS cleanup, fonts, whitespace
text_cleaner.py         Text cleanup (spacing, OCR, quotes, mojibake)
epub_packager.py        EPUB zip extract/package, DRM check
run.sh / run.bat        One-command launchers
```
