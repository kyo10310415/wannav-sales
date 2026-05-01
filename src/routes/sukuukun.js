const express = require('express');
const router = express.Router();
const multer = require('multer');
const https = require('https');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// ============================================================
// multer: メモリストレージ（PDFはバッファで受け取りテキスト抽出後DBに保存）
// ============================================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') return cb(null, true);
    cb(new Error('PDFファイルのみアップロード可能です'));
  }
});

// ============================================================
// Gemini API ヘルパー
// ============================================================
function callGemini(systemPrompt, userMessage, apiKey) {
  return new Promise((resolve, reject) => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const url = new URL(endpoint);

    const payload = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      }
    };

    const bodyStr = JSON.stringify(payload);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };

    const req = https.request(options, (resp) => {
      let data = '';
      resp.on('data', chunk => { data += chunk; });
      resp.on('end', () => {
        try {
          resolve({ status: resp.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error('Gemini APIレスポンスのJSONパース失敗: ' + data.slice(0, 300)));
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ============================================================
// ソース一覧のシステムプロンプト文字列を組み立てる
// ============================================================
function buildSystemPrompt(sources) {
  const base = `あなたは「すくう君」というVtuber営業専門のAIコーチです。
WannaV（ワナビー）プロダクションの営業担当者が行った面接（セールス）の文字起こしを読み、
以下の観点で採点・フィードバックを行ってください。

【評価観点】
1. **ラポール構築（20点）**: 冒頭の雑談・共感・信頼関係の構築
2. **ヒアリング（20点）**: 応募者の夢・課題・現状を引き出せているか
3. **価値提案（20点）**: WannaVの強み・サービス内容を魅力的に伝えられているか
4. **クロージング（20点）**: 契約に向けた提案・背中押しができているか
5. **全体的な流れ（20点）**: セールスの自然な流れ・テンポ・言葉遣い

【採点ルール】
- 各観点を0〜20点で採点し、合計100点満点で評価
- 各観点に具体的なフィードバック（良かった点・改善点）を記載
- 文字起こしの具体的な発言を引用してコメントする
- 改善提案は実践的・具体的に記述
- 最後に「総合コメント」として全体評価を200字程度で記述

【出力フォーマット】
必ず以下のJSON形式で返答してください。JSONのみを返し、前後に説明文を付けないこと：
{
  "total_score": <合計点>,
  "scores": {
    "rapport":        { "score": <点数>, "good": "<良かった点>", "improve": "<改善点>" },
    "hearing":        { "score": <点数>, "good": "<良かった点>", "improve": "<改善点>" },
    "value_proposal": { "score": <点数>, "good": "<良かった点>", "improve": "<改善点>" },
    "closing":        { "score": <点数>, "good": "<良かった点>", "improve": "<改善点>" },
    "overall_flow":   { "score": <点数>, "good": "<良かった点>", "improve": "<改善点>" }
  },
  "summary": "<総合コメント>",
  "highlights": ["<印象的な発言や場面1>", "<印象的な発言や場面2>"]
}`;

  if (!sources || sources.length === 0) return base;

  const sourcesText = sources.map((s, i) =>
    `=== ソース${i + 1}: ${s.title} ===\n${s.content}`
  ).join('\n\n');

  return `${base}

【評価の参考資料（セールストークスクリプト・指示書）】
以下の資料を参考にして、より具体的・詳細に評価してください。
資料の内容と実際のトークを照合し、正しいセールスフローに沿っているかも確認してください。

${sourcesText}`;
}

// ============================================================
// ソース管理 CRUD
// ============================================================

// GET /api/sukuukun/sources — ソース一覧
router.get('/sources', authenticateToken, (req, res) => {
  const rows = db.prepare(`
    SELECT id, title, source_type, file_name, char_count, created_at, updated_at
    FROM sukuukun_sources
    ORDER BY created_at DESC
  `).all();
  res.json(rows);
});

// GET /api/sukuukun/sources/:id — ソース詳細（content含む）
router.get('/sources/:id', authenticateToken, (req, res) => {
  const row = db.prepare('SELECT * FROM sukuukun_sources WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ソースが見つかりません' });
  res.json(row);
});

// POST /api/sukuukun/sources/text — テキストソース追加
router.post('/sources/text', authenticateToken, (req, res) => {
  const { title, content } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'タイトルは必須です' });
  if (!content || content.trim().length < 10) return res.status(400).json({ error: '内容が短すぎます（10文字以上）' });

  const result = db.prepare(`
    INSERT INTO sukuukun_sources (title, content, source_type, char_count)
    VALUES (?, ?, 'text', ?)
  `).run(title.trim(), content.trim(), content.trim().length);

  const row = db.prepare('SELECT * FROM sukuukun_sources WHERE id = ?').get(result.lastInsertRowid);
  res.json(row);
});

// POST /api/sukuukun/sources/pdf — PDFアップロード
router.post('/sources/pdf', authenticateToken, upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDFファイルが必要です' });

  const title = (req.body.title || req.file.originalname.replace(/\.pdf$/i, '')).trim();

  try {
    // pdf-parse でテキスト抽出
    const pdfParse = require('pdf-parse');
    const parsed = await pdfParse(req.file.buffer);
    const content = parsed.text.trim();

    if (content.length < 10) {
      return res.status(422).json({ error: 'PDFからテキストを抽出できませんでした（スキャンPDFは非対応）' });
    }

    const result = db.prepare(`
      INSERT INTO sukuukun_sources (title, content, source_type, file_name, char_count)
      VALUES (?, ?, 'pdf', ?, ?)
    `).run(title, content, req.file.originalname, content.length);

    const row = db.prepare('SELECT * FROM sukuukun_sources WHERE id = ?').get(result.lastInsertRowid);
    res.json({ ...row, pages: parsed.numpages });
  } catch (err) {
    console.error('[sukuukun] PDF parse error:', err);
    res.status(500).json({ error: 'PDF解析エラー: ' + err.message });
  }
});

// PUT /api/sukuukun/sources/:id — ソース編集（タイトル・内容）
router.put('/sources/:id', authenticateToken, (req, res) => {
  const { title, content } = req.body;
  const row = db.prepare('SELECT * FROM sukuukun_sources WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ソースが見つかりません' });

  const newTitle   = (title   !== undefined ? title.trim()   : row.title);
  const newContent = (content !== undefined ? content.trim() : row.content);

  db.prepare(`
    UPDATE sukuukun_sources
    SET title = ?, content = ?, char_count = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(newTitle, newContent, newContent.length, row.id);

  const updated = db.prepare('SELECT * FROM sukuukun_sources WHERE id = ?').get(row.id);
  res.json(updated);
});

// DELETE /api/sukuukun/sources/:id — ソース削除
router.delete('/sources/:id', authenticateToken, (req, res) => {
  const row = db.prepare('SELECT id FROM sukuukun_sources WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ソースが見つかりません' });
  db.prepare('DELETE FROM sukuukun_sources WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ============================================================
// 採点評価
// ============================================================

// POST /api/sukuukun/evaluate
// body: { transcript, applicantName }
router.post('/evaluate', authenticateToken, async (req, res) => {
  const { transcript, applicantName } = req.body;

  if (!transcript || transcript.trim().length < 50) {
    return res.status(400).json({ error: '文字起こしテキストが短すぎます（50文字以上必要）' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY が設定されていません' });
  }

  // 全ソースを読み込んでシステムプロンプトに組み込む
  const sources = db.prepare('SELECT title, content FROM sukuukun_sources ORDER BY created_at ASC').all();
  const systemPrompt = buildSystemPrompt(sources);

  const userMessage = applicantName
    ? `以下は「${applicantName}」さんとの面接（セールス）の文字起こしです。採点・評価してください。\n\n---\n${transcript.trim()}\n---`
    : `以下は面接（セールス）の文字起こしです。採点・評価してください。\n\n---\n${transcript.trim()}\n---`;

  try {
    const result = await callGemini(systemPrompt, userMessage, apiKey);

    if (result.status !== 200) {
      const errMsg = result.body?.error?.message || JSON.stringify(result.body).slice(0, 300);
      return res.status(502).json({ error: `Gemini APIエラー (${result.status}): ${errMsg}` });
    }

    const rawText = result.body?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let evaluation;
    try {
      const cleaned = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      evaluation = JSON.parse(cleaned);
    } catch (e) {
      return res.json({ raw: rawText, parseError: true });
    }

    // 採点履歴を保存
    try {
      const user = req.user;
      db.prepare(`
        INSERT INTO sukuukun_evaluations
          (applicant_name, evaluator_id, evaluator_name, transcript_length, total_score, result_json, source_snapshot)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        applicantName || null,
        user?.id || null,
        user?.name || null,
        transcript.trim().length,
        evaluation.total_score || 0,
        JSON.stringify(evaluation),
        JSON.stringify(sources.map(s => ({ id: s.id, title: s.title })))
      );
    } catch (e) {
      // 履歴保存失敗は無視（評価結果は返す）
      console.warn('[sukuukun] history save failed:', e.message);
    }

    res.json({ ...evaluation, sourceCount: sources.length });
  } catch (err) {
    console.error('[sukuukun] evaluate error:', err);
    res.status(500).json({ error: 'すくう君の評価中にエラーが発生しました: ' + err.message });
  }
});

// ============================================================
// 採点履歴
// ============================================================

// GET /api/sukuukun/history
router.get('/history', authenticateToken, (req, res) => {
  const rows = db.prepare(`
    SELECT id, applicant_name, evaluator_name, transcript_length,
           total_score, source_snapshot, created_at
    FROM sukuukun_evaluations
    ORDER BY created_at DESC
    LIMIT 50
  `).all();
  res.json(rows);
});

// GET /api/sukuukun/history/:id — 履歴詳細
router.get('/history/:id', authenticateToken, (req, res) => {
  const row = db.prepare('SELECT * FROM sukuukun_evaluations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '履歴が見つかりません' });
  try { row.result_json = JSON.parse(row.result_json); } catch (e) {}
  try { row.source_snapshot = JSON.parse(row.source_snapshot); } catch (e) {}
  res.json(row);
});

module.exports = router;
