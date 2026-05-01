const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

// ============================================================
// すくう君 — Gemini API を使った営業トーク採点・評価
// ============================================================

// セールストーク評価用システムプロンプト
const SYSTEM_PROMPT = `あなたは「すくう君」というVtuber営業専門のAIコーチです。
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
    "rapport": { "score": <点数>, "good": "<良かった点>", "improve": "<改善点>" },
    "hearing": { "score": <点数>, "good": "<良かった点>", "improve": "<改善点>" },
    "value_proposal": { "score": <点数>, "good": "<良かった点>", "improve": "<改善点>" },
    "closing": { "score": <点数>, "good": "<良かった点>", "improve": "<改善点>" },
    "overall_flow": { "score": <点数>, "good": "<良かった点>", "improve": "<改善点>" }
  },
  "summary": "<総合コメント>",
  "highlights": ["<印象的な発言や場面1>", "<印象的な発言や場面2>"]
}`;

// POST /api/sukuukun/evaluate
// body: { transcript: string, applicantName: string }
router.post('/evaluate', authenticateToken, async (req, res) => {
  const { transcript, applicantName } = req.body;

  if (!transcript || transcript.trim().length < 50) {
    return res.status(400).json({ error: '文字起こしテキストが短すぎます（50文字以上必要）' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY が設定されていません。Render の環境変数に追加してください。' });
  }

  const userMessage = applicantName
    ? `以下は「${applicantName}」さんとの面接（セールス）の文字起こしです。採点・評価してください。\n\n---\n${transcript}\n---`
    : `以下は面接（セールス）の文字起こしです。採点・評価してください。\n\n---\n${transcript}\n---`;

  try {
    const fetch = (...args) => import('node-fetch').then(m => m.default(...args)).catch(() => {
      // node-fetch が無い場合は https モジュールで代替
      return null;
    });

    // Gemini 1.5 Flash API（無料枠あり）
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const payload = {
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userMessage }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json'
      }
    };

    // https モジュールを使用（node-fetch 不要）
    const https = require('https');
    const url = new URL(endpoint);

    const result = await new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify(payload);
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        }
      };

      const reqHttp = https.request(options, (resp) => {
        let data = '';
        resp.on('data', chunk => { data += chunk; });
        resp.on('end', () => {
          try {
            resolve({ status: resp.statusCode, body: JSON.parse(data) });
          } catch (e) {
            reject(new Error('Gemini APIレスポンスのJSONパース失敗: ' + data.slice(0, 200)));
          }
        });
      });
      reqHttp.on('error', reject);
      reqHttp.write(bodyStr);
      reqHttp.end();
    });

    if (result.status !== 200) {
      const errMsg = result.body?.error?.message || JSON.stringify(result.body).slice(0, 300);
      return res.status(502).json({ error: `Gemini APIエラー (${result.status}): ${errMsg}` });
    }

    // レスポンス抽出
    const candidate = result.body?.candidates?.[0];
    const rawText = candidate?.content?.parts?.[0]?.text || '';

    let evaluation;
    try {
      // JSONブロック内のテキストを抽出（```json ... ``` を除去）
      const cleaned = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
      evaluation = JSON.parse(cleaned);
    } catch (e) {
      // JSON解析失敗時はそのまま返す
      return res.json({ raw: rawText, parseError: true });
    }

    res.json(evaluation);
  } catch (err) {
    console.error('[sukuukun] evaluate error:', err);
    res.status(500).json({ error: 'すくう君の評価中にエラーが発生しました: ' + err.message });
  }
});

module.exports = router;
