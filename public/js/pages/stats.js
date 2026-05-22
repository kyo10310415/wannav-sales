// Stats / CVR Page
const StatsPage = {
  currentType:   'month', // 'week' or 'month'
  currentPeriod: '',
  // スプレッドシートから取得するファネル数値（表示用のみ）
  applicantCount:      0,
  docPassCount:        0,
  interviewResvCount:  0,
  // interviewCount は廃止（面接実施数 = 営業報告件数のため不要）
  // CV はスプレッドシートではなく営業報告の契約数を使う（cvContractCount は廃止）
  loadingApplicantCount: false,
  allPeriods: [],
  // フィルター
  filters: {
    interviewer:              '',
    gender:                   '',
    age_group:                '',
    monthly_income_range:     '',
    disposable_income_range:  '',
    job_type:                 '',
    streaming_exp:            '',
  },
  filterOptions: null, // 選択肢キャッシュ

  // ============================================================
  // render()
  // ============================================================
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
        <div class="card" style="margin-bottom:16px">
          <div class="card-body" style="padding:14px 20px">
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
              <div>
                <span style="font-size:12px;font-weight:600;color:var(--gray-500);margin-right:8px">表示期間</span>
                <div class="period-tabs" style="display:inline-flex;gap:4px">
                  <button class="period-tab active" id="tab-month" onclick="StatsPage.switchType('month')">月次</button>
                  <button class="period-tab" id="tab-week" onclick="StatsPage.switchType('week')">週次</button>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:12px;font-weight:600;color:var(--gray-500)">期間</span>
                <select id="period-select" class="form-control" style="min-width:160px;width:auto"
                  onchange="StatsPage.onPeriodChange()">
                  ${months.map(m => `<option value="${m.value}">${m.label}</option>`).join('')}
                </select>
              </div>
              <button class="btn btn-primary btn-sm" onclick="StatsPage.applyAndLoad()">
                <i class="fas fa-sync-alt"></i> 集計
              </button>
            </div>
          </div>
        </div>

        <!-- フィルターパネル -->
        <div class="card" style="margin-bottom:16px">
          <div class="card-header" style="cursor:pointer;user-select:none" onclick="StatsPage.toggleFilter()">
            <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
              <span><i class="fas fa-sliders-h" style="margin-right:8px;color:var(--primary)"></i>フィルター</span>
              <span id="filter-badge" style="display:none;background:var(--primary);color:white;border-radius:99px;font-size:10px;padding:2px 8px;font-weight:600"></span>
              <i class="fas fa-chevron-down" id="filter-chevron" style="font-size:12px;color:var(--gray-400);transition:transform .2s"></i>
            </div>
          </div>
          <div id="filter-panel" style="display:none">
            <div class="card-body" style="padding:14px 20px">
              <div id="filter-body">
                <div class="loading-spinner"><div class="spinner"></div><span>読み込み中...</span></div>
              </div>
              <div style="margin-top:14px;display:flex;gap:8px">
                <button class="btn btn-primary btn-sm" onclick="StatsPage.applyAndLoad()">
                  <i class="fas fa-check"></i> フィルター適用
                </button>
                <button class="btn btn-secondary btn-sm" onclick="StatsPage.clearFilter()">
                  <i class="fas fa-times"></i> クリア
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- ビュータブ -->
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
          <div class="card">
            <div class="card-header">
              <div class="card-title"><i class="fas fa-table" style="margin-right:8px;color:var(--gray-500)"></i>期間別データ集計一覧</div>
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
          <div id="cvr-cards" style="margin-bottom:20px">
            <div class="loading-spinner"><div class="spinner"></div><span>集計中...</span></div>
          </div>
          <div class="card">
            <div class="card-header">
              <div class="card-title"><i class="fas fa-table" style="margin-right:8px;color:var(--gray-500)"></i>期間別CVR一覧</div>
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

  // ============================================================
  // mount()
  // ============================================================
  async mount() {
    const select = document.getElementById('period-select');
    if (select) this.currentPeriod = select.value;
    // フィルター選択肢を非同期取得・描画
    this._loadFilterOptions();
    // fetchApplicantCount・loadCurrentPeriod・loadAllPeriods を並列実行してロード時間を短縮
    await Promise.all([
      this.fetchApplicantCount(),
      this.loadCurrentPeriod(),
      this.loadAllPeriods(),
    ]);
  },

  // ============================================================
  // フィルターパネル
  // ============================================================
  toggleFilter() {
    const panel    = document.getElementById('filter-panel');
    const chevron  = document.getElementById('filter-chevron');
    const isOpen   = panel.style.display !== 'none';
    panel.style.display   = isOpen ? 'none' : 'block';
    chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  },

  async _loadFilterOptions() {
    if (this.filterOptions) {
      this._renderFilterBody();
      return;
    }
    try {
      this.filterOptions = await API.stats.filterOptions();
      this._renderFilterBody();
    } catch (e) {
      const fb = document.getElementById('filter-body');
      if (fb) fb.innerHTML = '<span style="color:var(--gray-400);font-size:12px">フィルター選択肢の読み込みに失敗しました</span>';
    }
  },

  _renderFilterBody() {
    const fb = document.getElementById('filter-body');
    if (!fb || !this.filterOptions) return;
    const o = this.filterOptions;
    const f = this.filters;

    // 文字列選択肢 select
    const sel = (id, label, opts, val) => `
      <div class="form-group" style="margin-bottom:0;min-width:150px">
        <label class="form-label" style="font-size:11px;margin-bottom:4px">${label}</label>
        <select id="filter-${id}" class="form-control" style="font-size:12px;padding:5px 8px">
          <option value="">すべて</option>
          ${opts.map(v => `<option value="${Utils.escHtml(v)}" ${val===v?'selected':''}>${Utils.escHtml(v)}</option>`).join('')}
        </select>
      </div>`;

    // value/label オブジェクト配列の select（月収・可処分所得の範囲帯）
    const selObj = (id, label, opts, val) => `
      <div class="form-group" style="margin-bottom:0;min-width:170px">
        <label class="form-label" style="font-size:11px;margin-bottom:4px">${label}</label>
        <select id="filter-${id}" class="form-control" style="font-size:12px;padding:5px 8px">
          <option value="">すべて</option>
          ${opts.map(r => `<option value="${Utils.escHtml(r.value)}" ${val===r.value?'selected':''}>${Utils.escHtml(r.label)}</option>`).join('')}
        </select>
      </div>`;

    fb.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">
        ${sel('interviewer',              '担当者',         o.interviewers,            f.interviewer)}
        ${sel('gender',                   '性別',           o.genders,                 f.gender)}
        ${sel('age_group',                '年齢帯',         o.age_groups,              f.age_group)}
        ${selObj('monthly_income_range',     '月収',           o.monthly_income_ranges,   f.monthly_income_range)}
        ${selObj('disposable_income_range',  '可処分所得',     o.disposable_income_ranges, f.disposable_income_range)}
        ${sel('job_type',                 '職種',           o.job_types,               f.job_type)}
        ${sel('streaming_exp',            '配信経験',       o.streaming_exps,          f.streaming_exp)}
      </div>
      <div style="margin-top:8px;font-size:11px;color:var(--gray-400)">
        <i class="fas fa-info-circle" style="margin-right:4px"></i>
        性別・年齢帯・月収・可処分所得・職種・配信経験は Notion プロファイルが登録済みの応募者のみ対象です
      </div>`;
  },

  _readFilters() {
    // id → filters キーのマッピング（id と key が同じなものはそのまま）
    const idKeyMap = [
      ['interviewer',             'interviewer'],
      ['gender',                  'gender'],
      ['age_group',               'age_group'],
      ['monthly_income_range',    'monthly_income_range'],
      ['disposable_income_range', 'disposable_income_range'],
      ['job_type',                'job_type'],
      ['streaming_exp',           'streaming_exp'],
    ];
    let count = 0;
    for (const [id, key] of idKeyMap) {
      const el = document.getElementById(`filter-${id}`);
      if (el) {
        this.filters[key] = el.value;
        if (el.value) count++;
      }
    }
    // バッジ更新
    const badge = document.getElementById('filter-badge');
    if (badge) {
      badge.textContent = count > 0 ? `${count}件のフィルター適用中` : '';
      badge.style.display = count > 0 ? 'inline' : 'none';
    }
  },

  clearFilter() {
    this.filters = {
      interviewer: '', gender: '', age_group: '',
      monthly_income_range: '', disposable_income_range: '',
      job_type: '', streaming_exp: '',
    };
    this._renderFilterBody();
    const badge = document.getElementById('filter-badge');
    if (badge) { badge.textContent = ''; badge.style.display = 'none'; }
    this.applyAndLoad();
  },

  // フィルター読み取り → 集計実行
  async applyAndLoad() {
    this._readFilters();
    await Promise.all([
      this.fetchApplicantCount(),
      this.loadCurrentPeriod(),
      this.loadAllPeriods(),
    ]);
  },

  // ============================================================
  // スプレッドシートからファネル数値を取得（表示用）
  // ============================================================
  async fetchApplicantCount() {
    if (!this.currentPeriod) return;
    this.loadingApplicantCount = true;
    try {
      const data = await API.spreadsheet.applicantsCount({
        period: this.currentType,
        value:  this.currentPeriod,
      });
      this.applicantCount     = data.count                || 0;
      this.docPassCount       = data.doc_pass_count       || 0;
      this.interviewResvCount = data.interview_resv_count || 0;
      // interview_count は廃止（面接実施数 = 営業報告件数）
    } catch (e) {
      this.applicantCount = this.docPassCount = this.interviewResvCount = 0;
    } finally {
      this.loadingApplicantCount = false;
    }
  },

  // ============================================================
  // 週次/月次切り替え
  // ============================================================
  switchType(type) {
    this.currentType = type;
    document.getElementById('tab-month').classList.toggle('active', type === 'month');
    document.getElementById('tab-week').classList.toggle('active',  type === 'week');

    const select  = document.getElementById('period-select');
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

  switchViewTab(tab) {
    const isFunnel = tab === 'funnel';
    document.getElementById('view-funnel').style.display = isFunnel ? 'block' : 'none';
    document.getElementById('view-cvr').style.display    = isFunnel ? 'none'  : 'block';
    const fBtn = document.getElementById('view-tab-funnel');
    const cBtn = document.getElementById('view-tab-cvr');
    if (fBtn) { fBtn.style.borderBottomColor = isFunnel ? 'var(--primary)' : 'transparent'; fBtn.style.color = isFunnel ? 'var(--primary)' : 'var(--gray-500)'; }
    if (cBtn) { cBtn.style.borderBottomColor = isFunnel ? 'transparent' : 'var(--primary)'; cBtn.style.color = isFunnel ? 'var(--gray-500)' : 'var(--primary)'; }
  },

  // ============================================================
  // 選択中の期間の CVR・クーリングオフカードを更新
  // ============================================================
  async loadCurrentPeriod() {
    const periodSelect = document.getElementById('period-select');
    if (periodSelect) this.currentPeriod = periodSelect.value;

    this.renderFunnelCards();

    const cvrCards = document.getElementById('cvr-cards');
    if (!cvrCards) return;
    cvrCards.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>集計中...</span></div>`;

    try {
      const filterParams = this._activeFilterParams();
      const data = await API.stats.summary({
        period:          this.currentType,
        value:           this.currentPeriod,
        applicant_count: this.applicantCount,
        ...filterParams,
      });

      const periodLabel = this.currentType === 'month'
        ? this.formatMonthLabel(this.currentPeriod)
        : this.formatWeekLabel(this.currentPeriod);

      const filterNote = this._filterNote();

      cvrCards.innerHTML = `
        <div style="margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="font-size:13px;font-weight:600;color:var(--gray-600)">
            <i class="fas fa-calendar-alt" style="margin-right:6px"></i>${Utils.escHtml(periodLabel)} の実績
          </div>
          ${filterNote ? `<div style="font-size:11px;color:var(--primary);background:#eff6ff;border-radius:6px;padding:2px 10px">${filterNote}</div>` : ''}
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
              <span>
                <i class="fas fa-clipboard-check" style="margin-right:4px;color:var(--primary)"></i>
                面接実施数: <strong>${data.total_interviews}件</strong>
                <span style="font-size:10px;color:var(--gray-400);margin-left:4px">（営業報告件数）</span>
              </span>
              <span><i class="fas fa-handshake" style="margin-right:4px;color:var(--success)"></i>契約数（営業報告）: <strong>${data.total_contracts}件</strong></span>
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
              <span>
                <i class="fas fa-users" style="margin-right:4px;color:var(--secondary)"></i>
                応募数<span style="font-size:10px;color:var(--gray-400)">（重複除外）</span>: <strong>${data.applicant_count}件</strong>
                ${data.applicant_count === 0 ? '<span style="font-size:10px;color:var(--warning)"><i class="fas fa-exclamation-triangle"></i> シート未設定</span>' : ''}
              </span>
              <span><i class="fas fa-handshake" style="margin-right:4px;color:var(--success)"></i>契約数: <strong>${data.total_contracts}件</strong></span>
            </div>
          </div>

          <!-- クーリングオフ率 -->
          <div class="cvr-card" style="border-top:4px solid #f59e0b">
            <div class="cvr-label">
              <span style="background:#f59e0b;color:white;border-radius:4px;padding:1px 8px;font-size:10px">CO率</span>
              クーリングオフ率（契約後）
            </div>
            <div class="cvr-value" style="color:#d97706">${data.coolingoff_rate}<span>%</span></div>
            <div class="cvr-breakdown">
              <span><i class="fas fa-undo" style="margin-right:4px;color:#f59e0b"></i>クーリングオフ数: <strong>${data.total_coolingoff}件</strong></span>
              <span style="font-size:11px;color:var(--gray-400)">契約 ${data.total_contracts}件 に対する割合</span>
            </div>
          </div>

        </div>

        <!-- サマリーカード -->
        <div class="card" style="margin-top:16px">
          <div class="card-body" style="padding:14px 16px">
            <div style="display:flex;gap:12px;flex-wrap:wrap">
              ${[
                { label:'面接実施数', val:data.total_interviews, color:'var(--primary)',  sub: '営業報告件数' },
                { label:'契約数（CV）', val:data.total_contracts,  color:'var(--success)',  sub: '営業報告の契約結果' },
                { label:'クーリングオフ', val:data.total_coolingoff, color:'#f59e0b',          sub: '営業報告の結果' },
                { label:'応募数',   val:data.applicant_count,   color:'var(--secondary)', sub: '期間・重複除外' },
              ].map(c => `
                <div style="flex:1;min-width:130px;background:var(--gray-50);border-radius:8px;padding:10px 14px;border-left:3px solid ${c.color}">
                  <div style="font-size:11px;color:var(--gray-500);margin-bottom:2px">${c.label}</div>
                  <div style="font-size:24px;font-weight:800;color:${c.color};line-height:1">${c.val.toLocaleString()}</div>
                  <div style="font-size:10px;color:var(--gray-400);margin-top:2px">${c.sub}</div>
                </div>`).join('')}
            </div>
          </div>
        </div>

        ${this._renderPlanBreakdown(data)}
      `;
    } catch (err) {
      cvrCards.innerHTML = `<div class="alert alert-error"><i class="fas fa-exclamation-circle"></i><span>${err.message}</span></div>`;
    }
  },

  // ============================================================
  // ファネルカード描画（スプレッドシート数値 + 営業報告の契約数）
  // ============================================================
  renderFunnelCards() {
    const el = document.getElementById('funnel-cards');
    if (!el) return;

    const periodLabel = this.currentType === 'month'
      ? this.formatMonthLabel(this.currentPeriod)
      : this.formatWeekLabel(this.currentPeriod);

    const apply = this.applicantCount;
    const doc   = this.docPassCount;
    const resv  = this.interviewResvCount;
    // 面接実施数: this.allPeriods（営業報告ベース）から選択期間の total_interviews を取得
    const periodRow = this.allPeriods.find(d => d.period === this.currentPeriod);
    const intv      = periodRow ? (periodRow.total_interviews || 0) : 0;
    const noshow    = periodRow ? (periodRow.total_noshow    || 0) : 0;
    const filterNote = this._filterNote();

    const pct = (num, base) => base > 0 ? ((num / base) * 100).toFixed(1) : '—';

    const steps = [
      { label:'応募',     icon:'fa-user-plus',      color:'#3b82f6', bg:'#eff6ff', count:apply, rateLabel:null,            rate:null },
      { label:'書類通過', icon:'fa-file-alt',        color:'#8b5cf6', bg:'#f5f3ff', count:doc,   rateLabel:'応募→書類通過', rate:pct(doc,  apply) },
      { label:'面接予約', icon:'fa-calendar-check',  color:'#f59e0b', bg:'#fffbeb', count:resv,  rateLabel:'書類→面接予約', rate:pct(resv, doc)   },
      { label:'面接実施', icon:'fa-clipboard-check', color:'#10b981', bg:'#ecfdf5', count:intv,  rateLabel:'予約→面接実施', rate:pct(intv, resv)  },
    ];
    const totalCvr = pct(doc, apply); // 応募→書類通過のサマリー

    el.innerHTML = `
      <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="font-size:13px;font-weight:600;color:var(--gray-600)">
            <i class="fas fa-calendar-alt" style="margin-right:6px"></i>${Utils.escHtml(periodLabel)} のデータ集計
          </div>
          ${filterNote ? `<div style="font-size:11px;color:var(--primary);background:#eff6ff;border-radius:6px;padding:2px 10px">${filterNote}</div>` : ''}
        </div>
        <div style="font-size:12px;color:var(--gray-500)">応募〜面接予約: スプレッドシート　面接実施: 営業報告（飛び除外）</div>
      </div>

      <div style="display:flex;gap:6px;align-items:stretch;flex-wrap:wrap;margin-bottom:12px">
        ${steps.map((s, i) => `
          <div style="flex:1;min-width:120px;background:${s.bg};border-radius:10px;padding:14px 12px;border:1px solid ${s.color}22">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
              <div style="width:28px;height:28px;background:${s.color};border-radius:8px;display:flex;align-items:center;justify-content:center">
                <i class="fas ${s.icon}" style="color:white;font-size:13px"></i>
              </div>
              <span style="font-size:12px;font-weight:700;color:${s.color}">${s.label}</span>
            </div>
            <div style="font-size:28px;font-weight:800;color:${s.color};line-height:1">
              ${s.count.toLocaleString()}<span style="font-size:13px;font-weight:500">件</span>
            </div>
            ${s.rate !== null ? `
              <div style="margin-top:8px;padding-top:8px;border-top:1px solid ${s.color}33">
                <div style="font-size:10px;color:var(--gray-400);margin-bottom:2px">${s.rateLabel}</div>
                <div style="font-size:18px;font-weight:700;color:${s.color}">
                  ${s.rate === '—' ? '<span style="font-size:13px;color:var(--gray-300)">—</span>' : `${s.rate}<span style="font-size:11px">%</span>`}
                </div>
              </div>` : `<div style="margin-top:8px;padding-top:8px;border-top:1px solid ${s.color}33;font-size:10px;color:var(--gray-400)">基準値</div>`}
          </div>
          ${i < steps.length - 1 ? `<div style="display:flex;align-items:center;color:var(--gray-300);font-size:18px;flex-shrink:0;align-self:center"><i class="fas fa-chevron-right"></i></div>` : ''}
        `).join('')}
      </div>

      <!-- 飛び件数バナー -->
      <div style="margin-bottom:16px;background:#fef3f2;border:1px solid #fecaca;border-radius:10px;padding:12px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px;flex:0 0 auto">
          <div style="width:32px;height:32px;background:#ef4444;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i class="fas fa-user-slash" style="color:white;font-size:14px"></i>
          </div>
          <span style="font-size:12px;font-weight:700;color:#dc2626">飛び（無断キャンセル）</span>
        </div>
        <div style="font-size:28px;font-weight:800;color:#dc2626;line-height:1">
          ${noshow.toLocaleString()}<span style="font-size:13px;font-weight:500">件</span>
        </div>
        <div style="font-size:11px;color:#991b1b;flex:1;min-width:180px">
          面接実施数にはカウントされません。
          ${(intv + noshow) > 0 ? `（全営業報告 ${(intv + noshow).toLocaleString()}件 中 ${pct(noshow, intv + noshow)}%）` : ''}
        </div>
      </div>

      <div style="background:linear-gradient(135deg,#1e40af,#7c3aed);border-radius:10px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <div style="color:rgba(255,255,255,0.8);font-size:12px;margin-bottom:2px">
            <i class="fas fa-route" style="margin-right:5px"></i>書類通過率（応募 → 書類通過）
          </div>
          <div style="color:white;font-size:11px;opacity:0.7">${Utils.escHtml(periodLabel)}</div>
        </div>
        <div style="text-align:right">
          <div style="color:white;font-size:36px;font-weight:900;line-height:1">
            ${totalCvr === '—' ? '—' : `${totalCvr}<span style="font-size:18px">%</span>`}
          </div>
          <div style="color:rgba(255,255,255,0.7);font-size:11px">${doc}件 / ${apply}件</div>
        </div>
      </div>
    `;
  },

  // ============================================================
  // 全期間一覧を読み込み
  // ============================================================
  async loadAllPeriods() {
    const wrap  = document.getElementById('periods-table-wrap');
    const fwrap = document.getElementById('funnel-table-wrap');
    if (wrap)  wrap.innerHTML  = `<div class="loading-spinner"><div class="spinner"></div><span>読み込み中...</span></div>`;
    if (fwrap) fwrap.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>読み込み中...</span></div>`;

    try {
      const filterParams = this._activeFilterParams();
      const data = await API.stats.allPeriods(this.currentType, filterParams);
      this.allPeriods = data;
      this.renderPeriodsTable(data);
      // allPeriods セット後にファネルカードも再描画（面接実施数を反映）
      this.renderFunnelCards();
      await this.renderFunnelTable();
    } catch (err) {
      const msg = `<div class="alert alert-error" style="margin:16px"><i class="fas fa-exclamation-circle"></i><span>${err.message}</span></div>`;
      if (wrap)  wrap.innerHTML  = msg;
      if (fwrap) fwrap.innerHTML = msg;
    }
  },

  // ============================================================
  // 期間別ファネルテーブル
  // ============================================================
  async renderFunnelTable() {
    const wrap = document.getElementById('funnel-table-wrap');
    if (!wrap) return;

    const periods = this.currentType === 'month'
      ? Utils.getRecentMonths(12)
      : Utils.getRecentWeeks(24);

    wrap.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>集計中...</span></div>`;

    try {
      // スプレッドシート側（応募・書類通過・面接予約）を直近6期間分取得
      // 現在の期間は fetchApplicantCount() で取得済みのデータを使い、残り5期間だけAPIを叩く
      const targetPeriods = periods.slice(0, 6);
      const sheetResults = await Promise.all(
        targetPeriods.map(p => {
          // 現在選択中の期間はキャッシュ済みデータを使う
          if (p.value === this.currentPeriod && this.applicantCount + this.docPassCount + this.interviewResvCount > 0) {
            return Promise.resolve({
              period: p.value,
              label:  p.label,
              count:                this.applicantCount,
              doc_pass_count:       this.docPassCount,
              interview_resv_count: this.interviewResvCount,
            });
          }
          return API.spreadsheet.applicantsCount({ period: this.currentType, value: p.value })
            .then(d => ({ period: p.value, label: p.label, ...d }))
            .catch(() => ({ period: p.value, label: p.label, count:0, doc_pass_count:0, interview_resv_count:0 }));
        })
      );

      // 営業報告側（面接実施数・飛び）: this.allPeriods から period キーで引く
      const salesMap = {};
      (this.allPeriods || []).forEach(d => {
        salesMap[d.period] = {
          intv:   d.total_interviews || 0,
          noshow: d.total_noshow     || 0,
        };
      });

      if (!sheetResults.length) {
        wrap.innerHTML = `<div class="empty-state"><i class="fas fa-chart-bar"></i><h3>データがありません</h3></div>`;
        return;
      }

      const pct = (num, base) => base > 0 ? ((num / base) * 100).toFixed(1) + '%' : '—';

      wrap.innerHTML = `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;min-width:800px">
            <thead>
              <tr style="background:var(--gray-50)">
                <th style="padding:10px 14px;font-size:12px;text-align:left;border-bottom:2px solid var(--gray-200)">期間</th>
                <th style="padding:10px 10px;font-size:12px;text-align:center;border-bottom:2px solid var(--gray-200);color:#3b82f6"><i class="fas fa-user-plus" style="margin-right:4px"></i>応募</th>
                <th style="padding:10px 10px;font-size:12px;text-align:center;border-bottom:2px solid var(--gray-200);color:#8b5cf6"><i class="fas fa-file-alt" style="margin-right:4px"></i>書類通過</th>
                <th style="padding:10px 8px;font-size:11px;text-align:center;border-bottom:2px solid var(--gray-200);color:#8b5cf6;background:#f9f7ff">応募→書類</th>
                <th style="padding:10px 10px;font-size:12px;text-align:center;border-bottom:2px solid var(--gray-200);color:#f59e0b"><i class="fas fa-calendar-check" style="margin-right:4px"></i>面接予約</th>
                <th style="padding:10px 8px;font-size:11px;text-align:center;border-bottom:2px solid var(--gray-200);color:#f59e0b;background:#fffdf0">書類→予約</th>
                <th style="padding:10px 10px;font-size:12px;text-align:center;border-bottom:2px solid var(--gray-200);color:#10b981"><i class="fas fa-clipboard-check" style="margin-right:4px"></i>面接実施</th>
                <th style="padding:10px 8px;font-size:11px;text-align:center;border-bottom:2px solid var(--gray-200);color:#10b981;background:#f0fdf8">予約→実施</th>
                <th style="padding:10px 10px;font-size:12px;text-align:center;border-bottom:2px solid var(--gray-200);color:#ef4444"><i class="fas fa-user-slash" style="margin-right:4px"></i>飛び</th>
              </tr>
            </thead>
            <tbody>
              ${sheetResults.map(r => {
                const isCurrent = r.period === this.currentPeriod;
                const apply  = r.count || 0;
                const doc    = r.doc_pass_count || 0;
                const resv   = r.interview_resv_count || 0;
                const sm     = salesMap[r.period] || { intv: 0, noshow: 0 };
                const intv   = sm.intv;
                const noshow = sm.noshow;
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
                    <td style="padding:8px 10px;text-align:center;font-weight:700;font-size:14px;color:#ef4444">${noshow.toLocaleString()}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div style="padding:10px 16px;font-size:11px;color:var(--gray-400);border-top:1px solid var(--gray-100)">
          <i class="fas fa-info-circle" style="margin-right:4px"></i>
          直近6期間を表示。応募・書類通過・面接予約はスプレッドシート。面接実施は営業報告件数（飛び除外）。飛びは営業報告の結果］飛び＾の件数。率は前ステップ比。
        </div>`;
    } catch (err) {
      wrap.innerHTML = `<div class="alert alert-error" style="margin:16px"><i class="fas fa-exclamation-circle"></i><span>${err.message}</span></div>`;
    }
  },

  // ============================================================
  // 期間別 CVR 一覧テーブル（営業報告ベース）
  // ============================================================
  renderPeriodsTable(data) {
    const wrap = document.getElementById('periods-table-wrap');
    if (!wrap) return;

    if (!data.length) {
      wrap.innerHTML = `<div class="empty-state"><i class="fas fa-chart-bar"></i><h3>データがありません</h3><p>営業報告を入力してください</p></div>`;
      return;
    }

    const maxCvr = Math.max(...data.map(d => parseFloat(d.cvr_interview) || 0));

    wrap.innerHTML = `
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>期間</th>
              <th>面接実施数</th>
              <th>契約数</th>
              <th>CVR① (面接比)</th>
              <th>クーリングオフ</th>
              <th>CO率（契約後）</th>
              <th style="min-width:120px">CVR進捗</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(d => {
              const cvr       = parseFloat(d.cvr_interview)   || 0;
              const coRate    = parseFloat(d.coolingoff_rate)  || 0;
              const barWidth  = maxCvr > 0 ? (cvr / maxCvr * 100).toFixed(0) : 0;
              const label     = this.currentType === 'month'
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
                  <td style="color:#d97706;font-weight:600">${d.total_coolingoff ?? 0}件</td>
                  <td>
                    ${coRate > 0
                      ? `<strong style="color:#f59e0b">${coRate}%</strong>`
                      : `<span style="color:var(--gray-300)">—</span>`}
                  </td>
                  <td>
                    <div style="background:var(--gray-100);border-radius:4px;height:8px;overflow:hidden">
                      <div style="background:var(--primary);height:100%;width:${barWidth}%;border-radius:4px;transition:width 0.3s"></div>
                    </div>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  },

  // ============================================================
  // 契約プラン別 CVR テーブル
  // ============================================================
  _renderPlanBreakdown(data) {
    const plans = data.plan_breakdown || [];
    if (!plans.length) return '';

    const totalInterviews = data.total_interviews || 0;
    const rows = plans.map(p => {
      const cvr      = totalInterviews > 0 ? ((p.count / totalInterviews) * 100).toFixed(1) : '0.0';
      const barWidth = data.total_contracts > 0 ? Math.round((p.count / data.total_contracts) * 100) : 0;
      const isUnfilled = p.plan === '未記入';
      return `
        <tr>
          <td style="padding:9px 14px;font-size:12px;font-weight:600;white-space:nowrap;color:${isUnfilled ? 'var(--gray-400)' : 'var(--gray-700)'}">
            ${isUnfilled ? '<i class="fas fa-minus-circle" style="margin-right:4px;color:var(--gray-300)"></i>' : '<i class="fas fa-tag" style="margin-right:4px;color:#7c3aed;font-size:10px"></i>'}
            ${Utils.escHtml(p.plan)}
          </td>
          <td style="padding:9px 12px;text-align:center;font-weight:700;font-size:15px;color:#16a34a">${p.count}</td>
          <td style="padding:9px 12px;text-align:center;font-size:13px;font-weight:600;color:var(--primary)">${cvr}%</td>
          <td style="padding:9px 14px;min-width:120px">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="flex:1;background:var(--gray-100);border-radius:4px;height:8px;overflow:hidden">
                <div style="background:#7c3aed;height:100%;width:${barWidth}%;border-radius:4px;transition:width 0.3s"></div>
              </div>
              <span style="font-size:10px;color:var(--gray-400);white-space:nowrap">${barWidth}%</span>
            </div>
          </td>
        </tr>`;
    }).join('');

    const totalCvr = totalInterviews > 0
      ? ((data.total_contracts / totalInterviews) * 100).toFixed(1) : '0.0';

    return `
      <div class="card" style="margin-top:20px">
        <div class="card-header" style="background:linear-gradient(135deg,#faf5ff,#f5f3ff)">
          <div class="card-title">
            <i class="fas fa-tags" style="margin-right:8px;color:#7c3aed"></i>契約プラン別 CVR（面接実施数比）
          </div>
        </div>
        <div class="card-body" style="padding:0">
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse">
              <thead>
                <tr style="background:var(--gray-50)">
                  <th style="padding:9px 14px;font-size:11px;text-align:left;border-bottom:2px solid var(--gray-200)">契約プラン</th>
                  <th style="padding:9px 12px;font-size:11px;text-align:center;border-bottom:2px solid var(--gray-200);color:#16a34a">契約数</th>
                  <th style="padding:9px 12px;font-size:11px;text-align:center;border-bottom:2px solid var(--gray-200);color:var(--primary)">CVR（面接比）</th>
                  <th style="padding:9px 14px;font-size:11px;text-align:left;border-bottom:2px solid var(--gray-200);min-width:150px">契約内の割合</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
                <tr style="background:#f0fdf4;border-top:2px solid #bbf7d0">
                  <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#166534">
                    <i class="fas fa-sigma" style="margin-right:5px"></i>合計
                  </td>
                  <td style="padding:10px 12px;text-align:center;font-weight:800;font-size:16px;color:#16a34a">${data.total_contracts}</td>
                  <td style="padding:10px 12px;text-align:center;font-weight:700;font-size:14px;color:var(--primary)">${totalCvr}%</td>
                  <td style="padding:10px 14px;font-size:11px;color:var(--gray-400)">面接実施 ${totalInterviews}件 に対する契約数</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  },

  // ============================================================
  // ユーティリティ
  // ============================================================
  _activeFilterParams() {
    const params = {};
    if (this.filters.interviewer)              params.interviewer              = this.filters.interviewer;
    if (this.filters.gender)                   params.gender                   = this.filters.gender;
    if (this.filters.age_group)                params.age_group                = this.filters.age_group;
    if (this.filters.monthly_income_range)     params.monthly_income_range     = this.filters.monthly_income_range;
    if (this.filters.disposable_income_range)  params.disposable_income_range  = this.filters.disposable_income_range;
    if (this.filters.job_type)                 params.job_type                 = this.filters.job_type;
    if (this.filters.streaming_exp)            params.streaming_exp            = this.filters.streaming_exp;
    return params;
  },

  _filterNote() {
    const active = Object.entries(this.filters).filter(([,v]) => v);
    if (!active.length) return '';
    const labels = {
      interviewer:             '担当者',
      gender:                  '性別',
      age_group:               '年齢帯',
      monthly_income_range:    '月収',
      disposable_income_range: '可処分所得',
      job_type:                '職種',
      streaming_exp:           '配信経験',
    };
    // 月収・可処分所得は value→label変換が必要
    const MONTHLY_LABELS   = { lt100k:'100,000円未満', mid:'100,000〜299,999円', gte300k:'300,000円以上' };
    const DISPOSABLE_LABELS = { lt10k:'10,000円未満',  mid:'10,000〜49,999円',  gte50k:'50,000円以上'  };
    return '<i class="fas fa-filter" style="margin-right:4px"></i>' +
      active.map(([k, v]) => {
        let display = v;
        if (k === 'monthly_income_range')    display = MONTHLY_LABELS[v]   || v;
        if (k === 'disposable_income_range') display = DISPOSABLE_LABELS[v] || v;
        return `${labels[k]}: ${Utils.escHtml(display)}`;
      }).join(' / ');
  },

  formatMonthLabel(period) {
    if (!period) return '';
    const [year, month] = period.split('-');
    return `${year}年${parseInt(month)}月`;
  },
  formatWeekLabel(period) {
    return Utils.weekRangeLabel(period);
  },
};
