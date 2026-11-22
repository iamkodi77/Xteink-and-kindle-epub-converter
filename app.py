"""
Xteink & Kindle EPUB Converter — Python web app.

Recreates http://epubkit.ink as a server-side Python web app:
upload EPUBs, pick a device (Xteink X4 / X4 Pro / X3, Kindle 10th gen),
choose the same tools/presets as the original site, optimize, download.

Run it with ./run.sh (Linux/macOS) or run.bat (Windows), then open
http://localhost:5000
"""

import base64
import io
import os
import shutil
import threading
import time
import uuid
import zipfile
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file, abort
from PIL import Image

MAX_COVER_SIZE = 20 * 1024 * 1024  # 20 MB for a replacement cover photo

from epub_processor import process_epub, extract_epub_metadata, ProcessingOptions
from image_processor import DEVICE_PROFILES, DEFAULT_DEVICE
from metadata_handler import FILENAME_FORMATS, format_filename

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / 'uploads'
OUTPUT_DIR = BASE_DIR / 'outputs'
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB, same as epubkit.ink

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE + 1024 * 1024

# task_id -> uploaded file info (kept until /api/remove or server restart)
TASKS = {}
# job_id -> live processing progress / result
JOBS = {}
_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_task_dir(task_id: str) -> Path:
    """Return the task directory, refusing path traversal."""
    if not task_id or not all(c in '0123456789abcdef' for c in task_id):
        abort(400, 'Invalid task id')
    return UPLOAD_DIR / task_id


def _validate_options(params: dict) -> str:
    """Return an error message for bad options, or an empty string."""
    device = params.get('device', DEFAULT_DEVICE)
    filename_format = params.get('filename_format', 'author-title')
    filename_template = params.get('filename_template', '')

    if device not in DEVICE_PROFILES:
        allowed = ', '.join(f"'{d}'" for d in DEVICE_PROFILES)
        return f'Unknown device (expected {allowed})'
    if filename_format not in FILENAME_FORMATS:
        return 'Unknown filename format'
    if filename_format == 'custom' and not filename_template.strip():
        return 'Custom filename template cannot be empty'
    if len(filename_template) > 200:
        return 'Filename template is too long'
    if filename_format == 'custom':
        try:
            format_filename(
                'title', 'author',
                filename_format='custom',
                template=filename_template,
                original_filename='original.epub',
                year='2026',
            )
        except ValueError as error:
            return str(error)
    return ''


def _build_options(filename: str, params: dict) -> ProcessingOptions:
    options = ProcessingOptions(
        device=params.get('device', DEFAULT_DEVICE),
        grayscale=bool(params.get('grayscale', True)),
        contrast_boost=bool(params.get('contrast', True)),
        quality=int(params.get('quality', 70)),
        remove_fonts=bool(params.get('remove_fonts', True)),
        remove_unused_css=bool(params.get('remove_css', True)),
        light_novel_mode=bool(params.get('light_novel', False)),
        generate_missing_cover=bool(params.get('generate_cover', True)),
        clean_metadata=bool(params.get('clean_metadata', True)),
        text_cleanup=bool(params.get('text_cleanup', True)),
        filename_format=params.get('filename_format', 'author-title'),
        filename_template=params.get('filename_template', ''),
        original_filename=filename,
    )
    edit_title = params.get('edit_title', '')
    edit_author = params.get('edit_author', '')
    if edit_title or edit_author:
        options.metadata_edits = {}
        if edit_title:
            options.metadata_edits['title'] = edit_title
        if edit_author:
            options.metadata_edits['author'] = edit_author
    return options


def _run_job(job_id: str, task_id: str, filename: str, params: dict):
    task_dir = _safe_task_dir(task_id)
    input_path = str(task_dir / 'input.epub')
    output_path = str(OUTPUT_DIR / f'{task_id}.epub')

    def progress(pct, msg):
        with _LOCK:
            JOBS[job_id]['percent'] = pct
            JOBS[job_id]['message'] = msg

    try:
        options = _build_options(filename, params)
        with _LOCK:
            cover_path = TASKS.get(task_id, {}).get('cover_path', '')
        options.cover_image_path = cover_path
        report = process_epub(input_path, output_path, options, progress)
        with _LOCK:
            JOBS[job_id].update({
                'done': True,
                'result': {
                    'success': report.success,
                    'error': report.error,
                    'original_size': report.original_size,
                    'optimized_size': report.optimized_size,
                    'output_filename': report.output_filename,
                    'summary': report.summary(),
                    'images_converted': report.images_converted,
                    'images_total': report.images_total,
                    'fonts_removed': report.fonts_removed,
                    'css_rules_removed': report.css_rules_removed,
                    'svg_covers_fixed': report.svg_covers_fixed,
                    'toc_status': report.toc_status,
                    'metadata_items_stripped': report.metadata_items_stripped,
                    'cover_generated': report.cover_generated,
                    'cover_replaced': report.cover_replaced,
                    'attrs_stripped': report.attrs_stripped,
                    'text_fixes_total': report.text_fixes_total,
                    'text_cleanup_summary': report.text_cleanup_summary,
                },
            })
            if report.success:
                TASKS[task_id]['output_path'] = output_path
                # format_filename() already appends the .epub extension
                TASKS[task_id]['output_filename'] = report.output_filename or 'optimized.epub'
    except Exception as e:
        with _LOCK:
            JOBS[job_id].update({'done': True, 'result': {'success': False, 'error': str(e)}})


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    devices = [
        {
            'id': key,
            'label': p['label'],
            'desc': f"{p['width']}&times;{p['height']} &bull; {p['inch']}",
            'active': key == DEFAULT_DEVICE,
        }
        for key, p in DEVICE_PROFILES.items()
    ]
    return render_template('index.html', devices=devices)


@app.route('/api/devices')
def devices():
    return jsonify([
        {'id': k, 'label': p['label'], 'width': p['width'], 'height': p['height'],
         'inch': p['inch'], 'gray_levels': len(p['gray_levels'])}
        for k, p in DEVICE_PROFILES.items()
    ])


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@app.route('/api/inspect', methods=['POST'])
def inspect():
    """Receive one EPUB, store it under a task id, return metadata preview."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    f = request.files['file']
    filename = f.filename or 'book.epub'

    if not filename.lower().endswith('.epub'):
        return jsonify({'filename': filename, 'error': 'Not an EPUB file'})
    if filename.lower().endswith('.kepub.epub'):
        return jsonify({'filename': filename, 'error': 'Kobo EPUB files (.kepub.epub) are not supported'})

    task_id = uuid.uuid4().hex
    task_dir = _safe_task_dir(task_id)
    task_dir.mkdir(parents=True, exist_ok=True)
    input_path = task_dir / 'input.epub'
    f.save(str(input_path))

    file_size = os.path.getsize(input_path)
    if file_size > MAX_FILE_SIZE:
        shutil.rmtree(task_dir, ignore_errors=True)
        return jsonify({'filename': filename, 'file_size': file_size,
                        'error': f'File too large (max {MAX_FILE_SIZE // (1024 * 1024)}MB)'})

    if not zipfile.is_zipfile(input_path):
        shutil.rmtree(task_dir, ignore_errors=True)
        return jsonify({'filename': filename, 'file_size': file_size,
                        'error': 'Not a valid EPUB file (not a ZIP archive)'})

    try:
        metadata = extract_epub_metadata(str(input_path))
    except Exception as e:
        metadata = {'title': '', 'author': '', 'error': str(e)}

    with _LOCK:
        TASKS[task_id] = {
            'filename': filename,
            'file_size': file_size,
            'input_path': str(input_path),
            'output_path': None,
            'output_filename': None,
            'created': time.time(),
        }

    return jsonify({
        'task_id': task_id,
        'filename': filename,
        'file_size': file_size,
        'metadata': metadata,
        'error': metadata.get('error'),
    })


@app.route('/api/process', methods=['POST'])
def process():
    """Start optimizing one uploaded EPUB in a background thread."""
    data = request.get_json(force=True)
    task_id = data.get('task_id', '')
    filename = data.get('filename', 'book.epub')
    params = data.get('params', {})

    with _LOCK:
        task = TASKS.get(task_id)
    if not task:
        return jsonify({'error': 'Unknown task. Upload the file again.'}), 404

    error = _validate_options(params)
    if error:
        return jsonify({'error': error}), 400

    job_id = uuid.uuid4().hex
    with _LOCK:
        JOBS[job_id] = {'percent': 0, 'message': 'Starting...', 'done': False, 'result': None}

    thread = threading.Thread(
        target=_run_job, args=(job_id, task_id, filename, params), daemon=True)
    thread.start()
    return jsonify({'job_id': job_id})


@app.route('/api/progress/<job_id>')
def progress(job_id):
    with _LOCK:
        job = JOBS.get(job_id)
    if not job:
        return jsonify({'error': 'Unknown job'}), 404
    with _LOCK:
        return jsonify({
            'percent': job['percent'],
            'message': job['message'],
            'done': job['done'],
            'result': job['result'],
        })


@app.route('/api/download/<task_id>')
def download(task_id):
    with _LOCK:
        task = TASKS.get(task_id)
    if not task or not task.get('output_path'):
        abort(404, 'No optimized file for this task')
    return send_file(
        task['output_path'],
        as_attachment=True,
        download_name=task.get('output_filename') or 'optimized.epub',
        mimetype='application/epub+zip',
    )


@app.route('/api/download-all', methods=['POST'])
def download_all():
    data = request.get_json(force=True)
    task_ids = data.get('task_ids', [])

    buffer = io.BytesIO()
    count = 0
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for task_id in task_ids:
            with _LOCK:
                task = TASKS.get(task_id)
            if task and task.get('output_path') and os.path.exists(task['output_path']):
                zf.write(task['output_path'], task.get('output_filename') or f'{task_id}.epub')
                count += 1
    if count == 0:
        abort(404, 'No optimized files available')
    buffer.seek(0)
    return send_file(
        buffer,
        as_attachment=True,
        download_name='optimized-epubs.zip',
        mimetype='application/zip',
    )


@app.route('/api/cover/<task_id>', methods=['POST'])
def upload_cover(task_id):
    """Upload a replacement cover photo for one EPUB. Stored per task and
    applied during processing (step 10b of the pipeline)."""
    with _LOCK:
        task = TASKS.get(task_id)
    if not task:
        return jsonify({'error': 'Unknown task. Upload the file again.'}), 404
    if 'file' not in request.files:
        return jsonify({'error': 'No image uploaded'}), 400

    f = request.files['file']
    filename = f.filename or 'cover.jpg'
    ext = Path(filename).suffix.lower()
    if ext not in {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff'}:
        return jsonify({'error': 'Unsupported image type (use JPG, PNG, WebP, BMP, GIF or TIFF)'}), 400

    data = f.read()
    if len(data) > MAX_COVER_SIZE:
        return jsonify({'error': f'Cover image too large (max {MAX_COVER_SIZE // (1024 * 1024)}MB)'}), 400

    # Validate it is a real image
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
    except Exception:
        return jsonify({'error': 'Not a valid image file'}), 400

    task_dir = _safe_task_dir(task_id)
    cover_path = task_dir / f'cover_upload{ext}'
    with open(cover_path, 'wb') as out:
        out.write(data)

    # Replace any previous custom cover
    for old in task_dir.glob('cover_upload.*'):
        if old != cover_path:
            old.unlink()

    with _LOCK:
        TASKS[task_id]['cover_path'] = str(cover_path)

    # Small base64 preview for the UI
    preview_img = Image.open(io.BytesIO(data))
    preview_img.thumbnail((200, 300))
    buf = io.BytesIO()
    preview_img.convert('RGB').save(buf, format='JPEG', quality=70)
    preview = base64.b64encode(buf.getvalue()).decode('ascii')

    return jsonify({'ok': True, 'preview': preview, 'filename': filename})


@app.route('/api/cover/<task_id>/remove', methods=['POST'])
def remove_cover(task_id):
    """Remove a previously uploaded replacement cover (keep the book's own)."""
    with _LOCK:
        task = TASKS.get(task_id)
    if not task:
        return jsonify({'error': 'Unknown task'}), 404
    task_dir = _safe_task_dir(task_id)
    for old in task_dir.glob('cover_upload.*'):
        old.unlink()
    with _LOCK:
        TASKS[task_id]['cover_path'] = ''
    return jsonify({'ok': True})


@app.route('/api/remove', methods=['POST'])
def remove():
    data = request.get_json(force=True)
    task_id = data.get('task_id', '')
    with _LOCK:
        TASKS.pop(task_id, None)
    shutil.rmtree(_safe_task_dir(task_id), ignore_errors=True)
    out = OUTPUT_DIR / f'{task_id}.epub'
    if out.exists():
        out.unlink()
    return jsonify({'ok': True})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    host = os.environ.get('HOST', '0.0.0.0')
    print(f'Xteink & Kindle EPUB Converter running at http://localhost:{port}')
    app.run(host=host, port=port, debug=False)
