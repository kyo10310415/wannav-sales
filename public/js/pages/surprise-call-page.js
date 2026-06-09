// サプライズコールページ
const SurpriseCallPage = {
  rows:        [],
  filtered:    [],
  headers:     [],
  searchQuery: '',
  currentPage: 1,
  perPage:     20,
  sortKey:     'タイムスタンプ',
  sortDir:     'desc',   // 'asc' | 'desc'
  loading:     false,
  fetchedAt:   null,

  // ── 数値系列・特殊表示列の定義 ──────────────────────────
  NUMERIC_COLS: new Set([
    '入会の手続きの満足度',
    '今の熱量を0~10点で教えてください',
    '合計点',
    'ユニーク生徒数',
    '指定範囲のユニーク生徒数',
    'クーリングオフ数',
  ]),

  // 架電結果ごとのバッジ色
  RESULT_COLORS: {
    '通話':         '#16a34a',
    '繋がった':     '#16a34a',  // 旧表記との互換
    '留守':        '#d97706',
    '電話番号間違い': '#dc2626',
    '拒否':        '#dc2626',
    'その他':      '#6b7280',
  },

  // ステータスごとのバッジ色
  STATUS_COLORS: {
    '継続':         '#2563eb',
    'CO':           '#dc2626',
    'クーリングオフ': '#dc2626',
    '保留':         '#d97706',
    '完了':         '#16a34a',
  },

  render() {
    return `
      <div class="page-header">
        <div>
          <div class="page-title">
            <i class="fas fa-phone-alt" style="margin-right:8px;color:#7c3aed"></i>サプライズコール
          </div>
          <div class="page-subtitle">入会後フォローアップコールの結果一覧</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span id="sc-cache-label" style="font-size:11px;color:var(--gray-400)"></span>
          <button class="btn btn-sm" id="sc-refresh-btn"
            style="background:#7c3aed;border-color:#7c3aed;color:white"
            onclick="SurpriseCallPage.refresh()">
            <i class="fas fa-sync-alt"></i> 更新
          </button>
        </div>
      </div>
      <div class="page-body">

        <!-- サマリーカード -->
        <div id="sc-summary" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px"></div>

        <!-- 検索・フィルター -->
        <div class="card" style="margin-bottom:12px">
          <div class="card-body" style="padding:12px 16px">
            <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
              <div style="flex:1;min-width:200px">
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px">検索</div>
                <div class="search-wrapper" style="max-width:100%">
                  <i class="fas fa-search"></i>
                  <input type="text" class="search-input" id="sc-search"
                    placeholder="学籍番号・メール・架電結果・ステータス..."
                    style="width:100%"
                    oninput="SurpriseCallPage.onSearch(this.value)">
                </div>
              </div>
              <div>
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px">架電結果</div>
                <select class="form-control" id="sc-filter-result" style="font-size:12px;height:34px"
                  onchange="SurpriseCallPage.applyFilter()">
                  <option value="">すべて</option>
                  <option value="通話">通話（繋がった）</option>
                  <option value="留守">留守</option>
                  <option value="電話番号間違い">電話番号間違い</option>
                  <option value="拒否">拒否</option>
                </select>
              </div>
              <div>
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px">ステータス</div>
                <select class="form-control" id="sc-filter-status" style="font-size:12px;height:34px"
                  onchange="SurpriseCallPage.applyFilter()">
                  <option value="">すべて</option>
                  <option value="継続">継続</option>
                  <option value="CO">CO</option>
                  <option value="保留">保留</option>
                  <option value="完了">完了</option>
                </select>
              </div>
              <span id="sc-count" style="font-size:13px;color:var(--gray-500);align-self:center;white-space:nowrap"></span>
            </div>
          </div>
        </div>

        <!-- テーブル -->
        <div class="card">
          <div class="card-body" style="padding:0">
            <div id="sc-table-wrap" style="overflow-x:auto">
              <div class="loading-spinner"><div class="spinner"></div><span>読み込み中...</span></div>
            </div>
            <div id="sc-pagination" style="padding:12px 16px;border-top:1px solid var(--gray-200)"></div>
          </div>
        </div>
      </div>
    `;
  },

  async mount() {
    await this.load();
  },

  // ── データ取得 ───────────────────────────────────────────
  async load() {
    this.loading = true;
    this._setTableLoading(true);
    try {
      const data = await API.surpriseCall.list();
      this.headers   = data.headers  || [];
      this.rows      = data.rows     || [];
      this.fetchedAt = data.fetchedAt;
      this._updateCacheLabel(data.cacheAgeSeconds);
      this.applyFilter();
      this._renderSummary();
    } catch (err) {
      this._setTableError(err.message);
    } finally {
      this.loading = false;
    }
  },

  async refresh() {
    const btn = document.getElementById('sc-refresh-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 更新中...'; }
    try {
      const data = await API.surpriseCall.refresh();
      this.headers   = data.headers  || [];
      this.rows      = data.rows     || [];
      this.fetchedAt = data.fetchedAt;
      this._updateCacheLabel(0);
      this.applyFilter();
      this._renderSummary();
      Utils.notify('データを更新しました', 'success');
    } catch (err) {
      Utils.notify('更新失敗: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt"></i> 更新'; }
    }
  },

  // ── 検索・フィルター ────────────────────────────────────
  onSearch(val) {
    this.searchQuery = val.trim();
    this.currentPage = 1;
    this.applyFilter();
  },

  applyFilter() {
    const q          = (this.searchQuery || '').toLowerCase();
    const resultSel  = (document.getElementById('sc-filter-result')  || {}).value || '';
    const statusSel  = (document.getElementById('sc-filter-status')  || {}).value || '';

    this.filtered = this.rows.filter(r => {
      if (resultSel && r['架電結果'] !== resultSel) return false;
      if (statusSel && r['ステータス'] !== statusSel) return false;
      if (q) {
        const hay = [
          r['学籍番号'], r['メールアドレス'], r['架電結果'],
          r['ステータス'], r['架電時間帯'], r['一番気になるトピック'],
          r['担当者は信頼できるか？'],
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    this.currentPage = 1;
    this._renderTable();
    this._renderPagination();
    this._updateCount();
  },

  // ── ソート ──────────────────────────────────────────────
  setSort(key) {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDir = 'asc';
    }
    this._sortFiltered();
    this._renderTable();
    this._renderPagination();
  },

  _sortFiltered() {
    const key     = this.sortKey;
    const dir     = this.sortDir === 'asc' ? 1 : -1;
    const isNum   = this.NUMERIC_COLS.has(key);

    this.filtered.sort((a, b) => {
      const av = a[key] || '';
      const bv = b[key] || '';
      if (isNum) {
        return (parseFloat(av) || 0) > (parseFloat(bv) || 0) ? dir : -dir;
      }
      return av.localeCompare(bv, 'ja') * dir;
    });
  },

  // ── テーブル描画 ────────────────────────────────────────
  _renderTable() {
    const wrap = document.getElementById('sc-table-wrap');
    if (!wrap) return;

    if (this.filtered.length === 0 && !this.loading) {
      wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--gray-400)">
        <i class="fas fa-inbox" style="font-size:32px;margin-bottom:8px;display:block"></i>
        データがありません
      </div>`;
      return;
    }

    const start  = (this.currentPage - 1) * this.perPage;
    const pageRows = this.filtered.slice(start, start + this.perPage);

    // 表示列定義（順序・幅指定）
    const COL_DEF = [
      { key: 'タイムスタンプ',                   label: '日時',        width: '120px' },
      { key: '学籍番号',                          label: '学籍番号',    width: '90px'  },
      { key: '架電時間帯',                        label: '架電時間帯',  width: '90px'  },
      { key: '架電結果',                          label: '架電結果',    width: '90px'  },
      { key: '入会の手続きの満足度',              label: '満足度',      width: '70px'  },
      { key: 'お手続きの中で不安に感じた点',      label: '不安な点',    width: '160px' },
      { key: '一番気になるトピック',              label: 'トピック',    width: '120px' },
      { key: '担当者は信頼できるか？',            label: '信頼度',      width: '80px'  },
      { key: '担当者に対する評価の理由',          label: '評価理由',    width: '160px' },
      { key: '今の熱量を0~10点で教えてください',  label: '熱量',        width: '60px'  },
      { key: 'どんな景色を見たいと思っているか？', label: '目指す景色',  width: '160px' },
      { key: 'ステータス',                        label: 'ステータス',  width: '80px'  },
      { key: 'CO開け日（目安）',                  label: 'CO開け日',    width: '100px' },
      { key: '合計点',                            label: '合計点',      width: '65px'  },
      { key: '口コミ共有済み',                    label: '口コミ済',    width: '70px'  },
    ];

    const sortIcon = (key) => {
      if (this.sortKey !== key) return '<i class="fas fa-sort" style="opacity:.3;margin-left:3px"></i>';
      return this.sortDir === 'asc'
        ? '<i class="fas fa-sort-up" style="margin-left:3px;color:#7c3aed"></i>'
        : '<i class="fas fa-sort-down" style="margin-left:3px;color:#7c3aed"></i>';
    };

    const thead = COL_DEF.map(c =>
      `<th style="width:${c.width};min-width:${c.width};cursor:pointer;white-space:nowrap;padding:8px 10px;font-size:11px"
          onclick="SurpriseCallPage.setSort('${c.key}')">
        ${c.label}${sortIcon(c.key)}
       </th>`
    ).join('');

    const tbody = pageRows.map((r, ri) => {
      const cells = COL_DEF.map(c => {
        const val = r[c.key] || '';
        let cellHtml = Utils.escHtml(val);

        // 架電結果バッジ
        if (c.key === '架電結果' && val) {
          const color = this.RESULT_COLORS[val] || '#6b7280';
          cellHtml = `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:${color}20;color:${color};border:1px solid ${color}40">${Utils.escHtml(val)}</span>`;
        }
        // ステータスバッジ
        if (c.key === 'ステータス' && val) {
          const color = this.STATUS_COLORS[val] || '#6b7280';
          cellHtml = `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:${color}20;color:${color};border:1px solid ${color}40">${Utils.escHtml(val)}</span>`;
        }
        // 満足度・熱量: 星/バー表示
        if (c.key === '入会の手続きの満足度' || c.key === '今の熱量を0~10点で教えてください' || c.key === '合計点') {
          const n = parseFloat(val);
          if (!isNaN(n)) {
            const max  = c.key === '合計点' ? 20 : (c.key === '今の熱量を0~10点で教えてください' ? 10 : 5);
            const pct  = Math.min(100, Math.round(n / max * 100));
            const color = pct >= 70 ? '#16a34a' : pct >= 40 ? '#d97706' : '#dc2626';
            cellHtml = `<div style="display:flex;align-items:center;gap:5px">
              <div style="flex:1;height:6px;background:var(--gray-200);border-radius:3px;min-width:36px">
                <div style="width:${pct}%;height:100%;background:${color};border-radius:3px"></div>
              </div>
              <span style="font-size:11px;font-weight:700;color:${color};min-width:20px;text-align:right">${val}</span>
            </div>`;
          }
        }
        // 口コミ共有済み: チェック表示
        if (c.key === '口コミ共有済み') {
          if (val === '○' || val.toLowerCase() === 'true' || val === '1' || val === 'はい') {
            cellHtml = '<i class="fas fa-check-circle" style="color:#16a34a"></i>';
          } else if (val) {
            cellHtml = `<span style="color:var(--gray-400);font-size:11px">${Utils.escHtml(val)}</span>`;
          }
        }
        // 長文は省略表示
        if ((c.key === 'お手続きの中で不安に感じた点' || c.key === '担当者に対する評価の理由' || c.key === 'どんな景色を見たいと思っているか？') && val.length > 40) {
          cellHtml = `<span title="${Utils.escHtml(val)}" style="cursor:help">${Utils.escHtml(val.slice(0, 38))}…</span>`;
        }

        return `<td style="padding:7px 10px;font-size:12px;border-bottom:1px solid var(--gray-100);vertical-align:middle">${cellHtml}</td>`;
      }).join('');

      const bg = ri % 2 === 0 ? '' : 'background:var(--gray-50)';
      return `<tr style="${bg}">${cells}</tr>`;
    }).join('');

    wrap.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:var(--gray-50);border-bottom:2px solid var(--gray-200)">
            ${thead}
          </tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table>`;
  },

  // ── ページネーション ────────────────────────────────────
  _renderPagination() {
    const el = document.getElementById('sc-pagination');
    if (!el) return;
    const total = this.filtered.length;
    const pages = Math.ceil(total / this.perPage);
    if (pages <= 1) { el.innerHTML = ''; return; }

    const cur   = this.currentPage;
    const start = Math.max(1, cur - 2);
    const end   = Math.min(pages, cur + 2);

    let html = `<div style="display:flex;gap:4px;align-items:center;justify-content:flex-end;flex-wrap:wrap">
      <span style="font-size:12px;color:var(--gray-400);margin-right:8px">${total}件 / ${pages}ページ</span>`;

    if (cur > 1) {
      html += `<button class="btn btn-sm btn-secondary" onclick="SurpriseCallPage.goPage(${cur - 1})" style="padding:3px 8px;font-size:11px">‹</button>`;
    }
    for (let i = start; i <= end; i++) {
      const active = i === cur ? 'background:#7c3aed;color:white;border-color:#7c3aed' : '';
      html += `<button class="btn btn-sm btn-secondary" onclick="SurpriseCallPage.goPage(${i})"
        style="padding:3px 8px;font-size:11px;${active}">${i}</button>`;
    }
    if (cur < pages) {
      html += `<button class="btn btn-sm btn-secondary" onclick="SurpriseCallPage.goPage(${cur + 1})" style="padding:3px 8px;font-size:11px">›</button>`;
    }
    html += '</div>';
    el.innerHTML = html;
  },

  goPage(p) {
    this.currentPage = p;
    this._renderTable();
    this._renderPagination();
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  },

  // ── サマリーカード ──────────────────────────────────────
  _renderSummary() {
    const el = document.getElementById('sc-summary');
    if (!el) return;

    const total    = this.rows.length;
    const reached  = this.rows.filter(r => r['架電結果'] === '通話' || r['架電結果'] === '繋がった').length;
    // CO件数: 'CO' または 'クーリングオフ' のいずれかを含む
    const coCount  = this.rows.filter(r => {
      const s = r['ステータス'] || '';
      return s === 'CO' || s === 'クーリングオフ';
    }).length;
    const sharedKuchikomi = this.rows.filter(r => {
      const v = (r['口コミ共有済み'] || '').toLowerCase();
      return v === '○' || v === 'true' || v === '1' || v === 'はい';
    }).length;

    // ユニークユーザー数（学籍番号でデdup）
    const uniqueStudents = new Set(
      this.rows.map(r => (r['学籍番号'] || '').trim()).filter(s => s !== '')
    );
    const uniqueCount = uniqueStudents.size;

    // ユニークユーザーのうち繋がったユーザー数（学籍番号単位で1件でも通話があればカウント）
    const reachedStudents = new Set(
      this.rows
        .filter(r => r['架電結果'] === '通話' || r['架電結果'] === '繋がった')
        .map(r => (r['学籍番号'] || '').trim())
        .filter(s => s !== '')
    );
    const reachedUniqueCount = reachedStudents.size;

    // 平均熱量
    const heatVals  = this.rows.map(r => parseFloat(r['今の熱量を0~10点で教えてください'])).filter(n => !isNaN(n));
    const avgHeat   = heatVals.length > 0 ? (heatVals.reduce((s, n) => s + n, 0) / heatVals.length).toFixed(1) : '-';

    // 架電到達率 = ユニークユーザーベース
    const reachRate = uniqueCount > 0 ? Math.round(reachedUniqueCount / uniqueCount * 100) : 0;

    // CO率 = CO件数 ÷ ユニークユーザー数（小数点1桁）
    const coRate = uniqueCount > 0 ? (coCount / uniqueCount * 100).toFixed(1) : '0.0';

    const cards = [
      { icon: 'fa-phone-alt',       label: '総架電数',              value: `${total}件`,              color: '#7c3aed' },
      { icon: 'fa-users',           label: 'ユニークユーザー数',     value: `${uniqueCount}人`,        color: '#0369a1' },
      { icon: 'fa-check-circle',    label: '繋がった（通話）',        value: `${reached}件`,            color: '#16a34a' },
      { icon: 'fa-percent',         label: '架電到達率（ユニーク）', value: `${reachRate}%`,           color: '#2563eb',
        sub: `${reachedUniqueCount}人 / ${uniqueCount}人` },
      { icon: 'fa-fire',            label: '平均熱量',               value: avgHeat,                   color: '#d97706' },
      { icon: 'fa-undo',            label: 'CO件数',                 value: `${coCount}件`,            color: '#dc2626' },
      { icon: 'fa-chart-pie',       label: 'CO率',                   value: `${coRate}%`,              color: '#dc2626',
        sub: `${coCount}件 / ${uniqueCount}人` },
      { icon: 'fa-star',            label: '口コミ共有済み',         value: `${sharedKuchikomi}件`,    color: '#f59e0b' },
    ];

    el.innerHTML = cards.map(c => `
      <div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
        <div style="width:38px;height:38px;border-radius:10px;background:${c.color}18;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i class="fas ${c.icon}" style="color:${c.color};font-size:16px"></i>
        </div>
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--gray-800)">${Utils.escHtml(String(c.value))}</div>
          <div style="font-size:10px;color:var(--gray-400);margin-top:1px">${c.label}</div>
          ${c.sub ? `<div style="font-size:10px;color:var(--gray-400);margin-top:1px">${Utils.escHtml(c.sub)}</div>` : ''}
        </div>
      </div>
    `).join('');
  },

  // ── ユーティリティ ──────────────────────────────────────
  _updateCount() {
    const el = document.getElementById('sc-count');
    if (el) el.textContent = `${this.filtered.length}件表示`;
  },

  _updateCacheLabel(ageSeconds) {
    const el = document.getElementById('sc-cache-label');
    if (!el) return;
    if (ageSeconds === null || ageSeconds === undefined) { el.textContent = ''; return; }
    const min = Math.floor(ageSeconds / 60);
    el.textContent = ageSeconds < 10 ? '取得直後' : `${min}分前取得`;
  },

  _setTableLoading(show) {
    const wrap = document.getElementById('sc-table-wrap');
    if (wrap && show) {
      wrap.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>読み込み中...</span></div>';
    }
  },

  _setTableError(msg) {
    const wrap = document.getElementById('sc-table-wrap');
    if (wrap) {
      wrap.innerHTML = `<div style="padding:40px;text-align:center;color:#dc2626">
        <i class="fas fa-exclamation-triangle" style="font-size:28px;margin-bottom:8px;display:block"></i>
        データの取得に失敗しました<br>
        <small style="color:var(--gray-400)">${Utils.escHtml(msg)}</small>
      </div>`;
    }
  },
};
