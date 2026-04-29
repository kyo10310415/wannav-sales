// Applicants Page
const ApplicantsPage = {
  applicants: [],        // 全データ（バックエンドでソート済み）
  filteredApplicants: [], // フィルタ後
  reports: [],
  visibleHeaders: [],
  currentPage: 1,
  perPage: 20,
  error: null,
  cacheInfo: null,       // キャッシュ情報

  // フィルタ・ソート状態
  searchQuery: '',
  filterResult: '',   // 営業報告の結果フィルタ
  filterDateFrom: '',
  filterDateTo: '',
  sortCol: null,      // null = 応募日降順（デフォルト）
  sortDir: 'desc',

  // 面接日保存中フラグ（行ごと）
  _savingInterviewDate: {},

  render() {
    return `
      <div class="page-header">
        <div>
          <div class="page-title"><i class="fas fa-users" style="margin-right:8px;color:var(--primary)"></i>応募者一覧</div>
          <div class="page-subtitle">スプレッドシートから取得（重複除外・応募日降順）</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <div id="cache-status-badge"></div>
          <button class="btn btn-secondary" onclick="ApplicantsPage.loadData(false)">
            <i class="fas fa-sync-alt"></i> 更新
          </button>
          <button class="btn btn-primary btn-sm" onclick="ApplicantsPage.forceRefresh()" title="スプレッドシートを今すぐ再取得">
            <i class="fas fa-cloud-download-alt"></i> 強制更新
          </button>
        </div>
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

  async loadData(useCache = true) {
    const wrap = document.getElementById('applicants-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>${useCache ? 'データを読み込み中...' : 'スプレッドシートを取得中...'}</span></div>`;
    const countEl = document.getElementById('applicant-count');
    if (countEl) countEl.textContent = '';

    try {
      const params = useCache ? {} : { refresh: '1' };
      const [sheetData, reportsData] = await Promise.all([
        API.spreadsheet.applicants(params),
        API.salesReports.list()
      ]);
      this.applicants = sheetData.applicants || [];
      this.visibleHeaders = sheetData.visibleHeaders || [];
      this.reports = reportsData || [];
      this.cacheInfo = {
        cached: sheetData.cached,
        age: sheetData.cache_age_seconds,
        stale: sheetData.stale,
      };
      this.error = null;
      this.renderCacheBadge();
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

  async forceRefresh() {
    const btn = document.querySelector('[onclick="ApplicantsPage.forceRefresh()"]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 取得中...'; }
    await this.loadData(false);
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-download-alt"></i> 強制更新'; }
    Utils.notify('スプレッドシートを最新データで更新しました', 'success');
  },

  renderCacheBadge() {
    const el = document.getElementById('cache-status-badge');
    if (!el || !this.cacheInfo) return;
    const age = this.cacheInfo.age;
    const ageText = age !== null
      ? (age < 60 ? `${age}秒前` : `${Math.floor(age/60)}分前`)
      : '初回取得';
    const color = this.cacheInfo.stale ? 'var(--warning)' : 'var(--success)';
    const icon = this.cacheInfo.stale ? 'fa-exclamation-triangle' : 'fa-check-circle';
    el.innerHTML = `
      <span style="font-size:11px;color:${color};display:flex;align-items:center;gap:4px;background:white;border:1px solid var(--gray-200);border-radius:6px;padding:4px 8px">
        <i class="fas ${icon}"></i>
        ${this.cacheInfo.stale ? '古いキャッシュ' : `キャッシュ (${ageText})`}
      </span>`;
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

  // 列ごとの幅設定（visible_data のヘッダー名 → px）
  _colWidth(headerName) {
    const map = {
      '応募日':       '82px',
      '応募月':       '64px',
      '性別':         '44px',
      '生年月日':     '82px',
      '一次面接担当': '76px',
      '二次面接担当': '76px',
      '書類通過':     '58px',
      '面接予約':     '58px',
      '一次面接実施': '72px',
      'AIレコメン実施':'80px',
      '面接実施':     '60px',
      '飛び':         '40px',
      'CV':           '38px',
      '広告媒体':     '70px',
      'ブラックリスト':'76px',
    };
    return map[headerName ? headerName.trim() : ''] || '80px';
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
    const dateColIdx = (() => {
      const exact = headers.findIndex(h => h && h.trim() === '応募日');
      if (exact !== -1) return exact;
      return headers.findIndex(h => h && h.trim() === 'タイムスタンプ');
    })();

    // <colgroup> で各列幅を固定
    const colDefs = [
      `<col style="width:110px;min-width:90px">`,  // 氏名（本名）
      `<col style="width:100px;min-width:88px">`,  // 面接日
    ];
    headers.forEach(h => {
      colDefs.push(`<col style="width:${this._colWidth(h)}">`);
    });
    colDefs.push(`<col style="width:80px;min-width:72px">`); // 営業報告

    // ヘッダー行生成：氏名（本名）を先頭、面接日を2列目に固定
    const headerCells = [
      `<th style="cursor:pointer;user-select:none;font-size:11px;padding:6px 6px"
          onclick="ApplicantsPage.sortByCol(-1)">
        氏名（本名）${this.sortIcon(-1)}
      </th>`,
      `<th style="font-size:11px;padding:6px 4px;text-align:center;background:#faf5ff;color:#7c3aed;white-space:nowrap">
        <i class="fas fa-calendar-alt" style="margin-right:3px;font-size:10px"></i>面接日
      </th>`,
    ];
    headers.forEach((h, i) => {
      const isDateCol = i === dateColIdx;
      headerCells.push(
        `<th style="cursor:pointer;user-select:none;font-size:11px;padding:6px 4px;text-align:center${isDateCol ? ';background:#eff6ff' : ''}"
          onclick="ApplicantsPage.sortByCol(${i})">
          ${Utils.escHtml(h)}${this.sortIcon(i)}
        </th>`
      );
    });
    headerCells.push(`<th style="text-align:center;font-size:11px;padding:6px 4px">営業報告</th>`);

    // 行生成
    const rowsHtml = items.map(a => {
      const report = this.getReportForApplicant(a);
      const isContract = report && (report.result?.includes('契約') || report.result === '契約');
      const rowBg = isContract ? 'background:#f0fdf4' : '';

      // キャッシュキー
      const safeId = `app-${a.row_index}`;
      ApplicantsPage._cache = ApplicantsPage._cache || {};
      ApplicantsPage._cache[safeId] = a;

      // 面接日セル
      const interviewDateVal = report?.interview_date || '';
      const isSaving = !!this._savingInterviewDate[safeId];
      const interviewDateCell = this._renderInterviewDateCell(safeId, report?.id || null, interviewDateVal, isSaving);

      // データセル（visible_data）
      const dataCells = a.visible_data.map((col, i) => {
        const isDateCol = i === dateColIdx;
        const val = col.value || '-';
        const cellStyle = isDateCol
          ? 'font-size:11px;padding:5px 4px;background:#eff6ff;font-weight:600;white-space:nowrap;text-align:center'
          : 'font-size:11px;padding:5px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:0;text-align:center';
        return `<td style="${cellStyle}" title="${Utils.escHtml(col.value)}">${Utils.escHtml(val)}</td>`;
      });

      // 営業報告ボタン
      const reportCell = report
        ? `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
            ${isContract
              ? '<span style="font-size:9px;background:#dcfce7;color:#16a34a;border-radius:4px;padding:1px 5px;font-weight:700"><i class="fas fa-check"></i> 契約</span>'
              : `<span style="font-size:9px;background:#f3f4f6;color:#374151;border-radius:4px;padding:1px 5px">${Utils.escHtml(report.result || '報告あり')}</span>`
            }
            <button class="btn btn-secondary btn-xs" style="font-size:10px;padding:2px 6px"
              onclick="ApplicantsPage.editReport('${safeId}',${report.id})">
              <i class="fas fa-edit"></i>
            </button>
          </div>`
        : `<button class="btn btn-primary btn-xs" style="font-size:10px;padding:3px 6px"
            onclick="ApplicantsPage.openSalesReport('${safeId}')">
            <i class="fas fa-plus"></i> 報告
          </button>`;

      return `
        <tr style="${rowBg}">
          <td style="font-weight:600;font-size:12px;padding:5px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:0"
              title="${Utils.escHtml(a.full_name)}">
            ${Utils.escHtml(a.full_name) || '-'}
          </td>
          <td style="padding:3px 4px;background:#faf5ff;text-align:center;white-space:nowrap">
            ${interviewDateCell}
          </td>
          ${dataCells.join('')}
          <td style="text-align:center;padding:4px 2px;white-space:nowrap">${reportCell}</td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
      <div style="padding:4px 10px 2px;font-size:10px;color:var(--gray-400)">
        <i class="fas fa-sort-amount-down"></i> ヘッダークリックでソート &nbsp;|&nbsp;
        <i class="fas fa-mouse-pointer"></i> セルにカーソルで全文表示 &nbsp;|&nbsp;
        <i class="fas fa-calendar-alt" style="color:#7c3aed"></i> <span style="color:#7c3aed">面接日</span>はカレンダーで入力・即時保存
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;table-layout:fixed;border-collapse:collapse">
          <colgroup>${colDefs.join('')}</colgroup>
          <thead>
            <tr>${headerCells.join('')}</tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;

    // 面接日 input のイベントを一括バインド
    this._bindInterviewDateEvents();
  },

  // -------------------------------------------------------
  // 面接日セル HTML 生成
  // -------------------------------------------------------
  _renderInterviewDateCell(safeId, reportId, dateVal, isSaving) {
    if (isSaving) {
      return `<span style="font-size:10px;color:var(--gray-400)"><i class="fas fa-spinner fa-spin"></i></span>`;
    }

    // reportId がある場合のみ日付入力を活性化
    // ない場合はグレーアウトして「報告後に入力可」を示す
    if (reportId === null) {
      return `
        <span style="font-size:10px;color:var(--gray-300)" title="先に営業報告を作成してください">
          <i class="fas fa-calendar-alt"></i> —
        </span>`;
    }

    const displayVal = dateVal
      ? (() => {
          const d = new Date(dateVal);
          return isNaN(d) ? dateVal : `${d.getMonth()+1}/${d.getDate()}`;
        })()
      : '';

    return `
      <div class="interview-date-wrap" style="position:relative;display:inline-block">
        <input
          type="date"
          class="interview-date-input"
          data-safe-id="${safeId}"
          data-report-id="${reportId}"
          value="${Utils.escHtml(dateVal)}"
          title="${dateVal ? Utils.escHtml(dateVal) : '面接日を選択'}"
          style="
            width:88px;
            padding:3px 4px 3px 20px;
            font-size:11px;
            border:1px solid #ddd8fe;
            border-radius:5px;
            background:white;
            color:${dateVal ? '#5b21b6' : 'var(--gray-400)'};
            cursor:pointer;
            outline:none;
          "
        >
        <i class="fas fa-calendar-alt" style="
          position:absolute;
          left:5px;
          top:50%;
          transform:translateY(-50%);
          color:#a78bfa;
          font-size:10px;
          pointer-events:none;
        "></i>
        ${dateVal
          ? `<span style="
              position:absolute;
              right:-2px;top:-5px;
              width:14px;height:14px;
              background:#7c3aed;
              border-radius:50%;
              display:flex;align-items:center;justify-content:center;
              cursor:pointer;font-size:8px;color:white;
            "
            onclick="ApplicantsPage.clearInterviewDate('${safeId}', ${reportId})"
            title="面接日をクリア">✕</span>`
          : ''}
      </div>`;
  },

  // -------------------------------------------------------
  // 面接日 input イベント一括バインド（renderTable後に呼ぶ）
  // -------------------------------------------------------
  _bindInterviewDateEvents() {
    const inputs = document.querySelectorAll('.interview-date-input');
    inputs.forEach(input => {
      input.addEventListener('change', (e) => {
        const safeId   = e.target.dataset.safeId;
        const reportId = parseInt(e.target.dataset.reportId);
        const newDate  = e.target.value; // 'YYYY-MM-DD' or ''
        this.saveInterviewDate(safeId, reportId, newDate);
      });
      // focus時: ブラウザのネイティブカレンダーを開く
      input.addEventListener('focus', (e) => {
        try { e.target.showPicker && e.target.showPicker(); } catch(_) {}
      });
    });
  },

  // -------------------------------------------------------
  // 面接日を即時保存
  // -------------------------------------------------------
  async saveInterviewDate(safeId, reportId, newDate) {
    if (this._savingInterviewDate[safeId]) return;
    this._savingInterviewDate[safeId] = true;

    // セルをスピナー表示
    this._updateInterviewDateCell(safeId, null, null, true);

    try {
      // 現在の営業報告データを取得
      const currentReport = await API.salesReports.get(reportId);

      // interview_date だけ更新して PUT
      await API.salesReports.update(reportId, {
        ...currentReport,
        interview_date: newDate || null,
      });

      // reportsキャッシュを更新
      const idx = this.reports.findIndex(r => r.id === reportId);
      if (idx !== -1) {
        this.reports[idx] = { ...this.reports[idx], interview_date: newDate || null };
      }

      Utils.notify(newDate ? `面接日を ${newDate} に保存しました` : '面接日をクリアしました', 'success');
    } catch (err) {
      Utils.notify('面接日の保存に失敗しました: ' + err.message, 'error');
    } finally {
      this._savingInterviewDate[safeId] = false;
      // セルを再描画
      const report = this.reports.find(r => r.id === reportId);
      this._updateInterviewDateCell(safeId, reportId, report?.interview_date || '', false);
    }
  },

  // -------------------------------------------------------
  // 面接日をクリア
  // -------------------------------------------------------
  async clearInterviewDate(safeId, reportId) {
    await this.saveInterviewDate(safeId, reportId, '');
  },

  // -------------------------------------------------------
  // 特定行の面接日セルだけ DOM 更新（テーブル全体を再描画しない）
  // -------------------------------------------------------
  _updateInterviewDateCell(safeId, reportId, dateVal, isSaving) {
    // data-safe-id からセルを探す
    const input = document.querySelector(`.interview-date-input[data-safe-id="${safeId}"]`);
    const cell = input
      ? input.closest('td')
      : document.querySelector(`td[data-interview-td="${safeId}"]`);

    if (!cell) return;

    const html = this._renderInterviewDateCell(safeId, reportId, dateVal || '', isSaving);
    cell.innerHTML = html;

    // 再バインド（このセルのみ）
    const newInput = cell.querySelector('.interview-date-input');
    if (newInput) {
      newInput.addEventListener('change', (e) => {
        const sid   = e.target.dataset.safeId;
        const rid   = parseInt(e.target.dataset.reportId);
        const d     = e.target.value;
        this.saveInterviewDate(sid, rid, d);
      });
      newInput.addEventListener('focus', (e) => {
        try { e.target.showPicker && e.target.showPicker(); } catch(_) {}
      });
    }
    const clearBtn = cell.querySelector('[onclick*="clearInterviewDate"]');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearInterviewDate(safeId, reportId);
      });
    }
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
