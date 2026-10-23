// One Loop 応募者テストページ
const OneLoopPage = {
  // ── 状態 ──────────────────────────────────────────────────
  applicants:  [],
  loading:     false,
  error:       null,
  pageInfo:    {},
  queryText:   `{
  applicants(first: 20) {
    pageInfo { hasNextPage endCursor }
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
}`,
  gqlResult:   null,
  gqlError:    null,
  activeTab:   'list',          // 'list' | 'playground'
  filterSource: '',
  searchQuery:  '',

  // ── レンダリング ──────────────────────────────────────────
  render() {
    return `
      <div class="page-header">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;box-shadow:0 2px 8px rgba(99,102,241,0.35)">🔗</div>
          <div>
            <div class="page-title" style="color:#3730a3">One Loop 連携テスト</div>
            <div class="page-subtitle">GraphQL API 経由で応募者データを取得・表示</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="font-size:11px;background:#ede9fe;color:#7c3aed;border-radius:6px;padding:3px 10px;font-weight:600">
            <i class="fas fa-plug" style="margin-right:4px"></i>one-loop-staging
          </span>
          <button class="btn btn-secondary" onclick="OneLoopPage.loadApplicants()" ${this.loading ? 'disabled' : ''}>
            <i class="fas fa-sync-alt ${this.loading ? 'fa-spin' : ''}"></i> 再取得
          </button>
        </div>
      </div>

      <div class="page-body">

        <!-- タブ -->
        <div style="display:flex;gap:4px;margin-bottom:16px;background:white;border-radius:10px;padding:4px;box-shadow:0 1px 4px rgba(0,0,0,0.08);width:fit-content">
          ${[
            { id: 'list',       icon: 'fa-table',     label: '応募者一覧' },
            { id: 'playground', icon: 'fa-code',      label: '連携の利用範囲' },
          ].map(t => `
            <button onclick="OneLoopPage.switchTab('${t.id}')"
              style="padding:7px 16px;border-radius:7px;border:none;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;transition:all 0.15s;
                ${this.activeTab === t.id
                  ? 'background:#6366f1;color:white;box-shadow:0 2px 6px rgba(99,102,241,0.4)'
                  : 'background:transparent;color:#6b7280'}">
              <i class="fas ${t.icon}"></i>${t.label}
            </button>
          `).join('')}
        </div>

        <!-- 応募者一覧タブ -->
        <div id="pane-list" style="display:${this.activeTab === 'list' ? 'block' : 'none'}">
          ${this._renderListPane()}
        </div>

        <!-- GraphQL Playground タブ -->
        <div id="pane-playground" style="display:${this.activeTab === 'playground' ? 'block' : 'none'}">
          ${this._renderPlaygroundPane()}
        </div>

      </div>`;
  },

  // ── 応募者一覧ペイン ──────────────────────────────────────
  _renderListPane() {
    // フィルタ
    let list = this.applicants;
    if (this.filterSource) list = list.filter(a => a.source === this.filterSource);
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(a =>
        `${a.lastName}${a.firstName}`.includes(q) ||
        (a.email || '').toLowerCase().includes(q)
      );
    }

    // source の一覧（フィルタ用）
    const sources = [...new Set(this.applicants.map(a => a.source).filter(Boolean))];

    return `
      <div class="card">
        <div class="card-header" style="background:#f5f3ff;border-bottom:1px solid #ddd6fe">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div class="card-title" style="color:#4c1d95">
              <i class="fas fa-users" style="margin-right:6px"></i>
              応募者一覧
              <span style="font-size:12px;font-weight:400;color:#6b7280;margin-left:8px">全 ${this.applicants.length} 件 / 表示 ${list.length} 件</span>
            </div>
            <div style="display:flex;gap:8px;margin-left:auto;flex-wrap:wrap">
              <input type="text" placeholder="名前・メールで検索…" value="${Utils.escHtml(this.searchQuery)}"
                oninput="OneLoopPage.searchQuery=this.value;OneLoopPage._rerenderListPane()"
                class="form-control" style="font-size:12px;width:180px">
              <select class="form-control" style="font-size:12px;width:160px"
                onchange="OneLoopPage.filterSource=this.value;OneLoopPage._rerenderListPane()">
                <option value="">すべての流入経路</option>
                ${sources.map(s => `<option value="${Utils.escHtml(s)}" ${this.filterSource===s?'selected':''}>${Utils.escHtml(s)}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
        <div class="card-body" style="padding:0">
          ${this.loading ? `
            <div style="text-align:center;padding:48px;color:#9ca3af">
              <i class="fas fa-spinner fa-spin" style="font-size:28px;margin-bottom:12px;display:block"></i>
              <div style="font-size:13px">One Loop からデータを取得中…</div>
            </div>
          ` : this.error ? `
            <div style="padding:24px">
              <div class="alert alert-error">
                <i class="fas fa-exclamation-circle"></i>
                <span>${Utils.escHtml(this.error)}</span>
              </div>
              <button class="btn btn-primary btn-sm" onclick="OneLoopPage.loadApplicants()">
                <i class="fas fa-redo"></i> 再試行
              </button>
            </div>
          ` : list.length === 0 ? `
            <div style="text-align:center;padding:48px;color:#9ca3af">
              <div style="font-size:36px;margin-bottom:12px">📭</div>
              <div style="font-size:13px">${this.applicants.length === 0 ? 'データがありません。「再取得」ボタンを押してください。' : '該当する応募者がいません'}</div>
            </div>
          ` : `
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse">
                <thead>
                  <tr style="background:#f5f3ff">
                    ${['氏名','メール','電話','流入経路','customFields','登録日'].map(h =>
                      `<th style="padding:10px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;white-space:nowrap;border-bottom:1px solid #e5e7eb">${h}</th>`
                    ).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${list.map(a => this._renderRow(a)).join('')}
                </tbody>
              </table>
            </div>
            ${this.pageInfo.hasNextPage ? `
              <div style="padding:12px 16px;border-top:1px solid #f3f4f6;text-align:center">
                <button class="btn btn-secondary btn-sm" onclick="OneLoopPage.loadMore()">
                  <i class="fas fa-chevron-down"></i> さらに読み込む
                </button>
              </div>
            ` : ''}
          `}
        </div>
      </div>`;
  },

  _renderRow(a) {
    const name = `${a.lastName || ''} ${a.firstName || ''}`.trim() || '（名前なし）';
    const date = a.createdAt ? a.createdAt.slice(0, 10) : '-';
    const cf   = a.customFields ? JSON.stringify(a.customFields) : '-';

    return `
      <tr style="border-bottom:1px solid #f3f4f6;transition:background 0.1s"
        onmouseenter="this.style.background='#f5f3ff'" onmouseleave="this.style.background=''">
        <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#1f2937">${Utils.escHtml(name)}</td>
        <td style="padding:10px 14px;font-size:12px;color:#374151">
          ${a.email ? `<a href="mailto:${Utils.escHtml(a.email)}" style="color:#6366f1">${Utils.escHtml(a.email)}</a>` : '<span style="color:#d1d5db">-</span>'}
        </td>
        <td style="padding:10px 14px;font-size:12px;color:#374151">${Utils.escHtml(a.phone || '-')}</td>
        <td style="padding:10px 14px">
          ${a.source
            ? `<span style="font-size:11px;background:#ede9fe;color:#7c3aed;border-radius:10px;padding:2px 8px;font-weight:600">${Utils.escHtml(a.source)}</span>`
            : '<span style="color:#d1d5db;font-size:12px">-</span>'}
        </td>
        <td style="padding:10px 14px;font-size:11px;color:#6b7280;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${Utils.escHtml(cf)}">
          ${Utils.escHtml(cf)}
        </td>
        <td style="padding:10px 14px;font-size:11px;color:#9ca3af;white-space:nowrap">${date}</td>
      </tr>`;
  },

  // ── GraphQL Playground ペイン ─────────────────────────────
  _renderPlaygroundPane() {
    return '<div class="card"><div class="card-body">応募者一覧の閲覧・検索・絞り込みを利用できます。任意GraphQLの実行機能は廃止しました。</div></div>';
  },

  // ── データ取得 ─────────────────────────────────────────────
  async loadApplicants() {
    this.loading    = true;
    this.error      = null;
    this.applicants = [];
    this.pageInfo   = {};
    this._rerenderListPane();

    try {
      const resp = await API.get('/oneloop/applicants?first=50');
      this.applicants = resp.applicants || [];
      this.pageInfo   = resp.pageInfo   || {};
    } catch (e) {
      this.error = e.message;
    } finally {
      this.loading = false;
      this._rerenderListPane();
    }
  },

  async loadMore() {
    if (!this.pageInfo.hasNextPage || !this.pageInfo.endCursor) return;
    try {
      const cursor = encodeURIComponent(this.pageInfo.endCursor);
      const resp   = await API.get(`/oneloop/applicants?first=50&after=${cursor}`);
      this.applicants = [...this.applicants, ...(resp.applicants || [])];
      this.pageInfo   = resp.pageInfo || {};
      this._rerenderListPane();
    } catch (e) {
      Utils.notify('追加取得に失敗しました: ' + e.message, 'error');
    }
  },

  // ── タブ切り替え ──────────────────────────────────────────
  switchTab(tab) {
    this.activeTab = tab;
    document.getElementById('pane-list').style.display       = tab === 'list'       ? 'block' : 'none';
    document.getElementById('pane-playground').style.display = tab === 'playground' ? 'block' : 'none';
    // タブボタンのスタイルを更新
    document.querySelectorAll('[onclick^="OneLoopPage.switchTab"]').forEach(btn => {
      const isActive = btn.getAttribute('onclick').includes(`'${tab}'`);
      btn.style.background   = isActive ? '#6366f1' : 'transparent';
      btn.style.color        = isActive ? 'white'   : '#6b7280';
      btn.style.boxShadow    = isActive ? '0 2px 6px rgba(99,102,241,0.4)' : 'none';
    });
  },

  // ── 一覧ペインのみ再描画 ──────────────────────────────────
  _rerenderListPane() {
    const pane = document.getElementById('pane-list');
    if (pane) pane.innerHTML = this._renderListPane();
  },

  // ── マウント（ページ初回表示時） ──────────────────────────
  mount() {
    // 初回データ取得
    if (this.applicants.length === 0 && !this.loading) {
      this.loadApplicants();
    }
  },
};
