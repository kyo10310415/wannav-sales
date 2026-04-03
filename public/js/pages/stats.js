// Stats / CVR Page
const StatsPage = {
  currentType: 'month', // 'week' or 'month'
  currentPeriod: '',
  applicantCount: 0,
  allPeriods: [],
  chart: null,

  render() {
    const months = Utils.getRecentMonths(12);
    const defaultMonth = months[0]?.value || '';

    return `
      <div class="page-header">
        <div>
          <div class="page-title"><i class="fas fa-chart-bar" style="margin-right:8px;color:var(--primary)"></i>データ集計</div>
          <div class="page-subtitle">CVR（コンバージョン率）集計</div>
        </div>
      </div>
      <div class="page-body">

        <!-- Period selector -->
        <div class="card" style="margin-bottom:20px">
          <div class="card-body" style="padding:16px 20px">
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
              <div>
                <span style="font-size:12px;font-weight:600;color:var(--gray-500);margin-right:8px">表示期間</span>
                <div class="period-tabs" style="display:inline-flex;gap:4px">
                  <button class="period-tab active" id="tab-month" onclick="StatsPage.switchType('month')">月次</button>
                  <button class="period-tab" id="tab-week" onclick="StatsPage.switchType('week')">週次</button>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:12px;font-weight:600;color:var(--gray-500)">期間選択</span>
                <select id="period-select" class="form-control" style="min-width:160px;width:auto" onchange="StatsPage.onPeriodChange()">
                  ${months.map(m => `<option value="${m.value}">${m.label}</option>`).join('')}
                </select>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:12px;font-weight:600;color:var(--gray-500)">応募数</span>
                <input type="number" id="applicant-count-input" class="form-control" style="width:100px"
                  value="${this.applicantCount}" min="0" placeholder="手入力"
                  onchange="StatsPage.onApplicantCountChange()">
                <span style="font-size:11px;color:var(--gray-400)">※スプレッドシートから自動取得</span>
              </div>
              <button class="btn btn-primary btn-sm" onclick="StatsPage.loadCurrentPeriod()">
                <i class="fas fa-sync-alt"></i> 集計
              </button>
            </div>
          </div>
        </div>

        <!-- CVR Cards -->
        <div id="cvr-cards" style="margin-bottom:20px">
          <div class="loading-spinner"><div class="spinner"></div><span>集計中...</span></div>
        </div>

        <!-- Trend Table -->
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
    // Get applicant count from spreadsheet
    try {
      const data = await API.spreadsheet.applicants();
      this.applicantCount = data.total || 0;
      const input = document.getElementById('applicant-count-input');
      if (input) input.value = this.applicantCount;
    } catch (e) {}

    // Set current period
    const select = document.getElementById('period-select');
    if (select) this.currentPeriod = select.value;

    await Promise.all([
      this.loadCurrentPeriod(),
      this.loadAllPeriods()
    ]);
  },

  switchType(type) {
    this.currentType = type;

    document.getElementById('tab-month').classList.toggle('active', type === 'month');
    document.getElementById('tab-week').classList.toggle('active', type === 'week');

    const select = document.getElementById('period-select');
    const options = type === 'month' ? Utils.getRecentMonths(12) : Utils.getRecentWeeks(24);
    select.innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    this.currentPeriod = options[0]?.value || '';

    this.loadCurrentPeriod();
    this.loadAllPeriods();
  },

  onPeriodChange() {
    this.currentPeriod = document.getElementById('period-select').value;
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
        applicant_count: this.applicantCount
      });

      const periodLabel = this.currentType === 'month'
        ? this.formatMonthLabel(this.currentPeriod)
        : this.formatWeekLabel(this.currentPeriod);

      cvrCards.innerHTML = `
        <div style="margin-bottom:12px;font-size:13px;font-weight:600;color:var(--gray-600)">
          <i class="fas fa-calendar-alt" style="margin-right:6px"></i>${Utils.escHtml(periodLabel)} の実績
        </div>
        <div class="cvr-grid">
          <!-- CVR① -->
          <div class="cvr-card" style="border-top:4px solid var(--primary)">
            <div class="cvr-label">
              <span style="background:var(--primary);color:white;border-radius:4px;padding:1px 8px;font-size:10px">CVR①</span>
              面接実施数に対する契約数
            </div>
            <div class="cvr-value">${data.cvr_interview}<span>%</span></div>
            <div class="cvr-breakdown">
              <span><i class="fas fa-clipboard-check" style="margin-right:4px;color:var(--primary)"></i>面接実施数: <strong>${data.total_interviews}件</strong></span>
              <span><i class="fas fa-handshake" style="margin-right:4px;color:var(--success)"></i>契約数: <strong>${data.total_contracts}件</strong></span>
            </div>
          </div>

          <!-- CVR② -->
          <div class="cvr-card" style="border-top:4px solid var(--secondary)">
            <div class="cvr-label">
              <span style="background:var(--secondary);color:white;border-radius:4px;padding:1px 8px;font-size:10px">CVR②</span>
              応募数に対する契約数
            </div>
            <div class="cvr-value" style="color:var(--secondary)">${data.cvr_applicant}<span>%</span></div>
            <div class="cvr-breakdown">
              <span><i class="fas fa-users" style="margin-right:4px;color:var(--secondary)"></i>応募数（重複除外）: <strong>${data.applicant_count}件</strong></span>
              <span><i class="fas fa-handshake" style="margin-right:4px;color:var(--success)"></i>契約数: <strong>${data.total_contracts}件</strong></span>
            </div>
          </div>

          <!-- Summary -->
          <div class="cvr-card">
            <div class="cvr-label"><i class="fas fa-chart-pie" style="margin-right:6px"></i>サマリー</div>
            <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--gray-50);border-radius:6px">
                <span style="font-size:12px;color:var(--gray-600)">面接実施数</span>
                <strong style="font-size:20px">${data.total_interviews}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--success-light);border-radius:6px">
                <span style="font-size:12px;color:var(--success)">契約数</span>
                <strong style="font-size:20px;color:var(--success)">${data.total_contracts}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--primary-light);border-radius:6px">
                <span style="font-size:12px;color:var(--primary)">応募数（重複除外）</span>
                <strong style="font-size:20px;color:var(--primary)">${data.applicant_count}</strong>
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
        </div>
      `;
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
            <th>進捗</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(d => {
            const cvr = parseFloat(d.cvr_interview) || 0;
            const barWidth = maxCvr > 0 ? (cvr / maxCvr * 100).toFixed(0) : 0;
            const label = this.currentType === 'month'
              ? this.formatMonthLabel(d.period)
              : this.formatWeekLabel(d.period);
            return `
              <tr>
                <td><strong>${Utils.escHtml(label)}</strong></td>
                <td>${d.total_interviews}件</td>
                <td><span class="badge badge-contract">${d.total_contracts}件</span></td>
                <td>
                  <strong style="color:var(--primary)">${cvr}%</strong>
                </td>
                <td style="min-width:120px">
                  <div style="background:var(--gray-100);border-radius:4px;height:8px;overflow:hidden">
                    <div style="background:var(--primary);height:100%;width:${barWidth}%;border-radius:4px;transition:width 0.3s"></div>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  formatMonthLabel(period) {
    if (!period) return '';
    const [year, month] = period.split('-');
    return `${year}年${parseInt(month)}月`;
  },

  formatWeekLabel(period) {
    if (!period) return '';
    const [year, week] = period.split('-W');
    return `${year}年 第${parseInt(week)}週`;
  }
};
