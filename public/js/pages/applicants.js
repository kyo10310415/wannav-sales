// Applicants Page
const ApplicantsPage = {
  applicants: [],
  filteredApplicants: [],
  reports: [],
  interviewDates: {}, // { applicant_key: 'YYYY-MM-DD' }
  surpriseCallMap: {}, // { student_number: [row, ...] } サプライズコール紐づけ
  notionProfileMap: {}, // { student_number: notionProfile } Notionプロファイル紐づけ
  visibleHeaders: [],
  allSheetHeaders: [], // 非表示列を含む全列ヘッダー（rawキー順）
  currentPage: 1,
  perPage: 20,
  error: null,
  cacheInfo: null,

  searchQuery: '',
  filterResult: '',
  filterDateFrom: '',
  filterDateTo: '',
  filterInterviewDateFrom: '',
  filterInterviewDateTo: '',
  filterInterviewer: '',
  filterReportResult: '',
  filterNoInterviewDate: false,
  filterHasInterviewDate: false,
  filterOverdueDate: false,     // 面接予定日超過（面接日 < 今日 かつ 未報告）
  sortCol: null,
  sortDir: 'desc',

  // 面接日保存中フラグ
  _savingDate: {},

  // 応募者キー生成（email優先、なければfull_name）
  _applicantKey(a) {
    return (a.email && a.email.trim()) ? a.email.trim() : (a.full_name || '').trim();
  },

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
          <button class="btn btn-sm" id="calendar-fetch-btn"
            style="background:#7c3aed;border-color:#7c3aed;color:white;white-space:nowrap"
            onclick="ApplicantsPage.syncCalendar()"
            title="Googleカレンダーから面接予約イベントを取得して面接日を自動設定">
            <i class="fas fa-calendar-alt"></i> カレンダー取得
          </button>
          <button class="btn btn-sm"
            style="background:#059669;border-color:#059669;color:white;white-space:nowrap"
            onclick="ApplicantsPage.downloadCSV()"
            title="現在の絞り込み条件でCSVダウンロード">
            <i class="fas fa-file-csv"></i> CSVダウンロード
          </button>
        </div>
      </div>
      <div class="page-body">
        <div class="card" style="margin-bottom:12px">
          <div class="card-body" style="padding:12px 16px">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
              <div style="flex:1;min-width:180px">
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px">フリー検索</div>
                <div class="search-wrapper" style="max-width:100%">
                  <i class="fas fa-search"></i>
                  <input type="text" class="search-input" id="applicant-search"
                    placeholder="氏名・メールアドレス..." style="width:100%">
                </div>
              </div>
              <div>
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px">応募日 From</div>
                <input type="date" id="filter-date-from" class="form-control" style="width:140px">
              </div>
              <div>
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px">応募日 To</div>
                <input type="date" id="filter-date-to" class="form-control" style="width:140px">
              </div>
              <div>
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px">応募者の状況</div>
                <select id="filter-result" class="form-control" style="width:130px">
                  <option value="">すべて</option>
                  <option value="contract">契約のみ</option>
                  <option value="reported">報告あり</option>
                  <option value="unreported">未報告</option>
                </select>
              </div>
              <div>
                <button class="btn btn-sm" id="filter-no-date-btn"
                  onclick="ApplicantsPage.toggleNoDateFilter()"
                  style="margin-top:auto;background:#f59e0b;border-color:#f59e0b;color:white;white-space:nowrap">
                  <i class="fas fa-calendar-times"></i> 面接日未入力のみ
                </button>
              </div>
              <div>
                <button class="btn btn-secondary btn-sm" onclick="ApplicantsPage.resetFilters()" style="margin-top:auto">
                  <i class="fas fa-times"></i> リセット
                </button>
              </div>
              <span id="applicant-count" style="font-size:13px;color:var(--gray-500);align-self:center;margin-left:auto;white-space:nowrap"></span>
            </div>
            <!-- 2行目: 詳細フィルター（面接日・担当者・報告結果） -->
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:8px;padding-top:8px;border-top:1px solid var(--gray-100)">
              <div style="display:flex;align-items:center;gap:6px;align-self:center">
                <i class="fas fa-filter" style="font-size:11px;color:var(--gray-400)"></i>
                <span style="font-size:11px;font-weight:600;color:var(--gray-500)">詳細絞り込み</span>
              </div>
              <div>
                <div style="font-size:11px;font-weight:600;color:#7c3aed;margin-bottom:4px"><i class="fas fa-calendar-alt" style="margin-right:3px"></i>面接日 From</div>
                <input type="date" id="filter-interview-date-from" class="form-control" style="width:140px;border-color:#c4b5fd">
              </div>
              <div>
                <div style="font-size:11px;font-weight:600;color:#7c3aed;margin-bottom:4px"><i class="fas fa-calendar-alt" style="margin-right:3px"></i>面接日 To</div>
                <input type="date" id="filter-interview-date-to" class="form-control" style="width:140px;border-color:#c4b5fd">
              </div>
              <div>
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px"><i class="fas fa-user-tie" style="margin-right:3px"></i>担当者</div>
                <select id="filter-interviewer" class="form-control" style="width:130px">
                  <option value="">すべて</option>
                </select>
              </div>
              <div>
                <div style="font-size:11px;font-weight:600;color:var(--gray-500);margin-bottom:4px"><i class="fas fa-clipboard-check" style="margin-right:3px"></i>営業報告の結果</div>
                <select id="filter-report-result" class="form-control" style="width:140px">
                  <option value="">すべて</option>
                  <option value="契約">契約</option>
                  <option value="契約＆職業案内">契約＆職業案内</option>
                  <option value="クーリングオフ">クーリングオフ</option>
                  <option value="飛び">飛び（無断キャンセル）</option>
                  <option value="保留">保留</option>
                  <option value="NG">NG</option>
                  <option value="その他">その他</option>
                </select>
              </div>
              <div>
                <button class="btn btn-sm" id="filter-has-date-btn"
                  onclick="ApplicantsPage.toggleHasDateFilter()"
                  style="margin-top:auto;background:#7c3aed;border-color:#7c3aed;color:white;white-space:nowrap;opacity:0.7">
                  <i class="fas fa-calendar-check"></i> 面接日入力済み
                </button>
              </div>
              <div>
                <button class="btn btn-sm" id="filter-overdue-btn"
                  onclick="ApplicantsPage.toggleOverdueDateFilter()"
                  style="margin-top:auto;background:#dc2626;border-color:#dc2626;color:white;white-space:nowrap;opacity:0.7">
                  <i class="fas fa-exclamation-circle"></i> 期日超過
                </button>
              </div>
            </div>
          </div>
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
      }, 250)
    );
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
    document.getElementById('filter-result').addEventListener('change', (e) => {
      this.filterResult = e.target.value;
      this.currentPage = 1;
      this.filterAndRender();
    });
    document.getElementById('filter-interview-date-from').addEventListener('change', (e) => {
      this.filterInterviewDateFrom = e.target.value;
      this.currentPage = 1;
      this.filterAndRender();
    });
    document.getElementById('filter-interview-date-to').addEventListener('change', (e) => {
      this.filterInterviewDateTo = e.target.value;
      this.currentPage = 1;
      this.filterAndRender();
    });
    document.getElementById('filter-interviewer').addEventListener('change', (e) => {
      this.filterInterviewer = e.target.value;
      this.currentPage = 1;
      this.filterAndRender();
    });
    document.getElementById('filter-report-result').addEventListener('change', (e) => {
      this.filterReportResult = e.target.value;
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
      const [sheetData, reportsData, datesData, scData, notionData] = await Promise.all([
        API.spreadsheet.applicants(params),
        API.salesReports.list(),
        API.interviewDates.list(),
        API.surpriseCall.list().catch(() => ({ rows: [] })),
        API.notion.profiles().catch(() => []),
      ]);
      this.applicants = sheetData.applicants || [];
      this.visibleHeaders = sheetData.visibleHeaders || [];
      this.allSheetHeaders = sheetData.headers || [];
      this.reports = reportsData || [];
      this.interviewDates = datesData || {};
      // サプライズコール: student_number → 架電記録配列のMap構築
      this.surpriseCallMap = {};
      for (const row of (scData.rows || [])) {
        const sn = (row['学籍番号'] || '').trim();
        if (!sn) continue;
        if (!this.surpriseCallMap[sn]) this.surpriseCallMap[sn] = [];
        this.surpriseCallMap[sn].push(row);
      }
      // Notionプロファイル: student_number → プロファイルのMap構築
      this.notionProfileMap = {};
      for (const p of (Array.isArray(notionData) ? notionData : [])) {
        const sn = (p.student_number || '').trim();
        if (sn) this.notionProfileMap[sn] = p;
      }
      this.cacheInfo = {
        cached: sheetData.cached,
        age: sheetData.cache_age_seconds,
        stale: sheetData.stale,
      };
      this.error = null;
      this.renderCacheBadge();
      this._populateInterviewerSelect();
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

  // ============================================================
  // Googleカレンダーから面接日を取得・照合して一括保存
  // ============================================================
  async syncCalendar() {
    const btn = document.getElementById('calendar-fetch-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 取得中...';
    }

    try {
      const res = await API.calendar.sync();
      const matched   = (res.results || []).filter(r => r.matched);
      const unmatched = (res.results || []).filter(r => !r.matched);

      // 面接日ローカルキャッシュを更新
      matched.forEach(r => {
        if (r.applicantKey) {
          this.interviewDates[r.applicantKey] = r.interviewDate || '';
        }
      });

      // テーブルを再描画
      this.renderTable();

      // 結果をトースト通知
      if (matched.length > 0) {
        Utils.notify(
          `カレンダー取得完了：${matched.length}件の面接日を設定しました` +
          (unmatched.length > 0 ? `（未照合 ${unmatched.length}件）` : ''),
          'success'
        );
      } else if (res.totalEvents === 0) {
        Utils.notify('「面接予約」イベントが見つかりませんでした（カレンダーIDを確認してください）', 'warning');
      } else {
        Utils.notify(
          `イベント ${res.totalEvents}件を取得しましたが、氏名が一致する応募者が見つかりませんでした`,
          'warning'
        );
      }
    } catch (err) {
      Utils.notify('カレンダー取得エラー: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-calendar-alt"></i> カレンダー取得';
      }
    }
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

  // 担当者セレクトの選択肢をレポートデータから生成
  _populateInterviewerSelect() {
    const sel = document.getElementById('filter-interviewer');
    if (!sel) return;
    const names = [...new Set(this.reports.map(r => r.interviewer_name).filter(Boolean))].sort();
    const current = sel.value;
    sel.innerHTML = '<option value="">すべて</option>' +
      names.map(n => `<option value="${Utils.escHtml(n)}"${n === current ? ' selected' : ''}>${Utils.escHtml(n)}</option>`).join('');
  },

  toggleNoDateFilter() {
    this.filterNoInterviewDate = !this.filterNoInterviewDate;
    if (this.filterNoInterviewDate) { this.filterHasInterviewDate = false; this.filterOverdueDate = false; }
    this.currentPage = 1;
    const btn = document.getElementById('filter-no-date-btn');
    if (btn) {
      if (this.filterNoInterviewDate) {
        btn.style.background = '#d97706'; btn.style.borderColor = '#d97706';
        btn.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.35)'; btn.style.opacity = '1';
      } else {
        btn.style.background = '#f59e0b'; btn.style.borderColor = '#f59e0b';
        btn.style.boxShadow = ''; btn.style.opacity = '1';
      }
    }
    const btn2 = document.getElementById('filter-has-date-btn');
    if (btn2) { btn2.style.opacity = '0.7'; btn2.style.boxShadow = ''; }
    const btn3 = document.getElementById('filter-overdue-btn');
    if (btn3) { btn3.style.opacity = '0.7'; btn3.style.boxShadow = ''; }
    this.filterAndRender();
  },

  toggleHasDateFilter() {
    this.filterHasInterviewDate = !this.filterHasInterviewDate;
    if (this.filterHasInterviewDate) { this.filterNoInterviewDate = false; this.filterOverdueDate = false; }
    this.currentPage = 1;
    const btn = document.getElementById('filter-has-date-btn');
    if (btn) {
      if (this.filterHasInterviewDate) {
        btn.style.opacity = '1'; btn.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.35)';
      } else {
        btn.style.opacity = '0.7'; btn.style.boxShadow = '';
      }
    }
    const btn2 = document.getElementById('filter-no-date-btn');
    if (btn2) { btn2.style.background = '#f59e0b'; btn2.style.borderColor = '#f59e0b'; btn2.style.boxShadow = ''; }
    const btn3 = document.getElementById('filter-overdue-btn');
    if (btn3) { btn3.style.opacity = '0.7'; btn3.style.boxShadow = ''; }
    this.filterAndRender();
  },

  toggleOverdueDateFilter() {
    this.filterOverdueDate = !this.filterOverdueDate;
    if (this.filterOverdueDate) { this.filterNoInterviewDate = false; this.filterHasInterviewDate = false; }
    this.currentPage = 1;
    const btn = document.getElementById('filter-overdue-btn');
    if (btn) {
      if (this.filterOverdueDate) {
        btn.style.opacity = '1'; btn.style.boxShadow = '0 0 0 3px rgba(220,38,38,0.35)';
      } else {
        btn.style.opacity = '0.7'; btn.style.boxShadow = '';
      }
    }
    const btn2 = document.getElementById('filter-no-date-btn');
    if (btn2) { btn2.style.background = '#f59e0b'; btn2.style.borderColor = '#f59e0b'; btn2.style.boxShadow = ''; }
    const btn3 = document.getElementById('filter-has-date-btn');
    if (btn3) { btn3.style.opacity = '0.7'; btn3.style.boxShadow = ''; }
    this.filterAndRender();
  },

  resetFilters() {
    this.searchQuery = '';
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.filterResult = '';
    this.filterInterviewDateFrom = '';
    this.filterInterviewDateTo = '';
    this.filterInterviewer = '';
    this.filterReportResult = '';
    this.filterNoInterviewDate = false;
    this.filterHasInterviewDate = false;
    this.filterOverdueDate = false;
    this.sortCol = null;
    this.sortDir = 'desc';
    this.currentPage = 1;
    const s = document.getElementById('applicant-search'); if (s) s.value = '';
    const df = document.getElementById('filter-date-from'); if (df) df.value = '';
    const dt = document.getElementById('filter-date-to'); if (dt) dt.value = '';
    const fr = document.getElementById('filter-result'); if (fr) fr.value = '';
    const idf = document.getElementById('filter-interview-date-from'); if (idf) idf.value = '';
    const idt = document.getElementById('filter-interview-date-to'); if (idt) idt.value = '';
    const iv = document.getElementById('filter-interviewer'); if (iv) iv.value = '';
    const rr = document.getElementById('filter-report-result'); if (rr) rr.value = '';
    const btn = document.getElementById('filter-no-date-btn');
    if (btn) { btn.style.background = '#f59e0b'; btn.style.borderColor = '#f59e0b'; btn.style.boxShadow = ''; }
    const btn2 = document.getElementById('filter-has-date-btn');
    if (btn2) { btn2.style.opacity = '0.7'; btn2.style.boxShadow = ''; }
    const btn3 = document.getElementById('filter-overdue-btn');
    if (btn3) { btn3.style.opacity = '0.7'; btn3.style.boxShadow = ''; }
    this.filterAndRender();
  },

  getReportForApplicant(a) {
    // 最新の報告（1件）を返す（面接実施済み・結果表示に使用）
    const all = this.getReportsForApplicant(a);
    return all.length > 0 ? all[0] : null;
  },

  getReportsForApplicant(a) {
    // 同一人物の報告を全件返す（新しい順）
    const aEmail = (a.email || '').toLowerCase().trim();
    const matches = this.reports.filter(r => {
      const rEmail = (r.applicant_email || '').toLowerCase().trim();
      if (aEmail && rEmail) {
        return rEmail === aEmail && r.applicant_full_name === a.full_name;
      }
      if (!aEmail && !rEmail) {
        return r.applicant_full_name === a.full_name;
      }
      return r.applicant_full_name === a.full_name;
    });
    return matches.sort((x, y) => y.id - x.id);
  },

  filterAndRender() {
    let list = [...this.applicants];

    if (this.searchQuery) {
      const q = this.searchQuery;
      list = list.filter(a =>
        (a.full_name || '').toLowerCase().includes(q) ||
        (a.email || '').toLowerCase().includes(q)
      );
    }

    if (this.filterDateFrom) {
      const from = new Date(this.filterDateFrom);
      list = list.filter(a => a.date_parsed && new Date(a.date_parsed) >= from);
    }
    if (this.filterDateTo) {
      const to = new Date(this.filterDateTo);
      to.setHours(23, 59, 59, 999);
      list = list.filter(a => a.date_parsed && new Date(a.date_parsed) <= to);
    }

    if (this.filterResult) {
      list = list.filter(a => {
        const reports = this.getReportsForApplicant(a);
        if (this.filterResult === 'contract')   return reports.some(r => r.result?.includes('契約') || r.result === '契約');
        if (this.filterResult === 'reported')   return reports.length > 0;
        if (this.filterResult === 'unreported') return reports.length === 0;
        return true;
      });
    }

    if (this.filterNoInterviewDate) {
      list = list.filter(a => {
        const key = this._applicantKey(a);
        const dateVal = this.interviewDates[key];
        return !dateVal || dateVal.trim() === '';
      });
    }

    // 面接日入力済みフィルター
    if (this.filterHasInterviewDate) {
      list = list.filter(a => {
        const key = this._applicantKey(a);
        const dateVal = this.interviewDates[key];
        return dateVal && dateVal.trim() !== '';
      });
    }

    // 期日超過フィルター: 面接日が入力済み かつ 今日より前 かつ 未報告
    if (this.filterOverdueDate) {
      const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
      list = list.filter(a => {
        const key     = this._applicantKey(a);
        const dateVal = this.interviewDates[key];
        if (!dateVal || dateVal.trim() === '') return false;  // 面接日未入力は除外
        if (dateVal >= today) return false;                   // 今日以降は除外
        const reports = this.getReportsForApplicant(a);
        return reports.length === 0;                          // 未報告のみ
      });
    }

    // 面接日 From/To フィルター
    if (this.filterInterviewDateFrom) {
      list = list.filter(a => {
        const key = this._applicantKey(a);
        const d = this.interviewDates[key];
        return d && d >= this.filterInterviewDateFrom;
      });
    }
    if (this.filterInterviewDateTo) {
      list = list.filter(a => {
        const key = this._applicantKey(a);
        const d = this.interviewDates[key];
        return d && d <= this.filterInterviewDateTo;
      });
    }

    // 担当者フィルター
    if (this.filterInterviewer) {
      list = list.filter(a => {
        return this.getReportsForApplicant(a).some(r => r.interviewer_name === this.filterInterviewer);
      });
    }

    // 営業報告の結果フィルター（詳細）
    if (this.filterReportResult) {
      list = list.filter(a => {
        return this.getReportsForApplicant(a).some(r => (r.result || '').includes(this.filterReportResult));
      });
    }

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

  // 応募者一覧で非表示にするスプレッドシートカラム（機能5）
  // ※ キーはnormalizeHeader()と同じ変換済み文字列（改行・全角スペース除去）
  _hiddenHeaders: new Set([
    '一次面接担当', '二次面接担当', '一次面接実施',
    '飛び', 'CV', 'リマインド送付時予約有無', '飛びリマインド送付'
  ]),

  _colWidth(headerName) {
    const map = {
      '応募日':        '82px',
      '応募月':        '64px',
      '性別':          '44px',
      '生年月日':      '82px',
      '一次面接担当':  '76px',
      '二次面接担当':  '76px',
      '書類通過':      '58px',
      '面接予約':      '58px',
      '一次面接実施':  '72px',
      'AIレコメン実施':'80px',
      '面接実施':      '60px',
      '飛び':          '40px',
      'CV':            '38px',
      '広告媒体':      '70px',
      'ブラックリスト':'76px',
      // 追加列（営業報告から）
      '面接担当者':    '72px',
      '面接内容':      '90px',
      '結果':          '64px',
      '契約プラン':    '88px',
      '学籍番号':      '72px',
      'Notion':        '72px',
    };
    return map[headerName ? headerName.trim() : ''] || '80px';
  },

  renderTable() {
    const wrap = document.getElementById('applicants-table-wrap');
    if (!wrap || this.error) return;

    const { items } = Utils.paginate(this.filteredApplicants, this.currentPage, this.perPage);

    if (!this.filteredApplicants.length) {
      const hasFilter = this.searchQuery || this.filterDateFrom || this.filterDateTo ||
        this.filterResult || this.filterInterviewDateFrom || this.filterInterviewDateTo ||
        this.filterInterviewer || this.filterReportResult ||
        this.filterHasInterviewDate || this.filterNoInterviewDate || this.filterOverdueDate;
      wrap.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-user-slash"></i>
          <h3>${hasFilter ? '条件に一致するデータがありません' : '応募者データがありません'}</h3>
          <p>${hasFilter ? 'フィルター条件を変更してください' : 'スプレッドシートを確認してください'}</p>
        </div>`;
      return;
    }

    // 機能5: 非表示カラムを除外したheadersとインデックスマップを作成
    const allHeaders = this.visibleHeaders;
    const visibleIdxMap = []; // allHeaders上のインデックス → 表示する列のインデックスリスト
    const headers = [];
    // 改行・全角スペース・前後空白を除去して比較
    const normalizeHeader = h => (h || '').replace(/[\r\n\u3000\s]+/g, '').trim();
    allHeaders.forEach((h, i) => {
      if (!this._hiddenHeaders.has(normalizeHeader(h))) {
        visibleIdxMap.push(i);
        headers.push(h);
      }
    });

    const dateColIdx = (() => {
      const i = headers.findIndex(h => h && h.trim() === '応募日');
      return i !== -1 ? i : headers.findIndex(h => h && h.trim() === 'タイムスタンプ');
    })();

    // 追加列（営業報告から）
    const reportExtraCols = ['面接担当者', '面接内容', '結果', '契約プラン', '学籍番号'];

    const colDefs = [
      `<col style="width:110px;min-width:90px">`,  // 氏名
      `<col style="width:108px;min-width:108px">`,  // 面接日
    ];
    headers.forEach(h => colDefs.push(`<col style="width:${this._colWidth(h)}">`) );
    reportExtraCols.forEach(h => colDefs.push(`<col style="width:${this._colWidth(h)};">`));
    colDefs.push(`<col style="width:60px;min-width:54px">`);  // 架電
    colDefs.push(`<col style="width:${this._colWidth('Notion')}">`); // Notion
    colDefs.push(`<col style="width:80px;min-width:72px">`);  // 営業報告

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
    // 営業報告由来の追加列ヘッダー
    reportExtraCols.forEach(h => {
      headerCells.push(
        `<th style="font-size:11px;padding:6px 4px;text-align:center;background:#fefce8;color:#92400e;white-space:nowrap">
          ${Utils.escHtml(h)}
        </th>`
      );
    });
    // 架電列ヘッダー → Notion列ヘッダー → 営業報告列ヘッダー（データ順と一致）
    headerCells.push(`<th style="font-size:11px;padding:6px 4px;text-align:center;background:#f5f3ff;color:#7c3aed;white-space:nowrap"><i class="fas fa-phone-alt" style="margin-right:2px"></i>架電</th>`);
    headerCells.push(`<th style="font-size:11px;padding:6px 4px;text-align:center;background:#fefce8;color:#92400e;white-space:nowrap">Notion</th>`);
    headerCells.push(`<th style="text-align:center;font-size:11px;padding:6px 4px">営業報告</th>`);

    const rowsHtml = items.map(a => {
      const report     = this.getReportForApplicant(a);  // 最新の報告
      const allReports = this.getReportsForApplicant(a);
      const isContract = allReports.some(r => r.result?.includes('契約') || r.result === '契約');
      const rowBg     = isContract ? 'background:#f0fdf4' : '';
      const safeId    = `app-${a.row_index}`;
      const appKey    = this._applicantKey(a);

      ApplicantsPage._cache = ApplicantsPage._cache || {};
      ApplicantsPage._cache[safeId] = a;

      const dateVal   = this.interviewDates[appKey] || '';
      const isSaving  = !!this._savingDate[appKey];

      // 機能5: 非表示列を除外したdataCells
      const dataCells = visibleIdxMap.map((origIdx, i) => {
        const col = a.visible_data[origIdx];
        const isDateCol = i === dateColIdx;
        const val = col ? (col.value || '-') : '-';
        const cellStyle = isDateCol
          ? 'font-size:11px;padding:5px 4px;background:#eff6ff;font-weight:600;white-space:nowrap;text-align:center'
          : 'font-size:11px;padding:5px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:0;text-align:center';
        return `<td style="${cellStyle}" title="${Utils.escHtml(col ? col.value : '')}">${Utils.escHtml(val)}</td>`;
      });

      // 機能5: 営業報告由来の追加列セル（最新報告の内容を表示）
      const notionUrl = report ? (report.notion_url || '') : '';
      // 結果列: 複数報告時は全件の結果を / 区切りで表示
      const resultDisplay = allReports.length > 1
        ? allReports.map(r => r.result || '-').join(' / ')
        : (report ? (report.result || '-') : '-');
      const extraVals = [
        report ? (report.interviewer_name  || '-') : '-',
        report ? (report.interview_content || '-') : '-',
        resultDisplay,
        report ? (report.contract_plan     || '-') : '-',
        report ? (report.student_number    || '-') : '-',
      ];
      const reportExtraCells = extraVals.map((val, i) => {
        const isResultCol = i === 2;
        const isCt = isResultCol && report && (report.result?.includes('契約') || report.result === '契約');
        const style = isCt
          ? 'font-size:11px;padding:5px 4px;text-align:center;background:#dcfce7;color:#16a34a;font-weight:700;white-space:nowrap'
          : 'font-size:11px;padding:5px 4px;text-align:center;background:#fefce8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:0';
        return `<td style="${style}" title="${Utils.escHtml(val)}">${Utils.escHtml(val)}</td>`;
      });
      // 架電結果セル
      const studentNum = report ? (report.student_number || '').trim() : '';
      const scRecords  = studentNum ? (this.surpriseCallMap[studentNum] || []) : [];
      const scCount    = scRecords.length;
      const latestSc   = scCount > 0
        ? [...scRecords].sort((a, b) => (b['タイムスタンプ'] || '').localeCompare(a['タイムスタンプ'] || ''))[0]
        : null;
      const scResult   = latestSc ? (latestSc['架電結果'] || '') : '';
      const scResultColor = (scResult === '通話' || scResult === '繋がった') ? '#16a34a'
        : scResult === '留守' ? '#d97706'
        : scResult ? '#6b7280' : '#d1d5db';
      const callCell = scCount > 0
        ? `<td style="text-align:center;padding:4px 2px;background:#f5f3ff">
            <button class="btn btn-xs sc-popup-btn"
              style="font-size:10px;padding:2px 6px;background:${scResultColor}18;border:1px solid ${scResultColor}50;color:${scResultColor};border-radius:4px;white-space:nowrap;cursor:pointer"
              data-student-num="${Utils.escHtml(studentNum)}"
              title="架電記録を見る">
              <i class="fas fa-phone-alt" style="margin-right:2px"></i>${scCount}件
            </button>
           </td>`
        : `<td style="text-align:center;padding:4px 2px;background:#f5f3ff">
            <span style="font-size:10px;color:#d1d5db">—</span>
           </td>`;

      // Notionリンク列（ボタン）
      const notionCell = `<td style="font-size:11px;padding:4px 6px;text-align:center;background:#fefce8">
        ${notionUrl
          ? `<a href="${Utils.escHtml(notionUrl)}" target="_blank" rel="noopener noreferrer"
              style="display:inline-flex;align-items:center;gap:3px;font-size:10px;padding:3px 7px;background:#1e1e1e;color:white;border-radius:5px;text-decoration:none;white-space:nowrap">
              <i class="fas fa-external-link-alt" style="font-size:9px"></i> Notion
            </a>`
          : '<span style="font-size:10px;color:var(--gray-300)">—</span>'
        }
      </td>`;

      const reportCell = `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
          ${report
            ? `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
                ${isContract
                  ? '<span style="font-size:9px;background:#dcfce7;color:#16a34a;border-radius:4px;padding:1px 5px;font-weight:700"><i class="fas fa-check"></i> 契約</span>'
                  : `<span style="font-size:9px;background:#f3f4f6;color:#374151;border-radius:4px;padding:1px 5px">${Utils.escHtml(report.result || '報告あり')}</span>`
                }
                ${allReports.length > 1
                  ? `<span style="font-size:9px;background:#dbeafe;color:#1d4ed8;border-radius:4px;padding:1px 5px;font-weight:600">報告 ${allReports.length}件</span>`
                  : ''
                }
                <button class="btn btn-secondary btn-xs" style="font-size:10px;padding:2px 6px"
                  onclick="ApplicantsPage.editReport('${safeId}',${report.id})">
                  <i class="fas fa-plus-circle"></i> 追記
                </button>
              </div>`
            : `<button class="btn btn-primary btn-xs" style="font-size:10px;padding:3px 6px"
                onclick="ApplicantsPage.openSalesReport('${safeId}')">
                <i class="fas fa-plus"></i> 報告
              </button>`
          }
          <button class="btn btn-xs" title="すくう君で採点"
            style="font-size:10px;padding:2px 5px;background:#fef3c7;border:1px solid #f59e0b;color:#92400e;border-radius:4px;white-space:nowrap;cursor:pointer"
            onclick="ApplicantsPage.openSukuukun('${safeId}')">
            🤖 すくう君
          </button>
          <button class="btn btn-xs" title="すくう君・発話比率の過去結果を確認"
            style="font-size:10px;padding:2px 5px;background:#f0fdf4;border:1px solid #4ade80;color:#166534;border-radius:4px;white-space:nowrap;cursor:pointer"
            onclick="ApplicantsPage.viewSukuukunHistory('${safeId}')">
            📋 過去結果
          </button>
        </div>`;

      // 面接日セル: 常に入力可能
      const interviewDateCell = isSaving
        ? `<span style="font-size:11px;color:var(--gray-400)"><i class="fas fa-spinner fa-spin"></i></span>`
        : `<input
            type="date"
            class="interview-date-input"
            data-app-key="${Utils.escHtml(appKey)}"
            value="${Utils.escHtml(dateVal)}"
            style="
              width:100px;
              padding:4px 6px;
              font-size:11px;
              border:1px solid ${dateVal ? '#c4b5fd' : '#e5e7eb'};
              border-radius:5px;
              background:${dateVal ? '#faf5ff' : 'white'};
              color:${dateVal ? '#6d28d9' : 'var(--gray-500)'};
              cursor:pointer;
              outline:none;
              font-weight:${dateVal ? '600' : '400'};
            "
          >`;

      return `
        <tr style="${rowBg}">
          <td style="font-weight:600;font-size:12px;padding:5px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:0"
              title="${Utils.escHtml(a.full_name)}">
            ${Utils.escHtml(a.full_name) || '-'}
          </td>
          <td style="padding:3px 6px;background:#faf5ff;text-align:center">
            ${interviewDateCell}
          </td>
          ${dataCells.join('')}
          ${reportExtraCells.join('')}
          ${callCell}
          ${notionCell}
          <td style="text-align:center;padding:4px 2px;white-space:nowrap">${reportCell}</td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
      <div style="padding:4px 10px 2px;font-size:10px;color:var(--gray-400)">
        <i class="fas fa-sort-amount-down"></i> ヘッダークリックでソート &nbsp;|&nbsp;
        <i class="fas fa-calendar-alt" style="color:#7c3aed"></i> <span style="color:#7c3aed">面接日</span>は直接クリックして入力・自動保存
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;table-layout:fixed;border-collapse:collapse">
          <colgroup>${colDefs.join('')}</colgroup>
          <thead><tr>${headerCells.join('')}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;

    // 架電記録ポップアップボタン
    wrap.querySelectorAll('.sc-popup-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sn = btn.dataset.studentNum;
        ApplicantsPage.showSurpriseCallPopup(e, sn);
      });
    });

    // イベントバインド
    wrap.querySelectorAll('.interview-date-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const key = e.target.dataset.appKey;
        const val = e.target.value;
        this.saveInterviewDate(key, val, e.target);
      });
    });
  },

  // ── サプライズコール架電記録ポップアップ ──────────────────────
  showSurpriseCallPopup(event, studentNum) {
    // 既存ポップアップを閉じる
    document.querySelectorAll('.sc-detail-popup').forEach(el => el.remove());

    const records = this.surpriseCallMap[studentNum] || [];
    if (records.length === 0) return;

    // タイムスタンプ降順でソート
    const sorted = [...records].sort((a, b) =>
      (b['タイムスタンプ'] || '').localeCompare(a['タイムスタンプ'] || '')
    );

    const resultColor = (v) =>
      (v === '通話' || v === '繋がった') ? '#16a34a'
      : v === '留守' ? '#d97706'
      : v ? '#6b7280' : '#9ca3af';

    const statusColor = (v) =>
      v === '継続' ? '#2563eb'
      : v === 'CO' ? '#dc2626'
      : v === '保留' ? '#d97706'
      : v === '完了' ? '#16a34a'
      : '#6b7280';

    const rows = sorted.map(r => {
      const rc = resultColor(r['架電結果'] || '');
      const sc = statusColor(r['ステータス'] || '');
      const heat = parseFloat(r['今の熱量を0~10点で教えてください'] || '');
      const heatBar = !isNaN(heat)
        ? `<span style="display:inline-flex;align-items:center;gap:3px">
            <span style="display:inline-block;width:32px;height:5px;background:#e5e7eb;border-radius:3px;position:relative">
              <span style="position:absolute;left:0;top:0;height:100%;width:${Math.min(100, heat / 10 * 100)}%;background:${heat >= 7 ? '#16a34a' : heat >= 4 ? '#d97706' : '#dc2626'};border-radius:3px"></span>
            </span>
            <b style="font-size:10px;color:${heat >= 7 ? '#16a34a' : heat >= 4 ? '#d97706' : '#dc2626'}">${heat}</b>
          </span>`
        : `<span style="color:#9ca3af;font-size:10px">-</span>`;
      return `
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:5px 8px;font-size:11px;white-space:nowrap;color:#6b7280">${Utils.escHtml(r['タイムスタンプ'] ? r['タイムスタンプ'].slice(0, 10) : '-')}</td>
          <td style="padding:5px 8px;font-size:11px;text-align:center">
            <span style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:600;background:${rc}18;color:${rc};border:1px solid ${rc}40">
              ${Utils.escHtml(r['架電結果'] || '-')}
            </span>
          </td>
          <td style="padding:5px 8px;font-size:11px;text-align:center">
            ${r['ステータス']
              ? `<span style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:600;background:${sc}18;color:${sc};border:1px solid ${sc}40">${Utils.escHtml(r['ステータス'])}</span>`
              : '<span style="color:#9ca3af;font-size:10px">-</span>'
            }
          </td>
          <td style="padding:5px 8px;font-size:11px;text-align:center">${heatBar}</td>
          <td style="padding:5px 8px;font-size:11px;text-align:center;color:#374151">${Utils.escHtml(r['入会の手続きの満足度'] || '-')}</td>
          <td style="padding:5px 8px;font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#374151"
              title="${Utils.escHtml(r['お手続きの中で不安に感じた点'] || '')}">${Utils.escHtml((r['お手続きの中で不安に感じた点'] || '-').slice(0, 30))}${(r['お手続きの中で不安に感じた点'] || '').length > 30 ? '…' : ''}</td>
        </tr>`;
    }).join('');

    const popup = document.createElement('div');
    popup.className = 'sc-detail-popup';
    popup.style.cssText = `
      position:fixed;z-index:9999;background:white;border-radius:10px;
      box-shadow:0 8px 32px rgba(0,0,0,0.18);border:1px solid #e5e7eb;
      min-width:520px;max-width:90vw;font-family:inherit;
    `;
    popup.innerHTML = `
      <div style="padding:10px 14px 8px;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:13px;font-weight:700;color:#7c3aed">
          <i class="fas fa-phone-alt" style="margin-right:6px"></i>架電記録（学籍番号: ${Utils.escHtml(studentNum)}）
          <span style="font-size:11px;font-weight:400;color:#9ca3af;margin-left:6px">${sorted.length}件</span>
        </div>
        <button onclick="this.closest('.sc-detail-popup').remove()"
          style="background:none;border:none;cursor:pointer;font-size:16px;color:#9ca3af;padding:0 2px;line-height:1">✕</button>
      </div>
      <div style="overflow-x:auto;max-height:280px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#f9fafb;font-size:10px;color:#6b7280">
              <th style="padding:5px 8px;text-align:left;white-space:nowrap">日時</th>
              <th style="padding:5px 8px;text-align:center;white-space:nowrap">架電結果</th>
              <th style="padding:5px 8px;text-align:center;white-space:nowrap">ステータス</th>
              <th style="padding:5px 8px;text-align:center;white-space:nowrap">熱量</th>
              <th style="padding:5px 8px;text-align:center;white-space:nowrap">満足度</th>
              <th style="padding:5px 8px;text-align:left;white-space:nowrap">不安な点</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    // 位置を計算してDOMに追加
    document.body.appendChild(popup);
    const rect = event.target.getBoundingClientRect();
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    let top  = rect.bottom + window.scrollY + 4;
    let left = rect.left  + window.scrollX;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (top + ph > window.scrollY + window.innerHeight - 8) top = rect.top + window.scrollY - ph - 4;
    popup.style.top  = `${top}px`;
    popup.style.left = `${left}px`;

    // 外クリックで閉じる
    const onOutside = (e) => {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', onOutside);
      }
    };
    setTimeout(() => document.addEventListener('click', onOutside), 0);
  },

  // 面接日を保存
  async saveInterviewDate(appKey, newDate, inputEl) {
    if (this._savingDate[appKey]) return;
    this._savingDate[appKey] = true;

    // inputをdisabledにして保存中を表現
    if (inputEl) {
      inputEl.disabled = true;
      inputEl.style.opacity = '0.5';
    }

    try {
      await API.interviewDates.save(appKey, newDate || null);
      this.interviewDates[appKey] = newDate || '';

      // inputのスタイルを更新
      if (inputEl) {
        inputEl.style.border   = newDate ? '1px solid #c4b5fd' : '1px solid #e5e7eb';
        inputEl.style.background = newDate ? '#faf5ff' : 'white';
        inputEl.style.color    = newDate ? '#6d28d9' : 'var(--gray-500)';
        inputEl.style.fontWeight = newDate ? '600' : '400';
      }

      Utils.notify(newDate ? `面接日を保存しました（${newDate}）` : '面接日をクリアしました', 'success');
    } catch (err) {
      Utils.notify('面接日の保存に失敗しました: ' + err.message, 'error');
      // 元の値に戻す
      if (inputEl) inputEl.value = this.interviewDates[appKey] || '';
    } finally {
      this._savingDate[appKey] = false;
      if (inputEl) {
        inputEl.disabled = false;
        inputEl.style.opacity = '1';
      }
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
    const end   = Math.min(page * this.perPage, total);

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
  },

  // ---------- すくう君 ----------
  openSukuukun(safeId) {
    const a = this._cache?.[safeId];
    if (!a) { Utils.notify('データが見つかりません', 'error'); return; }
    const report = this.getReportForApplicant(a);
    const appKey = this._applicantKey(a);
    SukuukunModal.open({
      applicantName:   a.full_name || '',
      applicantKey:    appKey,
      interviewResult: report?.result || '',
    });
  },

  // ---------- すくう君 過去結果確認 ----------
  async viewSukuukunHistory(safeId) {
    const a = this._cache?.[safeId];
    if (!a) { Utils.notify('データが見つかりません', 'error'); return; }
    const appKey = this._applicantKey(a);
    try {
      const data = await API.sukuukun.byApplicant(appKey);
      SukuukunHistoryModal.open(a.full_name || appKey, data);
    } catch (e) {
      Utils.notify('履歴の取得に失敗しました: ' + e.message, 'error');
    }
  },

  // ──────────────────────────────────────────────────────────
  // CSV ダウンロード
  //   ・filteredApplicants（現在の絞り込み結果・全件）を出力
  //   ・応募者基本情報 + 面接日 + Notionプロファイル + 営業報告（全件展開）+ サプライズコール（全件展開）
  // ──────────────────────────────────────────────────────────
  downloadCSV() {
    const list = this.filteredApplicants;
    if (!list.length) {
      Utils.notify('ダウンロードするデータがありません', 'error');
      return;
    }

    // ── CSV セル値のエスケープ ─────────────────────────────────
    const esc = v => {
      const s = (v == null || v === '') ? '' : String(v);
      // ダブルクォート・カンマ・改行を含む場合はダブルクォートで囲む
      if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };

    // ── スプレッドシート全列ヘッダー（非表示列含む、rawキー順） ──
    // allSheetHeaders があればそれを使い、自己PRなど非表示列もCSVに含める
    const sheetHeaders = this.allSheetHeaders.length
      ? this.allSheetHeaders
      : this.visibleHeaders;

    // ── Notionプロファイルのカラム定義（出力順） ─────────────
    const notionCols = [
      { key: 'gender',                   label: 'N_性別' },
      { key: 'birth_date',               label: 'N_生年月日' },
      { key: 'final_education',          label: 'N_最終学歴' },
      { key: 'current_job',              label: 'N_現職' },
      { key: 'job_type',                 label: 'N_職種' },
      { key: 'monthly_income',           label: 'N_月収' },
      { key: 'disposable_income',        label: 'N_可処分所得' },
      { key: 'savings',                  label: 'N_貯蓄' },
      { key: 'debt',                     label: 'N_借金' },
      { key: 'has_card',                 label: 'N_カード有無' },
      { key: 'work_history',             label: 'N_職歴' },
      { key: 'part_time_history',        label: 'N_バイト歴' },
      { key: 'prefecture',               label: 'N_都道府県' },
      { key: 'cohabitants',              label: 'N_同居人' },
      { key: 'has_partner',              label: 'N_パートナー有無' },
      { key: 'partner_understanding',    label: 'N_パートナー理解' },
      { key: 'sales_classification',     label: 'N_Sales3分類' },
      { key: 'has_streaming_experience', label: 'N_配信経験' },
      { key: 'streaming_history',        label: 'N_配信歴' },
      { key: 'streaming_equipment',      label: 'N_配信機材' },
      { key: 'motivation',               label: 'N_志望動機' },
      { key: 'company_reason',           label: 'N_企業が良い理由' },
      { key: 'contribution',             label: 'N_貢献できること' },
      { key: 'vtuber_effort',            label: 'N_VTuberの努力' },
      { key: 'other_auditions',          label: 'N_他オーディション' },
      { key: 'desired_streaming',        label: 'N_やりたい配信' },
      { key: 'vtuber_passion',           label: 'N_熱量%' },
      { key: 'medical_history',          label: 'N_病歴' },
      { key: 'status',                   label: 'N_ステータス' },
      { key: 'contract_plan',            label: 'N_契約プラン' },
    ];

    // ── 営業報告の全カラム定義（出力順） ─────────────────────
    const reportCols = [
      { key: 'id',                label: '報告ID' },
      { key: 'interviewer_name',  label: '面接担当者' },
      { key: 'interview_date',    label: '面接日' },
      { key: 'interview_content', label: '面接内容' },
      { key: 'result',            label: '結果' },
      { key: 'stay_count',        label: 'STAY回数' },
      { key: 'no_count',          label: 'NO回数' },
      { key: 'contract_plan',     label: '契約プラン' },
      { key: 'payment_method',    label: '支払方法' },
      { key: 'character_rights',  label: 'キャラクター権利' },
      { key: 'join_reasons',      label: '入会理由' },
      { key: 'decline_reasons',   label: '辞退理由' },
      { key: 'phone_number',      label: '電話番号' },
      { key: 'notion_url',        label: 'NotionURL' },
      { key: 'lesson_start_date', label: 'レッスン開始日' },
      { key: 'ep_proposal',       label: 'EP提案あり' },
      { key: 'student_number',    label: '学籍番号' },
      { key: 'details',           label: '詳細内容' },
      { key: 'created_at',        label: '報告作成日時' },
    ];

    // ── サプライズコールの出力カラム定義 ─────────────────────
    const scCols = [
      { key: 'タイムスタンプ',                     label: 'SC_タイムスタンプ' },
      { key: '架電時間帯',                         label: 'SC_架電時間帯' },
      { key: '架電結果',                           label: 'SC_架電結果' },
      { key: '入会の手続きの満足度',                label: 'SC_手続き満足度' },
      { key: 'お手続きの中で不安に感じた点',        label: 'SC_不安に感じた点' },
      { key: '一番気になるトピック',                label: 'SC_気になるトピック' },
      { key: '担当者は信頼できるか？',              label: 'SC_担当者信頼度' },
      { key: '担当者に対する評価の理由',            label: 'SC_担当者評価理由' },
      { key: '今の熱量を0~10点で教えてください',   label: 'SC_熱量' },
      { key: 'どんな景色を見たいと思っているか？',  label: 'SC_目標' },
      { key: 'ステータス',                         label: 'SC_ステータス' },
      { key: 'CO開け日（目安）',                   label: 'SC_CO開け日' },
      { key: '合計点',                             label: 'SC_合計点' },
      { key: '口コミ共有済み',                     label: 'SC_口コミ共有済み' },
    ];

    // ── 最大営業報告件数・最大SC件数を算出（ヘッダー行の列数決定） ─
    let maxReports = 0;
    let maxSc      = 0;
    for (const a of list) {
      const reps = this.getReportsForApplicant(a);
      if (reps.length > maxReports) maxReports = reps.length;
      const sn   = (reps[0]?.student_number || '').trim();
      const sc   = sn ? (this.surpriseCallMap[sn] || []) : [];
      if (sc.length > maxSc) maxSc = sc.length;
    }
    // 上限：報告20件、SC30件（異常値対策）
    maxReports = Math.min(maxReports, 20);
    maxSc      = Math.min(maxSc,      30);

    // ── ヘッダー行を構築 ──────────────────────────────────────
    const headerRow = [
      '氏名',
      'メールアドレス',
      '面接日',
      ...sheetHeaders,
      // Notionプロファイル（固定28列）
      ...notionCols.map(c => c.label),
    ];
    // 営業報告（N件分）
    for (let i = 1; i <= maxReports; i++) {
      for (const col of reportCols) {
        headerRow.push(`報告${i}_${col.label}`);
      }
    }
    // サプライズコール（N件分）
    for (let i = 1; i <= maxSc; i++) {
      for (const col of scCols) {
        headerRow.push(col.label.replace('SC_', `SC${i}_`));
      }
    }

    // ── データ行を構築 ────────────────────────────────────────
    const dataRows = list.map(a => {
      const appKey    = this._applicantKey(a);
      const dateVal   = this.interviewDates[appKey] || '';
      const allReps   = this.getReportsForApplicant(a);  // 新しい順
      const studentNum = (allReps[0]?.student_number || '').trim();
      const scAll     = studentNum ? (this.surpriseCallMap[studentNum] || []) : [];
      // SC は新しいもの優先（タイムスタンプ降順）
      const scSorted  = [...scAll].sort((x, y) =>
        (y['タイムスタンプ'] || '').localeCompare(x['タイムスタンプ'] || '')
      );

      // Notionプロファイルを学籍番号で引く（報告の学籍番号優先、なければスキップ）
      const notionProfile = this.notionProfileMap[studentNum] || null;

      const row = [
        a.full_name  || '',
        a.email      || '',
        dateVal,
        // スプレッドシート列（非表示含む全列を raw から取得）
        ...sheetHeaders.map(h => (a.raw ? (a.raw[h] ?? '') : '')),
        // Notionプロファイル（28列）
        ...notionCols.map(c => notionProfile ? (notionProfile[c.key] ?? '') : ''),
      ];

      // 営業報告（最大 maxReports 件）
      for (let i = 0; i < maxReports; i++) {
        const rep = allReps[i] || null;
        for (const col of reportCols) {
          if (!rep) {
            row.push('');
          } else if (col.key === 'ep_proposal') {
            row.push(rep.ep_proposal ? 'あり' : '');
          } else {
            row.push(rep[col.key] != null ? rep[col.key] : '');
          }
        }
      }

      // サプライズコール（最大 maxSc 件）
      for (let i = 0; i < maxSc; i++) {
        const sc = scSorted[i] || null;
        for (const col of scCols) {
          row.push(sc ? (sc[col.key] || '') : '');
        }
      }

      return row;
    });

    // ── BOM + CSV 文字列を生成 ────────────────────────────────
    const BOM = '\uFEFF';  // Excel での文字化け防止
    const csvLines = [headerRow, ...dataRows].map(
      row => row.map(esc).join(',')
    );
    const csvStr = BOM + csvLines.join('\r\n');

    // ── ダウンロード実行 ──────────────────────────────────────
    const blob    = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    const now     = new Date();
    const ts      = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    a.href        = url;
    a.download    = `応募者一覧_${ts}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    Utils.notify(`CSVをダウンロードしました（${list.length}件）`, 'success');
  }
};
