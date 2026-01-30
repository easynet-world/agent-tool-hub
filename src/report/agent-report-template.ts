/**
 * Built-in HTML template for agent run reports (Bootstrap 5).
 * Kept at framework level so no external template path is required.
 */
export const AGENT_REPORT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Run Report</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css" rel="stylesheet">
  <style>
    :root {
      --report-bg: #f0f4f8;
      --report-surface: #ffffff;
      --report-border: #e2e6ea;
      --report-border-light: #eef0f2;
      --report-text: #2c3e50;
      --report-text-muted: #5c6b7a;
      --report-accent: #2563eb;
      --report-accent-hover: #1d4ed8;
      --report-accent-bg: #eff6ff;
      --report-secondary: #059669;
      --report-secondary-bg: #ecfdf5;
      --report-code-bg: #f1f5f9;
      --report-prompt-bg: #f8fafc;
      --report-heading: #1e40af;
      --report-heading-alt: #047857;
      --report-tint: #e0e7ff;
      --report-table-head: #dbeafe;
      --report-table-head-text: #1e3a8a;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--report-bg);
      color: var(--report-text);
      font-size: 15px;
      line-height: 1.55;
    }
    .report-header {
      background: linear-gradient(135deg, #ffffff 0%, #f0f9ff 100%);
      border-bottom: 3px solid var(--report-accent);
      box-shadow: 0 1px 3px rgba(37, 99, 235, 0.08);
    }
    .report-title {
      font-weight: 600;
      color: var(--report-accent);
      font-size: 1.1rem;
      letter-spacing: -0.01em;
    }
    .report-header .form-label {
      color: var(--report-secondary);
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .prompt-block {
      background: var(--report-prompt-bg);
      border: 1px solid var(--report-tint);
      border-left: 4px solid var(--report-accent);
      border-radius: 6px;
      font-size: 0.9rem;
      word-break: break-word;
      color: var(--report-text);
    }
    .prompt-block.markdown-body { white-space: normal; padding: 1rem 1.25rem; }
    .nav-tabs {
      border-bottom: 2px solid var(--report-border);
    }
    .nav-tabs .nav-link {
      color: var(--report-text-muted);
      font-weight: 500;
      border: none;
      padding: 0.5rem 1rem 0.6rem;
      margin-bottom: -2px;
    }
    .nav-tabs .nav-link:hover { color: var(--report-accent); }
    .nav-tabs .nav-link.active {
      color: var(--report-accent);
      border-bottom: 2px solid var(--report-accent);
      background: var(--report-accent-bg);
    }
    .card {
      background: var(--report-surface);
      border: 1px solid var(--report-border-light);
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .card-header {
      background: var(--report-surface);
      border-bottom: 1px solid var(--report-tint);
      color: var(--report-heading);
      font-weight: 600;
    }
    .step-tree { list-style: none; padding-left: 0; }
    .step-tree .step-item {
      padding: 0.5rem 0.75rem;
      border-radius: 4px;
      cursor: pointer;
      border-left: 3px solid transparent;
      color: var(--report-text);
    }
    .step-tree .step-item:hover { background: var(--report-accent-bg); }
    .step-tree .step-item.active {
      background: var(--report-accent-bg);
      border-left-color: var(--report-accent);
    }
    .step-tree .step-item .step-node { font-weight: 500; }
    .step-tree .step-item .step-meta { font-size: 0.8rem; color: var(--report-text-muted); }
    .detail-panel {
      background: var(--report-surface);
      border-radius: 6px;
      border: 1px solid var(--report-border-light);
      min-height: 200px;
    }
    .detail-section { margin-bottom: 1rem; }
    .detail-section h6 {
      color: var(--report-secondary);
      font-weight: 600;
      margin-bottom: 0.5rem;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .detail-pre {
      background: var(--report-code-bg);
      border: 1px solid var(--report-tint);
      padding: 1rem 1.25rem;
      border-radius: 4px;
      font-size: 0.8rem;
      overflow-x: auto;
      max-height: 400px;
      overflow-y: auto;
      color: var(--report-text);
    }
    .markdown-body {
      padding: 1.5rem 1.75rem;
      color: var(--report-text);
      font-size: 1rem;
      line-height: 1.6;
    }
    .markdown-body h1 {
      font-size: 1.375rem;
      font-weight: 600;
      color: var(--report-heading);
      margin: 0 0 0.25rem 0;
      line-height: 1.3;
    }
    .markdown-body h1 + p {
      font-size: 0.9375rem;
      color: var(--report-text-muted);
      margin-top: 0;
      margin-bottom: 1.25rem;
    }
    .markdown-body h2 {
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--report-heading);
      margin: 1.5rem 0 0.5rem 0;
      padding-bottom: 0.25rem;
      border-bottom: 2px solid var(--report-tint);
    }
    .markdown-body h3 {
      font-size: 1.0625rem;
      font-weight: 600;
      color: var(--report-heading-alt);
      margin: 1.25rem 0 0.4rem 0;
    }
    .markdown-body h4 { font-size: 1rem; font-weight: 600; margin: 1rem 0 0.35rem 0; color: var(--report-heading-alt); }
    .markdown-body p {
      margin: 0 0 0.75rem 0;
      font-size: 1rem;
    }
    .markdown-body ul, .markdown-body ol { margin: 0 0 0.75rem 0; padding-left: 1.5rem; }
    .markdown-body li { margin-bottom: 0.25rem; }
    .markdown-body table {
      font-size: 0.9375rem;
      margin: 0.75rem 0;
      border-collapse: collapse;
      width: 100%;
    }
    .markdown-body th, .markdown-body td {
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--report-tint);
      text-align: left;
    }
    .markdown-body th {
      font-weight: 600;
      background: var(--report-table-head);
      color: var(--report-table-head-text);
      border-color: var(--report-accent);
    }
    .markdown-body tbody tr:nth-child(even) { background: var(--report-secondary-bg); }
    .markdown-body pre, .markdown-body code {
      background: var(--report-code-bg);
      border: 1px solid var(--report-tint);
      border-radius: 4px;
      color: var(--report-text);
      font-size: 0.875rem;
    }
    .markdown-body pre { padding: 1rem 1.25rem; overflow-x: auto; }
    .empty-state { color: var(--report-text-muted); text-align: center; padding: 2rem; }
  </style>
</head>
<body>
  <div class="report-header py-3 px-4">
    <h5 class="report-title mb-3">Agent Run Report</h5>
    <div class="row g-3">
      <div class="col-12">
        <label class="form-label small text-muted text-uppercase">System Prompt</label>
        <div class="prompt-block markdown-body" id="system-prompt"></div>
      </div>
      <div class="col-12">
        <label class="form-label small text-muted text-uppercase">User Prompt</label>
        <div class="prompt-block markdown-body" id="user-prompt"></div>
      </div>
    </div>
  </div>

  <div class="container-fluid py-3">
    <ul class="nav nav-tabs mb-3" role="tablist">
      <li class="nav-item">
        <a class="nav-link active" data-bs-toggle="tab" href="#tab-report">Report</a>
      </li>
      <li class="nav-item">
        <a class="nav-link" data-bs-toggle="tab" href="#tab-debug">Debug</a>
      </li>
    </ul>

    <div class="tab-content">
      <div class="tab-pane fade show active" id="tab-report">
        <div class="card border-0 shadow-sm">
          <div class="card-body markdown-body" id="report-markdown"></div>
        </div>
      </div>
      <div class="tab-pane fade" id="tab-debug">
        <div class="row g-3">
          <div class="col-md-4">
            <div class="card border-0 shadow-sm h-100">
              <div class="card-header bg-white border-bottom py-2">
                <span class="fw-semibold">Steps</span>
              </div>
              <div class="card-body p-0 overflow-auto" style="max-height: 70vh;">
                <ul class="step-tree list-unstyled mb-0 p-2" id="step-tree"></ul>
              </div>
            </div>
          </div>
          <div class="col-md-8">
            <div class="card border-0 shadow-sm h-100">
              <div class="card-header bg-white border-bottom py-2">
                <span class="fw-semibold">Step Detail</span>
                <span class="text-muted small ms-2" id="step-detail-title"></span>
              </div>
              <div class="card-body detail-panel">
                <div id="step-detail-empty" class="empty-state">Select a step</div>
                <div id="step-detail-content" class="d-none">
                  <div class="detail-section">
                    <h6>Input</h6>
                    <pre class="detail-pre mb-0" id="step-input"></pre>
                  </div>
                  <div class="detail-section">
                    <h6>Output</h6>
                    <pre class="detail-pre mb-0" id="step-output"></pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script type="application/json" id="agent-report-data">__REPORT_DATA__</script>
  <script>
    (function() {
      const el = document.getElementById('agent-report-data');
      const raw = el && el.textContent ? el.textContent.trim() : '{}';
      let data = {};
      try {
        data = raw === '' ? {} : JSON.parse(raw);
      } catch (e) {
        console.error('Invalid report data', e);
      }

      const systemPrompt = data.systemPrompt || '';
      const userPrompt = data.userPrompt || '';
      const reportMarkdown = data.reportMarkdown || '';
      const steps = Array.isArray(data.steps) ? data.steps : [];

      const markdownOpts = { gfm: true, breaks: true };
      function renderMarkdown(elId, text, fallback) {
        const el = document.getElementById(elId);
        if (!el) return;
        const content = (text || '').trim();
        if (!content) {
          el.innerHTML = fallback ? '<p class="text-muted">' + fallback + '</p>' : '';
          return;
        }
        if (typeof marked !== 'undefined') {
          el.innerHTML = marked.parse(content, markdownOpts);
        } else {
          el.textContent = content;
        }
      }
      renderMarkdown('system-prompt', systemPrompt, '(none)');
      renderMarkdown('user-prompt', userPrompt, '(none)');

      if (reportMarkdown) {
        if (typeof marked !== 'undefined') {
          document.getElementById('report-markdown').innerHTML = marked.parse(reportMarkdown, markdownOpts);
        } else {
          document.getElementById('report-markdown').textContent = reportMarkdown;
        }
      } else {
        document.getElementById('report-markdown').innerHTML = '<p class="text-muted">No report content.</p>';
      }

      const treeEl = document.getElementById('step-tree');
      const detailTitle = document.getElementById('step-detail-title');
      const detailEmpty = document.getElementById('step-detail-empty');
      const detailContent = document.getElementById('step-detail-content');
      const inputPre = document.getElementById('step-input');
      const outputPre = document.getElementById('step-output');

      steps.forEach(function(s, i) {
        const li = document.createElement('li');
        li.className = 'step-item';
        li.dataset.index = String(i);
        const node = s.node || '?';
        const meta = [];
        if (s.toolCalls && s.toolCalls.length) meta.push(s.toolCalls.map(function(t) { return t.name; }).join(', '));
        if (s.usage) meta.push('tokens: ' + (s.usage.total_tokens || (s.usage.input_tokens + s.usage.output_tokens) || '-'));
        li.innerHTML = '<span class="step-node">[' + (i + 1) + '] ' + escapeHtml(node) + '</span>' +
          (meta.length ? '<div class="step-meta mt-1">' + escapeHtml(meta.join(' | ')) + '</div>' : '');
        li.addEventListener('click', function() {
          document.querySelectorAll('.step-tree .step-item.active').forEach(function(x) { x.classList.remove('active'); });
          li.classList.add('active');
          detailEmpty.classList.add('d-none');
          detailContent.classList.remove('d-none');
          detailTitle.textContent = 'Step ' + (i + 1) + ' — ' + node;
          inputPre.textContent = formatJson(s.input);
          outputPre.textContent = formatJson(s.output);
        });
        treeEl.appendChild(li);
      });

      function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
      }
      function formatJson(obj) {
        if (obj === undefined || obj === null) return '(none)';
        try {
          return JSON.stringify(obj, null, 2);
        } catch (e) {
          return String(obj);
        }
      }
    })();
  </script>
</body>
</html>
`;
