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

// gemini-2.5-flash はthinkingモデルのため parts[] に thought:true のpartが混在する場合がある。
// 実際のテキスト出力（thought でないpart）を確実に取得するヘルパー。
function extractGeminiText(body) {
  const parts = body?.candidates?.[0]?.content?.parts || [];
  // thought:true でないpartのテキストを結合（通常は1件）
  const textParts = parts.filter(p => !p.thought).map(p => p.text || '');
  return textParts.join('') || '';
}

function callGemini(systemPrompt, userMessage, apiKey) {
  return new Promise((resolve, reject) => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const url = new URL(endpoint);

    const payload = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 65536,
        // responseMimeType を指定しない → テキスト出力でJSONを抽出する
        // （application/json 指定だと長文のtemplate_outputが途中で切れる問題が発生）
        // thinkingBudget=0 でthinkingを無効化（高速化・トークン節約）
        thinkingConfig: { thinkingBudget: 0 }
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
      const chunks = [];
      resp.on('data', chunk => { chunks.push(chunk); });
      resp.on('end', () => {
        try {
          const data = Buffer.concat(chunks).toString('utf8');
          resolve({ status: resp.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error('Gemini APIレスポンスのJSONパース失敗'));
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

// タイトルまたは内容の先頭行に「【出力テンプレート】」を含むソースを
// テンプレートソースと判定する。
function isTemplateSource(s) {
  const titleMatch = s.title.includes('【出力テンプレート】');
  const contentMatch = s.content.trimStart().startsWith('【出力テンプレート】');
  return titleMatch || contentMatch;
}

// テンプレートソースからテンプレート本文を取り出す
// 「【出力テンプレート】」という行自体は除き、それ以降の文字列を返す
function extractTemplateBody(s) {
  const lines = s.content.split('\n');
  // 「【出力テンプレート】」の行を探してそれ以降を返す
  const idx = lines.findIndex(l => l.trim() === '【出力テンプレート】');
  if (idx !== -1) {
    return lines.slice(idx + 1).join('\n').trim();
  }
  // タイトルがテンプレート判定の場合はそのまま全文を返す
  return s.content.trim();
}

const DEFAULT_TEMPLATE = `【セールス採点】
総合評価
〇点/100点

・加点ポイント / 減点ポイント
（ここに加点・減点の具体的な内容を記述）

・改善できた点
（ここに改善点を記述）

【トークスクリプト】
• 一致度：〇%
• オリジナリティ：〇%

【応募者様の人物像】
理想のターゲット像との一致率：〇%
• 月収：
• お住まい：
• ご年齢：
• 職業：
• セールス結果を加味しない場合の応募者層：

【要因分析】
（ここに今回のセールス結果の要因を詳しく分析して記述）`;

function buildSystemPrompt(sources) {
  // ソースをテンプレートソースと参考資料ソースに分類
  const templateSources = (sources || []).filter(isTemplateSource);
  const refSources      = (sources || []).filter(s => !isTemplateSource(s));

  // 使用するテンプレート：ソース登録済みなら最新のものを使用、なければデフォルト
  // テンプレートソースが複数ある場合は最初の1件（created_at DESC で取得済みなので先頭が最新）
  const activeTemplate = templateSources.length > 0
    ? extractTemplateBody(templateSources[0])
    : DEFAULT_TEMPLATE;

  const prompt = `あなたは「すくう君」というVtuber営業専門のAIコーチです。
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

【出力フォーマット - 厳守】
必ず以下のJSON形式のみで返答してください。JSONの前後に説明文・マークダウン・コードブロックを一切付けないこと。

"template_output" フィールドには、必ず下記【出力テンプレート】を**そのまま**使い、
〇や（説明文）を実際の値・文章で埋めた文字列を入れてください。
改行は \\n で表現し、テンプレート内の記号（•、・）もそのまま含めてください。

【出力テンプレート】
${activeTemplate}

---

出力するJSONの構造：
{
  "total_score": <合計点(整数)>,
  "scores": {
    "rapport":        { "score": <0〜20の整数>, "good": "<良かった点>", "improve": "<改善点>" },
    "hearing":        { "score": <0〜20の整数>, "good": "<良かった点>", "improve": "<改善点>" },
    "value_proposal": { "score": <0〜20の整数>, "good": "<良かった点>", "improve": "<改善点>" },
    "closing":        { "score": <0〜20の整数>, "good": "<良かった点>", "improve": "<改善点>" },
    "overall_flow":   { "score": <0〜20の整数>, "good": "<良かった点>", "improve": "<改善点>" }
  },
  "summary": "<総合コメント(200字程度)>",
  "highlights": ["<印象的な発言や場面1>", "<印象的な発言や場面2>"],
  "template_output": "<【出力テンプレート】を実際の値で埋めた文字列。改行は\\nで表現>"
}`;

  if (refSources.length === 0) return prompt;

  const sourcesText = refSources.map((s, i) =>
    `=== ソース${i + 1}: ${s.title} ===\n${s.content}`
  ).join('\n\n');

  return `${prompt}

【評価の参考資料（セールストークスクリプト・指示書）】
以下の資料を参考にして、より具体的・詳細に評価してください。
資料の内容と実際のトークを照合し、正しいセールスフローに沿っているかも確認してください。
また、トークスクリプトとの一致度・オリジナリティの推定にも使用してください。

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
// body: { transcript, applicantName, applicantKey, interviewerId, interviewerName, interviewResult }
router.post('/evaluate', authenticateToken, async (req, res) => {
  const { transcript, applicantName, applicantKey, interviewerId, interviewerName, interviewResult } = req.body;

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

  let headerParts = [];
  if (applicantName) headerParts.push(`応募者：${applicantName}`);
  if (interviewerName) headerParts.push(`面接担当：${interviewerName}`);
  if (interviewResult) headerParts.push(`面接結果：${interviewResult}`);
  const header = headerParts.length ? headerParts.join('　') + '\n\n' : '';

  const userMessage = `${header}以下は面接（セールス）の文字起こしです。採点・評価してください。\n\n---\n${transcript.trim()}\n---`;

  try {
    const result = await callGemini(systemPrompt, userMessage, apiKey);

    if (result.status !== 200) {
      const errMsg = result.body?.error?.message || JSON.stringify(result.body).slice(0, 300);
      return res.status(502).json({ error: `Gemini APIエラー (${result.status}): ${errMsg}` });
    }

    const rawText = extractGeminiText(result.body);

    let evaluation;
    try {
      // コードブロック（```json ... ``` や ``` ... ```）を除去してパース
      let cleaned = rawText.trim();
      // 先頭の ```json または ``` を除去
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
      // 末尾の ``` を除去
      cleaned = cleaned.replace(/\s*```\s*$/i, '');
      // JSONオブジェクトの開始 { を探して先頭のゴミを除去
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd   = cleaned.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('JSON object not found');
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
      evaluation = JSON.parse(cleaned);
    } catch (e) {
      // パース失敗時は生テキストを返す（フロントで表示）
      return res.json({ raw: rawText, parseError: true });
    }

    // 採点履歴を保存
    try {
      const user = req.user;
      db.prepare(`
        INSERT INTO sukuukun_evaluations
          (applicant_name, applicant_key, evaluator_id, evaluator_name,
           interviewer_id, interviewer_name, interview_result,
           transcript_length, total_score, result_json, source_snapshot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        applicantName || null,
        applicantKey  || null,
        user?.id || null,
        user?.name || null,
        interviewerId || null,
        interviewerName || null,
        interviewResult || null,
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
// query params: interviewer_id (任意: 担当者IDでフィルタ)
router.get('/history', authenticateToken, (req, res) => {
  const { interviewer_id } = req.query;
  let sql = `
    SELECT id, applicant_name, evaluator_name,
           interviewer_id, interviewer_name, interview_result,
           transcript_length, total_score, source_snapshot, created_at
    FROM sukuukun_evaluations
  `;
  const params = [];
  if (interviewer_id) {
    sql += ' WHERE interviewer_id = ?';
    params.push(Number(interviewer_id));
  }
  sql += ' ORDER BY created_at DESC LIMIT 50';
  const rows = db.prepare(sql).all(...params);
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

// DELETE /api/sukuukun/history/:id — 採点履歴削除
router.delete('/history/:id', authenticateToken, (req, res) => {
  const row = db.prepare('SELECT id FROM sukuukun_evaluations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '履歴が見つかりません' });
  db.prepare('DELETE FROM sukuukun_evaluations WHERE id = ?').run(req.params.id);
  res.json({ message: '削除しました' });
});

// DELETE /api/sukuukun/speech/:id — 発話分析履歴削除
router.delete('/speech/:id', authenticateToken, (req, res) => {
  const row = db.prepare('SELECT id FROM sukuukun_speech_analyses WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '発話分析が見つかりません' });
  db.prepare('DELETE FROM sukuukun_speech_analyses WHERE id = ?').run(req.params.id);
  res.json({ message: '削除しました' });
});

// ============================================================
// 発話比率分析
// POST /api/sukuukun/analyze-speech
// body: { transcript, metrics }
//   transcript : 文字起こし全文
//   metrics    : フロントで算出した数値メトリクス（JSON）
// ============================================================
router.post('/analyze-speech', authenticateToken, async (req, res) => {
  const { transcript, metrics } = req.body;
  if (!transcript || transcript.trim().length < 50) {
    return res.status(400).json({ error: '文字起こしテキストが短すぎます（50文字以上必要）' });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY が設定されていません' });
  }

  const metricsText = metrics ? JSON.stringify(metrics, null, 2) : '（メトリクスなし）';

  const systemPrompt = `あなたはVtuber営業専門のセールスコーチです。
面接・セールスの文字起こしと発話メトリクスを受け取り、
**この会話固有の内容・流れ・発言に基づいた**感情シグナル推定と改善アドバイスを行ってください。

【分析方針 — 重要】
- 一般論・テンプレート的なアドバイスは禁止。必ず会話の具体的な発言・場面を引用して分析すること。
- 発話比率が高い/低いという事実だけでなく、「なぜその状況が生まれたか」を会話内容から読み取ること。
- 感情シグナルは応募者の発言トーン・語彙・沈黙パターンから推定し、根拠となる発言を示すこと。
- アドバイスは「次回この担当者がとるべき具体的なアクション」として、この会話で見えた課題に直結させること。
- ティーチングやスクリプト遵守の一般的な言及は避けること。

【出力フォーマット — 厳守】
必ず以下の JSON 形式のみで返答してください。JSONの前後に説明文・マークダウン・コードブロックを付けないこと。

{
  "emotions": {
    "confusion":  <0〜100の整数: 困惑度推定>,
    "stress":     <0〜100の整数: ストレス推定>,
    "positive":   <0〜100の整数: ポジティブ度推定>
  },
  "emotion_notes": {
    "confusion_reason":  "<困惑の根拠：会話の具体的な発言・場面を引用（60文字以内）>",
    "stress_reason":     "<ストレスの根拠：会話の具体的な発言・場面を引用（60文字以内）>",
    "positive_reason":   "<ポジティブの根拠：会話の具体的な発言・場面を引用（60文字以内）>"
  },
  "advice": "<この会話固有の課題・強みを踏まえた具体的な改善アドバイス（200〜500文字）。必ず実際の発言を引用すること>",
  "actions": [
    "<この会話で見えた課題への具体的なアクション1（次回すぐ実践できるレベルで、50文字以内）>",
    "<この会話で見えた課題への具体的なアクション2（50文字以内）>",
    "<この会話で見えた課題への具体的なアクション3（50文字以内）>"
  ]
}`;

  const userMessage = `【発話メトリクス】\n${metricsText}\n\n【文字起こし（抜粋）】\n${transcript.trim().slice(0, 6000)}`;

  try {
    const result = await callGemini(systemPrompt, userMessage, apiKey);

    if (result.status !== 200) {
      const errMsg = result.body?.error?.message || JSON.stringify(result.body).slice(0, 300);
      return res.status(502).json({ error: `Gemini APIエラー (${result.status}): ${errMsg}` });
    }

    const rawText = extractGeminiText(result.body);

    let parsed;
    try {
      let cleaned = rawText.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '');
      const s = cleaned.indexOf('{');
      const e = cleaned.lastIndexOf('}');
      if (s === -1 || e === -1) throw new Error('JSON not found');
      parsed = JSON.parse(cleaned.slice(s, e + 1));
    } catch (e) {
      return res.json({ raw: rawText, parseError: true });
    }

    // ── 結果をDBに保存 ──────────────────────────────────────────
    const { interviewer_id, interviewer_name, applicant_name, applicant_key, analyzed_at } = req.body;
    const sr = metrics?.speech_ratio || {};
    const mo = metrics?.monologue    || {};
    const ae = metrics?.applicant_engagement || {};
    const intr = metrics?.interruptions || {};
    const em   = parsed.emotions || {};

    try {
      db.prepare(`
        INSERT INTO sukuukun_speech_analyses (
          interviewer_id, interviewer_name, applicant_name, applicant_key, analyzed_at,
          sales_ratio, applicant_ratio, sales_chars, applicant_chars,
          max_monologue_sec, mono_3min_count, mono_5min_count,
          applicant_turn_count, silence_over_15s,
          sales_interrupts, applicant_interrupts,
          emotion_confusion, emotion_stress, emotion_positive,
          advice, actions, transcript_length
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        interviewer_id   || null,
        interviewer_name || null,
        applicant_name   || null,
        applicant_key    || null,
        analyzed_at      || new Date().toISOString(),
        sr.sales_ratio     ?? null,
        sr.applicant_ratio ?? null,
        sr.sales_chars     ?? null,
        sr.applicant_chars ?? null,
        mo.max_sec          ?? null,
        mo.over_3min_count  ?? null,
        mo.over_5min_count  ?? null,
        ae.turn_count        ?? null,
        ae.silence_over_15s  ?? null,
        intr.sales_to_applicant    ?? null,
        intr.applicant_to_sales    ?? null,
        em.confusion ?? null,
        em.stress    ?? null,
        em.positive  ?? null,
        parsed.advice || null,
        parsed.actions ? JSON.stringify(parsed.actions) : null,
        transcript.trim().length
      );
    } catch (saveErr) {
      // 保存失敗は握りつぶして結果だけ返す（ログのみ）
      console.error('[sukuukun] speech-analysis save error:', saveErr);
    }

    res.json(parsed);
  } catch (err) {
    console.error('[sukuukun] analyze-speech error:', err);
    res.status(500).json({ error: '発話分析中にエラーが発生しました: ' + err.message });
  }
});

// ============================================================
// 発話比率集計
// GET /api/sukuukun/speech-stats
//   ?month=YYYY-MM  (省略時: 今月)
// ============================================================
router.get('/speech-stats', authenticateToken, async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7); // 'YYYY-MM'

    // 月の開始・終了
    const from = `${month}-01`;
    const to   = `${month}-31`; // SQLite は BETWEEN で超えても翌月以降を除外できる

    // 担当者別の集計
    const rows = db.prepare(`
      SELECT
        COALESCE(interviewer_id, -1)    AS interviewer_id,
        COALESCE(interviewer_name, '不明') AS interviewer_name,
        COUNT(*)                         AS analysis_count,
        ROUND(AVG(sales_ratio), 1)       AS avg_sales_ratio,
        ROUND(AVG(applicant_ratio), 1)   AS avg_applicant_ratio,
        ROUND(AVG(max_monologue_sec), 0) AS avg_max_monologue_sec,
        SUM(mono_3min_count)             AS total_mono_3min,
        SUM(mono_5min_count)             AS total_mono_5min,
        ROUND(AVG(applicant_turn_count), 1) AS avg_applicant_turns,
        SUM(silence_over_15s)            AS total_silence,
        SUM(sales_interrupts)            AS total_sales_interrupts,
        SUM(applicant_interrupts)        AS total_applicant_interrupts,
        ROUND(AVG(emotion_confusion), 1) AS avg_confusion,
        ROUND(AVG(emotion_stress), 1)    AS avg_stress,
        ROUND(AVG(emotion_positive), 1)  AS avg_positive
      FROM sukuukun_speech_analyses
      WHERE DATE(analyzed_at) BETWEEN ? AND ?
      GROUP BY interviewer_id, interviewer_name
      ORDER BY analysis_count DESC
    `).all(from, to);

    res.json({ month, rows });
  } catch (err) {
    console.error('[sukuukun] speech-stats error:', err);
    res.status(500).json({ error: '集計中にエラーが発生しました: ' + err.message });
  }
});

// ============================================================
// 発話比率集計 詳細（担当者×月）
// GET /api/sukuukun/speech-stats/detail
//   ?month=YYYY-MM&interviewer_id=N
// ============================================================
router.get('/speech-stats/detail', authenticateToken, async (req, res) => {
  try {
    const month          = req.query.month || new Date().toISOString().slice(0, 7);
    const interviewer_id = req.query.interviewer_id;

    const from = `${month}-01`;
    const to   = `${month}-31`;

    let query = `
      SELECT
        id, interviewer_name, applicant_name,
        analyzed_at, sales_ratio, applicant_ratio,
        max_monologue_sec, mono_3min_count, mono_5min_count,
        applicant_turn_count, silence_over_15s,
        sales_interrupts, applicant_interrupts,
        emotion_confusion, emotion_stress, emotion_positive,
        advice, actions, transcript_length, created_at
      FROM sukuukun_speech_analyses
      WHERE DATE(analyzed_at) BETWEEN ? AND ?
    `;
    const params = [from, to];

    if (interviewer_id) {
      query += ' AND interviewer_id = ?';
      params.push(Number(interviewer_id));
    }
    query += ' ORDER BY analyzed_at DESC';

    const rows = db.prepare(query).all(...params);

    // actions は JSON 文字列→配列にパース
    rows.forEach(r => {
      try { r.actions = JSON.parse(r.actions); } catch (e) { r.actions = []; }
    });

    res.json({ month, interviewer_id: interviewer_id || null, rows });
  } catch (err) {
    console.error('[sukuukun] speech-stats/detail error:', err);
    res.status(500).json({ error: '詳細取得中にエラーが発生しました: ' + err.message });
  }
});

// ============================================================
// 利用可能な年月一覧
// GET /api/sukuukun/speech-stats/months
// ============================================================
router.get('/speech-stats/months', authenticateToken, async (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT DISTINCT SUBSTR(analyzed_at, 1, 7) AS month
      FROM sukuukun_speech_analyses
      ORDER BY month DESC
    `).all();
    res.json(rows.map(r => r.month));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 応募者別すくう君結果取得
// GET /api/sukuukun/by-applicant/:key
// :key は encodeURIComponent された applicant_key
// 採点履歴（最新10件）＋発話比率履歴（最新10件）を返す
// ============================================================
router.get('/by-applicant/:key', authenticateToken, (req, res) => {
  const applicantKey = decodeURIComponent(req.params.key);
  if (!applicantKey) return res.status(400).json({ error: '応募者キーが必要です' });

  // 採点履歴
  const evaluations = db.prepare(`
    SELECT id, applicant_name, evaluator_name,
           interviewer_id, interviewer_name, interview_result,
           transcript_length, total_score, created_at
    FROM sukuukun_evaluations
    WHERE applicant_key = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(applicantKey);

  // 発話比率履歴
  const speeches = db.prepare(`
    SELECT id, interviewer_name, applicant_name, analyzed_at,
           sales_ratio, applicant_ratio,
           max_monologue_sec, mono_3min_count, mono_5min_count,
           applicant_turn_count, silence_over_15s,
           sales_interrupts, applicant_interrupts,
           emotion_confusion, emotion_stress, emotion_positive,
           advice, actions, transcript_length, created_at
    FROM sukuukun_speech_analyses
    WHERE applicant_key = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(applicantKey);

  // actions を JSON → 配列にパース
  speeches.forEach(r => {
    try { r.actions = JSON.parse(r.actions); } catch (e) { r.actions = []; }
  });

  res.json({ applicant_key: applicantKey, evaluations, speeches });
});

// ============================================================
// 採点履歴詳細（result_json付き）
// GET /api/sukuukun/history/:id  — 既存エンドポイント流用可
// ============================================================

module.exports = router;
