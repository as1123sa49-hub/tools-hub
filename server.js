const path = require('path');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3010;
const IMG_COMPARE_URL = process.env.IMG_COMPARE_URL || 'http://127.0.0.1:3000';
const BONUS_500X_URL = process.env.BONUS_500X_URL || 'http://127.0.0.1:3001';

const hubDir = __dirname;
const toolsRoot = path.resolve(__dirname, '..');
const testCaseGeneratorDir = path.join(toolsRoot, 'test-case-generator');
const frontLogCheckerScript = path.join(toolsRoot, 'front-log-checker', 'intercept.js');

app.use(express.static(hubDir));

// test-case-generator is a static tool; mount it directly.
app.use(
  '/apps/test-case-generator',
  express.static(testCaseGeneratorDir)
);

// 500x has its own server/api; proxy through hub.
app.use(
  '/apps/500x',
  createProxyMiddleware({
    target: BONUS_500X_URL,
    changeOrigin: true,
    pathRewrite: (path) => path.replace(/^\/apps\/500x/, '') || '/'
  })
);
app.get('/apps/500x', (_req, res) => res.redirect('/apps/500x/'));

// img-compare has its own server/api; proxy through hub.
app.use(
  '/apps/img-compare',
  createProxyMiddleware({
    target: IMG_COMPARE_URL,
    changeOrigin: true,
    pathRewrite: (path) => path.replace(/^\/apps\/img-compare/, '') || '/'
  })
);
app.get('/apps/img-compare', (_req, res) => res.redirect('/apps/img-compare/'));

// 500x API endpoints (keep path stable under /api/500x/*)
app.use(
  '/api/500x',
  createProxyMiddleware({
    target: BONUS_500X_URL,
    changeOrigin: true,
    pathRewrite: (path) => `/api${path}`
  })
);

app.use(
  '/api',
  createProxyMiddleware({
    target: IMG_COMPARE_URL,
    changeOrigin: true,
    pathRewrite: (path) => `/api${path}`
  })
);

app.get('/snippets/front-log-checker.txt', (_req, res) => {
  res.type('text/plain; charset=utf-8');
  res.sendFile(frontLogCheckerScript);
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(hubDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log('QA Tools Hub started');
  console.log(`Hub URL: http://localhost:${PORT}`);
  console.log(`img-compare target: ${IMG_COMPARE_URL}`);
  console.log(`500x target: ${BONUS_500X_URL}`);
});
