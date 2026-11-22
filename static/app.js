// EPUB Kit — Frontend (Python web app backend)

const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const fileList = document.getElementById('file-list');
const optionsPanel = document.getElementById('options-panel');
const progressSection = document.getElementById('progress-section');
const resultsSection = document.getElementById('results-section');
const processBtn = document.getElementById('process-btn');
const qualitySlider = document.getElementById('opt-quality');
const qualityValue = document.getElementById('quality-value');
const downloadAllBtn = document.getElementById('download-all-btn');
const filenameTemplateRow = document.getElementById('filename-template-row');
const filenameTemplate = document.getElementById('opt-filename-template');

// ==================== API ====================
// The Python pipeline runs on the server (app.py). Files are uploaded once
// (/api/inspect), then processed as background jobs polled via /api/progress.

async function apiInspect(file) {
    const form = new FormData();
    form.append('file', file, file.name);
    const resp = await fetch('/api/inspect', { method: 'POST', body: form });
    return resp.json();
}

async function apiProcess(taskId, filename, params) {
    const resp = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, filename, params }),
    });
    return resp.json();
}

async function apiProgress(jobId) {
    const resp = await fetch(`/api/progress/${jobId}`);
    return resp.json();
}

async function apiRemove(taskId) {
    await fetch('/api/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId }),
    });
}

async function apiUploadCover(taskId, file) {
    const form = new FormData();
    form.append('file', file, file.name);
    const resp = await fetch(`/api/cover/${taskId}`, { method: 'POST', body: form });
    return resp.json();
}

async function apiRemoveCover(taskId) {
    const resp = await fetch(`/api/cover/${taskId}/remove`, { method: 'POST' });
    return resp.json();
}

async function apiDownload(taskId) {
    const resp = await fetch(`/api/download/${taskId}`);
    if (!resp.ok) throw new Error('Download failed');
    const disposition = resp.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/);
    const filename = match ? match[1] : 'optimized.epub';
    return { blob: await resp.blob(), filename };
}

async function apiDownloadAll(taskIds) {
    const resp = await fetch('/api/download-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_ids: taskIds }),
    });
    if (!resp.ok) throw new Error('Download failed');
    return { blob: await resp.blob(), filename: 'optimized-epubs.zip' };
}

function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

let uploadedFiles = []; // {task_id, filename, metadata, file_size}
let selectedDevice = document.querySelector('.device-btn.active')?.dataset.device || 'x4';
let selectedFilenameFormat = 'author-title';

// ==================== Upload ====================

uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
});

async function handleFiles(files) {
    const epubFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.epub'));
    if (epubFiles.length === 0) return;

    // Show uploading state
    const uploadContent = uploadZone.querySelector('.upload-content');
    if (uploadContent) {
        uploadContent.innerHTML = `
            <div class="upload-spinner"></div>
            <p class="upload-label">Reading${epubFiles.length > 1 ? ` ${epubFiles.length} files` : ''}...</p>
            <p class="upload-hint">Checking the files on the server</p>
        `;
    }

    try {
        const results = [];
        for (const f of epubFiles) {
            results.push(await apiInspect(f));
        }

        results.forEach(file => {
            if (file.task_id && !file.error) {
                uploadedFiles.push(file);
            }
        });

        renderFileList(results);
        optionsPanel.hidden = uploadedFiles.length === 0;
    } catch (err) {
        uploadZone.innerHTML = `<div class="upload-content"><p class="upload-label" style="color:var(--error)">Could not read the file: ${escapeHtml(err.message)}</p></div>`;
    }

    // Reset upload zone
    setTimeout(() => {
        resetUploadZone();
    }, 400);
}

function resetUploadZone() {
    uploadZone.innerHTML = `
        <div class="upload-content">
            <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p class="upload-label">${uploadedFiles.length > 0 ? 'Drop more EPUB files' : 'Drop EPUB files here'}</p>
            <p class="upload-hint">or click to browse &bull; up to 100 MB each</p>
        </div>`;
}

function renderFileList(files) {
    fileList.hidden = false;

    files.forEach(file => {
        const card = document.createElement('div');
        card.className = `file-card ${file.error ? 'error' : ''}`;
        card.dataset.taskId = file.task_id || '';

        const meta = file.metadata || {};
        const coverHtml = meta.cover_data
            ? `<img src="data:image/jpeg;base64,${meta.cover_data}" alt="Cover">`
            : '<div class="no-cover">No cover</div>';

        const errorHtml = file.error
            ? `<div class="file-error">${escapeHtml(file.error)}</div>`
            : '';

        const editHtml = file.task_id && !file.error ? `
            <div class="file-edit">
                <input type="text" placeholder="Title" value="${escapeHtml(meta.title || '')}" data-field="title" data-task="${file.task_id}">
                <input type="text" placeholder="Author" value="${escapeHtml(meta.author || '')}" data-field="author" data-task="${file.task_id}">
            </div>` : '';

        const sizeStr = file.file_size ? formatBytes(file.file_size) : '';
        const metaLine = [meta.author, meta.series].filter(Boolean).join(' \u2014 ');

        card.innerHTML = `
            <div class="file-left">
                <div class="file-cover">${coverHtml}</div>
                ${file.task_id && !file.error ? `
                <div class="cover-actions">
                    <button type="button" class="cover-change-btn" data-task="${file.task_id}">
                        📷 Change
                    </button>
                    <button type="button" class="cover-revert-btn" data-task="${file.task_id}" hidden>
                        ↺ Original
                    </button>
                    <input type="file" accept="image/*" class="cover-input" data-task="${file.task_id}" hidden>
                </div>` : ''}
            </div>
            <div class="file-info">
                <div class="file-name">${escapeHtml(meta.title || file.filename)}</div>
                <div class="file-meta">${escapeHtml(metaLine)}${sizeStr ? (metaLine ? ' \u00b7 ' : '') + sizeStr : ''}</div>
                ${errorHtml}
                ${editHtml}
            </div>
            ${file.task_id ? '<button class="file-remove" onclick="removeFile(\'' + file.task_id + '\', this)" title="Remove">&times;</button>' : ''}
        `;

        fileList.appendChild(card);
    });
}

// ==================== Cover replacement ====================

fileList.addEventListener('click', (e) => {
    const changeBtn = e.target.closest('.cover-change-btn');
    if (changeBtn) {
        const input = fileList.querySelector(`.cover-input[data-task="${changeBtn.dataset.task}"]`);
        if (input) input.click();
        return;
    }
    const revertBtn = e.target.closest('.cover-revert-btn');
    if (revertBtn) {
        revertCover(revertBtn.dataset.task);
    }
});

fileList.addEventListener('change', (e) => {
    const input = e.target.closest('.cover-input');
    if (input && input.files && input.files[0]) {
        uploadCover(input.dataset.task, input.files[0]);
        input.value = '';
    }
});

async function uploadCover(taskId, file) {
    const card = fileList.querySelector(`.file-card[data-task-id="${taskId}"]`);
    const img = card ? card.querySelector('.cover-img') : null;
    const noCover = card ? card.querySelector('.no-cover') : null;
    const revertBtn = card ? card.querySelector('.cover-revert-btn') : null;

    // Local preview immediately
    const localUrl = URL.createObjectURL(file);
    if (img) {
        img.src = localUrl;
    } else if (noCover) {
        const newImg = document.createElement('img');
        newImg.className = 'cover-img';
        newImg.src = localUrl;
        noCover.replaceWith(newImg);
    }

    try {
        const result = await apiUploadCover(taskId, file);
        if (!result.ok && result.error) throw new Error(result.error);

        // Use the server-normalized preview
        if (result.preview) {
            const el = card.querySelector('.cover-img');
            if (el) el.src = `data:image/jpeg;base64,${result.preview}`;
        }
        const entry = uploadedFiles.find(f => f.task_id === taskId);
        if (entry) entry.custom_cover = true;
        if (revertBtn) revertBtn.hidden = false;
    } catch (err) {
        alert(`Could not set cover: ${err.message}`);
        // Restore original cover preview
        const entry = uploadedFiles.find(f => f.task_id === taskId);
        const el = card ? card.querySelector('.cover-img') : null;
        if (el && entry && entry.metadata && entry.metadata.cover_data) {
            el.src = `data:image/jpeg;base64,${entry.metadata.cover_data}`;
        }
        if (revertBtn) revertBtn.hidden = true;
    } finally {
        setTimeout(() => URL.revokeObjectURL(localUrl), 10000);
    }
}

async function revertCover(taskId) {
    try {
        await apiRemoveCover(taskId);
    } catch (err) { /* ignore */ }
    const card = fileList.querySelector(`.file-card[data-task-id="${taskId}"]`);
    const entry = uploadedFiles.find(f => f.task_id === taskId);
    if (card && entry) {
        const coverDiv = card.querySelector('.file-cover');
        const meta = entry.metadata || {};
        coverDiv.innerHTML = meta.cover_data
            ? `<img class="cover-img" src="data:image/jpeg;base64,${meta.cover_data}" alt="Cover">`
            : '<div class="no-cover">No cover</div>';
        const revertBtn = card.querySelector('.cover-revert-btn');
        if (revertBtn) revertBtn.hidden = true;
        entry.custom_cover = false;
    }
}

function removeFile(taskId, btn) {
    apiRemove(taskId);
    uploadedFiles = uploadedFiles.filter(f => f.task_id !== taskId);
    const card = btn.closest('.file-card');
    card.style.opacity = '0';
    card.style.transform = 'translateX(20px)';
    card.style.transition = 'all 0.2s ease';
    setTimeout(() => {
        card.remove();
        if (uploadedFiles.length === 0) {
            optionsPanel.hidden = true;
            fileList.hidden = true;
        }
    }, 200);
}

// ==================== Options ====================

document.querySelectorAll('.filename-format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filename-format-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedFilenameFormat = btn.dataset.filenameFormat;
        filenameTemplateRow.hidden = selectedFilenameFormat !== 'custom';
        if (selectedFilenameFormat === 'custom') filenameTemplate.focus();
    });
});

// Device toggle
document.querySelectorAll('.device-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.device-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedDevice = btn.dataset.device;
    });
});

// Preset profiles
document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const preset = btn.dataset.preset;
        if (preset === 'quick') {
            setOptions({ grayscale: true, contrast: true, fonts: false, css: false, cover: false, metadata: false, textcleanup: true, lightnovel: false, quality: 70 });
        } else if (preset === 'full') {
            setOptions({ grayscale: true, contrast: true, fonts: true, css: true, cover: true, metadata: true, textcleanup: true, lightnovel: false, quality: 70 });
        }
        // 'custom' doesn't change anything - user picks
    });
});

function setOptions(opts) {
    document.getElementById('opt-grayscale').checked = opts.grayscale;
    document.getElementById('opt-contrast').checked = opts.contrast;
    document.getElementById('opt-fonts').checked = opts.fonts;
    document.getElementById('opt-css').checked = opts.css;
    document.getElementById('opt-cover').checked = opts.cover;
    document.getElementById('opt-metadata').checked = opts.metadata;
    document.getElementById('opt-textcleanup').checked = opts.textcleanup;
    document.getElementById('opt-lightnovel').checked = opts.lightnovel;
    setQuality(opts.quality);
}

// Quality slider
qualitySlider.addEventListener('input', () => {
    qualityValue.textContent = qualitySlider.value + '%';
    document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
    const matching = document.querySelector(`.quality-btn[data-quality="${qualitySlider.value}"]`);
    if (matching) matching.classList.add('active');
});

document.querySelectorAll('.quality-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        setQuality(parseInt(btn.dataset.quality));
    });
});

function setQuality(val) {
    qualitySlider.value = val;
    qualityValue.textContent = val + '%';
    document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
    const matching = document.querySelector(`.quality-btn[data-quality="${val}"]`);
    if (matching) matching.classList.add('active');
}

// When any option changes, switch to Custom preset
document.querySelectorAll('.option input, #opt-quality').forEach(input => {
    input.addEventListener('change', () => {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.preset-btn[data-preset="custom"]').classList.add('active');
    });
});

// ==================== Processing ====================

processBtn.addEventListener('click', startProcessing);

async function startProcessing() {
    const validFiles = uploadedFiles.filter(f => f.task_id && !f.error);
    if (validFiles.length === 0) return;
    if (!validateFilenameTemplate()) return;

    processBtn.disabled = true;
    processBtn.innerHTML = `
        <svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
        Processing...`;
    progressSection.hidden = false;
    resultsSection.hidden = true;

    const options = getOptions();
    const completedIds = [];

    // Create progress items
    const progressItems = document.getElementById('progress-items');
    progressItems.innerHTML = '';

    for (const file of validFiles) {
        const item = document.createElement('div');
        item.className = 'progress-item';
        item.id = `progress-${file.task_id}`;
        item.innerHTML = `
            <div class="filename">${escapeHtml(file.filename)}</div>
            <div class="progress-bar-container">
                <div class="progress-bar" id="bar-${file.task_id}"></div>
            </div>
            <div class="progress-message" id="msg-${file.task_id}">Waiting...</div>
        `;
        progressItems.appendChild(item);
    }

    // Process files sequentially
    for (const file of validFiles) {
        const titleInput = document.querySelector(`input[data-task="${file.task_id}"][data-field="title"]`);
        const authorInput = document.querySelector(`input[data-task="${file.task_id}"][data-field="author"]`);
        const editTitle = titleInput ? titleInput.value : '';
        const editAuthor = authorInput ? authorInput.value : '';

        try {
            const report = await processFile(file.task_id, file.filename, options, editTitle, editAuthor);
            completedIds.push({ task_id: file.task_id, report });
        } catch (err) {
            completedIds.push({ task_id: file.task_id, report: { success: false, error: err.message } });
        }
    }

    showResults(completedIds);

    processBtn.disabled = false;
    processBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <polyline points="16 16 12 12 8 16"/>
            <line x1="12" y1="12" x2="12" y2="21"/>
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
        </svg>
        Optimize EPUBs`;
}

function validateFilenameTemplate() {
    filenameTemplate.setCustomValidity('');
    if (selectedFilenameFormat !== 'custom') return true;

    if (!filenameTemplate.value.trim()) {
        filenameTemplate.setCustomValidity('Enter a custom filename template.');
    } else {
        const remainder = filenameTemplate.value
            .replace(/\{\{|\}\}/g, '')
            .replace(/\{(?:title|author|year|series|series_index|language|original)\}/g, '');
        if (/[{}]/.test(remainder)) {
            filenameTemplate.setCustomValidity(
                'Use only the placeholders listed below the template.'
            );
        }
    }

    if (!filenameTemplate.checkValidity()) {
        filenameTemplate.reportValidity();
        filenameTemplate.focus();
        return false;
    }
    return true;
}

function getOptions() {
    return {
        device: selectedDevice,
        grayscale: document.getElementById('opt-grayscale').checked,
        contrast: document.getElementById('opt-contrast').checked,
        quality: parseInt(qualitySlider.value),
        remove_fonts: document.getElementById('opt-fonts').checked,
        remove_css: document.getElementById('opt-css').checked,
        light_novel: document.getElementById('opt-lightnovel').checked,
        generate_cover: document.getElementById('opt-cover').checked,
        clean_metadata: document.getElementById('opt-metadata').checked,
        text_cleanup: document.getElementById('opt-textcleanup').checked,
        filename_format: selectedFilenameFormat,
        filename_template: filenameTemplate.value,
    };
}

async function processFile(taskId, filename, options, editTitle, editAuthor) {
    const bar = document.getElementById(`bar-${taskId}`);
    const msg = document.getElementById(`msg-${taskId}`);
    const params = { ...options, edit_title: editTitle, edit_author: editAuthor };

    const { job_id, error } = await apiProcess(taskId, filename, params);
    if (error) throw new Error(error);

    // Poll the server for live progress
    for (;;) {
        await new Promise(r => setTimeout(r, 400));
        const state = await apiProgress(job_id);
        if (bar) bar.style.width = `${state.percent}%`;
        if (msg) msg.textContent = state.message;
        if (state.done) {
            if (bar) {
                bar.style.width = '100%';
                bar.classList.add(state.result?.success ? 'complete' : 'error');
            }
            if (msg) msg.textContent = state.result?.success ? 'Complete' : `Error: ${state.result?.error}`;
            if (state.result?.success) return state.result;
            throw new Error(state.result?.error || 'Processing failed');
        }
    }
}

// ==================== Results ====================

function showResults(completed) {
    resultsSection.hidden = false;
    const resultsItems = document.getElementById('results-items');
    resultsItems.innerHTML = '';

    const successIds = [];

    completed.forEach(({ task_id, report }) => {
        const card = document.createElement('div');
        card.className = `result-card ${report.success ? 'success' : 'error'}`;

        if (report.success) {
            successIds.push(task_id);
            const reduction = report.original_size > 0
                ? ((1 - report.optimized_size / report.original_size) * 100).toFixed(1)
                : 0;

            card.innerHTML = `
                <div class="result-header">
                    <span class="filename">${escapeHtml(report.output_filename || 'optimized.epub')}</span>
                </div>
                <div class="result-size">
                    <span class="size-original">${formatBytes(report.original_size)}</span>
                    <span class="size-arrow">&rarr;</span>
                    <span class="size-new">${formatBytes(report.optimized_size)}</span>
                    <span class="size-reduction">${reduction >= 0 ? '&minus;' + reduction : '+' + Math.abs(reduction).toFixed(1)}%</span>
                </div>
                <div class="result-summary">${escapeHtml(report.summary)}</div>
                <a href="#" class="download-btn" data-task="${task_id}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download
                </a>
            `;
        } else {
            card.innerHTML = `
                <div class="result-header">
                    <span class="filename">Error</span>
                </div>
                <div class="file-error">${escapeHtml(report.error)}</div>
            `;
        }

        const link = card.querySelector('.download-btn');
        if (link) {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    const { blob, filename } = await apiDownload(task_id);
                    saveBlob(blob, filename);
                } catch (err) {
                    alert(err.message);
                }
            });
        }

        resultsItems.appendChild(card);
    });

    // Show Download All button for batch
    if (successIds.length > 1) {
        downloadAllBtn.hidden = false;
        downloadAllBtn.onclick = async () => {
            try {
                const { blob, filename } = await apiDownloadAll(successIds);
                saveBlob(blob, filename);
            } catch (err) {
                alert(err.message);
            }
        };
    } else {
        downloadAllBtn.hidden = true;
    }

    // Scroll results into view
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ==================== Utilities ====================

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Spinning animation for processing button
const style = document.createElement('style');
style.textContent = `
    @keyframes spin { to { transform: rotate(360deg); } }
    .spin { animation: spin 1s linear infinite; }
    .upload-spinner {
        width: 28px; height: 28px;
        border: 3px solid var(--border);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin: 0 auto 12px;
    }
`;
document.head.appendChild(style);
