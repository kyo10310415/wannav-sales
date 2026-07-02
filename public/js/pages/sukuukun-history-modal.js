// すくう君 過去結果確認モーダル
// SukuukunHistoryModal.open(applicantName, data)
//   data: { applicant_key, evaluations: [...], speeches: [...] }
const SukuukunHistoryModal = {

  open(applicantName, data) {
    this._removeExisting();
    this._render(applicantName, data);
  },

  close() {
    this._removeExisting();
  },

  _removeExisting() {
    const el = document.getElementById('skh-modal-overlay');
    if (el) el.remove();
  },

  _render(applicantName, data) {
    const evaluations = data.evaluations || [];
    const speeches    = data.speeches    || [];

    const overlay = document.createElement('div');
    overlay.id        = 'skh-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;z-index:1200';

    const hasEval   = evaluations.length > 0;
    const hasSpeech = speeches.length > 0;

    const noDataHtml = `
      <div style="text-align:center;padding:40px 20px;color:#9ca3af">
        <div style="font-size:36px;margin-bottom:12px">📭</div>
        <div style="font-size:14px;font-weight:600;color:#6b7280;margin-bottom:6px">まだ記録がありません</div>
        <div style="font-size:12px">すくう君・発話比率分析を実行すると、この画面で過去の結果を確認できます</div>
      </div>`;

    // ── 採点履歴リスト ──
    const evalRows = evaluations.map(e => {
      const score  = e.total_score ?? '-';
      const color  = typeof score === 'number'
        ? (score >= 80 ? '#16a34a' : score >= 60 ? '#2563eb' : score >= 40 ? '#d97706' : '#dc2626')
        : '#9ca3af';
      const date   = e.created_at ? e.created_at.slice(0, 10) : '-';
      const result = e.interview_result
        ? `<span style="font-size:10px;background:${e.interview_result==='契約'?'#dcfce7':e.interview_result==='辞退'?'#fee2e2':'#fef3c7'};color:${e.interview_result==='契約'?'#166534':e.interview_result==='辞退'?'#991b1b':'#92400e'};border-radius:4px;padding:1px 6px;font-weight:600">${Utils.escHtml(e.interview_result)}</span>`
        : '';
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #f3f4f6;transition:background 0.15s"
          onmouseover="this.style.background='#fffbeb'" onmouseout="this.style.background=''">
          <div style="width:44px;height:44px;border-radius:50%;background:${color}18;border:2px solid ${color};display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer"
            onclick="SukuukunHistoryModal._showEvalDetail(${e.id})">
            <span style="font-size:16px;font-weight:800;color:${color}">${score}</span>
          </div>
          <div style="flex:1;min-width:0;cursor:pointer" onclick="SukuukunHistoryModal._showEvalDetail(${e.id})">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span style="font-size:12px;font-weight:600;color:#374151">${Utils.escHtml(e.interviewer_name || '担当者不明')}</span>
              ${result}
            </div>
            <div style="font-size:11px;color:#9ca3af;margin-top:2px">
              <i class="fas fa-calendar" style="margin-right:3px"></i>${date}
              ${e.transcript_length ? `　<i class="fas fa-file-alt" style="margin-right:3px"></i>${e.transcript_length.toLocaleString()}文字` : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
            <div style="color:#d1d5db;font-size:12px;cursor:pointer" onclick="SukuukunHistoryModal._showEvalDetail(${e.id})"><i class="fas fa-chevron-right"></i></div>
            <button onclick="event.stopPropagation();SukuukunHistoryModal._deleteEval(${e.id})"
              title="この採点を削除"
              style="background:none;border:none;cursor:pointer;padding:4px 6px;border-radius:4px;color:#fca5a5;font-size:13px;line-height:1;transition:all 0.15s"
              onmouseover="this.style.color='#dc2626';this.style.background='#fee2e2'"
              onmouseout="this.style.color='#fca5a5';this.style.background='none'">
              <i class="fas fa-trash-alt"></i>
            </button>
          </div>
        </div>`;
    }).join('');

    // ── 発話比率履歴リスト ──
    const speechRows = speeches.map(s => {
      const salesColor = s.sales_ratio > 80 ? '#dc2626' : s.sales_ratio > 65 ? '#d97706' : '#2563eb';
      const date = (s.analyzed_at || s.created_at || '').slice(0, 10);
      const actions = (s.actions || []).slice(0, 1).map(a =>
        `<div style="font-size:10px;color:#6b7280;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">💡 ${Utils.escHtml(a)}</div>`
      ).join('');
      return `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-bottom:1px solid #f3f4f6;transition:background 0.15s"
          onmouseover="this.style.background='#f5f3ff'" onmouseout="this.style.background=''">
          <div style="flex-shrink:0;text-align:center;min-width:48px;cursor:pointer" onclick="SukuukunHistoryModal._showSpeechDetail(${s.id})">
            <div style="font-size:18px;font-weight:800;color:${salesColor}">${s.sales_ratio ?? '-'}%</div>
            <div style="font-size:9px;color:#9ca3af">営業比率</div>
          </div>
          <div style="flex:1;min-width:0;cursor:pointer" onclick="SukuukunHistoryModal._showSpeechDetail(${s.id})">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span style="font-size:12px;font-weight:600;color:#374151">${Utils.escHtml(s.interviewer_name || '担当者不明')}</span>
            </div>
            <div style="font-size:11px;color:#9ca3af;margin-top:1px">
              <i class="fas fa-calendar" style="margin-right:3px"></i>${date}
              ${s.transcript_length ? `　<i class="fas fa-file-alt" style="margin-right:3px"></i>${s.transcript_length.toLocaleString()}文字` : ''}
            </div>
            ${actions}
          </div>
          <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
            <div style="color:#d1d5db;font-size:12px;cursor:pointer" onclick="SukuukunHistoryModal._showSpeechDetail(${s.id})"><i class="fas fa-chevron-right"></i></div>
            <button onclick="event.stopPropagation();SukuukunHistoryModal._deleteSpeech(${s.id})"
              title="この発話分析を削除"
              style="background:none;border:none;cursor:pointer;padding:4px 6px;border-radius:4px;color:#c4b5fd;font-size:13px;line-height:1;transition:all 0.15s"
              onmouseover="this.style.color='#7c3aed';this.style.background='#ede9fe'"
              onmouseout="this.style.color='#c4b5fd';this.style.background='none'">
              <i class="fas fa-trash-alt"></i>
            </button>
          </div>
        </div>`;
    }).join('');

    overlay.innerHTML = `
      <div class="modal" style="max-width:680px;width:95vw">
        <!-- ヘッダー -->
        <div class="modal-header" style="background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);border-bottom:2px solid #4ade80">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:38px;height:38px;border-radius:50%;background:#22c55e;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">📋</div>
            <div>
              <div class="modal-title" style="color:#166534">すくう君 過去結果</div>
              <div style="font-size:12px;color:#15803d;margin-top:2px">
                ${Utils.escHtml(applicantName)}
              </div>
            </div>
          </div>
          <button class="modal-close" id="skh-close" style="color:#166534"><i class="fas fa-times"></i></button>
        </div>

        <div class="modal-body" style="padding:0;max-height:78vh;overflow-y:auto" id="skh-body">
          ${(!hasEval && !hasSpeech)
            ? noDataHtml
            : `
              <!-- タブ -->
              <div style="display:flex;border-bottom:2px solid #e5e7eb;background:#f9fafb">
                <button id="skh-tab-eval"
                  onclick="SukuukunHistoryModal._switchTab('eval')"
                  style="flex:1;padding:10px 8px;background:none;border:none;border-bottom:2px solid #f59e0b;margin-bottom:-2px;font-size:12px;font-weight:700;color:#92400e;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px">
                  🤖 採点履歴
                  <span style="background:#f59e0b;color:white;border-radius:10px;font-size:10px;padding:1px 7px">${evaluations.length}</span>
                </button>
                <button id="skh-tab-speech"
                  onclick="SukuukunHistoryModal._switchTab('speech')"
                  style="flex:1;padding:10px 8px;background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;font-size:12px;font-weight:600;color:#6b7280;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px">
                  <i class="fas fa-wave-square" style="color:#6366f1"></i> 発話比率履歴
                  <span style="background:#6366f1;color:white;border-radius:10px;font-size:10px;padding:1px 7px">${speeches.length}</span>
                </button>
              </div>

              <!-- 採点リスト -->
              <div id="skh-panel-eval">
                ${hasEval ? evalRows : `<div style="padding:30px;text-align:center;color:#9ca3af;font-size:12px">採点履歴はありません</div>`}
              </div>

              <!-- 発話比率リスト -->
              <div id="skh-panel-speech" style="display:none">
                ${hasSpeech ? speechRows : `<div style="padding:30px;text-align:center;color:#9ca3af;font-size:12px">発話比率履歴はありません</div>`}
              </div>
            `
          }
        </div>

        <div class="modal-footer" style="padding:10px 16px;border-top:1px solid #e5e7eb;text-align:right">
          <button class="btn btn-secondary btn-sm" onclick="SukuukunHistoryModal.close()">
            <i class="fas fa-times"></i> 閉じる
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('skh-close').addEventListener('click',  () => this.close());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });

    // 件数ゼロのタブは初期選択を発話比率側に
    if (!hasEval && hasSpeech) this._switchTab('speech');
  },

  _switchTab(tab) {
    const evalBtn    = document.getElementById('skh-tab-eval');
    const speechBtn  = document.getElementById('skh-tab-speech');
    const evalPanel  = document.getElementById('skh-panel-eval');
    const speechPanel= document.getElementById('skh-panel-speech');
    if (!evalBtn) return;

    if (tab === 'eval') {
      evalBtn.style.borderBottomColor = '#f59e0b';
      evalBtn.style.color             = '#92400e';
      evalBtn.style.fontWeight        = '700';
      speechBtn.style.borderBottomColor = 'transparent';
      speechBtn.style.color             = '#6b7280';
      speechBtn.style.fontWeight        = '600';
      if (evalPanel)   evalPanel.style.display   = 'block';
      if (speechPanel) speechPanel.style.display = 'none';
    } else {
      speechBtn.style.borderBottomColor = '#6366f1';
      speechBtn.style.color             = '#4338ca';
      speechBtn.style.fontWeight        = '700';
      evalBtn.style.borderBottomColor   = 'transparent';
      evalBtn.style.color               = '#6b7280';
      evalBtn.style.fontWeight          = '600';
      if (speechPanel) speechPanel.style.display = 'block';
      if (evalPanel)   evalPanel.style.display   = 'none';
    }
  },

  // ── 採点詳細を取得して表示 ──
  async _showEvalDetail(id) {
    const body = document.getElementById('skh-body');
    if (!body) return;

    const backHtml = `<div style="padding:8px 12px;border-bottom:1px solid #e5e7eb">
      <button class="btn btn-secondary btn-xs" onclick="SukuukunHistoryModal._backToList()">
        <i class="fas fa-arrow-left"></i> 一覧に戻る
      </button>
    </div>`;

    body.innerHTML = backHtml + `<div style="padding:24px;text-align:center;color:#9ca3af"><i class="fas fa-spinner fa-spin" style="font-size:20px"></i></div>`;

    try {
      const data = await API.sukuukun.history.get(id);
      const eval_ = data.result_json || {};
      const total = eval_.total_score ?? data.total_score ?? '-';
      const color = typeof total === 'number'
        ? (total >= 80 ? '#16a34a' : total >= 60 ? '#2563eb' : total >= 40 ? '#d97706' : '#dc2626')
        : '#9ca3af';

      const cats = [
        { key:'rapport',        label:'ラポール構築', icon:'fa-handshake' },
        { key:'hearing',        label:'ヒアリング',   icon:'fa-headphones' },
        { key:'value_proposal', label:'価値提案',     icon:'fa-star' },
        { key:'closing',        label:'クロージング', icon:'fa-flag-checkered' },
        { key:'overall_flow',   label:'全体の流れ',   icon:'fa-stream' },
      ];

      const barsHtml = cats.map(c => {
        const s  = eval_.scores?.[c.key] || {};
        const sc = s.score ?? 0;
        const cl = typeof sc === 'number'
          ? (sc >= 16 ? '#16a34a' : sc >= 12 ? '#2563eb' : sc >= 8 ? '#d97706' : '#dc2626')
          : '#9ca3af';
        return `
          <div style="margin-bottom:8px;padding:8px 10px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <div style="font-size:11px;font-weight:600;color:#374151;display:flex;align-items:center;gap:4px">
                <i class="fas ${c.icon}" style="color:${cl};width:13px;text-align:center"></i>${c.label}
              </div>
              <div style="font-size:14px;font-weight:700;color:${cl}">${sc}<span style="font-size:9px;color:#9ca3af;font-weight:400">/20</span></div>
            </div>
            <div style="background:#e5e7eb;border-radius:3px;height:4px;overflow:hidden;margin-bottom:5px">
              <div style="height:100%;width:${Math.round(sc/20*100)}%;background:${cl};border-radius:3px;transition:width 0.6s ease"></div>
            </div>
            ${s.good    ? `<div style="font-size:10px;color:#374151;margin-bottom:2px">👍 ${Utils.escHtml(s.good)}</div>`    : ''}
            ${s.improve ? `<div style="font-size:10px;color:#374151">💡 ${Utils.escHtml(s.improve)}</div>` : ''}
          </div>`;
      }).join('');

      const templateSection = eval_.template_output ? `
        <div style="margin-bottom:12px;border-radius:8px;border:2px solid #f59e0b;overflow:hidden">
          <div style="background:#f59e0b;padding:6px 12px;display:flex;align-items:center;justify-content:space-between">
            <div style="color:white;font-size:11px;font-weight:700">🤖 すくう君レポート</div>
            <button onclick="navigator.clipboard.writeText(this.dataset.text).then(()=>{this.textContent='✅ コピー済み';setTimeout(()=>{this.innerHTML='<i class=\\'fas fa-copy\\'></i> コピー'},2000)})"
              data-text="${Utils.escHtml(eval_.template_output)}"
              style="background:rgba(255,255,255,0.25);border:none;border-radius:4px;color:white;font-size:10px;padding:2px 7px;cursor:pointer">
              <i class="fas fa-copy"></i> コピー
            </button>
          </div>
          <div style="padding:12px 14px;background:#fffbeb;font-size:11px;line-height:1.8;color:#1f2937;white-space:pre-wrap;font-family:inherit">${Utils.escHtml(eval_.template_output)}</div>
        </div>` : '';

      const date   = (data.created_at || '').slice(0, 10);
      const result = data.interview_result || '';
      const resultBadge = result
        ? `<span style="font-size:10px;background:${result==='契約'?'#dcfce7':result==='辞退'?'#fee2e2':'#fef3c7'};color:${result==='契約'?'#166534':result==='辞退'?'#991b1b':'#92400e'};border-radius:4px;padding:1px 6px;font-weight:600">${Utils.escHtml(result)}</span>`
        : '';

      body.innerHTML = backHtml + `
        <div style="padding:14px 16px">
          <div style="text-align:center;padding:12px;background:${color}18;border-radius:8px;border:2px solid ${color};margin-bottom:12px">
            <div style="display:flex;justify-content:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">
              ${data.interviewer_name ? `<span style="font-size:10px;background:#f0fdf4;color:#166534;border-radius:8px;padding:1px 7px;font-weight:600">🎙️ ${Utils.escHtml(data.interviewer_name)}</span>` : ''}
              ${resultBadge}
              <span style="font-size:10px;background:#f3f4f6;color:#6b7280;border-radius:8px;padding:1px 7px"><i class="fas fa-calendar" style="margin-right:3px"></i>${date}</span>
            </div>
            <div style="font-size:42px;font-weight:800;color:${color};line-height:1">${total}</div>
            <div style="font-size:11px;color:#6b7280">/ 100点</div>
          </div>
          <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
            <button onclick="SukuukunHistoryModal._deleteEval(${id})"
              style="background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;color:#dc2626;font-size:11px;padding:4px 10px;cursor:pointer;display:flex;align-items:center;gap:4px;transition:all 0.15s"
              onmouseover="this.style.background='#fecaca';this.style.borderColor='#dc2626'"
              onmouseout="this.style.background='#fee2e2';this.style.borderColor='#fca5a5'">
              <i class="fas fa-trash-alt"></i> この採点を削除
            </button>
          </div>
          ${templateSection}
          ${eval_.summary ? `
            <div style="margin-bottom:10px;padding:10px;background:#eff6ff;border-radius:6px;border-left:3px solid #3b82f6">
              <div style="font-size:10px;font-weight:600;color:#1e40af;margin-bottom:3px"><i class="fas fa-comment-dots"></i> 総合コメント</div>
              <div style="font-size:11px;color:#1f2937;line-height:1.6">${Utils.escHtml(eval_.summary)}</div>
            </div>` : ''}
          <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:6px"><i class="fas fa-list-check" style="color:#f59e0b;margin-right:4px"></i>各項目の採点</div>
          ${barsHtml}
        </div>`;
    } catch (e) {
      body.innerHTML = backHtml + `<div style="padding:24px;text-align:center;color:#dc2626;font-size:12px">詳細の取得に失敗しました: ${Utils.escHtml(e.message)}</div>`;
    }
  },

  // ── 発話比率詳細表示 ──
  _showSpeechDetail(id) {
    // 一覧内のデータをキャッシュとして保持しているため、再APIコールなしで表示
    // ※ speech詳細は一覧データのみで表示（actionsはパース済み）
    // data_idを使って再取得する代わりに既存のデータをグローバルキャッシュから参照
    // ただし簡易実装としてbody内のspeech行を再取得してもよい
    // → ここでは実装を簡潔にするため、通知のみでモーダル表示は一覧で完結とする
    const body = document.getElementById('skh-body');
    if (!body) return;

    // speech panelから該当データを取得
    const clickedEl = body.querySelector(`[onclick="SukuukunHistoryModal._showSpeechDetail(${id})"]`);
    if (!clickedEl) return;

    const backHtml = `<div style="padding:8px 12px;border-bottom:1px solid #e5e7eb">
      <button class="btn btn-secondary btn-xs" onclick="SukuukunHistoryModal._backToList()">
        <i class="fas fa-arrow-left"></i> 一覧に戻る
      </button>
    </div>`;

    // _cachedSpeechesから参照
    const s = (this._cachedSpeeches || []).find(x => x.id === id);
    if (!s) {
      body.innerHTML = backHtml + `<div style="padding:20px;text-align:center;color:#9ca3af;font-size:12px">データが見つかりません</div>`;
      return;
    }

    const salesColor = s.sales_ratio > 80 ? '#dc2626' : s.sales_ratio > 65 ? '#d97706' : '#2563eb';
    const fmtSec  = sec => sec >= 60 ? `${Math.floor(sec/60)}分${sec%60}秒` : `${sec}秒`;
    const emoColor = v => v >= 70 ? '#dc2626' : v >= 40 ? '#d97706' : '#16a34a';
    const posColor = v => v >= 60 ? '#16a34a' : v >= 30 ? '#d97706' : '#dc2626';
    const date   = (s.analyzed_at || s.created_at || '').slice(0, 10);

    const actionsHtml = (s.actions || []).map((a, i) => `
      <div style="display:flex;align-items:flex-start;gap:6px;padding:6px 8px;background:#f0fdf4;border-radius:5px;border-left:3px solid #16a34a;margin-bottom:5px">
        <span style="background:#16a34a;color:white;font-size:9px;font-weight:700;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</span>
        <span style="font-size:11px;color:#1f2937;line-height:1.5">${Utils.escHtml(a)}</span>
      </div>`).join('');

    body.innerHTML = backHtml + `
      <div style="padding:14px 16px">
        <!-- 削除ボタン -->
        <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
          <button onclick="SukuukunHistoryModal._deleteSpeech(${id})"
            style="background:#ede9fe;border:1px solid #c4b5fd;border-radius:6px;color:#7c3aed;font-size:11px;padding:4px 10px;cursor:pointer;display:flex;align-items:center;gap:4px;transition:all 0.15s"
            onmouseover="this.style.background='#ddd6fe';this.style.borderColor='#7c3aed'"
            onmouseout="this.style.background='#ede9fe';this.style.borderColor='#c4b5fd'">
            <i class="fas fa-trash-alt"></i> この分析を削除
          </button>
        </div>
        <!-- メタ -->
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;font-size:10px">
          ${s.interviewer_name ? `<span style="background:#eff6ff;color:#1e40af;border-radius:8px;padding:2px 8px;font-weight:600">🎙️ ${Utils.escHtml(s.interviewer_name)}</span>` : ''}
          <span style="background:#f3f4f6;color:#6b7280;border-radius:8px;padding:2px 8px"><i class="fas fa-calendar" style="margin-right:3px"></i>${date}</span>
        </div>

        <!-- 発話比率バー -->
        <div style="margin-bottom:12px;padding:12px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
          <div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:8px"><i class="fas fa-comments" style="color:#6366f1;margin-right:4px"></i>発話比率</div>
          <div style="margin-bottom:4px">
            <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:600;margin-bottom:2px">
              <span style="color:${salesColor}">営業 ${s.sales_ratio ?? 0}%</span>
              <span style="color:#6b7280">応募者 ${s.applicant_ratio ?? 0}%</span>
            </div>
            <div style="display:flex;height:14px;border-radius:6px;overflow:hidden;gap:2px">
              <div style="width:${s.sales_ratio ?? 0}%;background:${salesColor};border-radius:6px 0 0 6px;transition:width 0.6s ease"></div>
              <div style="flex:1;background:#94a3b8;border-radius:0 6px 6px 0"></div>
            </div>
          </div>
        </div>

        <!-- 詳細指標 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
          ${s.max_monologue_sec != null ? `<div style="padding:8px 10px;background:#fef3c7;border-radius:6px"><div style="font-size:9px;color:#92400e;font-weight:600">最長独演</div><div style="font-size:14px;font-weight:700;color:#92400e">${fmtSec(s.max_monologue_sec)}</div></div>` : ''}
          ${s.applicant_turn_count != null ? `<div style="padding:8px 10px;background:#f0fdf4;border-radius:6px"><div style="font-size:9px;color:#166534;font-weight:600">応募者発話回数</div><div style="font-size:14px;font-weight:700;color:#166534">${s.applicant_turn_count}回</div></div>` : ''}
          ${s.emotion_confusion != null ? `<div style="padding:8px 10px;background:#fff1f2;border-radius:6px"><div style="font-size:9px;color:#be123c;font-weight:600">困惑</div><div style="font-size:14px;font-weight:700;color:${emoColor(s.emotion_confusion)}">${s.emotion_confusion}%</div></div>` : ''}
          ${s.emotion_positive != null ? `<div style="padding:8px 10px;background:#f0fdf4;border-radius:6px"><div style="font-size:9px;color:#166534;font-weight:600">ポジティブ</div><div style="font-size:14px;font-weight:700;color:${posColor(s.emotion_positive)}">${s.emotion_positive}%</div></div>` : ''}
        </div>

        <!-- アドバイス -->
        ${s.advice ? `
          <div style="margin-bottom:10px;padding:10px;background:#eff6ff;border-radius:6px;border-left:3px solid #6366f1">
            <div style="font-size:10px;font-weight:600;color:#4338ca;margin-bottom:4px"><i class="fas fa-lightbulb"></i> AI アドバイス</div>
            <div style="font-size:11px;color:#1f2937;line-height:1.6">${Utils.escHtml(s.advice)}</div>
          </div>` : ''}

        <!-- 改善アクション -->
        ${actionsHtml ? `
          <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:6px"><i class="fas fa-tasks" style="color:#16a34a;margin-right:4px"></i>改善アクション</div>
          ${actionsHtml}` : ''}
      </div>`;
  },

  // ── 採点履歴削除 ──
  async _deleteEval(id) {
    if (!confirm('この採点履歴を削除しますか？\nこの操作は取り消せません。')) return;
    try {
      await API.history.deleteEval(id);
      // キャッシュから削除
      this._cachedEvals = (this._cachedEvals || []).filter(e => e.id !== id);
      if (this._lastOpenArgs) {
        const [name, data] = this._lastOpenArgs;
        const newData = { ...data, evaluations: this._cachedEvals, speeches: this._cachedSpeeches || [] };
        this._lastOpenArgs = [name, newData];
        this.close();
        this.open(name, newData);
      } else {
        this.close();
      }
      Utils.notify('採点履歴を削除しました', 'success');
    } catch (e) {
      Utils.notify('削除に失敗しました: ' + e.message, 'error');
    }
  },

  // ── 発話分析削除 ──
  async _deleteSpeech(id) {
    if (!confirm('この発話比率分析を削除しますか？\nこの操作は取り消せません。')) return;
    try {
      await API.history.deleteSpeech(id);
      // キャッシュから削除
      this._cachedSpeeches = (this._cachedSpeeches || []).filter(s => s.id !== id);
      if (this._lastOpenArgs) {
        const [name, data] = this._lastOpenArgs;
        const newData = { ...data, evaluations: this._cachedEvals || [], speeches: this._cachedSpeeches };
        this._lastOpenArgs = [name, newData];
        this.close();
        this.open(name, newData);
      } else {
        this.close();
      }
      Utils.notify('発話比率分析を削除しました', 'success');
    } catch (e) {
      Utils.notify('削除に失敗しました: ' + e.message, 'error');
    }
  },

  // ── 一覧に戻る（再レンダリングせず、保存済みのデータで戻す） ──
  _backToList() {
    if (this._lastOpenArgs) {
      const [name, data] = this._lastOpenArgs;
      this.close();
      this.open(name, data);
    } else {
      this.close();
    }
  },
};

// open() のオーバーライドでデータをキャッシュ
const _skhOrigOpen = SukuukunHistoryModal.open.bind(SukuukunHistoryModal);
SukuukunHistoryModal.open = function(applicantName, data) {
  this._lastOpenArgs     = [applicantName, data];
  this._cachedSpeeches   = (data.speeches || []);
  this._cachedEvals      = (data.evaluations || []);
  _skhOrigOpen(applicantName, data);
};
