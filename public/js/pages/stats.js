// Stats / CVR Page
const StatsPage = {
  currentType: 'month', // 'week' or 'month'
  currentPeriod: '',
  applicantCount: 0,
  docPassCount: 0,
  interviewResvCount: 0,
  interviewCount: 0,
  cvContractCount: 0,
  loadingApplicantCount: false,
  allPeriods: [],

  render() {
    const months = Utils.getRecentMonths(12);

    return `
      <div class="page-header">
        <div>
          <div class="page-title"><i class="fas fa-chart-bar" style="margin-right:8px;color:var(--primary)"></i>データ集計</div>
          <div class="page-subtitle">CVR（コンバージョン率）集計</div>
        </div>
      </div>
      <div class="page-body">

        <!-- 期間セレクター -->
        <div class="card" style="margin-bottom:20px">
          <div class="card-body" style="padding:16px 20px">
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">

              <!-- 週次/月次タブ -->
              <div>
                <span style="font-size:12px;font-weight:600;color:var(--gray-500);margin-right:8px">表示期間</span>
                <div class="period-tabs" style="display:inline-flex;gap:4px">
                  <button class="period-tab active" id="tab-month" onclick="StatsPage.switchType('month')">月次</button>
                  <button class="period-tab" id="tab-week" onclick="StatsPage.switchType('week')">週次</button>
                </div>
              </div>

              <!-- 期間選択 -->
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:12px;font-weight:600;color:var(--gray-500)">期間</span>
                <select id="period-select" class="form-control" style="min-width:160px;width:auto"
                  onchange="StatsPage.onPeriodChange()">
                  ${months.map(m => `<option value="${m.value}">${m.label}</option>`).join('')}
                </select>
              </div>

              <!-- 集計ボタン -->
              <button class="btn btn-primary btn-sm" onclick="StatsPage.loadCurrentPeriod()">
                <i class="fas fa-sync-alt"></i> 集計
              </button>
            </div>
          </div>
        </div>

        <!-- タブ切り替え（データ集計 / CVR） -->
        <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid var(--gray-200)">
          <button id="view-tab-funnel" class="view-tab active"
            onclick="StatsPage.switchViewTab('funnel')"
            style="padding:8px 20px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:3px solid var(--primary);color:var(--primary);margin-bottom:-2px">
            <i class="fas fa-filter" style="margin-right:5px"></i>データ集計
          </button>
          <button id="view-tab-cvr" class="view-tab"
            onclick="StatsPage.switchViewTab('cvr')"
            style="padding:8px 20px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;color:var(--gray-500);border-bottom:3px solid transparent;margin-bottom:-2px">
            <i class="fas fa-percentage" style="margin-right:5px"></i>CVR集計
          </button>
        </div>

        <!-- データ集計（ファネル）ビュー -->
        <div id="view-funnel">
          <div id="funnel-cards" style="margin-bottom:20px">
            <div class="loading-spinner"><div class="spinner"></div><span>集計中...</span></div>
          </div>

          <!-- 期間別ファネル一覧 -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">
                <i class="fas fa-table" style="margin-right:8px;color:var(--gray-500)"></i>
                期間別データ集計一覧
              </div>
            </div>
            <div class="card-body" style="padding:0">
              <div id="funnel-table-wrap">
                <div class="loading-spinner"><div class="spinner"></div><span>読み込み中...</span></div>
              </div>
            </div>
          </div>
        </div>

        <!-- CVR集計ビュー -->
        <div id="view-cvr" style="display:none">
          <!-- CVRカード -->
          <div id="cvr-cards" style="margin-bottom:20px">
            <div class="loading-spinner"><div class="spinner"></div><span>集計中...</span></div>
          </div>

          <!-- 期間別CVR一覧テーブル -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">
                <i class="fas fa-table" style="margin-right:8px;color:var(--gray-500)"></i>
                期間別CVR一覧
              </div>
            </div>
            <div class="card-body" style="padding:0">
              <div id="periods-table-wrap">
                <div class="loading-spinner"><div class="spinner"></div><span>読み込み中...</span></div>
              </div>
            </div>
          </div>
        </div>

      </div>
    `;
  },

  async mount() {
    const select = document.getElementById('period-select');
    if (select) this.currentPeriod = select.value;

    await this.fetchApplicantCount();

    await Promise.all([
      this.loadCurrentPeriod(),
      this.loadAllPeriods()
    ]);
  },

  switchViewTab(tab) {
    const isFunnel = tab === 'funnel';
    document.getElementById('view-funnel').style.display = isFunnel ? 'block' : 'none';
    document.getElementById('view-cvr').style.display    = isFunnel ? 'none'  : 'block';

    const fBtn = document.getElementById('view-tab-funnel');
    const cBtn = document.getElementById('view-tab-cvr');
    if (fBtn) {
      fBtn.style.borderBottomColor = isFunnel ? 'var(--primary)' : 'transparent';
      fBtn.style.color = isFunnel ? 'var(--primary)' : 'var(--gray-500)';
    }
    if (cBtn) {
      cBtn.style.borderBottomColor = isFunnel ? 'transparent' : 'var(--primary)';
      cBtn.style.color = isFunnel ? 'var(--gray-500)' : 'var(--primary)';
    }
  },

  // 選択中の期間のスプレッドシート各カウントを取得
  async fetchApplicantCount() {
    if (!this.currentPeriod) return;

    const loadingEl = document.getElementById('count-loading');
    if (loadingEl) loadingEl.style.display = 'block';
    this.loadingApplicantCount = true;

    try {
      const data = await API.spreadsheet.applicantsCount({
        period: this.currentType,
        value:  this.currentPeriod
      });
      this.applicantCount      = data.count                || 0;
      this.docPassCount        = data.doc_pass_count       || 0;
      this.interviewResvCount  = data.interview_resv_count || 0;
      this.interviewCount      = data.interview_count      || 0;
      this.cvContractCount     = data.cv_count             || 0;
    } catch (e) {
      this.applicantCount     = 0;
      this.docPassCount       = 0;
      this.interviewResvCount = 0;
      this.interviewCount     = 0;
      this.cvContractCount    = 0;
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
      this.loadingApplicantCount = false;
    }
  },

  switchType(type) {
    this.currentType = type;

    document.getElementById('tab-month').classList.toggle('active', type === 'month');
    document.getElementById('tab-week').classList.toggle('active', type === 'week');

    const select = document.getElementById('period-select');
    const options = type === 'month' ? Utils.getRecentMonths(12) : Utils.getRecentWeeks(24);
    select.innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    this.currentPeriod = options[0]?.value || '';

    this.fetchApplicantCount().then(() => this.loadCurrentPeriod());
    this.loadAllPeriods();
  },

  async onPeriodChange() {
    this.currentPeriod = document.getElementById('period-select').value;
    await this.fetchApplicantCount();
    await this.loadCurrentPeriod();
  },

  async loadCurrentPeriod() {
    const periodSelect = document.getElementById('period-select');
    if (periodSelect) this.currentPeriod = periodSelect.value;

    // ファネルカードを更新
    this.renderFunnelCards();

    // CVRカードも更新
    const cvrCards = document.getElementById('cvr-cards');
    if (!cvrCards) return;
    cvrCards.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>集計中...</span></div>`;

    try {
      const data = await API.stats.summary({
        period:            this.currentType,
        value:             this.currentPeriod,
        applicant_count:   this.applicantCount,
        cv_contract_count: this.cvContractCount,
        interview_count:   this.interviewCount,
      });

      const periodLabel = this.currentType === 'month'
        ? this.formatMonthLabel(this.currentPeriod)
        : this.formatWeekLabel(this.currentPeriod);

      cvrCards.innerHTML = `
        <div style="margin-bottom:12px;font-size:13px;font-weight:600;color:var(--gray-600)">
          <i class="fas fa-calendar-alt" style="margin-right:6px"></i>${Utils.escHtml(periodLabel)} の実績
        </div>
        <div class="cvr-grid">

          <div class="cvr-card" style="border-top:4px solid var(--primary)">
            <div class="cvr-label">
              <span style="background:var(--primary);color:white;border-radius:4px;padding:1px 8px;font-size:10px">CVR①</span>
              面接実施数に対する契約数
            </div>
            <div class="cvr-value">${data.cvr_interview}<span>%</span></div>
            <div class="cvr-breakdown">
              <span>
                <i class="fas fa-clipboard-check" style="margin-right:4px;color:var(--primary)"></i>
                面接実施数: <strong>${data.total_interviews}件</strong>
                ${data.interview_from_sheet > 0
                  ? `<span style="font-size:10px;color:var(--gray-400);margin-left:4px">（シート 面接実施=TRUE）</span>`
                  : `<span style="font-size:10px;color:var(--warning);margin-left:4px"><i class="fas fa-exclamation-triangle"></i> 営業報告件数で代替</span>`
                }
              </span>
              <span><i class="fas fa-handshake" style="margin-right:4px;color:var(--success)"></i>契約数（CV=TRUE）: <strong>${data.total_contracts}件</strong></span>
              ${data.contracts_from_cv > 0 ? `
              <span style="font-size:11px;color:var(--gray-400);padding-left:4px;border-left:2px solid var(--gray-200);margin-top:2px">
                <i class="fas fa-table" style="margin-right:3px"></i>内訳: 営業報告 ${data.contracts_from_report}件 / CV列TRUE ${data.contracts_from_cv}件
              </span>` : ''}
            </div>
          </div>

          <div class="cvr-card" style="border-top:4px solid var(--secondary)">
            <div class="cvr-label">
              <span style="background:var(--secondary);color:white;border-radius:4px;padding:1px 8px;font-size:10px">CVR②</span>
              応募数に対する契約数
            </div>
            <div class="cvr-value" style="color:var(--secondary)">${data.cvr_applicant}<span>%</span></div>
            <div class="cvr-breakdown">
              <span>
                <i class="fas fa-users" style="margin-right:4px;color:var(--secondary)"></i>
                応募数<span style="font-size:10px;color:var(--gray-400)">（${Utils.escHtml(periodLabel)}・重複除外）</span>:
                <strong>${data.applicant_count}件</strong>
                ${data.applicant_count === 0 ? '<span style="font-size:10px;color:var(--warning)"><i class="fas fa-exclamation-triangle"></i> スプレッドシート未設定</span>' : ''}
              </span>
              <span><i class="fas fa-handshake" style="margin-right:4px;color:var(--success)"></i>契約数: <strong>${data.total_contracts}件</strong></span>
            </div>
          </div>

          <div class="cvr-card">
            <div class="cvr-label"><i class="fas fa-chart-pie" style="margin-right:6px"></i>サマリー</div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--gray-50);border-radius:6px">
                <div>
                  <div style="font-size:12px;color:var(--gray-600)">面接実施数</div>
                  <div style="font-size:10px;color:var(--gray-400)">
                    ${data.interview_from_sheet > 0 ? 'シート 面接実施=TRUE' : '営業報告件数（シート未設定）'}
                  </div>
                </div>
                <strong style="font-size:22px">${data.total_interviews}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--success-light);border-radius:6px">
                <div>
                  <div style="font-size:12px;color:var(--success)">契約数</div>
                  ${data.contracts_from_cv > 0 ? `<div style="font-size:10px;color:var(--gray-400)">営業報告 ${data.contracts_from_report} / CV=TRUE ${data.contracts_from_cv}</div>` : ''}
                </div>
                <strong style="font-size:22px;color:var(--success)">${data.total_contracts}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--primary-light);border-radius:6px">
                <span style="font-size:12px;color:var(--primary)">応募数（期間・重複除外）</span>
                <strong style="font-size:22px;color:var(--primary)">${data.applicant_count}</strong>
              </div>
            </div>
          </div>

        </div>
      `;
    } catch (err) {
      cvrCards.innerHTML = `
        <div class="alert alert-error">
          <i class="fas fa-exclamation-circle"></i>
          <span>${err.message}</span>
        </div>`;
    }
  },

  // ============================================================
  // ファネルカード描画（実数＋転換率）
  // ============================================================
  renderFunnelCards() {
    const el = document.getElementById('funnel-cards');
    if (!el) return;

    const periodLabel = this.currentType === 'month'
      ? this.formatMonthLabel(this.currentPeriod)
      : this.formatWeekLabel(this.currentPeriod);

    const apply   = this.applicantCount;
    const doc     = this.docPassCount;
    const resv    = this.interviewResvCount;
    const intv    = this.interviewCount;
    const cv      = this.cvContractCount;

    const pct = (num, base) =>
      base > 0 ? ((num / base) * 100).toFixed(1) : '—';

    // ステップ定義
    const steps = [
      { label: '応募',     icon: 'fa-user-plus',      color: '#3b82f6', bg: '#eff6ff', count: apply, rateLabel: null,             rate: null },
      { label: '書類通過', icon: 'fa-file-alt',        color: '#8b5cf6', bg: '#f5f3ff', count: doc,   rateLabel: '応募→書類通過',  rate: pct(doc,  apply) },
      { label: '面接予約', icon: 'fa-calendar-check',  color: '#f59e0b', bg: '#fffbeb', count: resv,  rateLabel: '書類→面接予約',  rate: pct(resv, doc)   },
      { label: '面接実施', icon: 'fa-clipboard-check', color: '#10b981', bg: '#ecfdf5', count: intv,  rateLabel: '予約→面接実施',  rate: pct(intv, resv)  },
      { label: 'CV',       icon: 'fa-handshake',       color: '#ef4444', bg: '#fef2f2', count: cv,    rateLabel: '面接→CV',        rate: pct(cv,   intv)  },
    ];

    // 全体CVR（応募→CV）
    const totalCvr = pct(cv, apply);

    el.innerHTML = `
      <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="font-size:13px;font-weight:600;color:var(--gray-600)">
          <i class="fas fa-calendar-alt" style="margin-right:6px"></i>${Utils.escHtml(periodLabel)} のデータ集計
        </div>
        <div style="font-size:12px;color:var(--gray-500)">
          スプレッドシートの各列の <strong>TRUE</strong> 件数を集計しています
        </div>
      </div>

      <!-- ファネルステップカード -->
      <div style="display:flex;gap:6px;align-items:stretch;flex-wrap:wrap;margin-bottom:16px">
        ${steps.map((s, i) => `
          <div style="flex:1;min-width:120px;background:${s.bg};border-radius:10px;padding:14px 12px;position:relative;border:1px solid ${s.color}22">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
              <div style="width:28px;height:28px;background:${s.color};border-radius:8px;display:flex;align-items:center;justify-content:center">
                <i class="fas ${s.icon}" style="color:white;font-size:13px"></i>
              </div>
              <span style="font-size:12px;font-weight:700;color:${s.color}">${s.label}</span>
            </div>
            <div style="font-size:28px;font-weight:800;color:${s.color};line-height:1">
              ${s.count.toLocaleString()}
              <span style="font-size:13px;font-weight:500">件</span>
            </div>
            ${s.rate !== null ? `
              <div style="margin-top:8px;padding-top:8px;border-top:1px solid ${s.color}33">
                <div style="font-size:10px;color:var(--gray-400);margin-bottom:2px">${s.rateLabel}</div>
                <div style="font-size:18px;font-weight:700;color:${s.color === '#3b82f6' ? 'var(--gray-600)' : s.color}">
                  ${s.rate === '—' ? '<span style="font-size:13px;color:var(--gray-300)">—</span>' : `${s.rate}<span style="font-size:11px">%</span>`}
                </div>
              </div>
            ` : `<div style="margin-top:8px;padding-top:8px;border-top:1px solid ${s.color}33;font-size:10px;color:var(--gray-400)">基準値</div>`}
          </div>
          ${i < steps.length - 1 ? `
            <div style="display:flex;align-items:center;color:var(--gray-300);font-size:18px;flex-shrink:0;align-self:center">
              <i class="fas fa-chevron-right"></i>
            </div>
          ` : ''}
        `).join('')}
      </div>

      <!-- 全体CVRバナー -->
      <div style="background:linear-gradient(135deg,#1e40af,#7c3aed);border-radius:10px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <div style="color:rgba(255,255,255,0.8);font-size:12px;margin-bottom:2px">
            <i class="fas fa-route" style="margin-right:5px"></i>全体CVR（応募 → CV）
          </div>
          <div style="color:white;font-size:11px;opacity:0.7">${Utils.escHtml(periodLabel)}</div>
        </div>
        <div style="text-align:right">
          <div style="color:white;font-size:36px;font-weight:900;line-height:1">
            ${totalCvr === '—' ? '—' : `${totalCvr}<span style="font-size:18px">%</span>`}
          </div>
          <div style="color:rgba(255,255,255,0.7);font-size:11px">${cv}件 / ${apply}件</div>
        </div>
      </div>
    `;
  },

  async loadAllPeriods() {
    const wrap = document.getElementById('periods-table-wrap');
    const fwrap = document.getElementById('funnel-table-wrap');

    if (wrap) wrap.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>読み込み中...</span></div>`;
    if (fwrap) fwrap.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>読み込み中...</span></div>`;

    try {
      const data = await API.stats.allPeriods(this.currentType);
      this.allPeriods = data;
      this.renderPeriodsTable(data);
      await this.renderFunnelTable();
    } catch (err) {
      const msg = `<div class="alert alert-error" style="margin:16px"><i class="fas fa-exclamation-circle"></i><span>${err.message}</span></div>`;
      if (wrap) wrap.innerHTML = msg;
      if (fwrap) fwrap.innerHTML = msg;
    }
  },

  // 期間別ファネルテーブル（スプレッドシートから全期間分を取得）
  async renderFunnelTable() {
    const wrap = document.getElementById('funnel-table-wrap');
    if (!wrap) return;

    // 直近12か月（月次）または24週（週次）の一覧をスプレッドシートから取得
    const periods = this.currentType === 'month'
      ? Utils.getRecentMonths(12)
      : Utils.getRecentWeeks(24);

    wrap.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>集計中...</span></div>`;

    try {
      // 全期間のカウントを並列取得
      const results = await Promise.all(
        periods.slice(0, 6).map(p =>
          API.spreadsheet.applicantsCount({ period: this.currentType, value: p.value })
            .then(d => ({ period: p.value, label: p.label, ...d }))
            .catch(() => ({ period: p.value, label: p.label, count: 0, doc_pass_count: 0, interview_resv_count: 0, interview_count: 0, cv_count: 0 }))
        )
      );

      if (!results.length) {
        wrap.innerHTML = `<div class="empty-state"><i class="fas fa-chart-bar"></i><h3>データがありません</h3></div>`;
        return;
      }

      const pct = (num, base) => base > 0 ? ((num / base) * 100).toFixed(1) + '%' : '—';

      wrap.innerHTML = `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;min-width:700px">
            <thead>
              <tr style="background:var(--gray-50)">
                <th style="padding:10px 14px;font-size:12px;text-align:left;border-bottom:2px solid var(--gray-200);white-space:nowrap">期間</th>
                <th style="padding:10px 10px;font-size:12px;text-align:center;border-bottom:2px solid var(--gray-200);color:#3b82f6">
                  <i class="fas fa-user-plus" style="margin-right:4px"></i>応募
                </th>
                <th style="padding:10px 10px;font-size:12px;text-align:center;border-bottom:2px solid var(--gray-200);color:#8b5cf6">
                  <i class="fas fa-file-alt" style="margin-right:4px"></i>書類通過
                </th>
                <th style="padding:10px 8px;font-size:11px;text-align:center;border-bottom:2px solid var(--gray-200);color:#8b5cf6;background:#f9f7ff">
                  応募→書類
                </th>
                <th style="padding:10px 10px;font-size:12px;text-align:center;border-bottom:2px solid var(--gray-200);color:#f59e0b">
                  <i class="fas fa-calendar-check" style="margin-right:4px"></i>面接予約
                </th>
                <th style="padding:10px 8px;font-size:11px;text-align:center;border-bottom:2px solid var(--gray-200);color:#f59e0b;background:#fffdf0">
                  書類→予約
                </th>
                <th style="padding:10px 10px;font-size:12px;text-align:center;border-bottom:2px solid var(--gray-200);color:#10b981">
                  <i class="fas fa-clipboard-check" style="margin-right:4px"></i>面接実施
                </th>
                <th style="padding:10px 8px;font-size:11px;text-align:center;border-bottom:2px solid var(--gray-200);color:#10b981;background:#f0fdf8">
                  予約→実施
                </th>
                <th style="padding:10px 10px;font-size:12px;text-align:center;border-bottom:2px solid var(--gray-200);color:#ef4444">
                  <i class="fas fa-handshake" style="margin-right:4px"></i>CV
                </th>
                <th style="padding:10px 8px;font-size:11px;text-align:center;border-bottom:2px solid var(--gray-200);color:#ef4444;background:#fff5f5">
                  面接→CV
                </th>
                <th style="padding:10px 10px;font-size:12px;text-align:center;border-bottom:2px solid var(--gray-200);color:white;background:linear-gradient(135deg,#1e40af,#7c3aed);white-space:nowrap">
                  全体CVR
                </th>
              </tr>
            </thead>
            <tbody>
              ${results.map(r => {
                const isCurrent = r.period === this.currentPeriod;
                const apply = r.count || 0;
                const doc   = r.doc_pass_count || 0;
                const resv  = r.interview_resv_count || 0;
                const intv  = r.interview_count || 0;
                const cv    = r.cv_count || 0;
                return `
                  <tr style="${isCurrent ? 'background:#eff6ff' : ''}">
                    <td style="padding:10px 14px;font-weight:600;font-size:13px;white-space:nowrap">
                      ${Utils.escHtml(r.label)}
                      ${isCurrent ? '<span style="margin-left:6px;font-size:10px;background:#bfdbfe;color:#1d4ed8;border-radius:4px;padding:1px 5px">選択中</span>' : ''}
                    </td>
                    <td style="padding:8px 10px;text-align:center;font-weight:700;font-size:14px;color:#3b82f6">${apply.toLocaleString()}</td>
                    <td style="padding:8px 10px;text-align:center;font-weight:700;font-size:14px;color:#8b5cf6">${doc.toLocaleString()}</td>
                    <td style="padding:8px 8px;text-align:center;font-size:12px;color:#8b5cf6;background:#faf8ff">${pct(doc, apply)}</td>
                    <td style="padding:8px 10px;text-align:center;font-weight:700;font-size:14px;color:#f59e0b">${resv.toLocaleString()}</td>
                    <td style="padding:8px 8px;text-align:center;font-size:12px;color:#f59e0b;background:#fffef5">${pct(resv, doc)}</td>
                    <td style="padding:8px 10px;text-align:center;font-weight:700;font-size:14px;color:#10b981">${intv.toLocaleString()}</td>
                    <td style="padding:8px 8px;text-align:center;font-size:12px;color:#10b981;background:#f5fdfb">${pct(intv, resv)}</td>
                    <td style="padding:8px 10px;text-align:center;font-weight:700;font-size:14px;color:#ef4444">${cv.toLocaleString()}</td>
                    <td style="padding:8px 8px;text-align:center;font-size:12px;color:#ef4444;background:#fff8f8">${pct(cv, intv)}</td>
                    <td style="padding:8px 10px;text-align:center;font-weight:800;font-size:14px;color:#1e40af;background:#eef2ff">${pct(cv, apply)}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div style="padding:8px 14px;font-size:11px;color:var(--gray-400)">
          <i class="fas fa-info-circle" style="margin-right:4px"></i>
          直近6期間を表示。各列は「TRUE」の件数。率は前ステップ比。
        </div>
      `;
    } catch (err) {
      wrap.innerHTML = `<div class="alert alert-error" style="margin:16px"><i class="fas fa-exclamation-circle"></i><span>${err.message}</span></div>`;
    }
  },

  renderPeriodsTable(data) {
    const wrap = document.getElementById('periods-table-wrap');
    if (!wrap) return;

    if (!data.length) {
      wrap.innerHTML = `<div class="empty-state"><i class="fas fa-chart-bar"></i><h3>データがありません</h3><p>営業報告を入力してください</p></div>`;
      return;
    }

    const maxCvr = Math.max(...data.map(d => parseFloat(d.cvr_interview) || 0));

    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>期間</th>
            <th>面接実施数</th>
            <th>契約数</th>
            <th>CVR① (面接比)</th>
            <th style="min-width:120px">進捗バー</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(d => {
            const cvr = parseFloat(d.cvr_interview) || 0;
            const barWidth = maxCvr > 0 ? (cvr / maxCvr * 100).toFixed(0) : 0;
            const label = this.currentType === 'month'
              ? this.formatMonthLabel(d.period)
              : this.formatWeekLabel(d.period);
            const isCurrent = d.period === this.currentPeriod;
            return `
              <tr style="${isCurrent ? 'background:#eff6ff' : ''}">
                <td>
                  <strong>${Utils.escHtml(label)}</strong>
                  ${isCurrent ? '<span class="badge" style="background:#bfdbfe;color:#1d4ed8;margin-left:6px;font-size:10px">選択中</span>' : ''}
                </td>
                <td>${d.total_interviews}件</td>
                <td><span class="badge badge-contract">${d.total_contracts}件</span></td>
                <td><strong style="color:var(--primary)">${cvr}%</strong></td>
                <td>
                  <div style="background:var(--gray-100);border-radius:4px;height:8px;overflow:hidden">
                    <div style="background:var(--primary);height:100%;width:${barWidth}%;border-radius:4px;transition:width 0.3s"></div>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  },

  formatMonthLabel(period) {
    if (!period) return '';
    const [year, month] = period.split('-');
    return `${year}年${parseInt(month)}月`;
  },

  formatWeekLabel(period) {
    return Utils.weekRangeLabel(period);
  }
};
