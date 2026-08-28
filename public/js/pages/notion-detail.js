// 詳細データページ（Notionプロファイル一覧・検索）
const NotionDetailPage = {
  profiles: [],
  filtered: [],
  searchQuery: '',
  currentPage: 1,
  perPage: 20,
  syncStatus: null,
  syncing: false,

  // 表示プロパティ定義（ラベル / DBカラム名）
  PROPS: [
    { label: '性別',              key: 'gender' },
    { label: '生年月日',          key: 'birth_date' },
    { label: '最終学歴',          key: 'final_education' },
    { label: '現職',              key: 'current_job' },
    { label: '職種',              key: 'job_type' },
    { label: '月収',              key: 'monthly_income' },
    { label: '可処分所得',        key: 'disposable_income' },
    { label: '貯蓄',              key: 'savings' },
    { label: '借金',              key: 'debt' },
    { label: 'カード有無',        key: 'has_card' },
    { label: '職歴',              key: 'work_history' },
    { label: 'バイト歴',          key: 'part_time_history' },
    { label: '都道府県',          key: 'prefecture' },
    { label: '同居人',            key: 'cohabitants' },
    { label: 'パートナー有無',    key: 'has_partner' },
    { label: 'パートナー理解',    key: 'partner_understanding' },
    { label: 'Sales3分類',        key: 'sales_classification' },
    { label: '配信経験',          key: 'has_streaming_experience' },
    { label: '配信歴',            key: 'streaming_history' },
    { label: '配信機材',          key: 'streaming_equipment' },
    { label: '志望動機',          key: 'motivation' },
    { label: '企業が良い理由',    key: 'company_reason' },
    { label: '貢献できること',    key: 'contribution' },
    { label: 'VTuberの努力',      key: 'vtuber_effort' },
    { label: '他オーディション',  key: 'other_auditions' },
    { label: 'やりたい配信',      key: 'desired_streaming' },
    { label: '熱量%',             key: 'vtuber_passion' },
    { label: '病歴',              key: 'medical_history' },
    { label: 'ステータス',        key: 'status' },
    { label: '契約プラン',        key: 'contract_plan' },
  ],

  render() {
    return `
      <div class="page-header">
        <div>
          <div class="page-title">
            <i class="fas fa-database" style="margin-right:8px;color:#1e1e1e"></i>詳細データ
          </div>
          <div class="page-subtitle">Notionから取得した応募者詳細プロファイル</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <div id="nd-sync-status"></div>
          <button class="btn btn-sm" id="nd-sync-btn"
            style="background:#1e1e1e;border-color:#1e1e1e;color:white"
            onclick="NotionDetailPage.syncNow()">
            <i class="fas fa-sync-alt"></i> 今すぐ同期
          </button>
        </div>
      </div>
      <div class="page-body">
        <div class="card" style="margin-bottom:12px">
          <div class="card-body" style="padding:12px 16px">
            <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
              <div style="flex:1;min-width:200px">
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px">検索</div>
                <div class="search-wrapper" style="max-width:100%">
                  <i class="fas fa-search"></i>
                  <input type="text" class="search-input" id="nd-search"
                    placeholder="学籍番号・氏名・都道府県..." style="width:100%">
                </div>
              </div>
              <span id="nd-count" style="font-size:13px;color:var(--gray-500);align-self:center;white-space:nowrap"></span>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-body" style="padding:0">
            <div id="nd-table-wrap">
              <div class="loading-spinner"><div class="spinner"></div><span>読み込み中...</span></div>
            </div>
          </div>
        </div>
        <div id="nd-pagination" style="padding:8px 0"></div>
      </div>

      <!-- 詳細モーダル -->
      <div id="nd-modal" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.45);overflow-y:auto">
        <div style="max-width:680px;margin:40px auto;background:white;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.25);overflow:hidden">
          <div style="background:#1e1e1e;padding:16px 20px;display:flex;justify-content:space-between;align-items:center">
            <div style="color:white;font-size:15px;font-weight:700" id="nd-modal-title">詳細データ</div>
            <button onclick="NotionDetailPage.closeModal()"
              style="background:none;border:none;color:white;font-size:18px;cursor:pointer;padding:2px 6px">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div id="nd-modal-body" style="padding:20px"></div>
        </div>
      </div>
    `;
  },

  async mount() {
    document.getElementById('nd-search').addEventListener('input',
      Utils.debounce(e => {
        this.searchQuery = e.target.value.toLowerCase();
        this.currentPage = 1;
        this.filterAndRender();
      }, 250)
    );
    await Promise.all([this.loadProfiles(), this.loadSyncStatus()]);
  },

  async loadProfiles() {
    try {
      this.profiles = await API.notion.profiles();
      this.filterAndRender();
    } catch (err) {
      const wrap = document.getElementById('nd-table-wrap');
      if (wrap) wrap.innerHTML = `
        <div class="alert alert-error" style="margin:20px">
          <i class="fas fa-exclamation-triangle"></i>
          <div>
            <strong>データの取得に失敗しました</strong><br>
            <span style="font-size:12px">${Utils.escHtml(err.message)}</span>
          </div>
        </div>`;
    }
  },

  async loadSyncStatus() {
    try {
      const st = await API.notion.syncStatus();
      this.syncStatus = st;
      this.renderSyncStatus();
    } catch (e) {}
  },

  renderSyncStatus() {
    const el = document.getElementById('nd-sync-status');
    if (!el || !this.syncStatus) return;
    const last = this.syncStatus.last_synced
      ? new Date(this.syncStatus.last_synced).toLocaleString('ja-JP')
      : '未同期';
    el.innerHTML = `
      <span style="font-size:11px;color:var(--gray-500);background:white;border:1px solid var(--gray-200);
        border-radius:6px;padding:4px 8px;display:flex;align-items:center;gap:4px">
        <i class="fas fa-clock" style="color:var(--gray-400)"></i>
        最終同期: ${Utils.escHtml(last)}
        <span style="color:var(--gray-400)">/ ${this.syncStatus.total || 0}件</span>
      </span>`;
  },

  async syncNow() {
    if (this.syncing) return;
    this.syncing = true;
    const btn = document.getElementById('nd-sync-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 同期中...'; }

    try {
      const res = await API.notion.sync();
      Utils.notify(res.started ? 'Notion同期を開始しました' : 'Notion同期は既に実行中です', 'info');

      // サーバー側の同期はバックグラウンド実行。完了まで状態APIを確認する。
      let status = null;
      for (let attempt = 0; attempt < 90; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        status = await API.notion.syncStatus();
        this.syncStatus = status;
        this.renderSyncStatus();
        if (!status.running) break;
      }

      if (status?.running) {
        throw new Error('同期処理が続いています。しばらく後にページを再読み込みしてください');
      }
      if (status?.last_error) throw new Error(status.last_error);

      await Promise.all([this.loadProfiles(), this.loadSyncStatus()]);
      Utils.notify(`同期完了: ${status?.last_saved ?? status?.total ?? 0}件保存しました`, 'success');
    } catch (err) {
      Utils.notify('同期エラー: ' + err.message, 'error');
    } finally {
      this.syncing = false;
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt"></i> 今すぐ同期'; }
    }
  },

  filterAndRender() {
    let list = [...this.profiles];
    if (this.searchQuery) {
      const q = this.searchQuery;
      list = list.filter(p =>
        (p.student_number || '').toLowerCase().includes(q) ||
        (p.prefecture     || '').toLowerCase().includes(q) ||
        (p.gender         || '').toLowerCase().includes(q) ||
        (p.final_education|| '').toLowerCase().includes(q) ||
        (p.current_job    || '').toLowerCase().includes(q) ||
        (p.sales_classification || '').toLowerCase().includes(q)
      );
    }
    this.filtered = list;
    const countEl = document.getElementById('nd-count');
    if (countEl) countEl.textContent = `${list.length}件`;
    this.renderTable();
    this.renderPagination();
  },

  renderTable() {
    const wrap = document.getElementById('nd-table-wrap');
    if (!wrap) return;

    if (!this.filtered.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-database"></i>
          <h3>${this.searchQuery ? '条件に一致するデータがありません' : 'Notionデータがありません'}</h3>
          <p>${this.searchQuery ? 'キーワードを変更してください' : '「今すぐ同期」ボタンでNotionからデータを取得してください。<br>事前に環境変数 NOTION_API_KEY と NOTION_DATABASE_ID を設定してください。'}</p>
        </div>`;
      return;
    }

    const { items } = Utils.paginate(this.filtered, this.currentPage, this.perPage);

    // サマリー表示列（テーブル上は代表的な列のみ）
    const summaryCols = [
      { label: '学籍番号',   key: 'student_number' },
      { label: '性別',       key: 'gender' },
      { label: '生年月日',   key: 'birth_date' },
      { label: '最終学歴',   key: 'final_education' },
      { label: '現職',       key: 'current_job' },
      { label: '都道府県',   key: 'prefecture' },
      { label: 'Sales3分類', key: 'sales_classification' },
      { label: '配信経験',   key: 'has_streaming_experience' },
      { label: '熱量%',      key: 'vtuber_passion' },
      { label: '最終同期',   key: 'synced_at' },
    ];

    const headerRow = summaryCols.map(c =>
      `<th style="padding:8px 10px;font-size:11px;white-space:nowrap;text-align:center">${Utils.escHtml(c.label)}</th>`
    ).join('') + `<th style="padding:8px 10px;font-size:11px;text-align:center">詳細</th>`;

    const rows = items.map(p => {
      const cells = summaryCols.map(c => {
        let val = p[c.key] || '—';
        if (c.key === 'synced_at' && p.synced_at) {
          val = new Date(p.synced_at).toLocaleDateString('ja-JP');
        }
        const isSales = c.key === 'sales_classification' && val && val !== '—';
        const style = isSales
          ? 'font-size:11px;padding:5px 8px;text-align:center;font-weight:700;color:#7c3aed;background:#faf5ff'
          : 'font-size:11px;padding:5px 8px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:0';
        return `<td style="${style}" title="${Utils.escHtml(String(val))}">${Utils.escHtml(String(val))}</td>`;
      }).join('');

      return `
        <tr>
          ${cells}
          <td style="text-align:center;padding:4px 6px">
            <button class="btn btn-xs"
              style="font-size:10px;padding:3px 8px;background:#1e1e1e;color:white;border:none;border-radius:5px;cursor:pointer"
              onclick="NotionDetailPage.openModal(${Number(p.id)})">
              <i class="fas fa-expand-alt"></i> 詳細
            </button>
          </td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;min-width:700px">
          <thead>
            <tr style="background:var(--gray-50);border-bottom:2px solid var(--gray-200)">
              ${headerRow}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },

  renderPagination() {
    const paginEl = document.getElementById('nd-pagination');
    if (!paginEl) return;
    const total = this.filtered.length;
    const totalPages = Math.ceil(total / this.perPage);
    if (totalPages <= 1) { paginEl.innerHTML = ''; return; }

    const page = this.currentPage;
    const start = (page - 1) * this.perPage + 1;
    const end   = Math.min(page * this.perPage, total);
    let btns = '';
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || Math.abs(i - page) <= 2) {
        btns += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="NotionDetailPage.goPage(${i})">${i}</button>`;
      } else if (Math.abs(i - page) === 3) {
        btns += `<span style="padding:0 4px;color:var(--gray-400)">…</span>`;
      }
    }
    paginEl.innerHTML = `
      <div class="pagination">
        <span>${start}〜${end}件 / 全${total}件</span>
        <div class="pagination-controls">
          <button class="page-btn" onclick="NotionDetailPage.goPage(${page-1})" ${page<=1?'disabled':''}>
            <i class="fas fa-chevron-left"></i>
          </button>
          ${btns}
          <button class="page-btn" onclick="NotionDetailPage.goPage(${page+1})" ${page>=totalPages?'disabled':''}>
            <i class="fas fa-chevron-right"></i>
          </button>
        </div>
      </div>`;
  },

  goPage(page) {
    const totalPages = Math.ceil(this.filtered.length / this.perPage);
    if (page < 1 || page > totalPages) return;
    this.currentPage = page;
    this.renderTable();
    this.renderPagination();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  openModal(profileId) {
    const p = this.profiles.find(x => Number(x.id) === Number(profileId));
    if (!p) return;

    document.getElementById('nd-modal-title').textContent = p.student_number
      ? `詳細データ — 学籍番号: ${p.student_number}`
      : '詳細データ — 学籍番号未設定';

    const rows = this.PROPS.map(prop => {
      const val = p[prop.key];
      const display = (val && val.trim && val.trim()) ? val : '—';
      const isLong = display.length > 40;
      return `
        <tr>
          <td style="padding:8px 12px;font-size:12px;font-weight:600;color:var(--gray-600);
            white-space:nowrap;width:130px;vertical-align:top;border-bottom:1px solid var(--gray-100)">
            ${Utils.escHtml(prop.label)}
          </td>
          <td style="padding:8px 12px;font-size:12px;color:var(--gray-800);
            border-bottom:1px solid var(--gray-100);${isLong ? 'word-break:break-all' : ''}">
            ${Utils.escHtml(display)}
          </td>
        </tr>`;
    }).join('');

    const syncDate = p.synced_at
      ? new Date(p.synced_at).toLocaleString('ja-JP') : '—';

    document.getElementById('nd-modal-body').innerHTML = `
      <table style="width:100%;border-collapse:collapse">
        ${rows}
        <tr>
          <td style="padding:8px 12px;font-size:11px;font-weight:600;color:var(--gray-400);white-space:nowrap;vertical-align:top">
            最終同期
          </td>
          <td style="padding:8px 12px;font-size:11px;color:var(--gray-400)">
            ${Utils.escHtml(syncDate)}
          </td>
        </tr>
      </table>`;

    document.getElementById('nd-modal').style.display = 'block';
    document.body.style.overflow = 'hidden';
  },

  closeModal() {
    document.getElementById('nd-modal').style.display = 'none';
    document.body.style.overflow = '';
  },
};
