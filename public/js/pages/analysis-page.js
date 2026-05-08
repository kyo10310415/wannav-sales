// データ分析ページ
const AnalysisPage = {
  result: null,
  loading: false,
  // 分析履歴（セッション内）
  history: [],

  // ────────────────────────────────────────────────────────────
  render() {
    const now   = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    // デフォルト: 今月1日〜今日
    const defaultFrom = `${thisMonth}-01`;
    const defaultTo   = now.toISOString().slice(0, 10);

    return `
      <div class="page-header">
        <div>
          <div class="page-title">
            <i class="fas fa-microscope" style="margin-right:8px;color:#0ea5e9"></i>データ分析
          </div>
          <div class="page-subtitle">営業データをAIが分析 — 結果・解説・ネクストアクションを生成</div>
        </div>
      </div>
      <div class="page-body" style="display:grid;grid-template-columns:360px 1fr;gap:20px;align-items:start">

        <!-- 左カラム: 分析条件 -->
        <div>
          <!-- 分析条件カード -->
          <div class="card" style="margin-bottom:16px">
            <div class="card-header">
              <div class="card-title">
                <i class="fas fa-sliders-h" style="margin-right:6px;color:#0ea5e9"></i>分析条件
              </div>
            </div>
            <div class="card-body" style="padding:18px 20px;display:flex;flex-direction:column;gap:16px">

              <!-- 分析期間 -->
              <div>
                <label style="font-size:12px;font-weight:700;color:var(--gray-600);display:block;margin-bottom:6px">
                  <i class="fas fa-calendar-alt" style="margin-right:4px;color:#0ea5e9"></i>分析期間
                </label>
                <div style="display:flex;align-items:center;gap:8px">
                  <input type="date" id="analysis-date-from" class="form-control" style="flex:1"
                    value="${defaultFrom}">
                  <span style="color:var(--gray-400);font-size:12px;white-space:nowrap">〜</span>
                  <input type="date" id="analysis-date-to" class="form-control" style="flex:1"
                    value="${defaultTo}">
                </div>
                <!-- クイック期間ボタン -->
                <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
                  <button class="btn btn-xs btn-secondary" onclick="AnalysisPage.setQuickPeriod('this_month')">今月</button>
                  <button class="btn btn-xs btn-secondary" onclick="AnalysisPage.setQuickPeriod('last_month')">先月</button>
                  <button class="btn btn-xs btn-secondary" onclick="AnalysisPage.setQuickPeriod('last_3months')">直近3ヶ月</button>
                  <button class="btn btn-xs btn-secondary" onclick="AnalysisPage.setQuickPeriod('last_6months')">直近6ヶ月</button>
                  <button class="btn btn-xs btn-secondary" onclick="AnalysisPage.setQuickPeriod('all')">全期間</button>
                </div>
              </div>

              <!-- 分析内容 -->
              <div>
                <label style="font-size:12px;font-weight:700;color:var(--gray-600);display:block;margin-bottom:6px">
                  <i class="fas fa-question-circle" style="margin-right:4px;color:#0ea5e9"></i>分析したい内容
                </label>
                <textarea id="analysis-question"
                  class="form-control"
                  rows="5"
                  placeholder="例:&#10;・男女でCVRの差はあるか？&#10;・どの担当者のCVRが最も高いか？&#10;・辞退の理由で多いものは何か？&#10;・面接内容の種類によってCVRに差はあるか？&#10;・STAYの回数と契約率の関係は？"
                  style="resize:vertical;font-size:13px;line-height:1.7"></textarea>
                <div style="font-size:11px;color:var(--gray-400);margin-top:4px">
                  自然な日本語で質問してください
                </div>
              </div>

              <!-- 実行ボタン -->
              <button id="analysis-run-btn" class="btn btn-primary"
                style="width:100%;justify-content:center;background:#0ea5e9;border-color:#0ea5e9;font-size:14px;padding:12px"
                onclick="AnalysisPage.run()">
                <i class="fas fa-brain"></i> AIで分析する
              </button>
            </div>
          </div>

          <!-- 分析例カード -->
          <div class="card">
            <div class="card-header">
              <div class="card-title" style="font-size:12px">
                <i class="fas fa-lightbulb" style="margin-right:6px;color:#f59e0b"></i>分析例
              </div>
            </div>
            <div class="card-body" style="padding:12px 16px">
              <div style="display:flex;flex-direction:column;gap:6px">
                ${[
                  '担当者ごとのCVRを比較して、差がある原因を教えて',
                  '辞退者の理由で最も多いものは何か、改善策は？',
                  '面接内容（種類）によってCVRに差はあるか？',
                  'STAYの回数が多いほど契約率は上がっているか？',
                  '入会した理由のTOPは何か、どう活かすべきか？',
                  '今月のデータを総合的に分析して改善点を教えて',
                ].map(ex => `
                  <button class="analysis-example-btn"
                    onclick="AnalysisPage.setExample(this)"
                    style="text-align:left;background:var(--gray-50,#f9fafb);border:1px solid var(--gray-200);border-radius:6px;padding:7px 10px;font-size:11px;color:var(--gray-600);cursor:pointer;transition:all .15s;line-height:1.5">
                    <i class="fas fa-arrow-right" style="color:#0ea5e9;margin-right:5px;font-size:10px"></i>${ex}
                  </button>`).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- 右カラム: 結果エリア -->
        <div id="analysis-result-area">
          <div class="card" style="min-height:400px">
            <div class="card-body" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;text-align:center;color:var(--gray-400)">
              <i class="fas fa-microscope" style="font-size:48px;margin-bottom:16px;opacity:.3"></i>
              <div style="font-size:15px;font-weight:600;margin-bottom:8px">分析条件を入力して</div>
              <div style="font-size:15px;font-weight:600;margin-bottom:16px">「AIで分析する」を押してください</div>
              <div style="font-size:12px;line-height:1.8;max-width:320px">
                期間・分析内容を指定すると、<br>
                営業報告データをもとにAIが<br>
                結果・解説・ネクストアクションを生成します
              </div>
            </div>
          </div>
        </div>

      </div><!-- /page-body grid -->
    `;
  },

  // ────────────────────────────────────────────────────────────
  mount() {
    // Ctrl+Enter で実行
    const ta = document.getElementById('analysis-question');
    if (ta) {
      ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          this.run();
        }
      });
    }
  },

  // ────────────────────────────────────────────────────────────
  setExample(btn) {
    const ta = document.getElementById('analysis-question');
    if (ta) {
      ta.value = btn.textContent.replace(/^[→\s]+/, '').trim();
      ta.focus();
    }
  },

  setQuickPeriod(type) {
    const now   = new Date();
    const pad   = n => String(n).padStart(2, '0');
    let from, to;
    to = now.toISOString().slice(0, 10);

    if (type === 'this_month') {
      from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    } else if (type === 'last_month') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
      to   = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
    } else if (type === 'last_3months') {
      const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
    } else if (type === 'last_6months') {
      const d = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
    } else if (type === 'all') {
      from = '2020-01-01';
      to   = now.toISOString().slice(0, 10);
    }

    const fromEl = document.getElementById('analysis-date-from');
    const toEl   = document.getElementById('analysis-date-to');
    if (fromEl) fromEl.value = from;
    if (toEl)   toEl.value   = to;
  },

  // ────────────────────────────────────────────────────────────
  async run() {
    const question  = document.getElementById('analysis-question')?.value.trim() || '';
    const date_from = document.getElementById('analysis-date-from')?.value || '';
    const date_to   = document.getElementById('analysis-date-to')?.value   || '';

    if (question.length < 3) {
      Utils.notify('分析内容を入力してください', 'error');
      return;
    }

    const btn = document.getElementById('analysis-run-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 分析中…';
    }

    // ローディング表示
    const area = document.getElementById('analysis-result-area');
    if (area) {
      area.innerHTML = `
        <div class="card" style="min-height:400px">
          <div class="card-body" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 20px;text-align:center">
            <div style="position:relative;width:64px;height:64px;margin-bottom:24px">
              <i class="fas fa-brain" style="font-size:40px;color:#0ea5e9;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)"></i>
              <svg style="position:absolute;top:0;left:0;width:64px;height:64px;animation:spin 1.5s linear infinite" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="28" fill="none" stroke="#e0f2fe" stroke-width="4"/>
                <path d="M32 4 A28 28 0 0 1 60 32" fill="none" stroke="#0ea5e9" stroke-width="4" stroke-linecap="round"/>
              </svg>
            </div>
            <div style="font-size:15px;font-weight:700;color:var(--gray-700);margin-bottom:8px">AIが分析しています…</div>
            <div style="font-size:12px;color:var(--gray-400)">データを集計して Gemini に送信中です</div>
          </div>
        </div>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
    }

    try {
      const data = await API.analysis.run({ question, date_from, date_to });
      this.result = data;
      if (data.parseError) {
        this._renderRaw(data.raw, question, date_from, date_to);
      } else {
        this._renderResult(data, question, date_from, date_to);
      }
    } catch (e) {
      if (area) {
        area.innerHTML = `
          <div class="card">
            <div class="card-body" style="padding:40px;text-align:center;color:#dc2626">
              <i class="fas fa-exclamation-circle" style="font-size:36px;margin-bottom:12px;display:block"></i>
              <div style="font-size:14px;font-weight:600">${Utils.escHtml(e.message)}</div>
            </div>
          </div>`;
      }
      Utils.notify('分析エラー: ' + e.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-brain"></i> AIで分析する';
      }
    }
  },

  // ────────────────────────────────────────────────────────────
  _renderResult(data, question, dateFrom, dateTo) {
    const area = document.getElementById('analysis-result-area');
    if (!area) return;

    const meta      = data.meta || {};
    const findings  = data.findings || [];
    const actions   = data.next_actions || [];

    // 期間ラベル
    const periodLabel = (dateFrom && dateTo)
      ? `${dateFrom} 〜 ${dateTo}`
      : (dateFrom || dateTo || '全期間');

    // Findingsカード
    const findingsHtml = findings.map(f => {
      const colors = {
        good:    { bg: '#f0fdf4', border: '#86efac', icon: 'fa-check-circle', iconColor: '#16a34a', labelColor: '#166534' },
        bad:     { bg: '#fef2f2', border: '#fca5a5', icon: 'fa-exclamation-circle', iconColor: '#dc2626', labelColor: '#991b1b' },
        neutral: { bg: '#f0f9ff', border: '#7dd3fc', icon: 'fa-info-circle', iconColor: '#0284c7', labelColor: '#0369a1' },
      };
      const c = colors[f.type] || colors.neutral;
      return `
        <div style="background:${c.bg};border:1px solid ${c.border};border-radius:10px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start">
          <i class="fas ${c.icon}" style="color:${c.iconColor};font-size:18px;margin-top:2px;flex-shrink:0"></i>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:4px">
              <span style="font-size:12px;font-weight:700;color:${c.labelColor}">${Utils.escHtml(f.label || '')}</span>
              ${f.value ? `<span style="font-size:18px;font-weight:800;color:${c.labelColor};line-height:1">${Utils.escHtml(String(f.value))}</span>` : ''}
            </div>
            <div style="font-size:12px;color:var(--gray-600);line-height:1.6">${Utils.escHtml(f.detail || '')}</div>
          </div>
        </div>`;
    }).join('');

    // ネクストアクション
    const actionsHtml = actions.map((a, i) => `
      <div style="display:flex;gap:12px;align-items:flex-start;padding:12px 14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px">
        <span style="background:#0ea5e9;color:#fff;border-radius:50%;min-width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${i + 1}</span>
        <span style="font-size:13px;color:var(--gray-700);line-height:1.6;font-weight:500">${Utils.escHtml(a)}</span>
      </div>`).join('');

    area.innerHTML = `
      <!-- ヘッダー -->
      <div class="card" style="margin-bottom:16px;border-left:4px solid #0ea5e9">
        <div class="card-body" style="padding:16px 20px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
            <div>
              <div style="font-size:16px;font-weight:800;color:var(--gray-800);margin-bottom:4px">
                ${Utils.escHtml(data.title || '分析結果')}
              </div>
              <div style="font-size:12px;color:var(--gray-500)">
                <i class="fas fa-calendar" style="margin-right:4px"></i>${Utils.escHtml(periodLabel)}
                &ensp;|&ensp;
                <i class="fas fa-database" style="margin-right:4px"></i>営業報告 ${meta.total_reports || 0}件
                &ensp;|&ensp;
                <i class="fas fa-file-contract" style="margin-right:4px"></i>契約 ${meta.contract_count || 0}件
                &ensp;|&ensp;
                CVR ${meta.cvr || 0}%
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-sm btn-secondary" style="font-size:11px" onclick="AnalysisPage._copyResult()">
                <i class="fas fa-copy"></i> コピー
              </button>
              <button id="analysis-export-btn" class="btn btn-sm" style="font-size:11px;background:#16a34a;border-color:#16a34a;color:#fff"
                onclick="AnalysisPage.exportSheet()">
                <i class="fas fa-file-export"></i> スプレッドシートに書き出す
              </button>
            </div>
          </div>
          <div style="margin-top:12px;padding:12px 14px;background:var(--gray-50,#f9fafb);border-radius:8px;font-size:13px;color:var(--gray-700);line-height:1.7">
            <i class="fas fa-comment-dots" style="color:#0ea5e9;margin-right:6px"></i>
            <strong>質問:</strong> ${Utils.escHtml(question)}
          </div>
          <!-- 書き出し完了バナー（書き出し後に表示） -->
          <div id="analysis-export-banner" style="display:none"></div>
        </div>
      </div>

      <!-- サマリー -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <div class="card-title">
            <i class="fas fa-chart-pie" style="margin-right:6px;color:#0ea5e9"></i>分析結果サマリー
          </div>
        </div>
        <div class="card-body" style="padding:16px 20px">
          <p style="font-size:14px;color:var(--gray-700);line-height:1.8;margin:0">${Utils.escHtml(data.summary || '')}</p>
        </div>
      </div>

      <!-- 発見事項 -->
      ${findings.length ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <div class="card-title">
            <i class="fas fa-search" style="margin-right:6px;color:#0ea5e9"></i>主な発見事項
          </div>
        </div>
        <div class="card-body" style="padding:16px 20px">
          <div style="display:flex;flex-direction:column;gap:10px">
            ${findingsHtml}
          </div>
        </div>
      </div>` : ''}

      <!-- 詳細解説 -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <div class="card-title">
            <i class="fas fa-file-alt" style="margin-right:6px;color:#0ea5e9"></i>詳細解説
          </div>
        </div>
        <div class="card-body" style="padding:16px 20px">
          <p style="font-size:13px;color:var(--gray-700);line-height:1.9;margin:0;white-space:pre-wrap">${Utils.escHtml(data.explanation || '')}</p>
        </div>
      </div>

      <!-- ネクストアクション -->
      ${actions.length ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <div class="card-title">
            <i class="fas fa-tasks" style="margin-right:6px;color:#0ea5e9"></i>ネクストアクション
          </div>
        </div>
        <div class="card-body" style="padding:16px 20px">
          <div style="display:flex;flex-direction:column;gap:8px">
            ${actionsHtml}
          </div>
        </div>
      </div>` : ''}

      <!-- 注意点 -->
      ${data.caution ? `
      <div class="card" style="border-left:3px solid #f59e0b">
        <div class="card-body" style="padding:12px 16px;display:flex;gap:10px;align-items:flex-start">
          <i class="fas fa-exclamation-triangle" style="color:#f59e0b;margin-top:2px;flex-shrink:0"></i>
          <div style="font-size:12px;color:var(--gray-600);line-height:1.7">
            <strong style="color:#92400e">データの注意点:</strong> ${Utils.escHtml(data.caution)}
          </div>
        </div>
      </div>` : ''}
    `;
  },

  _renderRaw(raw, question, dateFrom, dateTo) {
    const area = document.getElementById('analysis-result-area');
    if (!area) return;
    area.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">AIの応答（JSONパース失敗）</div>
        </div>
        <div class="card-body" style="padding:16px 20px">
          <pre style="font-size:12px;white-space:pre-wrap;line-height:1.6;color:var(--gray-700)">${Utils.escHtml(raw || '')}</pre>
        </div>
      </div>`;
  },

  _copyResult() {
    const d = this.result;
    if (!d) return;
    const text = [
      `【${d.title || '分析結果'}】`,
      '',
      '■ サマリー',
      d.summary || '',
      '',
      ...(d.findings || []).map(f => `◆ ${f.label} ${f.value || ''}\n   ${f.detail || ''}`),
      '',
      '■ 詳細解説',
      d.explanation || '',
      '',
      '■ ネクストアクション',
      ...(d.next_actions || []).map((a, i) => `${i + 1}. ${a}`),
      d.caution ? `\n⚠ 注意: ${d.caution}` : '',
    ].join('\n');

    navigator.clipboard.writeText(text).then(
      () => Utils.notify('分析結果をコピーしました', 'success'),
      () => Utils.notify('コピーに失敗しました', 'error')
    );
  },

  // ────────────────────────────────────────────────────────────
  async exportSheet() {
    if (!this.result) {
      Utils.notify('先に分析を実行してください', 'error');
      return;
    }

    const btn = document.getElementById('analysis-export-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 書き出し中…';
    }

    try {
      const payload = {
        result:  this.result,
        rawData: this.result._rawData || null,
      };
      const resp = await API.analysis.exportSheet(payload);

      // 成功トースト + スプレッドシートへのリンク通知
      Utils.notify('スプレッドシートに書き出しました', 'success');

      // 結果エリアにリンクバナーを表示
      const banner = document.getElementById('analysis-export-banner');
      if (banner) {
        banner.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;
                      background:#f0fdf4;border:1px solid #86efac;border-radius:8px;margin-top:12px">
            <i class="fas fa-check-circle" style="color:#16a34a;font-size:18px;flex-shrink:0"></i>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:700;color:#166534;margin-bottom:2px">
                スプレッドシートに書き出しました
              </div>
              <div style="font-size:11px;color:#15803d">
                「${Utils.escHtml(resp.summarySheet)}」シートに分析結果を追記
                ／「${Utils.escHtml(resp.recordsSheet)}」シートに${resp.recordsWritten}件の使用データを追記
              </div>
            </div>
            <a href="${Utils.escHtml(resp.spreadsheetUrl)}" target="_blank" rel="noopener"
               style="flex-shrink:0;font-size:12px;font-weight:600;color:#0ea5e9;
                      text-decoration:none;display:flex;align-items:center;gap:4px;
                      padding:6px 12px;border:1px solid #0ea5e9;border-radius:6px;
                      background:#fff;white-space:nowrap">
              <i class="fas fa-external-link-alt"></i> シートを開く
            </a>
          </div>`;
        banner.style.display = 'block';
      }

    } catch (e) {
      Utils.notify('書き出しエラー: ' + e.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-file-export"></i> スプレッドシートに書き出す';
      }
    }
  },
};
