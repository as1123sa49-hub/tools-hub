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
      '輸入需求或功能描述。',
      '設定輸出類型與測試維度。',
      '產生測案並檢查欄位完整性。',
      '匯出或複製結果給 QA / 開發使用。'
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
  }
};

const toolTitle = document.getElementById('tool-title');
const btnReload = document.getElementById('btn-reload');
const guide = document.getElementById('guide');
const embedWrap = document.getElementById('embed-wrap');
const navButtons = Array.from(document.querySelectorAll('.nav-btn'));

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
  } else {
    embedWrap.style.display = 'none';
    btnReload.style.display = 'none';
    hideAllFrames();
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

renderTool(currentTool);
