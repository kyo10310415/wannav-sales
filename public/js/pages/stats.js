// Stats / CVR Page
const StatsPage = {
  currentType: 'month', // 'week' or 'month'
  currentPeriod: '',
  applicantCount: 0,
  cvContractCount: 0,    // CV=TRUEの件数
  interviewCount: 0,     // 面接実施=TRUEの件数（スプレッドシート）
  allPeriods: [],
  loadingApplicantCount: false,

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

              <!-- 応募数（自動取得） -->
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:12px;font-weight:600;color:var(--gray-500)">応募数</span>
                <div style="position:relative">
                  <input type="number" id="applicant-count-input" class="form-control" style="width:90px"
                    value="${this.applicantCount}" min="0"
                    onchange="StatsPage.onApplicantCountChange()">
                  <div id="count-loading" style="display:none;position:absolute;right:8px;top:50%;transform:translateY(-50%)">
                    <div class="spinner" style="width:14px;height:14px;border-width:2px"></div>
                  </div>
                </div>
                <span style="font-size:11px;color:var(--gray-400)">
                  <i class="fas fa-table" style="margin-right:3px"></i>選択期間の応募数（自動）
                </span>
              </div>

              <!-- 集計ボタン -->
              <button class="btn btn-primary btn-sm" onclick="StatsPage.loadCurrentPeriod()">
                <i class="fas fa-sync-alt"></i> 集計
              </button>
            </div>
          </div>
        </div>

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
    `;
  },

  async mount() {
    const select = document.getElementById('period-select');
    if (select) this.currentPeriod = select.value;

    // 期間の応募数を取得してから集計
    await this.fetchApplicantCount();

    await Promise.all([
      this.loadCurrentPeriod(),
      this.loadAllPeriods()
    ]);
  },

  // 選択中の期間のスプレッドシート応募数＆CV=TRUE件数を取得
  async fetchApplicantCount() {
    if (!this.currentPeriod) return;

    const loadingEl = document.getElementById('count-loading');
    const inputEl = document.getElementById('applicant-count-input');

    if (loadingEl) loadingEl.style.display = 'block';
    this.loadingApplicantCount = true;

    try {
      const data = await API.spreadsheet.applicantsCount({
        period: this.currentType,
        value: this.currentPeriod
      });
      this.applicantCount   = data.count         || 0;
      this.cvContractCount  = data.cv_count       || 0;  // CV=TRUE件数
      this.interviewCount   = data.interview_count || 0; // 面接実施=TRUE件数
      if (inputEl) inputEl.value = this.applicantCount;
    } catch (e) {
      this.applicantCount = 0;
      this.cvContractCount = 0;
      if (inputEl) inputEl.value = 0;
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

    // 期間変更時に応募数も更新
    this.fetchApplicantCount().then(() => {
      this.loadCurrentPeriod();
    });
    this.loadAllPeriods();
  },

  async onPeriodChange() {
    this.currentPeriod = document.getElementById('period-select').value;
    // 期間が変わったら応募数を再取得
    await this.fetchApplicantCount();
    await this.loadCurrentPeriod();
  },

  onApplicantCountChange() {
    this.applicantCount = parseInt(document.getElementById('applicant-count-input').value) || 0;
  },

  async loadCurrentPeriod() {
    const cvrCards = document.getElementById('cvr-cards');
    if (!cvrCards) return;
    cvrCards.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>集計中...</span></div>`;

    const periodSelect = document.getElementById('period-select');
    if (periodSelect) this.currentPeriod = periodSelect.value;

    try {
      const data = await API.stats.summary({
        period: this.currentType,
        value: this.currentPeriod,
        applicant_count:   this.applicantCount,
        cv_contract_count: this.cvContractCount,  // CV=TRUE件数
        interview_count:   this.interviewCount,   // 面接実施=TRUE件数
      });

      const periodLabel = this.currentType === 'month'
        ? this.formatMonthLabel(this.currentPeriod)
        : this.formatWeekLabel(this.currentPeriod);

      cvrCards.innerHTML = `
        <div style="margin-bottom:12px;font-size:13px;font-weight:600;color:var(--gray-600)">
          <i class="fas fa-calendar-alt" style="margin-right:6px"></i>${Utils.escHtml(periodLabel)} の実績
        </div>
        <div class="cvr-grid">

          <!-- CVR① 面接実施数に対する契約数 -->
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

          <!-- CVR② 応募数に対する契約数 -->
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

          <!-- サマリー -->
          <div class="cvr-card">
            <div class="cvr-label"><i class="fas fa-chart-pie" style="margin-right:6px"></i>サマリー</div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--gray-50);border-radius:6px">
                <div>
                  <div style="font-size:12px;color:var(--gray-600)">面接実施数</div>
                  <div style="font-size:10px;color:var(--gray-400)">
                    ${data.interview_from_sheet > 0
                      ? 'シート 面接実施=TRUE'
                      : '営業報告件数（シート未設定）'
                    }
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

  async loadAllPeriods() {
    const wrap = document.getElementById('periods-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>読み込み中...</span></div>`;

    try {
      const data = await API.stats.allPeriods(this.currentType);
      this.allPeriods = data;
      this.renderPeriodsTable(data);
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
