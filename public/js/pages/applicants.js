// Applicants Page
const ApplicantsPage = {
  applicants: [],        // 全データ（バックエンドでソート済み）
  filteredApplicants: [], // フィルタ後
  reports: [],
  visibleHeaders: [],
  currentPage: 1,
  perPage: 20,
  error: null,

  // フィルタ・ソート状態
  searchQuery: '',
  filterResult: '',   // 営業報告の結果フィルタ
  filterDateFrom: '',
  filterDateTo: '',
  sortCol: null,      // null = 応募日降順（デフォルト）
  sortDir: 'desc',

  render() {
    return `
      <div class="page-header">
        <div>
          <div class="page-title"><i class="fas fa-users" style="margin-right:8px;color:var(--primary)"></i>応募者一覧</div>
          <div class="page-subtitle">スプレッドシートから取得（重複除外・応募日降順）</div>
        </div>
        <button class="btn btn-secondary" onclick="ApplicantsPage.loadData()">
          <i class="fas fa-sync-alt"></i> 更新
        </button>
      </div>
      <div class="page-body">

        <!-- フィルターバー -->
        <div class="card" style="margin-bottom:12px">
          <div class="card-body" style="padding:12px 16px">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">

              <!-- テキスト検索 -->
              <div style="flex:1;min-width:180px">
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px">フリー検索</div>
                <div class="search-wrapper" style="max-width:100%">
                  <i class="fas fa-search"></i>
                  <input type="text" class="search-input" id="applicant-search"
                    placeholder="氏名・メールアドレス..." style="width:100%">
                </div>
              </div>

              <!-- 応募日（From） -->
              <div>
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px">応募日 From</div>
                <input type="date" id="filter-date-from" class="form-control" style="width:140px">
              </div>

              <!-- 応募日（To） -->
              <div>
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px">応募日 To</div>
                <input type="date" id="filter-date-to" class="form-control" style="width:140px">
              </div>

              <!-- 結果フィルタ -->
              <div>
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px">営業報告の結果</div>
                <select id="filter-result" class="form-control" style="width:130px">
                  <option value="">すべて</option>
                  <option value="contract">契約のみ</option>
                  <option value="reported">報告あり</option>
                  <option value="unreported">未報告</option>
                </select>
              </div>

              <!-- リセット -->
              <div>
                <button class="btn btn-secondary btn-sm" onclick="ApplicantsPage.resetFilters()" style="margin-top:auto">
                  <i class="fas fa-times"></i> リセット
                </button>
              </div>

              <span id="applicant-count" style="font-size:13px;color:var(--gray-500);align-self:center;margin-left:auto;white-space:nowrap"></span>
            </div>
          </div>
        </div>

        <!-- テーブル -->
        <div class="card">
          <div class="card-body" style="padding:0">
            <div id="applicants-table-wrap">
              <div class="loading-spinner"><div class="spinner"></div><span>スプレッドシートを読み込み中...</span></div>
            </div>
          </div>
        </div>
        <div id="applicants-pagination" style="padding:8px 0"></div>
      </div>
    `;
  },

  async mount() {
    // フリー検索
    document.getElementById('applicant-search').addEventListener('input',
      Utils.debounce((e) => {
        this.searchQuery = e.target.value.toLowerCase();
        this.currentPage = 1;
        this.filterAndRender();
      }, 250)
    );
    // 日付フィルタ
    document.getElementById('filter-date-from').addEventListener('change', (e) => {
      this.filterDateFrom = e.target.value;
      this.currentPage = 1;
      this.filterAndRender();
    });
    document.getElementById('filter-date-to').addEventListener('change', (e) => {
      this.filterDateTo = e.target.value;
      this.currentPage = 1;
      this.filterAndRender();
    });
    // 結果フィルタ
    document.getElementById('filter-result').addEventListener('change', (e) => {
      this.filterResult = e.target.value;
      this.currentPage = 1;
      this.filterAndRender();
    });

    await this.loadData();
  },

  async loadData() {
    const wrap = document.getElementById('applicants-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>スプレッドシートを読み込み中...</span></div>`;
    const countEl = document.getElementById('applicant-count');
    if (countEl) countEl.textContent = '';

    try {
      const [sheetData, reportsData] = await Promise.all([
        API.spreadsheet.applicants(),
        API.salesReports.list()
      ]);
      this.applicants = sheetData.applicants || [];
      this.visibleHeaders = sheetData.visibleHeaders || [];
      this.reports = reportsData || [];
      this.error = null;
      this.filterAndRender();
    } catch (err) {
      this.error = err.message;
      wrap.innerHTML = `
        <div style="padding:24px">
          <div class="alert alert-error">
            <i class="fas fa-exclamation-triangle"></i>
            <div>
              <strong>スプレッドシートの読み込みに失敗しました</strong><br>
              <span style="font-size:12px">${Utils.escHtml(err.message)}</span>
            </div>
          </div>
          <div class="alert alert-info">
            <i class="fas fa-info-circle"></i>
            <div>
              <strong>設定方法</strong><br>
              <span style="font-size:12px">
                環境変数 <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> にサービスアカウントのJSONを設定するか、<br>
                <code>GOOGLE_API_KEY</code> にAPIキーを設定してください。
              </span>
            </div>
          </div>
        </div>`;
    }
  },

  async loadReports() {
    try {
      this.reports = await API.salesReports.list();
      this.filterAndRender();
    } catch (e) {}
  },

  resetFilters() {
    this.searchQuery = '';
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.filterResult = '';
    this.sortCol = null;
    this.sortDir = 'desc';
    this.currentPage = 1;
    // UIリセット
    const s = document.getElementById('applicant-search');
    if (s) s.value = '';
    const df = document.getElementById('filter-date-from');
    if (df) df.value = '';
    const dt = document.getElementById('filter-date-to');
    if (dt) dt.value = '';
    const fr = document.getElementById('filter-result');
    if (fr) fr.value = '';
    this.filterAndRender();
  },

  getReportForApplicant(a) {
    return this.reports.find(r =>
      (a.email && r.applicant_email === a.email) ||
      (r.applicant_full_name === a.full_name)
    ) || null;
  },

  filterAndRender() {
    let list = [...this.applicants];

    // テキスト検索
    if (this.searchQuery) {
      const q = this.searchQuery;
      list = list.filter(a =>
        (a.full_name || '').toLowerCase().includes(q) ||
        (a.email || '').toLowerCase().includes(q)
      );
    }

    // 応募日フィルタ
    if (this.filterDateFrom) {
      const from = new Date(this.filterDateFrom);
      list = list.filter(a => {
        if (!a.date_parsed) return false;
        return new Date(a.date_parsed) >= from;
      });
    }
    if (this.filterDateTo) {
      const to = new Date(this.filterDateTo);
      to.setHours(23, 59, 59, 999);
      list = list.filter(a => {
        if (!a.date_parsed) return false;
        return new Date(a.date_parsed) <= to;
      });
    }

    // 結果フィルタ
    if (this.filterResult) {
      list = list.filter(a => {
        const report = this.getReportForApplicant(a);
        if (this.filterResult === 'contract') {
          return report && (report.result?.includes('契約') || report.result === '契約');
        } else if (this.filterResult === 'reported') {
          return !!report;
        } else if (this.filterResult === 'unreported') {
          return !report;
        }
        return true;
      });
    }

    // カラムソート（nullの場合は応募日降順 = バックエンドから受け取った順）
    if (this.sortCol !== null) {
      list.sort((a, b) => {
        const va = (a.visible_data[this.sortCol]?.value || '').toLowerCase();
        const vb = (b.visible_data[this.sortCol]?.value || '').toLowerCase();
        if (va < vb) return this.sortDir === 'asc' ? -1 : 1;
        if (va > vb) return this.sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    this.filteredApplicants = list;
    const countEl = document.getElementById('applicant-count');
    if (countEl) countEl.textContent = `${list.length}件`;

    this.renderTable();
    this.renderPagination();
  },

  sortByCol(colIdx) {
    if (this.sortCol === colIdx) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortCol = colIdx;
      this.sortDir = 'asc';
    }
    this.currentPage = 1;
    this.filterAndRender();
  },

  sortIcon(colIdx) {
    if (this.sortCol !== colIdx) return '<i class="fas fa-sort" style="color:var(--gray-300);font-size:10px;margin-left:3px"></i>';
    return this.sortDir === 'asc'
      ? '<i class="fas fa-sort-up" style="color:var(--primary);font-size:10px;margin-left:3px"></i>'
      : '<i class="fas fa-sort-down" style="color:var(--primary);font-size:10px;margin-left:3px"></i>';
  },

  renderTable() {
    const wrap = document.getElementById('applicants-table-wrap');
    if (!wrap || this.error) return;

    const { items } = Utils.paginate(this.filteredApplicants, this.currentPage, this.perPage);

    if (!this.filteredApplicants.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-user-slash"></i>
          <h3>${this.searchQuery || this.filterDateFrom || this.filterDateTo || this.filterResult ? '条件に一致するデータがありません' : '応募者データがありません'}</h3>
          <p>${this.searchQuery || this.filterDateFrom || this.filterDateTo || this.filterResult ? 'フィルター条件を変更してください' : 'スプレッドシートを確認してください'}</p>
        </div>`;
      return;
    }

    const headers = this.visibleHeaders;

    // 応募日列のインデックスを特定（visible_data内）
    const dateColIdx = headers.findIndex(h =>
      h && (h.trim().includes('応募日') || h.trim() === 'タイムスタンプ')
    );

    // ヘッダー行生成：氏名（本名）を先頭に固定
    const headerCells = [
      `<th style="white-space:nowrap;cursor:pointer;user-select:none" onclick="ApplicantsPage.sortByCol(-1)">
        氏名（本名）${this.sortIcon(-1)}
      </th>`
    ];
    headers.forEach((h, i) => {
      // 応募日列は先頭付近に目立たせる
      const isDateCol = i === dateColIdx;
      headerCells.push(
        `<th style="white-space:nowrap;cursor:pointer;user-select:none${isDateCol ? ';background:#eff6ff' : ''}"
          onclick="ApplicantsPage.sortByCol(${i})">
          ${Utils.escHtml(h)}${this.sortIcon(i)}
        </th>`
      );
    });
    headerCells.push(`<th style="text-align:center;white-space:nowrap">営業報告</th>`);

    // 行生成
    const rowsHtml = items.map(a => {
      const report = this.getReportForApplicant(a);
      const isContract = report && (report.result?.includes('契約') || report.result === '契約');
      const rowBg = isContract ? 'background:#f0fdf4' : '';

      // データセル（visible_data）
      const dataCells = a.visible_data.map((col, i) => {
        const isDateCol = i === dateColIdx;
        const cellStyle = isDateCol
          ? 'font-size:12px;white-space:nowrap;background:#eff6ff;font-weight:600'
          : 'font-size:12px;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis';
        const val = col.value || '-';
        return `<td style="${cellStyle}" title="${Utils.escHtml(col.value)}">${Utils.escHtml(val)}</td>`;
      });

      // 営業報告ボタン
      // applicantのJSONをdata属性で安全に渡す
      const safeId = `app-${a.row_index}`;

      // Store applicant data globally for retrieval
      ApplicantsPage._cache = ApplicantsPage._cache || {};
      ApplicantsPage._cache[safeId] = a;

      const reportCell = report
        ? `<div style="display:flex;flex-direction:column;align-items:center;gap:4px">
            ${isContract
              ? '<span class="badge badge-contract" style="font-size:10px"><i class="fas fa-check"></i> 契約済</span>'
              : `<span class="badge badge-default" style="font-size:10px">${Utils.escHtml(report.result || '報告あり')}</span>`
            }
            <button class="btn btn-secondary btn-xs" onclick="ApplicantsPage.editReport('${safeId}',${report.id})">
              <i class="fas fa-edit"></i> 編集
            </button>
          </div>`
        : `<button class="btn btn-primary btn-sm" onclick="ApplicantsPage.openSalesReport('${safeId}')">
            <i class="fas fa-plus"></i> 営業報告
          </button>`;

      return `
        <tr style="${rowBg}">
          <td style="white-space:nowrap;font-weight:600;font-size:13px">
            ${Utils.escHtml(a.full_name) || '-'}
          </td>
          ${dataCells.join('')}
          <td style="text-align:center;white-space:nowrap">${reportCell}</td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
      <div class="scroll-hint" style="padding:6px 12px 2px;font-size:11px;color:var(--gray-400)">
        <i class="fas fa-arrows-alt-h"></i> 横スクロール可 &nbsp;|&nbsp;
        <i class="fas fa-sort-amount-down"></i> ヘッダークリックでソート
      </div>
      <div style="overflow-x:auto">
        <table style="min-width:900px">
          <thead>
            <tr>${headerCells.join('')}</tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
  },

  renderPagination() {
    const paginEl = document.getElementById('applicants-pagination');
    if (!paginEl) return;

    const total = this.filteredApplicants.length;
    const totalPages = Math.ceil(total / this.perPage);
    const page = this.currentPage;

    if (totalPages <= 1) { paginEl.innerHTML = ''; return; }

    const start = (page - 1) * this.perPage + 1;
    const end = Math.min(page * this.perPage, total);

    let pageButtons = '';
    const range = 2;
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= page - range && i <= page + range)) {
        pageButtons += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="ApplicantsPage.goPage(${i})">${i}</button>`;
      } else if (i === page - range - 1 || i === page + range + 1) {
        pageButtons += `<span style="padding:0 4px;color:var(--gray-400)">…</span>`;
      }
    }

    paginEl.innerHTML = `
      <div class="pagination">
        <span>${start}〜${end}件 / 全${total}件</span>
        <div class="pagination-controls">
          <button class="page-btn" onclick="ApplicantsPage.goPage(${page-1})" ${page<=1?'disabled':''}>
            <i class="fas fa-chevron-left"></i>
          </button>
          ${pageButtons}
          <button class="page-btn" onclick="ApplicantsPage.goPage(${page+1})" ${page>=totalPages?'disabled':''}>
            <i class="fas fa-chevron-right"></i>
          </button>
        </div>
      </div>`;
  },

  goPage(page) {
    const totalPages = Math.ceil(this.filteredApplicants.length / this.perPage);
    if (page < 1 || page > totalPages) return;
    this.currentPage = page;
    this.renderTable();
    this.renderPagination();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  openSalesReport(safeId) {
    const a = this._cache?.[safeId];
    if (!a) { Utils.notify('データが見つかりません', 'error'); return; }
    SalesReportModal.open(a, null);
  },

  async editReport(safeId, reportId) {
    const a = this._cache?.[safeId];
    if (!a) { Utils.notify('データが見つかりません', 'error'); return; }
    try {
      const report = await API.salesReports.get(reportId);
      SalesReportModal.open(a, report);
    } catch (e) {
      Utils.notify('エラーが発生しました', 'error');
    }
  }
};
