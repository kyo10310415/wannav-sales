const express = require('express');
const router  = express.Router();
const https   = require('https');
const { authenticateToken } = require('../middleware/auth');

// ============================================================
// One Loop GraphQL プロキシ
// ============================================================

const ONE_LOOP_ENDPOINT = 'https://one-loop-staging.n2jk-apps.com/admin/graphql';
const ONE_LOOP_TOKEN    = '6e85da826398fffa9f40d26ca91c8f9798f1239246eb2c58b5f7af9a56c81535';

/**
 * GraphQL クエリを One Loop に送信して結果を返すヘルパー
 */
function queryOneLoop(query, variables) {
  return new Promise((resolve, reject) => {
    const url     = new URL(ONE_LOOP_ENDPOINT);
    const payload = JSON.stringify({ query, variables: variables || {} });

    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${ONE_LOOP_TOKEN}`,
      },
    };

    const req = https.request(options, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        try {
          resolve({ status: resp.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (e) {
          reject(new Error('One Loop レスポンスのJSONパース失敗'));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// One Loop GraphQL の複雑度上限: 300
// フィールド数(10) × first で計算されるため first=20 が実質上限
const ONELOOP_PAGE_SIZE = 20;

// ============================================================
// GET /api/oneloop/applicants
//   ?all=true    全件取得（ページネーションを自動で繰り返す、デフォルト true）
//   ?after=xxx   単一ページ取得時のカーソル（all=false のときのみ有効）
//   ?source=xxx  流入経路フィルタ（省略時: 全件）
// ============================================================
router.get('/applicants', authenticateToken, async (req, res) => {
  const fetchAll = req.query.all !== 'false'; // デフォルト true
  const after    = req.query.after  || null;
  const source   = req.query.source || null;

  const query = `
    query GetApplicants($first: Int!, $after: String) {
      applicants(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            firstName
            lastName
            email
            phone
            source
            customFields
            createdAt
            updatedAt
          }
        }
      }
    }
  `;

  try {
    let allNodes   = [];
    let cursor     = after;
    let pageInfo   = {};
    const MAX_PAGES = 50; // 無限ループ防止（最大 50 × 20 = 1000件）

    for (let page = 0; page < MAX_PAGES; page++) {
      const variables = { first: ONELOOP_PAGE_SIZE, after: cursor || null };
      const result    = await queryOneLoop(query, variables);

      if (result.status !== 200) {
        return res.status(502).json({ error: `One Loop API エラー (${result.status})` });
      }
      if (result.body.errors) {
        return res.status(400).json({ error: result.body.errors.map(e => e.message).join(', ') });
      }

      const conn  = result.body.data?.applicants || {};
      const nodes = (conn.edges || []).map(e => e.node);
      pageInfo    = conn.pageInfo || {};

      allNodes = allNodes.concat(nodes);

      // 全件取得モードでなければ1ページで終了
      if (!fetchAll) break;
      // 次ページがなければ終了
      if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;

      cursor = pageInfo.endCursor;
    }

    // source フィルタ（サーバー側で絞り込み）
    if (source) {
      allNodes = allNodes.filter(n => n.source === source);
    }

    res.json({
      applicants: allNodes,
      pageInfo:   fetchAll ? { hasNextPage: false } : pageInfo,
      total:      allNodes.length,
    });
  } catch (err) {
    console.error('[oneloop] applicants error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/oneloop/graphql
//   汎用 GraphQL プロキシ（テストページ用）
//   body: { query: string, variables?: object }
// ============================================================
router.post('/graphql', authenticateToken, async (req, res) => {
  const { query, variables } = req.body;
  if (!query) return res.status(400).json({ error: 'query は必須です' });

  try {
    const result = await queryOneLoop(query, variables);
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[oneloop] graphql proxy error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
