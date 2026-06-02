require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/sales-reports', require('./src/routes/salesReports'));
app.use('/api/spreadsheet', require('./src/routes/spreadsheet'));
app.use('/api/stats', require('./src/routes/stats'));
app.use('/api/interview-dates', require('./src/routes/interviewDates'));
app.use('/api/calendar', require('./src/routes/calendar'));
app.use('/api/sukuukun', require('./src/routes/sukuukun'));
app.use('/api/analysis', require('./src/routes/analysis'));
app.use('/api/notion',        require('./src/routes/notion'));
app.use('/api/surprise-call', require('./src/routes/surpriseCall'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback - serve index.html for all non-API routes
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    next();
  }
});

app.listen(PORT, () => {
  console.log(`WannaV Sales管理システム - Server running on port ${PORT}`);

  // ── バックグラウンド: Googleカレンダー自動同期（30分ごと）────
  const calendarSync = require('./src/jobs/calendarSync');
  calendarSync.start(); // 起動10秒後に初回実行 → 以降30分ごと

  // ── バックグラウンド: Notion プロファイル同期（毎日午前3時）──
  const notionSync = require('./src/jobs/notionSync');
  notionSync.start(); // 起動30秒後に初回実行 → 以降毎日午前3時
});

module.exports = app;
