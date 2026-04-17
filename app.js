const TOOL_MAP = {
  'img-compare': {
    title: '圖片比對',
    url: '/apps/img-compare/',
    embeddable: true,
    steps: [
      '可填 A/B 兩個網址做比對；也可只填一個網址做單站檢視。',
      '選擇擷取模式：一般頁用「標準」、輪詢頁用「含列表輪詢」。',
      '點擊開始擷取，完成後查看總覽、載入狀態、資源大小、視覺比對。',
      '必要時匯出 CSV（含失敗清單）。'
    ]
  },
  'test-case-generator': {
    title: '測案產生器',
    url: '/apps/test-case-generator/',
    embeddable: true,
    steps: [
      '先選擇模式：新舊規格比對，或匯入Case比對新版。',
      '新舊規格模式：上傳新版 PDF（必要）與舊版 PDF（選填），可搭配快取版本。',
      '匯入Case模式：上傳新版 PDF + Baseline TestCase（CSV/XLSX，使用模板欄位）。',
      '視需要調整對應提示詞 Tab，點擊開始分析後檢查新增/失效/取代結果。',
      '確認結果後匯出 XLSX，交付 QA / 開發使用。'
    ]
  },
  '500x': {
    title: '500X 機率統計',
    url: '/apps/500x/',
    embeddable: true,
    steps: [
      '確認 500X 服務已啟動（預設 http://localhost:3001）。',
      '輸入遊戲網址與局數，點擊開始收集。',
      '等待 WebSocket 統計更新與局數達標。',
      '在 500X 頁面匯出統計 CSV / 明細 CSV。'
    ],
    command: 'cd tools/500x && node verify-rates.js'
  },
  'front-log-checker': {
    title: '前端 LOG 驗證',
    url: '',
    embeddable: false,
    steps: [
      '此工具目前為攔截腳本，尚未提供獨立網頁 UI。',
      '在 Hub 複製完整腳本內容。',
      '到目標站台開 DevTools Console，直接貼上完整腳本。',
      '執行目標流程並觀察 LOG 是否符合規則。',
      '整理異常項目後回報。'
    ],
    command: 'node tools/front-log-checker/intercept.js',
    inlineScript: true
  },
  'front-log-compare': {
    title: 'LOG 結構比對',
    url: '',
    embeddable: false,
    customPanel: true,
    steps: [
      '上傳舊版與新版兩份 JSON（由 front-log-checker 匯出的 JSON(原始)）。',
      '選擇匹配鍵：預設 function_name + event，可切換為 function_name 或自訂欄位。',
      '固定比對 jsondata 的 path/type；可選擇是否附加外層欄位比對。',
      '點擊開始比對後查看 PASS/WARN/FAIL，並可下載差異 CSV 報告。'
    ]
  }
};

const toolTitle = document.getElementById('tool-title');
const btnReadme = document.getElementById('btn-readme');
const btnReload = document.getElementById('btn-reload');
const guide = document.getElementById('guide');
const embedWrap = document.getElementById('embed-wrap');
const navButtons = Array.from(document.querySelectorAll('.nav-btn'));
const readmeModal = document.getElementById('readme-modal');
const readmeTitle = document.getElementById('readme-title');
const readmeContent = document.getElementById('readme-content');
const readmeCloseBtn = document.getElementById('readme-close-btn');
const readmeCloseBackdrop = document.getElementById('readme-close-backdrop');

let currentTool = 'img-compare';
let frontLogScriptCache = '';
const toolFrames = new Map();

async function renderGuide(tool) {
  const data = TOOL_MAP[tool];
  const stepsHtml = data.steps.map((step) => `<li>${step}</li>`).join('');
  const commandHtml = data.command ? `<code>${data.command}</code>` : '';
  const loaderHtml = data.inlineScript
    ? `
      <div class="snippet-box">
        <div class="snippet-head">
          <strong>Console 完整腳本（直接貼上）</strong>
          <button id="btn-copy-loader" class="btn-copy">複製</button>
        </div>
        <textarea id="console-loader" readonly></textarea>
      </div>
    `
    : '';

  guide.innerHTML = `
    <h3>操作導引</h3>
    <ol>${stepsHtml}</ol>
    ${commandHtml}
    ${loaderHtml}
  `;

  if (data.inlineScript) {
    const textarea = document.getElementById('console-loader');
    const btnCopy = document.getElementById('btn-copy-loader');
    const script = await getFrontLogScriptText();
    textarea.value = script || '// 讀取 front-log-checker 腳本失敗，請確認 Hub server 正常。';
    btnCopy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(textarea.value);
        btnCopy.textContent = '已複製';
        setTimeout(() => { btnCopy.textContent = '複製'; }, 1200);
      } catch (_e) {
        textarea.select();
        document.execCommand('copy');
        btnCopy.textContent = '已複製';
        setTimeout(() => { btnCopy.textContent = '複製'; }, 1200);
      }
    });
  }
}

async function getFrontLogScriptText() {
  if (frontLogScriptCache) return frontLogScriptCache;
  const res = await fetch('/snippets/front-log-checker.txt', { cache: 'no-store' });
  if (!res.ok) throw new Error(`load failed: ${res.status}`);
  frontLogScriptCache = await res.text();
  return frontLogScriptCache;
}

function getValueType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function parseMaybeJson(raw) {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_e) {
      return {};
    }
  }
  if (raw && typeof raw === 'object') return raw;
  return {};
}

function collectSchemaPaths(value, prefix, bucket, ignoreSet) {
  const path = prefix || '$';
  const leaf = path.split('.').pop().replace('[]', '');
  if (ignoreSet.has(path) || ignoreSet.has(leaf)) return;

  const valType = getValueType(value);
  bucket[path] = valType;

  if (valType === 'array') {
    if (value.length > 0) {
      collectSchemaPaths(value[0], `${path}[]`, bucket, ignoreSet);
    } else {
      bucket[`${path}[]`] = 'unknown';
    }
    return;
  }

  if (valType === 'object') {
    Object.keys(value).sort().forEach((key) => {
      if (ignoreSet.has(key)) return;
      const nextPath = path === '$' ? key : `${path}.${key}`;
      collectSchemaPaths(value[key], nextPath, bucket, ignoreSet);
    });
  }
}

function normalizeRawLogs(payload, ignoreSet) {
  const source = Array.isArray(payload) ? payload : [];
  return source.map((item, index) => {
    const root = item && typeof item === 'object' ? item : {};
    const body = root.payload && typeof root.payload === 'object' ? root.payload : root;
    const outerData = body.data && typeof body.data === 'object' ? body.data : body;
    const jsondata = parseMaybeJson(outerData.jsondata);
    const schemaMap = {};
    collectSchemaPaths(jsondata, '$', schemaMap, ignoreSet);

    return {
      index: index + 1,
      function_name: jsondata.function_name || outerData.function_name || body.function_name || '',
      event: body.event || outerData.event || jsondata.event || '',
      outerData,
      jsondata,
      schemaMap
    };
  });
}

function getJsonPathValue(obj, schemaPath) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (schemaPath === '$') return obj;
  const parts = schemaPath.split('.');
  let cursor = obj;
  for (const part of parts) {
    if (cursor === undefined || cursor === null) return undefined;
    if (part.endsWith('[]')) {
      const key = part.slice(0, -2);
      if (key) cursor = cursor[key];
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[0];
      continue;
    }
    cursor = cursor[part];
  }
  return cursor;
}

function formatSampleValue(value) {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (_e) {
    return String(value);
  }
}

function collectSampleValues(records, schemaPath) {
  const values = new Set();
  records.forEach((record) => {
    const raw = getJsonPathValue(record.jsondata, schemaPath);
    const formatted = formatSampleValue(raw);
    if (formatted === '') return;
    values.add(formatted);
  });
  const list = Array.from(values);
  if (!list.length) return '';
  if (list.length <= 2) return list.join(' | ');
  return `${list.slice(0, 2).join(' | ')} ... (共${list.length}種)`;
}

function collectOuterSampleValues(records, field) {
  const values = new Set();
  records.forEach((record) => {
    const raw = record?.outerData?.[field];
    const formatted = formatSampleValue(raw);
    if (formatted === '') return;
    values.add(formatted);
  });
  const list = Array.from(values);
  if (!list.length) return '';
  if (list.length <= 2) return list.join(' | ');
  return `${list.slice(0, 2).join(' | ')} ... (共${list.length}種)`;
}

function parseCsvLine(line) {
  const cols = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cols.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cols.push(current);
  return cols;
}

function toCsv(rows, headers) {
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    const line = headers.map((h) => {
      const raw = row[h] == null ? '' : String(row[h]);
      const escaped = raw.replaceAll('"', '""');
      return escaped.includes(',') || escaped.includes('\n') ? `"${escaped}"` : escaped;
    }).join(',');
    lines.push(line);
  });
  return `\uFEFF${lines.join('\n')}`;
}

function buildMatchKey(record, mode, customFields) {
  if (mode === 'function_name') return record.function_name || '(empty:function_name)';
  if (mode === 'custom') {
    const parts = customFields.map((field) => {
      const name = field.trim();
      if (!name) return '';
      const val = record.outerData[name];
      return `${name}=${val == null ? '' : String(val)}`;
    }).filter(Boolean);
    return parts.length > 0 ? parts.join('|') : '(custom:empty)';
  }
  return `${record.function_name || '(empty:function_name)'}|${record.event || '(empty:event)'}`;
}

function aggregateByKey(records, mode, customFields) {
  const grouped = new Map();
  records.forEach((record) => {
    const key = buildMatchKey(record, mode, customFields);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  });
  return grouped;
}

function formatMatchTarget(key) {
  if (!key) return '(未提供匹配資訊)';
  return key
    .replaceAll('(empty:function_name)', 'function_name(空)')
    .replaceAll('(empty:event)', 'event(空)')
    .replaceAll('|', ' / ');
}

function getIssueLabel(issueType) {
  const map = {
    match: '一致',
    missing_group: '整組缺失',
    extra_path: '新增欄位',
    missing_path: '缺少欄位',
    type_mismatch: '型別變更',
    outer_extra: '外層新增欄位',
    outer_missing: '外層缺少欄位',
    outer_type_mismatch: '外層型別變更'
  };
  return map[issueType] || issueType;
}

function buildIssueDescription(row) {
  if (row.issue_type === 'missing_group') {
    return `此匹配組在新舊其中一側不存在（舊版 ${row.old_value} 筆 / 新版 ${row.new_value} 筆）。`;
  }
  if (row.issue_type === 'extra_path') return '新版出現舊版沒有的 jsondata 欄位。';
  if (row.issue_type === 'missing_path') return '新版缺少舊版已有的 jsondata 欄位。';
  if (row.issue_type === 'type_mismatch') return '同一路徑欄位型別不同，可能影響下游解析。';
  if (row.issue_type === 'outer_extra') return '新版多出外層欄位。';
  if (row.issue_type === 'outer_missing') return '新版缺少外層欄位。';
  if (row.issue_type === 'outer_type_mismatch') return '外層欄位型別不同。';
  if (row.issue_type === 'match') return 'jsondata 路徑存在且型別一致。';
  return '';
}

function formatSchemaPath(path) {
  return path === '$' ? 'jsondata(根節點)' : path;
}

function buildDiffTable(rows) {
  if (!rows.length) return '<p class="status-pass">此分頁未發現差異。</p>';
  return `
    <table>
      <thead><tr><th>比對對象</th><th>狀態</th><th>差異分類</th><th>差異欄位</th><th>舊版</th><th>新版</th><th>舊版 seq_index</th><th>新版 seq_index</th><th>說明</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td>${escapeHtml(formatMatchTarget(r.key))}</td>
          <td>${escapeHtml(r.status)}</td>
          <td>${escapeHtml(getIssueLabel(r.issue_type))}</td>
          <td>${escapeHtml(r.field || '-')}</td>
          <td>${escapeHtml(r.old_value || '-')}</td>
          <td>${escapeHtml(r.new_value || '-')}</td>
          <td>${escapeHtml(r.old_seq_index || '-')}</td>
          <td>${escapeHtml(r.new_seq_index || '-')}</td>
          <td>${escapeHtml(buildIssueDescription(r))}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  `;
}

function buildJsondataAccordion(groups) {
  if (!groups.length) return '<p class="status-pass">此分頁目前沒有可展開的 jsondata 比對資料。</p>';
  return groups.map((group, idx) => {
    const panelId = `jsondata-group-${idx}`;
    return `
      <article class="json-acc-card">
        <button class="json-acc-toggle" data-target="${panelId}" type="button">
          <span class="json-acc-title">${escapeHtml(formatMatchTarget(group.key))}</span>
          <span class="json-acc-meta">
            PASS ${group.passCount} / WARN ${group.warnCount} / FAIL ${group.failCount}
          </span>
          <span class="json-acc-meta">舊版 seq_index: ${escapeHtml(group.old_seq_index || '-')}</span>
          <span class="json-acc-meta">新版 seq_index: ${escapeHtml(group.new_seq_index || '-')}</span>
        </button>
        <div id="${panelId}" class="json-acc-panel">
          <table>
            <thead><tr><th>欄位路徑</th><th>結果</th><th>差異分類</th><th>舊版型別</th><th>新版型別</th><th>舊版樣本值</th><th>新版樣本值</th><th>說明</th></tr></thead>
            <tbody>
              ${group.details.map((detail) => `<tr>
                <td>${escapeHtml(formatSchemaPath(detail.path))}</td>
                <td>${escapeHtml(detail.status)}</td>
                <td>${escapeHtml(getIssueLabel(detail.issue_type))}</td>
                <td>${escapeHtml(detail.old_type || '-')}</td>
                <td>${escapeHtml(detail.new_type || '-')}</td>
                <td>${escapeHtml(detail.old_sample || '-')}</td>
                <td>${escapeHtml(detail.new_sample || '-')}</td>
                <td>${escapeHtml(buildIssueDescription({
                  issue_type: detail.issue_type,
                  old_value: detail.old_type,
                  new_value: detail.new_type
                }) || 'jsondata 結構一致')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }).join('');
}

function buildOuterAccordion(groups, enabled) {
  if (!enabled) return '<p>未啟用外層比對，本次無外層差異資料。</p>';
  if (!groups.length) return '<p class="status-pass">外層欄位未發現可比對資料。</p>';

  return groups.map((group, idx) => {
    const panelId = `outer-group-${idx}`;
    return `
      <article class="json-acc-card">
        <button class="json-acc-toggle" data-target="${panelId}" type="button">
          <span class="json-acc-title">${escapeHtml(formatMatchTarget(group.key))}</span>
          <span class="json-acc-meta">PASS ${group.passCount} / WARN ${group.warnCount} / FAIL ${group.failCount}</span>
          <span class="json-acc-meta">舊版 seq_index: ${escapeHtml(group.oldSeqText || '-')}</span>
          <span class="json-acc-meta">新版 seq_index: ${escapeHtml(group.newSeqText || '-')}</span>
        </button>
        <div id="${panelId}" class="json-acc-panel">
          <table>
            <thead><tr><th>外層欄位</th><th>結果</th><th>差異分類</th><th>舊版型別</th><th>新版型別</th><th>舊版樣本值</th><th>新版樣本值</th><th>說明</th></tr></thead>
            <tbody>
              ${group.details.map((detail) => `<tr>
                <td>${escapeHtml(detail.field || '-')}</td>
                <td>${escapeHtml(detail.status)}</td>
                <td>${escapeHtml(getIssueLabel(detail.issue_type))}</td>
                <td>${escapeHtml(detail.old_value || '-')}</td>
                <td>${escapeHtml(detail.new_value || '-')}</td>
                <td>${escapeHtml(detail.old_sample || '-')}</td>
                <td>${escapeHtml(detail.new_sample || '-')}</td>
                <td>${escapeHtml(buildIssueDescription({
                  issue_type: detail.issue_type,
                  old_value: detail.old_value,
                  new_value: detail.new_value
                }))}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }).join('');
}

function mergeSchema(records) {
  const merged = new Map();
  records.forEach((record) => {
    Object.entries(record.schemaMap).forEach(([path, type]) => {
      if (!merged.has(path)) merged.set(path, new Set());
      merged.get(path).add(type);
    });
  });
  return merged;
}

function mergeOuterShape(records, fields) {
  const merged = new Map();
  records.forEach((record) => {
    fields.forEach((field) => {
      if (!(field in record.outerData)) return;
      if (!merged.has(field)) merged.set(field, new Set());
      merged.get(field).add(getValueType(record.outerData[field]));
    });
  });
  return merged;
}

function getSeqIndexText(records) {
  const set = new Set();
  records.forEach((record) => {
    const raw = record?.outerData?.seq_index;
    if (raw === undefined || raw === null || raw === '') return;
    set.add(String(raw));
  });
  const list = Array.from(set);
  if (list.length === 0) return '';
  if (list.length <= 3) return list.join(' | ');
  return `${list.slice(0, 3).join(' | ')} ... (共${list.length}筆)`;
}

function renderLogComparePanel() {
  embedWrap.style.display = 'block';
  hideAllFrames();
  embedWrap.innerHTML = `
    <section class="compare-card">
      <div class="compare-grid">
        <label>舊版 JSON(原始)
          <input id="cmp-old-file" type="file" accept=".json,application/json">
        </label>
        <label>新版 JSON(原始)
          <input id="cmp-new-file" type="file" accept=".json,application/json">
        </label>
      </div>
      <div class="compare-grid">
        <label>匹配鍵
          <select id="cmp-match-mode">
            <option value="function_name_event" selected>function_name + event（預設）</option>
            <option value="function_name">function_name</option>
            <option value="custom">自訂外層欄位</option>
          </select>
        </label>
        <label id="cmp-custom-wrap" class="hidden">自訂匹配欄位（逗號分隔）
          <input id="cmp-custom-fields" type="text" placeholder="例如 table_id,room_id">
        </label>
      </div>
      <div class="compare-grid">
        <label class="row-checkbox">
          <input id="cmp-enable-outer" type="checkbox">
          啟用外層欄位比對（jsondata path/type 固定必比）
        </label>
        <label id="cmp-outer-wrap" class="hidden">外層比對欄位（逗號分隔）
          <input id="cmp-outer-fields" type="text" placeholder="例如 api,module">
        </label>
      </div>
      <label>忽略欄位（逗號分隔）
        <input id="cmp-ignore-fields" type="text" value="timestamp,_capturedAt,trace_id,token,host">
      </label>
      <label class="row-checkbox">
        <input id="cmp-only-has-function-name" type="checkbox" checked>
        僅比對有 function_name 的資料（空值直接跳過）
      </label>
      <div class="compare-actions">
        <button id="cmp-run" class="btn-primary">開始比對</button>
        <button id="cmp-download" class="btn-muted" disabled>下載差異 CSV</button>
      </div>
      <div id="cmp-summary" class="compare-summary"></div>
      <div id="cmp-tabs" class="compare-tabs hidden">
        <button class="cmp-tab-btn active" data-tab="all">全部明細</button>
        <button class="cmp-tab-btn" data-tab="missing-group">整組缺失</button>
        <button class="cmp-tab-btn" data-tab="jsondata">jsondata 結構差異</button>
        <button class="cmp-tab-btn" data-tab="outer">外層差異</button>
      </div>
      <div id="cmp-tab-panels">
        <div id="cmp-panel-all" class="compare-details"></div>
        <div id="cmp-panel-missing-group" class="compare-details hidden"></div>
        <div id="cmp-panel-jsondata" class="compare-details hidden"></div>
        <div id="cmp-panel-outer" class="compare-details hidden"></div>
      </div>
    </section>
  `;

  const modeEl = document.getElementById('cmp-match-mode');
  const customWrap = document.getElementById('cmp-custom-wrap');
  const enableOuter = document.getElementById('cmp-enable-outer');
  const outerWrap = document.getElementById('cmp-outer-wrap');
  const runBtn = document.getElementById('cmp-run');
  const downloadBtn = document.getElementById('cmp-download');
  const summaryEl = document.getElementById('cmp-summary');
  const tabsEl = document.getElementById('cmp-tabs');
  const tabButtons = Array.from(document.querySelectorAll('.cmp-tab-btn'));
  const panelAll = document.getElementById('cmp-panel-all');
  const panelMissingGroup = document.getElementById('cmp-panel-missing-group');
  const panelJsondata = document.getElementById('cmp-panel-jsondata');
  const panelOuter = document.getElementById('cmp-panel-outer');
  let lastDiffRows = [];

  const switchTab = (tabId) => {
    tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabId));
    panelAll.classList.toggle('hidden', tabId !== 'all');
    panelMissingGroup.classList.toggle('hidden', tabId !== 'missing-group');
    panelJsondata.classList.toggle('hidden', tabId !== 'jsondata');
    panelOuter.classList.toggle('hidden', tabId !== 'outer');
  };

  modeEl.addEventListener('change', () => {
    customWrap.classList.toggle('hidden', modeEl.value !== 'custom');
  });
  enableOuter.addEventListener('change', () => {
    outerWrap.classList.toggle('hidden', !enableOuter.checked);
  });
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  panelJsondata.addEventListener('click', (event) => {
    const btn = event.target.closest('.json-acc-toggle');
    if (!btn) return;
    const target = btn.getAttribute('data-target');
    if (!target) return;
    const panel = document.getElementById(target);
    if (!panel) return;
    panel.classList.toggle('hidden');
  });
  panelOuter.addEventListener('click', (event) => {
    const btn = event.target.closest('.json-acc-toggle');
    if (!btn) return;
    const target = btn.getAttribute('data-target');
    if (!target) return;
    const panel = document.getElementById(target);
    if (!panel) return;
    panel.classList.toggle('hidden');
  });

  runBtn.addEventListener('click', async () => {
    const oldFile = document.getElementById('cmp-old-file').files?.[0];
    const newFile = document.getElementById('cmp-new-file').files?.[0];
    if (!oldFile || !newFile) {
      summaryEl.innerHTML = '<p class="status-fail">請先上傳舊版與新版 JSON。</p>';
      tabsEl.classList.add('hidden');
      panelAll.innerHTML = '';
      panelMissingGroup.innerHTML = '';
      panelJsondata.innerHTML = '';
      panelOuter.innerHTML = '';
      return;
    }

    try {
      const [oldText, newText] = await Promise.all([oldFile.text(), newFile.text()]);
      const oldJson = JSON.parse(oldText);
      const newJson = JSON.parse(newText);
      const ignoreSet = new Set(
        document.getElementById('cmp-ignore-fields').value.split(',').map((s) => s.trim()).filter(Boolean)
      );
      const oldRawRecords = normalizeRawLogs(oldJson, ignoreSet);
      const newRawRecords = normalizeRawLogs(newJson, ignoreSet);
      const onlyHasFunctionName = document.getElementById('cmp-only-has-function-name').checked;
      const hasFunctionName = (record) => Boolean(String(record.function_name || '').trim());
      const oldRecords = onlyHasFunctionName ? oldRawRecords.filter(hasFunctionName) : oldRawRecords;
      const newRecords = onlyHasFunctionName ? newRawRecords.filter(hasFunctionName) : newRawRecords;
      const oldSkipped = oldRawRecords.length - oldRecords.length;
      const newSkipped = newRawRecords.length - newRecords.length;

      const mode = modeEl.value;
      const customFields = document.getElementById('cmp-custom-fields').value.split(',').map((s) => s.trim()).filter(Boolean);
      const outerFields = document.getElementById('cmp-outer-fields').value.split(',').map((s) => s.trim()).filter(Boolean);
      const compareOuter = enableOuter.checked && outerFields.length > 0;

      const oldMap = aggregateByKey(oldRecords, mode, customFields);
      const newMap = aggregateByKey(newRecords, mode, customFields);
      const allKeys = Array.from(new Set([...oldMap.keys(), ...newMap.keys()])).sort();

      const rows = [];
      const jsondataGroups = [];
      const outerGroups = [];
      let pass = 0;
      let warn = 0;
      let fail = 0;

      allKeys.forEach((key) => {
        const oldGroup = oldMap.get(key) || [];
        const newGroup = newMap.get(key) || [];
        const oldSeqText = getSeqIndexText(oldGroup);
        const newSeqText = getSeqIndexText(newGroup);

        if (oldGroup.length === 0 || newGroup.length === 0) {
          fail += 1;
          rows.push({
            key,
            status: 'FAIL',
            issue_type: 'missing_group',
            field: '',
            old_value: String(oldGroup.length),
            new_value: String(newGroup.length),
            old_seq_index: oldSeqText,
            new_seq_index: newSeqText
          });
          return;
        }

        const oldSchema = mergeSchema(oldGroup);
        const newSchema = mergeSchema(newGroup);
        const schemaPaths = Array.from(new Set([...oldSchema.keys(), ...newSchema.keys()])).sort();
        const jsondataDetails = [];
        let jsonPass = 0;
        let jsonWarn = 0;
        let jsonFail = 0;

        let hasFail = false;
        let hasWarn = false;

        schemaPaths.forEach((path) => {
          const oldTypes = oldSchema.get(path);
          const newTypes = newSchema.get(path);
          const oldSample = collectSampleValues(oldGroup, path);
          const newSample = collectSampleValues(newGroup, path);
          if (!oldTypes && newTypes) {
            hasWarn = true;
            jsonWarn += 1;
            jsondataDetails.push({
              path,
              status: 'WARN',
              issue_type: 'extra_path',
              old_type: '',
              new_type: Array.from(newTypes).sort().join('|'),
              old_sample: oldSample,
              new_sample: newSample
            });
            rows.push({
              key,
              status: 'WARN',
              issue_type: 'extra_path',
              field: path,
              old_value: '',
              new_value: Array.from(newTypes).join('|'),
              old_seq_index: oldSeqText,
              new_seq_index: newSeqText
            });
            return;
          }
          if (oldTypes && !newTypes) {
            hasFail = true;
            jsonFail += 1;
            jsondataDetails.push({
              path,
              status: 'FAIL',
              issue_type: 'missing_path',
              old_type: Array.from(oldTypes).sort().join('|'),
              new_type: '',
              old_sample: oldSample,
              new_sample: newSample
            });
            rows.push({
              key,
              status: 'FAIL',
              issue_type: 'missing_path',
              field: path,
              old_value: Array.from(oldTypes).join('|'),
              new_value: '',
              old_seq_index: oldSeqText,
              new_seq_index: newSeqText
            });
            return;
          }

          const oldTypeStr = Array.from(oldTypes).sort().join('|');
          const newTypeStr = Array.from(newTypes).sort().join('|');
          if (oldTypeStr !== newTypeStr) {
            hasFail = true;
            jsonFail += 1;
            jsondataDetails.push({
              path,
              status: 'FAIL',
              issue_type: 'type_mismatch',
              old_type: oldTypeStr,
              new_type: newTypeStr,
              old_sample: oldSample,
              new_sample: newSample
            });
            rows.push({
              key,
              status: 'FAIL',
              issue_type: 'type_mismatch',
              field: path,
              old_value: oldTypeStr,
              new_value: newTypeStr,
              old_seq_index: oldSeqText,
              new_seq_index: newSeqText
            });
          } else {
            jsonPass += 1;
            jsondataDetails.push({
              path,
              status: 'PASS',
              issue_type: 'match',
              old_type: oldTypeStr,
              new_type: newTypeStr,
              old_sample: oldSample,
              new_sample: newSample
            });
          }
        });
        jsondataGroups.push({
          key,
          old_seq_index: oldSeqText,
          new_seq_index: newSeqText,
          passCount: jsonPass,
          warnCount: jsonWarn,
          failCount: jsonFail,
          details: jsondataDetails
        });

        if (compareOuter) {
          const oldOuter = mergeOuterShape(oldGroup, outerFields);
          const newOuter = mergeOuterShape(newGroup, outerFields);
          const outerDetails = [];
          let outerPass = 0;
          let outerWarn = 0;
          let outerFail = 0;
          outerFields.forEach((field) => {
            const oldTypes = oldOuter.get(field);
            const newTypes = newOuter.get(field);
            if (!oldTypes && !newTypes) return;
            const oldSample = collectOuterSampleValues(oldGroup, field);
            const newSample = collectOuterSampleValues(newGroup, field);
            if (!oldTypes && newTypes) {
              hasWarn = true;
              outerWarn += 1;
              outerDetails.push({
                field,
                status: 'WARN',
                issue_type: 'outer_extra',
                old_value: '',
                new_value: Array.from(newTypes).join('|'),
                old_sample: oldSample,
                new_sample: newSample
              });
              rows.push({
                key,
                status: 'WARN',
                issue_type: 'outer_extra',
                field,
                old_value: '',
                new_value: Array.from(newTypes).join('|'),
                old_seq_index: oldSeqText,
                new_seq_index: newSeqText
              });
              return;
            }
            if (oldTypes && !newTypes) {
              hasFail = true;
              outerFail += 1;
              outerDetails.push({
                field,
                status: 'FAIL',
                issue_type: 'outer_missing',
                old_value: Array.from(oldTypes).join('|'),
                new_value: '',
                old_sample: oldSample,
                new_sample: newSample
              });
              rows.push({
                key,
                status: 'FAIL',
                issue_type: 'outer_missing',
                field,
                old_value: Array.from(oldTypes).join('|'),
                new_value: '',
                old_seq_index: oldSeqText,
                new_seq_index: newSeqText
              });
              return;
            }
            const oldTypeStr = Array.from(oldTypes).sort().join('|');
            const newTypeStr = Array.from(newTypes).sort().join('|');
            if (oldTypeStr !== newTypeStr) {
              hasFail = true;
              outerFail += 1;
              outerDetails.push({
                field,
                status: 'FAIL',
                issue_type: 'outer_type_mismatch',
                old_value: oldTypeStr,
                new_value: newTypeStr,
                old_sample: oldSample,
                new_sample: newSample
              });
              rows.push({
                key,
                status: 'FAIL',
                issue_type: 'outer_type_mismatch',
                field,
                old_value: oldTypeStr,
                new_value: newTypeStr,
                old_seq_index: oldSeqText,
                new_seq_index: newSeqText
              });
            } else {
              outerPass += 1;
              outerDetails.push({
                field,
                status: 'PASS',
                issue_type: 'match',
                old_value: oldTypeStr,
                new_value: newTypeStr,
                old_sample: oldSample,
                new_sample: newSample
              });
            }
          });
          outerGroups.push({
            key,
            oldSeqText,
            newSeqText,
            passCount: outerPass,
            warnCount: outerWarn,
            failCount: outerFail,
            details: outerDetails
          });
        }

        if (hasFail) fail += 1;
        else if (hasWarn) warn += 1;
        else pass += 1;
      });

      lastDiffRows = rows;
      downloadBtn.disabled = rows.length === 0;
      const summaryClass = fail > 0 ? 'status-fail' : (warn > 0 ? 'status-warn' : 'status-pass');
      summaryEl.innerHTML = `
        <p class="${summaryClass}">
          比對完成：PASS ${pass} / WARN ${warn} / FAIL ${fail}（共 ${allKeys.length} 組）
        </p>
        <p>
          參與比對筆數：舊版 ${oldRecords.length} / 新版 ${newRecords.length}
          ${onlyHasFunctionName ? `（已跳過無 function_name：舊版 ${oldSkipped} / 新版 ${newSkipped}）` : ''}
        </p>
      `;
      const missingGroupRows = rows.filter((r) => r.issue_type === 'missing_group');
      const outerRows = rows.filter((r) => ['outer_extra', 'outer_missing', 'outer_type_mismatch'].includes(r.issue_type));

      panelAll.innerHTML = buildDiffTable(rows);
      panelMissingGroup.innerHTML = buildDiffTable(missingGroupRows);
      panelJsondata.innerHTML = buildJsondataAccordion(jsondataGroups);
      panelOuter.innerHTML = buildOuterAccordion(outerGroups, compareOuter);
      tabsEl.classList.remove('hidden');
      switchTab('all');
    } catch (err) {
      summaryEl.innerHTML = `<p class="status-fail">比對失敗：${err.message || '請確認上傳的是有效 JSON 檔。'}</p>`;
      tabsEl.classList.add('hidden');
      panelAll.innerHTML = '';
      panelMissingGroup.innerHTML = '';
      panelJsondata.innerHTML = '';
      panelOuter.innerHTML = '';
      lastDiffRows = [];
      downloadBtn.disabled = true;
    }
  });

  downloadBtn.addEventListener('click', () => {
    if (!lastDiffRows.length) return;
    const exportRows = lastDiffRows.map((row) => ({
      compare_target: formatMatchTarget(row.key),
      status: row.status,
      issue_type: getIssueLabel(row.issue_type),
      field: row.field || '',
      old_value: row.old_value || '',
      new_value: row.new_value || '',
      old_seq_index: row.old_seq_index || '',
      new_seq_index: row.new_seq_index || '',
      description: buildIssueDescription(row)
    }));
    const csv = toCsv(exportRows, ['compare_target', 'status', 'issue_type', 'field', 'old_value', 'new_value', 'old_seq_index', 'new_seq_index', 'description']);
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `log_compare_diff_${Date.now()}.csv`;
    a.click();
  });
}

async function renderTool(tool) {
  const data = TOOL_MAP[tool];
  currentTool = tool;
  toolTitle.textContent = data.title;
  await renderGuide(tool);

  navButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  if (data.embeddable && data.url) {
    embedWrap.style.display = 'block';
    btnReload.style.display = 'inline-block';
    showToolFrame(tool, data.url);
  } else if (data.customPanel) {
    btnReload.style.display = 'none';
    renderLogComparePanel();
  } else {
    embedWrap.style.display = 'none';
    btnReload.style.display = 'none';
    hideAllFrames();
    embedWrap.innerHTML = '';
  }
}

function hideAllFrames() {
  for (const frame of toolFrames.values()) {
    frame.style.display = 'none';
  }
}

function ensureToolFrame(tool, url) {
  if (!toolFrames.has(tool)) {
    const frame = document.createElement('iframe');
    frame.className = 'tool-frame';
    frame.title = `${tool}-frame`;
    frame.src = url;
    embedWrap.appendChild(frame);
    toolFrames.set(tool, frame);
    return frame;
  }

  const frame = toolFrames.get(tool);
  if (!frame.src.endsWith(url)) {
    frame.src = url;
  }
  return frame;
}

function showToolFrame(tool, url) {
  hideAllFrames();
  const frame = ensureToolFrame(tool, url);
  frame.style.display = 'block';
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function markdownToHtml(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const html = [];
  let inCodeBlock = false;
  let inList = false;

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        if (inList) {
          html.push('</ul>');
          inList = false;
        }
        html.push('<pre><code>');
      } else {
        html.push('</code></pre>');
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }

    if (line.startsWith('# ')) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
      continue;
    }

    if (line.startsWith('## ')) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
      continue;
    }

    if (line.startsWith('### ')) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
      continue;
    }

    if (line.startsWith('- ')) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${escapeHtml(line.slice(2))}</li>`);
      continue;
    }

    if (!line.trim()) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push('<p></p>');
      continue;
    }

    if (inList) {
      html.push('</ul>');
      inList = false;
    }

    const withInlineCode = escapeHtml(line).replace(/`([^`]+)`/g, '<code>$1</code>');
    html.push(`<p>${withInlineCode}</p>`);
  }

  if (inList) html.push('</ul>');
  if (inCodeBlock) html.push('</code></pre>');
  return html.join('');
}

async function openReadmeModal() {
  const data = TOOL_MAP[currentTool];
  readmeTitle.textContent = `${data.title} 說明`;
  readmeContent.innerHTML = '<p>讀取中...</p>';
  readmeModal.classList.remove('hidden');
  readmeModal.setAttribute('aria-hidden', 'false');

  try {
    const res = await fetch(`/api/docs/${encodeURIComponent(currentTool)}`, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`readme load failed: ${res.status}`);
    }
    const payload = await res.json();
    readmeContent.innerHTML = markdownToHtml(payload.markdown || '');
  } catch (_e) {
    const fallbackLines = [
      `## ${data.title}`,
      '',
      '目前讀不到 README.md，改為顯示工具內建操作導引：',
      '',
      ...((data.steps || []).map((step) => `- ${step}`))
    ];
    if (data.command) {
      fallbackLines.push('', '建議命令：', '', `\`${data.command}\``);
    }
    readmeContent.innerHTML = markdownToHtml(fallbackLines.join('\n'));
  }
}

function closeReadmeModal() {
  readmeModal.classList.add('hidden');
  readmeModal.setAttribute('aria-hidden', 'true');
}

btnReload.addEventListener('click', () => {
  const data = TOOL_MAP[currentTool];
  if (!data || !data.embeddable || !data.url) return;
  const frame = ensureToolFrame(currentTool, data.url);
  frame.src = data.url;
  frame.style.display = 'block';
});

navButtons.forEach((btn) => {
  btn.addEventListener('click', async () => {
    await renderTool(btn.dataset.tool);
  });
});

btnReadme.addEventListener('click', openReadmeModal);
readmeCloseBtn.addEventListener('click', closeReadmeModal);
readmeCloseBackdrop.addEventListener('click', closeReadmeModal);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !readmeModal.classList.contains('hidden')) {
    closeReadmeModal();
  }
});

renderTool(currentTool);
