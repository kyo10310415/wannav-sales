'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { authenticateToken } = require('../middleware/auth');

// ============================================================
// Notion プロパティ値を安全に取り出すユーティリティ
// ============================================================
function extractPropValue(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':
      return prop.title.map(t => t.plain_text).join('') || null;
    case 'rich_text':
      return prop.rich_text.map(t => t.plain_text).join('') || null;
    case 'number':
      return prop.number !== null ? String(prop.number) : null;
    case 'select':
      return prop.select?.name || null;
    case 'multi_select':
      return prop.multi_select.map(s => s.name).join(', ') || null;
    case 'date':
      return prop.date?.start || null;
    case 'checkbox':
      return prop.checkbox ? 'あり' : 'なし';
    case 'url':
      return prop.url || null;
    case 'email':
      return prop.email || null;
    case 'phone_number':
      return prop.phone_number || null;
    case 'formula':
      return extractPropValue(prop.formula);
    case 'string':
      return prop.string || null;
    default:
      return null;
  }
}

// Notionページ1件のプロパティをDBカラムにマッピング
function mapPageToRecord(page) {
  const p = page.properties;
  const g = name => extractPropValue(p[name]);
  return {
    notion_page_id:            page.id,
    gender:                    g('性別'),
    birth_date:                g('生年月日'),
    final_education:           g('最終学歴'),
    current_job:               g('現職'),
    job_type:                  g('職種'),
    monthly_income:            g('月収（全桁記入）'),
    disposable_income:         g('可処分所得（全桁記入）'),
    savings:                   g('貯蓄（全桁記入）'),
    debt:                      g('借金（全桁記入）'),
    has_card:                  g('カード有無'),
    work_history:              g('職歴'),
    part_time_history:         g('バイト歴'),
    prefecture:                g('お住まいの都道府県'),
    cohabitants:               g('同居人'),
    has_partner:               g('パートナーの有無'),
    partner_understanding:     g('パートナー理解'),
    sales_classification:      g('Sales3分類'),
    has_streaming_experience:  g('配信経験の有無'),
    streaming_history:         g('配信歴'),
    streaming_equipment:       g('配信機材の状況'),
    motivation:                g('志望動機'),
    company_reason:            g('企業が良い理由'),
    contribution:              g('貢献できること'),
    vtuber_effort:             g('VTuberの努力'),
    other_auditions:           g('他のオーディション応募'),
    desired_streaming:         g('やってみたい配信'),
    vtuber_passion:            g('VTuberへの熱量%'),
    medical_history:           g('病歴'),
    raw_json:                  JSON.stringify(p),
    synced_at:                 new Date().toISOString(),
  };
}

// ============================================================
// Notion DBから全ページを取得してDBに保存
// ============================================================
async function syncNotionProfiles() {
  const apiKey  = process.env.NOTION_API_KEY;
  const dbId    = process.env.NOTION_DATABASE_ID;
  if (!apiKey || !dbId) {
    throw new Error('NOTION_API_KEY または NOTION_DATABASE_ID が設定されていません');
  }

  // @notionhq/client は ESM のみのため fetch で直接呼ぶ
  let allPages = [];
  let cursor   = undefined;

  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const resp = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method:  'POST',
      headers: {
        'Authorization':  `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type':   'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Notion API error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    allPages = allPages.concat(data.results || []);
    cursor   = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  // 学籍番号プロパティ名の候補（どちらかに存在する）
  const STUDENT_NUM_KEYS = ['学籍番号', '学籍番号 '];

  const upsert = db.prepare(`
    INSERT INTO notion_profiles
      (student_number, notion_page_id, gender, birth_date, final_education,
       current_job, job_type, monthly_income, disposable_income,
       savings, debt, has_card, work_history, part_time_history,
       prefecture, cohabitants, has_partner, partner_understanding,
       sales_classification, has_streaming_experience, streaming_history,
       streaming_equipment, motivation, company_reason, contribution,
       vtuber_effort, other_auditions, desired_streaming, vtuber_passion,
       medical_history, raw_json, synced_at)
    VALUES
      (@student_number, @notion_page_id, @gender, @birth_date, @final_education,
       @current_job, @job_type, @monthly_income, @disposable_income,
       @savings, @debt, @has_card, @work_history, @part_time_history,
       @prefecture, @cohabitants, @has_partner, @partner_understanding,
       @sales_classification, @has_streaming_experience, @streaming_history,
       @streaming_equipment, @motivation, @company_reason, @contribution,
       @vtuber_effort, @other_auditions, @desired_streaming, @vtuber_passion,
       @medical_history, @raw_json, @synced_at)
    ON CONFLICT(student_number) DO UPDATE SET
      notion_page_id           = excluded.notion_page_id,
      gender                   = excluded.gender,
      birth_date               = excluded.birth_date,
      final_education          = excluded.final_education,
      current_job              = excluded.current_job,
      job_type                 = excluded.job_type,
      monthly_income           = excluded.monthly_income,
      disposable_income        = excluded.disposable_income,
      savings                  = excluded.savings,
      debt                     = excluded.debt,
      has_card                 = excluded.has_card,
      work_history             = excluded.work_history,
      part_time_history        = excluded.part_time_history,
      prefecture               = excluded.prefecture,
      cohabitants              = excluded.cohabitants,
      has_partner              = excluded.has_partner,
      partner_understanding    = excluded.partner_understanding,
      sales_classification     = excluded.sales_classification,
      has_streaming_experience = excluded.has_streaming_experience,
      streaming_history        = excluded.streaming_history,
      streaming_equipment      = excluded.streaming_equipment,
      motivation               = excluded.motivation,
      company_reason           = excluded.company_reason,
      contribution             = excluded.contribution,
      vtuber_effort            = excluded.vtuber_effort,
      other_auditions          = excluded.other_auditions,
      desired_streaming        = excluded.desired_streaming,
      vtuber_passion           = excluded.vtuber_passion,
      medical_history          = excluded.medical_history,
      raw_json                 = excluded.raw_json,
      synced_at                = excluded.synced_at
  `);

  const syncAll = db.transaction((pages) => {
    let saved = 0;
    for (const page of pages) {
      // 学籍番号を取得
      let studentNum = null;
      for (const key of STUDENT_NUM_KEYS) {
        const val = extractPropValue(page.properties[key]);
        if (val && val.trim()) { studentNum = val.trim(); break; }
      }
      if (!studentNum) continue; // 学籍番号なしはスキップ

      const record = mapPageToRecord(page);
      record.student_number = studentNum;
      upsert.run(record);
      saved++;
    }
    return saved;
  });

  const saved = syncAll(allPages);
  console.log(`[NotionSync] ${allPages.length}件取得 / ${saved}件保存 at ${new Date().toISOString()}`);
  return { total: allPages.length, saved };
}

// ============================================================
// GET /api/notion/profiles  全件一覧
// ============================================================
router.get('/profiles', authenticateToken, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM notion_profiles ORDER BY student_number ASC'
  ).all();
  res.json(rows);
});

// ============================================================
// GET /api/notion/profiles/:studentNumber  1件取得
// ============================================================
router.get('/profiles/:studentNumber', authenticateToken, (req, res) => {
  const row = db.prepare(
    'SELECT * FROM notion_profiles WHERE student_number = ?'
  ).get(req.params.studentNumber);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// ============================================================
// POST /api/notion/sync  手動同期（admin only）
// ============================================================
router.post('/sync', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'admin only' });
  }
  try {
    const result = await syncNotionProfiles();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[NotionSync] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/notion/sync-status  最終同期時刻
// ============================================================
router.get('/sync-status', authenticateToken, (req, res) => {
  const row = db.prepare(
    'SELECT MAX(synced_at) as last_synced, COUNT(*) as total FROM notion_profiles'
  ).get();
  res.json(row);
});

module.exports = router;
module.exports.syncNotionProfiles = syncNotionProfiles;
