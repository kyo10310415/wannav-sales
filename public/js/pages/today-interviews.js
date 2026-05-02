// Today's Interviews Page
const TodayInterviewsPage = {
  applicants: [],
  interviewDates: {},
  reports: [],
  filteredApplicants: [],

  currentDate: '',   // YYYY-MM-DD
  searchQuery: '',
  sortCol: null,     // 'name' | 'interview_date' | 'apply_date' | 'gender'
  sortDir: 'asc',

  _savingDate: {},
  _cache: {},

  // ---------- helpers ----------
  _today() {
    return dayjs().format('YYYY-MM-DD');
  },

  _fmt(date) {
    return date ? dayjs(date).format('YYYY/MM/DD') : '';
  },

  _applicantKey(a) {
    return (a.email && a.email.trim()) ? a.email.trim() : (a.full_name || '').trim();
  },

  _shift(days) {
    this.currentDate = dayjs(this.currentDate).add(days, 'day').format('YYYY-MM-DD');
    this._updateDateDisplay();
    this.filterAndRender();
  },

  _updateDateDisplay() {
    const el = document.getElementById('today-date-display');
    if (!el) return;
    const d = dayjs(this.currentDate);
    const today  = this._today();
    const isToday = this.currentDate === today;
    const label  = isToday ? '今日' : (this.currentDate === dayjs(today).subtract(1,'day').format('YYYY-MM-DD') ? '昨日' : this.currentDate === dayjs(today).add(1,'day').format('YYYY-MM-DD') ? '明日' : '');
    el.innerHTML = `
      <span style="font-weight:700;font-size:18px">${d.format('YYYY年M月D日')}</span>
      ${label ? `<span style="margin-left:6px;font-size:12px;background:${isToday ? '#dbeafe' : '#f3f4f6'};color:${isToday ? '#1d4ed8' : '#374151'};border-radius:10px;padding:2px 8px">${label}</span>` : ''}
    `;

    // 「今日に戻る」ボタンの表示切替
    const todayBtn = document.getElementById('today-jump-btn');
    if (todayBtn) todayBtn.style.display = isToday ? 'none' : 'inline-flex';
  },

  _getGender(a) {
    if (!a.visible_data) return '';
    const headers = this._headers || [];
    const idx = headers.findIndex(h => h && h.trim() === '性別');
    if (idx === -1) return '';
    return a.visible_data[idx]?.value || '';
  },

  _getApplyDate(a) {
    if (!a.visible_data) return '';
    const headers = this._headers || [];
    const idx = headers.findIndex(h => h && (h.trim() === '応募日' || h.trim() === 'タイムスタンプ'));
    if (idx === -1) return a.date_parsed || '';
    return a.visible_data[idx]?.value || a.date_parsed || '';
  },

  getReportForApplicant(a) {
    return this.reports.find(r =>
      (a.email && r.applicant_email === a.email) ||
      (r.applicant_full_name === a.full_name)
    ) || null;
  },

  // ---------- render ----------
  render() {
    return `
      <div class="page-header">
        <div>
          <div class="page-title">
            <i class="fas fa-calendar-day" style="margin-right:8px;color:#2563eb"></i>今日の面接
          </div>
          <div class="page-subtitle">面接日が一致する応募者を表示</div>
        </div>
      </div>

      <div class="page-body">
        <!-- 日付ナビ -->
        <div class="card" style="margin-bottom:12px">
          <div class="card-body" style="padding:12px 16px">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <button class="btn btn-secondary btn-sm" onclick="TodayInterviewsPage._shift(-1)">
                <i class="fas fa-chevron-left"></i> 前日
              </button>
              <div id="today-date-display" style="flex:1;text-align:center;min-width:180px"></div>
              <button class="btn btn-secondary btn-sm" onclick="TodayInterviewsPage._shift(1)">
                翌日 <i class="fas fa-chevron-right"></i>
              </button>
              <button id="today-jump-btn" class="btn btn-primary btn-sm"
                style="display:none"
                onclick="TodayInterviewsPage.jumpToday()">
                <i class="fas fa-crosshairs"></i> 今日に戻る
              </button>
            </div>
          </div>
        </div>

        <!-- 検索・ソート -->
        <div class="card" style="margin-bottom:12px">
          <div class="card-body" style="padding:10px 16px">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
              <div style="flex:1;min-width:180px">
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px">フリー検索</div>
                <div class="search-wrapper" style="max-width:100%">
                  <i class="fas fa-search"></i>
                  <input type="text" class="search-input" id="today-search"
                    placeholder="氏名で検索..." style="width:100%">
                </div>
              </div>
              <div>
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px">ソート</div>
                <select id="today-sort-select" class="form-control" style="width:130px">
                  <option value="name_asc">氏名 A→Z</option>
                  <option value="name_desc">氏名 Z→A</option>
                  <option value="apply_date_desc">応募日 新→旧</option>
                  <option value="apply_date_asc">応募日 旧→新</option>
                  <option value="gender_asc">性別</option>
                </select>
              </div>
              <span id="today-count"
                style="font-size:13px;color:var(--gray-500);align-self:center;margin-left:auto;white-space:nowrap">
              </span>
            </div>
          </div>
        </div>

        <!-- テーブル -->
        <div class="card">
          <div class="card-body" style="padding:0">
            <div id="today-table-wrap">
              <div class="loading-spinner">
                <div class="spinner"></div><span>読み込み中...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  // ---------- mount ----------
  async mount() {
    this.currentDate = this._today();

    document.getElementById('today-search').addEventListener('input',
      Utils.debounce((e) => {
        this.searchQuery = e.target.value.toLowerCase();
        this.filterAndRender();
      }, 250)
    );

    document.getElementById('today-sort-select').addEventListener('change', (e) => {
      const [col, dir] = e.target.value.split('_asc').length > 1
        ? [e.target.value.replace('_asc',''), 'asc']
        : [e.target.value.replace('_desc',''), 'desc'];
      this.sortCol = col;
      this.sortDir = dir;
      this.filterAndRender();
    });

    await this.loadData();
    this._updateDateDisplay();
  },

  // ---------- data ----------
  async loadData() {
    const wrap = document.getElementById('today-table-wrap');
    if (wrap) wrap.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>データを読み込み中...</span></div>`;

    try {
      const [sheetData, reportsData, datesData] = await Promise.all([
        API.spreadsheet.applicants({}),
        API.salesReports.list(),
        API.interviewDates.list(),
      ]);
      this.applicants    = sheetData.applicants || [];
      this._headers      = sheetData.visibleHeaders || [];
      this.reports       = reportsData || [];
      this.interviewDates = datesData || {};
      this.filterAndRender();
    } catch (err) {
      if (wrap) wrap.innerHTML = `
        <div style="padding:24px">
          <div class="alert alert-error">
            <i class="fas fa-exclamation-triangle"></i>
            <span>${Utils.escHtml(err.message)}</span>
          </div>
        </div>`;
    }
  },

  jumpToday() {
    this.currentDate = this._today();
    this._updateDateDisplay();
    this.filterAndRender();
  },

  // ---------- filter & sort ----------
  filterAndRender() {
    // 面接日が currentDate と一致するものだけ
    let list = this.applicants.filter(a => {
      const key  = this._applicantKey(a);
      const date = this.interviewDates[key] || '';
      return date === this.currentDate;
    });

    // フリー検索
    if (this.searchQuery) {
      const q = this.searchQuery;
      list = list.filter(a => (a.full_name || '').toLowerCase().includes(q));
    }

    // ソート
    list = this._sort(list);

    this.filteredApplicants = list;

    const countEl = document.getElementById('today-count');
    if (countEl) countEl.textContent = `${list.length}件`;

    this._updateDateDisplay();
    this.renderTable();
  },

  _sort(list) {
    if (!this.sortCol) return list;
    return [...list].sort((a, b) => {
      let va = '', vb = '';
      if (this.sortCol === 'name') {
        va = a.full_name || '';
        vb = b.full_name || '';
      } else if (this.sortCol === 'apply_date') {
        va = this._getApplyDate(a);
        vb = this._getApplyDate(b);
      } else if (this.sortCol === 'gender') {
        va = this._getGender(a);
        vb = this._getGender(b);
      }
      if (va < vb) return this.sortDir === 'asc' ? -1 : 1;
      if (va > vb) return this.sortDir === 'asc' ?  1 : -1;
      return 0;
    });
  },

  // ---------- table ----------
  renderTable() {
    const wrap = document.getElementById('today-table-wrap');
    if (!wrap) return;

    if (!this.filteredApplicants.length) {
      wrap.innerHTML = `
        <div class="empty-state" style="padding:48px 24px">
          <i class="fas fa-calendar-times" style="font-size:40px;color:var(--gray-300)"></i>
          <h3 style="margin-top:12px;color:var(--gray-500)">
            ${this.searchQuery ? '条件に一致する面接がありません' : 'この日の面接はありません'}
          </h3>
          <p style="color:var(--gray-400);font-size:13px">
            ${this.searchQuery ? '検索ワードを変えてみてください' : '前日・翌日も確認できます'}
          </p>
        </div>`;
      return;
    }

    const rows = this.filteredApplicants.map(a => {
      const key        = this._applicantKey(a);
      const safeId     = `ti-${a.row_index}`;
      const report     = this.getReportForApplicant(a);
      const isContract = report && (report.result?.includes('契約') || report.result === '契約');
      const rowBg      = isContract ? 'background:#f0fdf4' : '';
      const gender     = this._getGender(a);
      const applyDate  = this._getApplyDate(a);
      const iDate      = this.interviewDates[key] || '';
      const isSaving   = !!this._savingDate[key];

      this._cache[safeId] = a;

      // 面接日セル（編集可）
      const interviewDateCell = isSaving
        ? `<span style="font-size:11px;color:var(--gray-400)"><i class="fas fa-spinner fa-spin"></i></span>`
        : `<input type="date"
            class="ti-date-input"
            data-app-key="${Utils.escHtml(key)}"
            value="${Utils.escHtml(iDate)}"
            style="width:110px;padding:4px 6px;font-size:11px;border:1px solid #c4b5fd;border-radius:5px;background:#faf5ff;color:#6d28d9;font-weight:600;cursor:pointer;outline:none">`;

      // 営業報告ボタン
      const reportCell = report
        ? `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
            ${isContract
              ? '<span style="font-size:9px;background:#dcfce7;color:#16a34a;border-radius:4px;padding:1px 5px;font-weight:700"><i class="fas fa-check"></i> 契約</span>'
              : `<span style="font-size:9px;background:#f3f4f6;color:#374151;border-radius:4px;padding:1px 5px">${Utils.escHtml(report.result || '報告あり')}</span>`}
            <button class="btn btn-secondary btn-xs" style="font-size:10px;padding:2px 8px"
              onclick="TodayInterviewsPage.editReport('${safeId}',${report.id})">
              <i class="fas fa-edit"></i> 編集
            </button>
            <button class="btn btn-xs" style="font-size:10px;padding:2px 8px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:4px;cursor:pointer;margin-top:1px"
              onclick="TodayInterviewsPage.openSukuukun('${safeId}')">
              🤖 すくう君
            </button>
          </div>`
        : `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
            <button class="btn btn-primary btn-xs" style="font-size:10px;padding:3px 8px"
              onclick="TodayInterviewsPage.openSalesReport('${safeId}')">
              <i class="fas fa-plus"></i> 報告
            </button>
            <button class="btn btn-xs" style="font-size:10px;padding:2px 8px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:4px;cursor:pointer;margin-top:1px"
              onclick="TodayInterviewsPage.openSukuukun('${safeId}')">
              🤖 すくう君
            </button>
          </div>`;

      // 性別バッジ
      const genderBadge = gender
        ? `<span style="font-size:10px;padding:1px 7px;border-radius:10px;
            background:${gender.includes('女') ? '#fce7f3' : '#eff6ff'};
            color:${gender.includes('女') ? '#be185d' : '#1d4ed8'}">
            ${Utils.escHtml(gender)}
          </span>`
        : '<span style="color:var(--gray-300);font-size:11px">-</span>';

      return `
        <tr style="${rowBg}">
          <td style="font-weight:700;font-size:13px;padding:8px 12px;white-space:nowrap">
            ${Utils.escHtml(a.full_name) || '-'}
          </td>
          <td style="padding:6px 8px;text-align:center;background:#faf5ff">
            ${interviewDateCell}
          </td>
          <td style="padding:6px 8px;text-align:center;font-size:12px;color:var(--gray-600)">
            ${Utils.escHtml(applyDate) || '-'}
          </td>
          <td style="padding:6px 8px;text-align:center">
            ${genderBadge}
          </td>
          <td style="padding:6px 8px;text-align:center;white-space:nowrap">
            ${reportCell}
          </td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:var(--gray-50)">
              <th style="padding:10px 12px;font-size:12px;text-align:left;border-bottom:1px solid var(--gray-200)">
                氏名（本名）
              </th>
              <th style="padding:10px 8px;font-size:12px;text-align:center;border-bottom:1px solid var(--gray-200);background:#faf5ff;color:#7c3aed">
                <i class="fas fa-calendar-alt" style="margin-right:4px;font-size:10px"></i>面接日
              </th>
              <th style="padding:10px 8px;font-size:12px;text-align:center;border-bottom:1px solid var(--gray-200)">
                応募日
              </th>
              <th style="padding:10px 8px;font-size:12px;text-align:center;border-bottom:1px solid var(--gray-200)">
                性別
              </th>
              <th style="padding:10px 8px;font-size:12px;text-align:center;border-bottom:1px solid var(--gray-200)">
                営業報告
              </th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    // 面接日 change イベント
    wrap.querySelectorAll('.ti-date-input').forEach(input => {
      input.addEventListener('change', (e) => {
        this.saveInterviewDate(e.target.dataset.appKey, e.target.value, e.target);
      });
    });
  },

  // ---------- save interview date ----------
  async saveInterviewDate(appKey, newDate, inputEl) {
    if (this._savingDate[appKey]) return;
    this._savingDate[appKey] = true;
    if (inputEl) { inputEl.disabled = true; inputEl.style.opacity = '0.5'; }

    try {
      await API.interviewDates.save(appKey, newDate || null);
      this.interviewDates[appKey] = newDate || '';

      // applicants.js 側のキャッシュも更新
      if (typeof ApplicantsPage !== 'undefined') {
        ApplicantsPage.interviewDates[appKey] = newDate || '';
      }

      Utils.notify(newDate ? `面接日を保存しました（${newDate}）` : '面接日をクリアしました', 'success');

      // 日付が変わったらリストから消える可能性があるので再フィルタ
      this.filterAndRender();
    } catch (err) {
      Utils.notify('面接日の保存に失敗しました: ' + err.message, 'error');
      if (inputEl) inputEl.value = this.interviewDates[appKey] || '';
    } finally {
      this._savingDate[appKey] = false;
      if (inputEl) { inputEl.disabled = false; inputEl.style.opacity = '1'; }
    }
  },

  // ---------- sales report ----------
  openSalesReport(safeId) {
    const a = this._cache?.[safeId];
    if (!a) { Utils.notify('データが見つかりません', 'error'); return; }
    SalesReportModal.open(a, null, () => this.loadData());
  },

  async editReport(safeId, reportId) {
    const a = this._cache?.[safeId];
    if (!a) { Utils.notify('データが見つかりません', 'error'); return; }
    try {
      const report = await API.salesReports.get(reportId);
      SalesReportModal.open(a, report, () => this.loadData());
    } catch (e) {
      Utils.notify('エラーが発生しました', 'error');
    }
  },

  // ---------- すくう君 ----------
  openSukuukun(safeId) {
    const a = this._cache?.[safeId];
    if (!a) { Utils.notify('データが見つかりません', 'error'); return; }
    // 対応する報告から結果を取得
    const report = this.getReportForApplicant(a);
    SukuukunModal.open({
      applicantName: a.full_name || '',
      interviewResult: report?.result || '',
    });
  }
};
