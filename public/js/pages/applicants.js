// Applicants Page
const ApplicantsPage = {
  applicants: [],
  filteredApplicants: [],
  reports: [],
  headers: [],
  currentPage: 1,
  perPage: 20,
  searchQuery: '',
  loading: false,
  error: null,

  render() {
    return `
      <div class="page-header">
        <div>
          <div class="page-title"><i class="fas fa-users" style="margin-right:8px;color:var(--primary)"></i>応募者一覧</div>
          <div class="page-subtitle">スプレッドシートから取得（重複除外済み）</div>
        </div>
        <button class="btn btn-secondary" id="refresh-btn" onclick="ApplicantsPage.loadData()">
          <i class="fas fa-sync-alt"></i> 更新
        </button>
      </div>
      <div class="page-body">
        <div class="toolbar">
          <div class="search-wrapper">
            <i class="fas fa-search"></i>
            <input type="text" class="search-input" id="applicant-search" placeholder="名前・メールで検索..." style="width:100%">
          </div>
          <span id="applicant-count" style="font-size:13px;color:var(--gray-500)"></span>
        </div>
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
    document.getElementById('applicant-search').addEventListener('input',
      Utils.debounce((e) => {
        this.searchQuery = e.target.value.toLowerCase();
        this.currentPage = 1;
        this.filterAndRender();
      }, 300)
    );

    await this.loadData();
  },

  async loadData() {
    const wrap = document.getElementById('applicants-table-wrap');
    if (!wrap) return;

    wrap.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>スプレッドシートを読み込み中...</span></div>`;
    document.getElementById('applicant-count').textContent = '';

    try {
      const [sheetData, reportsData] = await Promise.all([
        API.spreadsheet.applicants(),
        API.salesReports.list()
      ]);
      this.applicants = sheetData.applicants || [];
      this.headers = sheetData.headers || [];
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
              <span style="font-size:12px">${Utils.escHtml(err.message)}</span><br>
              <span style="font-size:12px;color:var(--gray-500)">Google APIキーまたはサービスアカウント認証情報の設定が必要です。</span>
            </div>
          </div>
          <div class="alert alert-info">
            <i class="fas fa-info-circle"></i>
            <div>
              <strong>設定方法</strong><br>
              <span style="font-size:12px">環境変数 <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> にサービスアカウントのJSONを設定するか、<br>
              <code>GOOGLE_API_KEY</code> にAPIキーを設定してください。<br>
              スプレッドシートは公開または共有されている必要があります。</span>
            </div>
          </div>
        </div>
      `;
      document.getElementById('applicant-count').textContent = '';
    }
  },

  async loadReports() {
    try {
      this.reports = await API.salesReports.list();
      this.filterAndRender();
    } catch (e) {}
  },

  filterAndRender() {
    const q = this.searchQuery;
    this.filteredApplicants = q
      ? this.applicants.filter(a =>
          a.full_name.toLowerCase().includes(q) ||
          (a.email || '').toLowerCase().includes(q) ||
          (a.columns.A || '').toLowerCase().includes(q)
        )
      : this.applicants;

    const total = this.filteredApplicants.length;
    const countEl = document.getElementById('applicant-count');
    if (countEl) countEl.textContent = `${total}件`;

    this.renderTable();
    this.renderPagination();
  },

  getReportForApplicant(applicant) {
    // Match by email or name
    return this.reports.find(r =>
      (applicant.email && r.applicant_email === applicant.email) ||
      (r.applicant_full_name === applicant.full_name)
    ) || null;
  },

  renderTable() {
    const wrap = document.getElementById('applicants-table-wrap');
    if (!wrap) return;

    const { items, totalPages, total, page } = Utils.paginate(
      this.filteredApplicants, this.currentPage, this.perPage
    );

    if (!this.filteredApplicants.length) {
      if (this.error) return;
      wrap.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-user-slash"></i>
          <h3>${this.searchQuery ? '検索結果がありません' : '応募者データがありません'}</h3>
          <p>${this.searchQuery ? '検索条件を変更してください' : 'スプレッドシートを確認してください'}</p>
        </div>
      `;
      return;
    }

    // Build header row from headers array
    const h = this.headers;
    wrap.innerHTML = `
      <div class="scroll-hint"><i class="fas fa-arrows-alt-h"></i> 横スクロール可能</div>
      <div style="overflow-x:auto">
        <table style="min-width:1200px">
          <thead>
            <tr>
              ${h.slice(0, 27).map((header, i) => `<th style="font-size:10px;padding:8px 8px">${Utils.escHtml(header) || String.fromCharCode(65 + i)}</th>`).join('')}
              <th style="text-align:center;white-space:nowrap">営業報告</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(a => {
              const report = this.getReportForApplicant(a);
              const cols = a.columns;
              const colValues = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','AA'];
              const isContract = report && (report.result?.includes('契約') || report.result === '契約');
              const rowStyle = isContract ? 'background:#f0fdf4' : '';
              return `
                <tr style="${rowStyle}">
                  ${colValues.map(c => `<td style="font-size:12px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis" title="${Utils.escHtml(cols[c])}">${Utils.escHtml(cols[c]) || '-'}</td>`).join('')}
                  <td style="text-align:center;white-space:nowrap">
                    ${report
                      ? `
                        <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
                          ${isContract
                            ? '<span class="badge badge-contract" style="font-size:10px"><i class="fas fa-check"></i> 契約済</span>'
                            : `<span class="badge badge-default" style="font-size:10px">${Utils.escHtml(report.result || '報告あり')}</span>`
                          }
                          <button class="btn btn-secondary btn-xs" onclick="ApplicantsPage.editReport('${Utils.escHtml(JSON.stringify(a))}', ${report.id})">
                            <i class="fas fa-edit"></i> 編集
                          </button>
                        </div>
                      `
                      : `<button class="btn btn-primary btn-sm" onclick="ApplicantsPage.openSalesReport('${Utils.escHtml(JSON.stringify(a))}')">
                          <i class="fas fa-plus"></i> 営業報告
                        </button>`
                    }
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  renderPagination() {
    const paginEl = document.getElementById('applicants-pagination');
    if (!paginEl) return;

    const { totalPages, total, page } = Utils.paginate(
      this.filteredApplicants, this.currentPage, this.perPage
    );

    if (totalPages <= 1) {
      paginEl.innerHTML = '';
      return;
    }

    const start = (page - 1) * this.perPage + 1;
    const end = Math.min(page * this.perPage, total);

    let pageButtons = '';
    const range = 2;
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= page - range && i <= page + range)) {
        pageButtons += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="ApplicantsPage.goPage(${i})">${i}</button>`;
      } else if (i === page - range - 1 || i === page + range + 1) {
        pageButtons += `<span style="padding:0 4px;color:var(--gray-400)">...</span>`;
      }
    }

    paginEl.innerHTML = `
      <div class="pagination">
        <span>${start}〜${end}件 / 全${total}件</span>
        <div class="pagination-controls">
          <button class="page-btn" onclick="ApplicantsPage.goPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>
            <i class="fas fa-chevron-left"></i>
          </button>
          ${pageButtons}
          <button class="page-btn" onclick="ApplicantsPage.goPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>
            <i class="fas fa-chevron-right"></i>
          </button>
        </div>
      </div>
    `;
  },

  goPage(page) {
    const totalPages = Math.ceil(this.filteredApplicants.length / this.perPage);
    if (page < 1 || page > totalPages) return;
    this.currentPage = page;
    this.renderTable();
    this.renderPagination();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  openSalesReport(applicantJson) {
    try {
      const applicant = JSON.parse(applicantJson);
      SalesReportModal.open(applicant, null);
    } catch (e) {
      Utils.notify('エラーが発生しました', 'error');
    }
  },

  async editReport(applicantJson, reportId) {
    try {
      const applicant = JSON.parse(applicantJson);
      const report = await API.salesReports.get(reportId);
      SalesReportModal.open(applicant, report);
    } catch (e) {
      Utils.notify('エラーが発生しました', 'error');
    }
  }
};
