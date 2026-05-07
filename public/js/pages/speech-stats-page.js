// 発話比率集計ページ
const SpeechStatsPage = {
  currentMonth: '',
  summaryRows: [],
  detailRows: [],
  detailInterviewerId: null,
  detailInterviewerName: '',

  // ────────────────────────────────────────────────────────────
  render() {
    const months = Utils.getRecentMonths(24);
    const now    = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    return `
      <div class="page-header">
        <div>
          <div class="page-title">
            <i class="fas fa-microphone-alt" style="margin-right:8px;color:#7c3aed"></i>発話比率集計
          </div>
          <div class="page-subtitle">担当者別の発話分析平均（すくう君発話比率分析の蓄積データ）</div>
        </div>
      </div>
      <div class="page-body">

        <!-- 年月セレクター -->
        <div class="card" style="margin-bottom:20px">
          <div class="card-body" style="padding:16px 20px">
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
              <div style="display:flex;align-items:center;gap:8px">
                <i class="fas fa-calendar-alt" style="color:#7c3aed;font-size:15px"></i>
                <span style="font-size:13px;font-weight:600;color:var(--gray-600)">対象月</span>
                <select id="speech-month-select" class="form-control" style="min-width:160px;width:auto"
                  onchange="SpeechStatsPage.onMonthChange()">
                  ${months.map(m => `<option value="${m.value}" ${m.value === defaultMonth ? 'selected' : ''}>${m.label}</option>`).join('')}
                </select>
              </div>
              <button class="btn btn-sm" style="background:#7c3aed;color:#fff;border-color:#7c3aed"
                onclick="SpeechStatsPage.load()">
                <i class="fas fa-sync-alt"></i> 集計
              </button>
            </div>
          </div>
        </div>

        <!-- サマリーカード -->
        <div id="speech-summary-area">
          <div style="text-align:center;padding:60px 0;color:var(--gray-400)">
            <i class="fas fa-spinner fa-spin" style="font-size:28px;margin-bottom:12px;display:block"></i>
            データを読み込んでいます...
          </div>
        </div>

        <!-- 担当者別テーブル -->
        <div id="speech-table-area" style="display:none">
          <div class="card">
            <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
              <div class="card-title">
                <i class="fas fa-table" style="margin-right:6px;color:#7c3aed"></i>担当者別 発話比率一覧
              </div>
              <span id="speech-month-label" style="font-size:13px;color:var(--gray-500);font-weight:600"></span>
            </div>
            <div class="card-body" style="padding:0">
              <div class="table-container">
                <table id="speech-stats-table">
                  <thead>
                    <tr>
                      <th>担当者</th>
                      <th style="text-align:center">分析回数</th>
                      <th style="text-align:center">講師発話率</th>
                      <th style="text-align:center">応募者発話率</th>
                      <th style="text-align:center">最長連続発話</th>
                      <th style="text-align:center">3分超<br>モノローグ</th>
                      <th style="text-align:center">応募者<br>ターン数</th>
                      <th style="text-align:center">困惑</th>
                      <th style="text-align:center">ストレス</th>
                      <th style="text-align:center">ポジティブ</th>
                      <th style="text-align:center">詳細</th>
                    </tr>
                  </thead>
                  <tbody id="speech-stats-tbody"></tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- 空メッセージ -->
        <div id="speech-empty-area" style="display:none">
          <div class="card">
            <div class="card-body" style="text-align:center;padding:60px 20px;color:var(--gray-400)">
              <i class="fas fa-chart-pie" style="font-size:40px;margin-bottom:16px;display:block;opacity:.3"></i>
              <div style="font-size:14px">この月の発話比率分析データはありません</div>
              <div style="font-size:12px;margin-top:6px">すくう君の「発話比率分析」ボタンで分析を実施すると蓄積されます</div>
            </div>
          </div>
        </div>

      </div><!-- /page-body -->

      <!-- 詳細モーダル -->
      <div id="speech-detail-modal" class="modal-overlay" style="display:none" onclick="SpeechStatsPage.closeDetail(event)">
        <div class="modal" style="max-width:820px;width:95vw;max-height:90vh;overflow-y:auto" onclick="event.stopPropagation()">
          <div class="modal-header">
            <div class="modal-title">
              <i class="fas fa-microphone-alt" style="color:#7c3aed;margin-right:8px"></i>
              <span id="speech-detail-title">発話比率 詳細</span>
            </div>
            <button class="modal-close" onclick="SpeechStatsPage.closeDetail()">&times;</button>
          </div>
          <div class="modal-body" id="speech-detail-body">
            <!-- 動的に挿入 -->
          </div>
        </div>
      </div>
    `;
  },

  // ────────────────────────────────────────────────────────────
  mount() {
    this.currentMonth = document.getElementById('speech-month-select')?.value || '';
    this.load();
  },

  // ────────────────────────────────────────────────────────────
  onMonthChange() {
    this.currentMonth = document.getElementById('speech-month-select')?.value || '';
  },

  // ────────────────────────────────────────────────────────────
  async load() {
    const month = document.getElementById('speech-month-select')?.value
                  || this.currentMonth;
    this.currentMonth = month;

    this._showLoading();

    try {
      const data = await API.sukuukun.speechStats.summary({ month });
      this.summaryRows = data.rows || [];
      this._renderTable(month);
    } catch (e) {
      Utils.notify('集計の取得に失敗しました: ' + e.message, 'error');
      this._showEmpty();
    }
  },

  // ────────────────────────────────────────────────────────────
  _showLoading() {
    document.getElementById('speech-summary-area').innerHTML = `
      <div style="text-align:center;padding:60px 0;color:var(--gray-400)">
        <i class="fas fa-spinner fa-spin" style="font-size:28px;margin-bottom:12px;display:block"></i>
        データを読み込んでいます...
      </div>`;
    document.getElementById('speech-table-area').style.display  = 'none';
    document.getElementById('speech-empty-area').style.display  = 'none';
  },

  _showEmpty() {
    document.getElementById('speech-summary-area').innerHTML = '';
    document.getElementById('speech-table-area').style.display  = 'none';
    document.getElementById('speech-empty-area').style.display  = '';
  },

  // ────────────────────────────────────────────────────────────
  _renderTable(month) {
    const rows = this.summaryRows;
    const monthLabel = this._monthLabel(month);

    document.getElementById('speech-summary-area').innerHTML = '';

    if (!rows || rows.length === 0) {
      this._showEmpty();
      return;
    }

    // サマリーカード（全体平均）
    const total      = rows.length;
    const totalCount = rows.reduce((s, r) => s + (r.analysis_count || 0), 0);
    const avgSales   = rows.reduce((s, r) => s + (r.avg_sales_ratio || 0), 0) / total;
    const avgApp     = rows.reduce((s, r) => s + (r.avg_applicant_ratio || 0), 0) / total;
    const avgMono    = rows.reduce((s, r) => s + (r.avg_max_monologue_sec || 0), 0) / total;
    const avgPositive = rows.reduce((s, r) => s + (r.avg_positive || 0), 0) / total;

    document.getElementById('speech-summary-area').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px">
        ${this._miniCard('fa-users', '担当者数', `${total}人`, '#7c3aed')}
        ${this._miniCard('fa-chart-pie', '総分析回数', `${totalCount}回`, '#2563eb')}
        ${this._miniCard('fa-microphone', '平均講師発話率', `${Math.round(avgSales)}%`, this._ratioColor(Math.round(avgSales)))}
        ${this._miniCard('fa-user', '平均応募者発話率', `${Math.round(avgApp)}%`, '#059669')}
        ${this._miniCard('fa-stopwatch', '平均最長連続発話', this._secLabel(Math.round(avgMono)), '#d97706')}
        ${this._miniCard('fa-smile', '平均ポジティブ', `${Math.round(avgPositive)}%`, '#16a34a')}
      </div>`;

    // テーブル
    document.getElementById('speech-month-label').textContent = monthLabel;
    const tbody = document.getElementById('speech-stats-tbody');
    tbody.innerHTML = rows.map(r => this._tableRow(r)).join('');

    document.getElementById('speech-table-area').style.display = '';
    document.getElementById('speech-empty-area').style.display = 'none';
  },

  _miniCard(icon, label, value, color) {
    return `
      <div class="card" style="margin:0">
        <div class="card-body" style="padding:16px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:${color};margin-bottom:4px">
            <i class="fas ${icon}" style="font-size:14px;opacity:.6;margin-right:4px"></i>${value}
          </div>
          <div style="font-size:11px;color:var(--gray-500);font-weight:600">${label}</div>
        </div>
      </div>`;
  },

  _tableRow(r) {
    const salesRatio = r.avg_sales_ratio != null ? Math.round(r.avg_sales_ratio) : '-';
    const appRatio   = r.avg_applicant_ratio != null ? Math.round(r.avg_applicant_ratio) : '-';
    const monoSec    = r.avg_max_monologue_sec != null ? this._secLabel(Math.round(r.avg_max_monologue_sec)) : '-';
    const mono3      = r.total_mono_3min != null ? r.total_mono_3min : '-';
    const appTurns   = r.avg_applicant_turns != null ? Math.round(r.avg_applicant_turns) : '-';
    const confusion  = r.avg_confusion  != null ? Math.round(r.avg_confusion)  : '-';
    const stress     = r.avg_stress     != null ? Math.round(r.avg_stress)     : '-';
    const positive   = r.avg_positive   != null ? Math.round(r.avg_positive)   : '-';

    const salesBar  = typeof salesRatio === 'number' ? this._ratioBar(salesRatio, '#7c3aed') : '';
    const appBar    = typeof appRatio   === 'number' ? this._ratioBar(appRatio,   '#059669') : '';

    return `
      <tr>
        <td style="font-weight:600">${Utils.escHtml(r.interviewer_name || '不明')}</td>
        <td style="text-align:center">
          <span class="badge badge-default">${r.analysis_count}回</span>
        </td>
        <td style="min-width:110px">
          ${salesBar}
          <span style="font-size:12px;color:${this._ratioColor(salesRatio)};font-weight:700;margin-left:4px">${salesRatio}%</span>
        </td>
        <td style="min-width:110px">
          ${appBar}
          <span style="font-size:12px;color:#059669;font-weight:700;margin-left:4px">${appRatio}%</span>
        </td>
        <td style="text-align:center;font-size:13px">${monoSec}</td>
        <td style="text-align:center">
          ${typeof mono3 === 'number' && mono3 > 0
            ? `<span style="color:#dc2626;font-weight:700">${mono3}回</span>`
            : `<span style="color:var(--gray-400)">${mono3}</span>`}
        </td>
        <td style="text-align:center;font-size:13px">${appTurns}回</td>
        <td style="text-align:center">${this._emotionBadge(confusion, 'confusion')}</td>
        <td style="text-align:center">${this._emotionBadge(stress,    'stress')}</td>
        <td style="text-align:center">${this._emotionBadge(positive,  'positive')}</td>
        <td style="text-align:center">
          <button class="btn btn-sm btn-secondary" style="font-size:11px;padding:3px 10px"
            onclick="SpeechStatsPage.openDetail(${r.interviewer_id}, '${Utils.escHtml(r.interviewer_name || '不明')}')">
            <i class="fas fa-list-ul"></i> 詳細
          </button>
        </td>
      </tr>`;
  },

  _ratioBar(pct, color) {
    const w = Math.min(Math.max(pct, 0), 100);
    return `<div style="display:inline-block;vertical-align:middle;width:60px;height:6px;background:var(--gray-200);border-radius:3px;overflow:hidden">
      <div style="width:${w}%;height:100%;background:${color};border-radius:3px;transition:width .4s"></div>
    </div>`;
  },

  _ratioColor(pct) {
    if (typeof pct !== 'number') return 'var(--gray-400)';
    if (pct >= 80) return '#dc2626'; // 高すぎ
    if (pct >= 65) return '#d97706'; // やや高い
    return '#7c3aed';                // 適切
  },

  _emotionBadge(val, type) {
    if (val === '-' || val == null) return '<span style="color:var(--gray-300)">-</span>';
    const v = Number(val);
    let color = '#6b7280';
    if (type === 'confusion') {
      color = v >= 50 ? '#dc2626' : v >= 30 ? '#d97706' : '#6b7280';
    } else if (type === 'stress') {
      color = v >= 60 ? '#dc2626' : v >= 40 ? '#d97706' : '#6b7280';
    } else if (type === 'positive') {
      color = v >= 60 ? '#16a34a' : v >= 40 ? '#d97706' : '#6b7280';
    }
    return `<span style="color:${color};font-weight:700;font-size:13px">${v}%</span>`;
  },

  _secLabel(sec) {
    if (!sec && sec !== 0) return '-';
    if (sec < 60) return `${sec}秒`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}分${s}秒` : `${m}分`;
  },

  _monthLabel(month) {
    if (!month) return '';
    const [y, m] = month.split('-');
    return `${y}年${parseInt(m, 10)}月`;
  },

  // ────────────────────────────────────────────────────────────
  // 詳細モーダル
  // ────────────────────────────────────────────────────────────
  async openDetail(interviewerId, interviewerName) {
    this.detailInterviewerId   = interviewerId;
    this.detailInterviewerName = interviewerName;

    const modal = document.getElementById('speech-detail-modal');
    const body  = document.getElementById('speech-detail-body');
    const title = document.getElementById('speech-detail-title');

    title.textContent = `${interviewerName} ― 発話比率 詳細（${this._monthLabel(this.currentMonth)}）`;
    body.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--gray-400)">
      <i class="fas fa-spinner fa-spin" style="font-size:22px"></i>
    </div>`;
    modal.style.display = 'flex';

    try {
      const data = await API.sukuukun.speechStats.detail({
        month:          this.currentMonth,
        interviewer_id: interviewerId === -1 ? undefined : interviewerId,
      });
      this.detailRows = data.rows || [];
      body.innerHTML  = this._renderDetailBody(this.detailRows, interviewerName);
    } catch (e) {
      body.innerHTML = `<div style="color:#dc2626;padding:20px">取得に失敗しました: ${Utils.escHtml(e.message)}</div>`;
    }
  },

  closeDetail(e) {
    if (e && e.target !== document.getElementById('speech-detail-modal')) return;
    document.getElementById('speech-detail-modal').style.display = 'none';
  },

  _renderDetailBody(rows, interviewerName) {
    if (!rows || rows.length === 0) {
      return `<div style="text-align:center;padding:40px;color:var(--gray-400)">
        この月のデータはありません
      </div>`;
    }

    // 詳細統計サマリー
    const cnt      = rows.length;
    const avgSales = Math.round(rows.reduce((s,r) => s+(r.sales_ratio||0),0)/cnt);
    const avgApp   = Math.round(rows.reduce((s,r) => s+(r.applicant_ratio||0),0)/cnt);
    const avgMono  = Math.round(rows.reduce((s,r) => s+(r.max_monologue_sec||0),0)/cnt);
    const avgConf  = Math.round(rows.reduce((s,r) => s+(r.emotion_confusion||0),0)/cnt);
    const avgStr   = Math.round(rows.reduce((s,r) => s+(r.emotion_stress||0),0)/cnt);
    const avgPos   = Math.round(rows.reduce((s,r) => s+(r.emotion_positive||0),0)/cnt);

    const summaryHtml = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:20px;padding:0 4px">
        ${this._detailMiniCard('分析回数', cnt+'回', '#7c3aed')}
        ${this._detailMiniCard('平均講師発話率', avgSales+'%', this._ratioColor(avgSales))}
        ${this._detailMiniCard('平均応募者発話率', avgApp+'%', '#059669')}
        ${this._detailMiniCard('平均最長連続発話', this._secLabel(avgMono), '#d97706')}
        ${this._detailMiniCard('平均困惑', avgConf+'%', avgConf>=50?'#dc2626':'#6b7280')}
        ${this._detailMiniCard('平均ストレス', avgStr+'%', avgStr>=60?'#dc2626':'#6b7280')}
        ${this._detailMiniCard('平均ポジティブ', avgPos+'%', avgPos>=60?'#16a34a':'#6b7280')}
      </div>`;

    // 個別レコード
    const cardsHtml = rows.map(r => this._detailCard(r)).join('');

    return summaryHtml + `
      <div style="font-size:12px;font-weight:700;color:var(--gray-500);margin-bottom:10px;padding:0 2px">
        各回の詳細（${cnt}件）
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${cardsHtml}
      </div>`;
  },

  _detailMiniCard(label, value, color) {
    return `<div style="background:var(--gray-50,#f9fafb);border:1px solid var(--gray-200);border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:18px;font-weight:700;color:${color}">${value}</div>
      <div style="font-size:10px;color:var(--gray-500);margin-top:2px">${label}</div>
    </div>`;
  },

  _detailCard(r) {
    const date = r.analyzed_at
      ? new Date(r.analyzed_at).toLocaleDateString('ja-JP', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})
      : '日時不明';

    const actions = Array.isArray(r.actions) ? r.actions : [];
    const actionsHtml = actions.length
      ? actions.map((a,i) => `<div style="padding:6px 0;font-size:12px;border-bottom:1px solid var(--gray-100);display:flex;gap:8px;align-items:flex-start">
            <span style="background:#7c3aed;color:#fff;border-radius:50%;min-width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">${i+1}</span>
            <span>${Utils.escHtml(a)}</span>
          </div>`).join('')
      : '<span style="color:var(--gray-400);font-size:12px">なし</span>';

    return `
      <div style="border:1px solid var(--gray-200);border-radius:10px;padding:14px 16px;background:#fff">
        <!-- ヘッダー -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;flex-wrap:wrap;gap:6px">
          <div style="font-weight:600;font-size:13px">
            <i class="fas fa-user-tie" style="color:#7c3aed;margin-right:4px"></i>
            ${Utils.escHtml(r.applicant_name || '（応募者名なし）')}
          </div>
          <div style="font-size:11px;color:var(--gray-400)">${date}</div>
        </div>

        <!-- 発話比率バー -->
        <div style="margin-bottom:12px">
          <div style="font-size:11px;color:var(--gray-500);font-weight:600;margin-bottom:4px">発話比率</div>
          <div style="display:flex;height:20px;border-radius:4px;overflow:hidden;background:var(--gray-100)">
            <div style="width:${r.sales_ratio||0}%;background:#7c3aed;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;font-weight:700;transition:width .4s;min-width:${r.sales_ratio>5?'30px':'0'}">
              ${(r.sales_ratio||0) > 8 ? (r.sales_ratio||0)+'%' : ''}
            </div>
            <div style="width:${r.applicant_ratio||0}%;background:#059669;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;font-weight:700;transition:width .4s;min-width:${r.applicant_ratio>5?'30px':'0'}">
              ${(r.applicant_ratio||0) > 8 ? (r.applicant_ratio||0)+'%' : ''}
            </div>
          </div>
          <div style="display:flex;gap:16px;margin-top:4px;font-size:11px">
            <span><span style="display:inline-block;width:10px;height:10px;background:#7c3aed;border-radius:2px;margin-right:3px"></span>講師 ${r.sales_ratio||0}%</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:#059669;border-radius:2px;margin-right:3px"></span>応募者 ${r.applicant_ratio||0}%</span>
          </div>
        </div>

        <!-- メトリクスグリッド -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:12px">
          <div style="background:var(--gray-50,#f9fafb);border-radius:6px;padding:8px;text-align:center">
            <div style="font-size:14px;font-weight:700;color:#d97706">${this._secLabel(r.max_monologue_sec)}</div>
            <div style="font-size:10px;color:var(--gray-500)">最長連続発話</div>
          </div>
          <div style="background:var(--gray-50,#f9fafb);border-radius:6px;padding:8px;text-align:center">
            <div style="font-size:14px;font-weight:700;color:${r.mono_3min_count>0?'#dc2626':'#6b7280'}">${r.mono_3min_count||0}回</div>
            <div style="font-size:10px;color:var(--gray-500)">3分超モノローグ</div>
          </div>
          <div style="background:var(--gray-50,#f9fafb);border-radius:6px;padding:8px;text-align:center">
            <div style="font-size:14px;font-weight:700;color:#2563eb">${r.applicant_turn_count||0}回</div>
            <div style="font-size:10px;color:var(--gray-500)">応募者ターン数</div>
          </div>
          <div style="background:var(--gray-50,#f9fafb);border-radius:6px;padding:8px;text-align:center">
            <div style="font-size:14px;font-weight:700;color:${r.emotion_confusion>=50?'#dc2626':r.emotion_confusion>=30?'#d97706':'#6b7280'}">${r.emotion_confusion!=null?r.emotion_confusion+'%':'-'}</div>
            <div style="font-size:10px;color:var(--gray-500)">困惑</div>
          </div>
          <div style="background:var(--gray-50,#f9fafb);border-radius:6px;padding:8px;text-align:center">
            <div style="font-size:14px;font-weight:700;color:${r.emotion_stress>=60?'#dc2626':r.emotion_stress>=40?'#d97706':'#6b7280'}">${r.emotion_stress!=null?r.emotion_stress+'%':'-'}</div>
            <div style="font-size:10px;color:var(--gray-500)">ストレス</div>
          </div>
          <div style="background:var(--gray-50,#f9fafb);border-radius:6px;padding:8px;text-align:center">
            <div style="font-size:14px;font-weight:700;color:${r.emotion_positive>=60?'#16a34a':r.emotion_positive>=40?'#d97706':'#6b7280'}">${r.emotion_positive!=null?r.emotion_positive+'%':'-'}</div>
            <div style="font-size:10px;color:var(--gray-500)">ポジティブ</div>
          </div>
        </div>

        <!-- 改善アドバイス -->
        ${r.advice ? `
        <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:6px;padding:10px 12px;margin-bottom:10px">
          <div style="font-size:11px;font-weight:700;color:#7c3aed;margin-bottom:4px">
            <i class="fas fa-lightbulb" style="margin-right:4px"></i>改善アドバイス
          </div>
          <div style="font-size:12px;color:var(--gray-700);line-height:1.7">${Utils.escHtml(r.advice)}</div>
        </div>` : ''}

        <!-- 具体的アクション -->
        ${actions.length ? `
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--gray-600);margin-bottom:6px">
            <i class="fas fa-tasks" style="margin-right:4px;color:#7c3aed"></i>具体的改善アクション
          </div>
          ${actionsHtml}
        </div>` : ''}
      </div>`;
  },
};
