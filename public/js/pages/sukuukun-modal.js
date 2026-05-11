// すくう君モーダル — 営業トーク文字起こし採点・評価（新版機能ベース）
// open(opts) opts: { applicantName?, interviewResult? }
// ※ SukuukunPage と同等の機能を持つモーダル形式の実装
const SukuukunModal = {
  _opts: {},
  _users: [],   // ユーザー一覧キャッシュ
  _sources: [], // ソースキャッシュ

  // opts: { applicantName?: string, interviewResult?: string }
  async open(opts = {}) {
    // applicantオブジェクトが直接渡された場合（applicants.jsの旧呼び出し互換）
    if (opts && typeof opts === 'object' && opts.full_name !== undefined) {
      const report = typeof ApplicantsPage !== 'undefined'
        ? ApplicantsPage.getReportForApplicant?.(opts) || null
        : null;
      opts = {
        applicantName:  opts.full_name || '',
        interviewResult: report?.result || '',
      };
    }
    this._opts = opts || {};
    this._removeExisting();

    // ユーザー一覧を取得（キャッシュ済みなら再取得しない）
    if (!this._users.length) {
      try { this._users = await API.users.list(); } catch (e) { this._users = []; }
    }

    this._render();
  },

  close() {
    this._removeExisting();
  },

  _removeExisting() {
    const el = document.getElementById('sukuukun-modal-overlay');
    if (el) el.remove();
  },

  // ══════════════════════════════════════════════════════════════
  // レンダリング
  // ══════════════════════════════════════════════════════════════
  _render() {
    const opts           = this._opts;
    const applicantName  = opts.applicantName  || '';
    const interviewResult = opts.interviewResult || '';

    const userOptions = this._users.map(u =>
      `<option value="${u.id}" data-name="${Utils.escHtml(u.name)}">${Utils.escHtml(u.name)}</option>`
    ).join('');

    const currentUser   = typeof Auth !== 'undefined' ? Auth.user : null;
    const currentUserId = currentUser?.id || '';

    const overlay = document.createElement('div');
    overlay.id        = 'sukuukun-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;z-index:1100';

    overlay.innerHTML = `
      <div class="modal" style="max-width:920px;width:95vw">
        <!-- ヘッダー -->
        <div class="modal-header" style="background:linear-gradient(135deg,#fef3c7 0%,#fffbeb 100%);border-bottom:2px solid #f59e0b">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:38px;height:38px;border-radius:50%;background:#f59e0b;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🤖</div>
            <div>
              <div class="modal-title" style="color:#92400e">すくう君 — 営業トーク採点</div>
              <div style="font-size:12px;color:#a16207;margin-top:2px">
                ${applicantName ? `対象：${Utils.escHtml(applicantName)}　|　` : ''}Gemini AI による採点・フィードバック
              </div>
            </div>
          </div>
          <button class="modal-close" id="skm-close" style="color:#92400e"><i class="fas fa-times"></i></button>
        </div>

        <div class="modal-body" style="padding:0;max-height:82vh;overflow-y:auto">

          <!-- ① 入力エリア -->
          <div id="skm-input-area" style="padding:16px 20px">

            <!-- 3列：応募者・担当者・結果 -->
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px">
              <div>
                <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:4px">
                  <i class="fas fa-user" style="color:#f59e0b;margin-right:4px"></i>応募者氏名
                </label>
                <input type="text" id="skm-applicant-name" class="form-control"
                  style="font-size:13px" placeholder="例: 山田 太郎"
                  value="${Utils.escHtml(applicantName)}">
              </div>
              <div>
                <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:4px">
                  <i class="fas fa-user-tie" style="color:#2563eb;margin-right:4px"></i>面接担当者
                </label>
                <select id="skm-interviewer" class="form-control" style="font-size:13px">
                  <option value="">-- 担当者を選択 --</option>
                  ${userOptions}
                </select>
              </div>
              <div>
                <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:4px">
                  <i class="fas fa-clipboard-check" style="color:#059669;margin-right:4px"></i>面接結果
                </label>
                <select id="skm-interview-result" class="form-control" style="font-size:13px">
                  <option value="">-- 結果を選択 --</option>
                  <option value="契約"    ${interviewResult==='契約'    ? 'selected':''}>契約</option>
                  <option value="辞退"    ${interviewResult==='辞退'    ? 'selected':''}>辞退</option>
                  <option value="持ち帰り" ${interviewResult==='持ち帰り' ? 'selected':''}>持ち帰り</option>
                </select>
              </div>
            </div>

            <!-- 文字起こし入力 -->
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <label style="font-size:12px;font-weight:600;color:#374151">
                  <i class="fas fa-file-alt" style="color:#f59e0b;margin-right:5px"></i>
                  面接（セールス）の文字起こし <span style="color:#dc2626">*</span>
                </label>
                <span id="skm-char-count" style="font-size:11px;color:#9ca3af">0 文字</span>
              </div>
              <div style="font-size:11px;color:#6b7280;margin-bottom:6px">
                ※ NotebookLM や音声認識ツールで書き起こしたテキストをそのまま貼り付けてください。約2時間分の長文にも対応。
              </div>
              <textarea id="skm-transcript" rows="13" class="form-control"
                placeholder="例：
営業: こんにちは、WannaVの○○と申します。
応募者: よろしくお願いします。
営業: 本日はお時間いただきありがとうございます...
（文字起こし全文をここに貼り付けてください）"
                style="font-size:12px;line-height:1.6;resize:vertical;min-height:220px"></textarea>
            </div>

            <!-- ソースバッジ -->
            <div id="skm-source-badge" style="margin-top:8px;font-size:11px;color:#6b7280;display:flex;align-items:center;gap:5px">
              <i class="fas fa-circle-notch fa-spin"></i> ソース読み込み中...
            </div>

            <!-- ボタン行 -->
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
              <button class="btn btn-secondary btn-sm" id="skm-cancel">キャンセル</button>
              <button id="skm-speech-btn"
                style="padding:8px 16px;background:#6366f1;border:none;border-radius:8px;color:white;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px">
                <i class="fas fa-wave-square"></i> 発話比率分析
              </button>
              <button id="skm-submit"
                style="padding:8px 20px;background:#f59e0b;border:none;border-radius:8px;color:white;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px">
                <i class="fas fa-robot"></i> すくう君に採点してもらう
              </button>
            </div>
          </div>

          <!-- ② ローディング -->
          <div id="skm-loading" style="display:none;padding:48px 20px;text-align:center">
            <div style="font-size:40px;margin-bottom:14px;animation:skm-spin 2s linear infinite;display:inline-block">⚙️</div>
            <div style="font-size:15px;font-weight:600;color:#374151;margin-bottom:6px" id="skm-loading-msg">すくう君が採点中です…</div>
            <div style="font-size:12px;color:#6b7280">Gemini AI が文字起こしを分析しています。しばらくお待ちください。</div>
          </div>

          <!-- ③ 結果エリア（採点 / 発話比率を同じ場所に表示） -->
          <div id="skm-result" style="display:none;padding:16px 20px"></div>

        </div>
      </div>

      <style>
        @keyframes skm-spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        .skm-sbar { transition: width 0.6s ease; }
      </style>
    `;

    document.body.appendChild(overlay);

    // ---- イベント ----
    document.getElementById('skm-close').addEventListener('click',  () => this.close());
    document.getElementById('skm-cancel').addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });

    // 文字数カウント
    const ta = document.getElementById('skm-transcript');
    const cc = document.getElementById('skm-char-count');
    ta.addEventListener('input', () => {
      const len = ta.value.length;
      cc.textContent = `${len.toLocaleString()} 文字`;
      cc.style.color = len >= 50 ? '#059669' : '#9ca3af';
    });

    // ログイン中ユーザーをデフォルト選択
    if (currentUserId) {
      const sel = document.getElementById('skm-interviewer');
      if (sel) sel.value = String(currentUserId);
    }

    // ソース件数バッジを非同期で更新
    this._loadSourceBadge();

    document.getElementById('skm-submit').addEventListener('click',      () => this._submitEvaluate());
    document.getElementById('skm-speech-btn').addEventListener('click',  () => this._submitSpeech());
  },

  // ══════════════════════════════════════════════════════════════
  // ソースバッジ
  // ══════════════════════════════════════════════════════════════
  async _loadSourceBadge() {
    const badge = document.getElementById('skm-source-badge');
    if (!badge) return;
    try {
      this._sources = await API.sukuukun.sources.list();
      if (this._sources.length === 0) {
        badge.innerHTML = `<i class="fas fa-exclamation-circle" style="color:#d97706"></i>
          <span style="color:#d97706">ソース未登録。「すくう君」ページのソース管理からスクリプトを追加すると採点精度が上がります。</span>`;
      } else {
        const hasTpl = this._sources.some(s => this._isTemplateSource(s));
        const refCount = this._sources.filter(s => !this._isTemplateSource(s)).length;
        const tplPart = hasTpl
          ? `<span style="background:#ede9fe;color:#7c3aed;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:700">📋 テンプレートあり</span>`
          : `<span style="background:#fef3c7;color:#92400e;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:700">⚠️ テンプレート未登録</span>`;
        const refPart = refCount > 0
          ? `<span style="color:#059669"><i class="fas fa-check-circle"></i> 参照ソース ${refCount}件</span>`
          : '';
        badge.innerHTML = `<span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${tplPart}${refPart}</span>`;
      }
    } catch (e) {
      badge.innerHTML = `<i class="fas fa-exclamation-circle" style="color:#9ca3af"></i>
        <span style="color:#9ca3af">ソース情報の取得に失敗しました</span>`;
    }
  },

  _isTemplateSource(s) {
    return s.title.includes('【出力テンプレート】') ||
      (s.content || '').trimStart().startsWith('【出力テンプレート】');
  },

  // ══════════════════════════════════════════════════════════════
  // 共通: 入力値取得
  // ══════════════════════════════════════════════════════════════
  _getInputValues() {
    const transcript     = (document.getElementById('skm-transcript')?.value || '').trim();
    const applicantName  = (document.getElementById('skm-applicant-name')?.value || '').trim();
    const interviewerSel = document.getElementById('skm-interviewer');
    const interviewerId  = interviewerSel?.value ? Number(interviewerSel.value) : null;
    const interviewerName = interviewerId
      ? (interviewerSel.options[interviewerSel.selectedIndex]?.dataset?.name || '')
      : '';
    const interviewResult = document.getElementById('skm-interview-result')?.value || '';
    return { transcript, applicantName, interviewerId, interviewerName, interviewResult };
  },

  // ── ローディング表示 / 非表示 ──
  _showLoading(msg = 'すくう君が採点中です…') {
    document.getElementById('skm-input-area').style.display = 'none';
    document.getElementById('skm-loading').style.display    = 'block';
    document.getElementById('skm-result').style.display     = 'none';
    const msgEl = document.getElementById('skm-loading-msg');
    if (msgEl) msgEl.textContent = msg;
  },

  _showResult() {
    document.getElementById('skm-loading').style.display = 'none';
    document.getElementById('skm-result').style.display  = 'block';
  },

  _backToInput() {
    document.getElementById('skm-result').style.display     = 'none';
    document.getElementById('skm-loading').style.display    = 'none';
    document.getElementById('skm-input-area').style.display = 'block';
  },

  _retryBtn() {
    return `<div style="text-align:center;margin-top:16px">
      <button class="btn btn-secondary btn-sm" onclick="SukuukunModal._backToInput()">
        <i class="fas fa-arrow-left"></i> 入力に戻る
      </button>
    </div>`;
  },

  // ══════════════════════════════════════════════════════════════
  // 採点（評価）
  // ══════════════════════════════════════════════════════════════
  async _submitEvaluate() {
    const { transcript, applicantName, interviewerId, interviewerName, interviewResult } = this._getInputValues();
    if (transcript.length < 50) {
      Utils.notify('文字起こしテキストが短すぎます（50文字以上必要）', 'error');
      return;
    }

    this._showLoading('すくう君が採点中です…');

    try {
      const data = await API.sukuukun.evaluate({
        transcript,
        applicantName:   applicantName   || undefined,
        interviewerId:   interviewerId   || undefined,
        interviewerName: interviewerName || undefined,
        interviewResult: interviewResult || undefined,
      });

      this._showResult();

      if (data.parseError) {
        document.getElementById('skm-result').innerHTML = `
          <div class="alert alert-error" style="margin-bottom:12px">
            <i class="fas fa-exclamation-triangle"></i>
            <span>JSON解析に失敗しました。生のレスポンスを表示します。</span>
          </div>
          <pre style="font-size:12px;background:#f9fafb;padding:12px;border-radius:8px;white-space:pre-wrap;overflow-x:auto">${Utils.escHtml(data.raw||'')}</pre>
          ${this._retryBtn()}`;
        return;
      }

      this._renderEvalResult(data, transcript.length, applicantName, interviewerName, interviewResult);

    } catch (err) {
      document.getElementById('skm-loading').style.display    = 'none';
      document.getElementById('skm-input-area').style.display = 'block';
      Utils.notify('採点エラー: ' + err.message, 'error');
    }
  },

  _scoreColor(s, max) {
    const p = s / max;
    if (p >= 0.8) return '#16a34a';
    if (p >= 0.6) return '#2563eb';
    if (p >= 0.4) return '#d97706';
    return '#dc2626';
  },

  _renderEvalResult(data, txLen, applicantName, interviewerName, interviewResult) {
    const resultEl = document.getElementById('skm-result');
    if (!resultEl) return;

    const total = data.total_score ?? 0;
    const color = this._scoreColor(total, 100);

    const cats = [
      { key:'rapport',        label:'ラポール構築', icon:'fa-handshake' },
      { key:'hearing',        label:'ヒアリング',   icon:'fa-headphones' },
      { key:'value_proposal', label:'価値提案',     icon:'fa-star' },
      { key:'closing',        label:'クロージング', icon:'fa-flag-checkered' },
      { key:'overall_flow',   label:'全体の流れ',   icon:'fa-stream' },
    ];

    const barsHtml = cats.map(c => {
      const s  = data.scores?.[c.key] || {};
      const sc = s.score ?? 0;
      const cl = this._scoreColor(sc, 20);
      return `
        <div style="margin-bottom:10px;padding:10px 12px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <div style="font-size:12px;font-weight:600;color:#1f2937;display:flex;align-items:center;gap:5px">
              <i class="fas ${c.icon}" style="color:${cl};width:14px;text-align:center"></i>${c.label}
            </div>
            <div style="font-size:16px;font-weight:700;color:${cl}">${sc}<span style="font-size:10px;color:#9ca3af;font-weight:400">/20</span></div>
          </div>
          <div style="background:#e5e7eb;border-radius:3px;height:5px;overflow:hidden;margin-bottom:7px">
            <div class="skm-sbar" style="height:100%;width:${Math.round(sc/20*100)}%;background:${cl};border-radius:3px"></div>
          </div>
          ${s.good    ? `<div style="font-size:11px;color:#374151;margin-bottom:3px;display:flex;gap:4px"><span style="color:#059669;font-weight:600;flex-shrink:0">👍</span><span>${Utils.escHtml(s.good)}</span></div>` : ''}
          ${s.improve ? `<div style="font-size:11px;color:#374151;display:flex;gap:4px"><span style="color:#d97706;font-weight:600;flex-shrink:0">💡</span><span>${Utils.escHtml(s.improve)}</span></div>` : ''}
        </div>`;
    }).join('');

    const hlHtml = (data.highlights || []).length
      ? (data.highlights.map(h =>
          `<div style="font-size:11px;padding:6px 10px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:0 5px 5px 0;margin-bottom:5px;line-height:1.55">${Utils.escHtml(h)}</div>`
        ).join(''))
      : '';

    // メタバッジ
    const metaBadges = [
      applicantName   && `<span style="background:#eff6ff;color:#1e40af;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">👤 ${Utils.escHtml(applicantName)}</span>`,
      interviewerName && `<span style="background:#f0fdf4;color:#166534;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">🎙️ ${Utils.escHtml(interviewerName)}</span>`,
      interviewResult && `<span style="background:${interviewResult==='契約'?'#dcfce7':interviewResult==='辞退'?'#fee2e2':'#fef3c7'};color:${interviewResult==='契約'?'#166534':interviewResult==='辞退'?'#991b1b':'#92400e'};font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">📋 ${Utils.escHtml(interviewResult)}</span>`,
    ].filter(Boolean).join(' ');

    // テンプレート出力セクション（新版機能）
    const templateSection = data.template_output ? `
      <div style="margin-bottom:14px;border-radius:10px;border:2px solid #f59e0b;overflow:hidden">
        <div style="background:#f59e0b;padding:8px 14px;display:flex;align-items:center;justify-content:space-between">
          <div style="color:white;font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px">
            <i class="fas fa-robot"></i> すくう君レポート
          </div>
          <button onclick="SukuukunModal._copyTemplateOutput(this)"
            data-text="${Utils.escHtml(data.template_output)}"
            style="background:rgba(255,255,255,0.25);border:none;border-radius:5px;color:white;font-size:10px;padding:3px 8px;cursor:pointer;font-weight:600">
            <i class="fas fa-copy"></i> コピー
          </button>
        </div>
        <div style="padding:14px 16px;background:#fffbeb;font-size:12px;line-height:1.85;color:#1f2937;white-space:pre-wrap;font-family:inherit">${Utils.escHtml(data.template_output)}</div>
      </div>` : '';

    // 採点詳細（template_outputあり → アコーディオン、なし → 直接展開）
    const detailsInner = `
      ${data.summary ? `
      <div style="margin-bottom:12px;padding:10px 12px;background:#eff6ff;border-radius:8px;border-left:3px solid #3b82f6">
        <div style="font-size:11px;font-weight:600;color:#1e40af;margin-bottom:4px"><i class="fas fa-comment-dots"></i> 総合コメント</div>
        <div style="font-size:12px;color:#1f2937;line-height:1.65">${Utils.escHtml(data.summary)}</div>
      </div>` : ''}
      <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:6px"><i class="fas fa-list-check" style="color:#f59e0b;margin-right:4px"></i>各項目の採点</div>
      ${barsHtml}
      ${hlHtml ? `<div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;margin-top:4px"><i class="fas fa-bookmark" style="color:#f59e0b;margin-right:4px"></i>注目の発言</div>${hlHtml}` : ''}`;

    const detailsSection = data.template_output ? `
      <div style="margin-bottom:12px;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden">
        <button onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('.skm-acc-arrow').style.transform=this.nextElementSibling.style.display==='none'?'rotate(0deg)':'rotate(180deg)';"
          style="width:100%;background:#f3f4f6;border:none;padding:9px 14px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;font-size:12px;font-weight:600;color:#374151">
          <span><i class="fas fa-list-check" style="color:#f59e0b;margin-right:5px"></i>採点詳細・注目発言を見る</span>
          <i class="fas fa-chevron-down skm-acc-arrow" style="font-size:10px;color:#9ca3af;transition:transform 0.2s"></i>
        </button>
        <div style="display:none;padding:12px">${detailsInner}</div>
      </div>` : detailsInner;

    resultEl.innerHTML = `
      <!-- 総合スコア -->
      <div style="text-align:center;padding:16px;background:${color}18;border-radius:10px;border:2px solid ${color};margin-bottom:14px">
        ${metaBadges ? `<div style="margin-bottom:8px;display:flex;justify-content:center;gap:6px;flex-wrap:wrap">${metaBadges}</div>` : ''}
        <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:2px">総合スコア</div>
        <div style="font-size:52px;font-weight:800;color:${color};line-height:1">${total}</div>
        <div style="font-size:12px;color:#6b7280">/ 100点</div>
        <div style="font-size:10px;color:#9ca3af;margin-top:4px">参照ソース: ${data.sourceCount||0}件 ・ 文字数: ${txLen.toLocaleString()} 文字 ・ ${new Date().toLocaleString('ja-JP')}</div>
      </div>

      ${templateSection}
      ${detailsSection}

      <!-- ボタン -->
      <div style="display:flex;justify-content:center;gap:10px;margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb">
        <button class="btn btn-secondary btn-sm" onclick="SukuukunModal._backToInput()">
          <i class="fas fa-arrow-left"></i> 別の文字起こしを採点
        </button>
        <button class="btn btn-sm" onclick="SukuukunModal.close()"
          style="background:#6b7280;border-color:#6b7280;color:white">
          <i class="fas fa-times"></i> 閉じる
        </button>
      </div>`;

    // スコアバーアニメーション
    setTimeout(() => {
      resultEl.querySelectorAll('.skm-sbar').forEach(b => {
        const w = b.style.width; b.style.width = '0';
        setTimeout(() => { b.style.width = w; }, 60);
      });
    }, 80);
  },

  // テンプレート出力コピー
  _copyTemplateOutput(btn) {
    const text = btn?.dataset?.text || '';
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-check"></i> コピー済み';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }).catch(() => {
      Utils.notify('コピーに失敗しました', 'error');
    });
  },

  // ══════════════════════════════════════════════════════════════
  // 発話比率分析（SukuukunPage と同等ロジック）
  // ══════════════════════════════════════════════════════════════
  async _submitSpeech() {
    const { transcript, interviewerId, interviewerName, applicantName } = this._getInputValues();
    if (transcript.length < 50) {
      Utils.notify('文字起こしテキストが短すぎます（50文字以上）', 'error');
      return;
    }

    this._showLoading('発話を分析中です…');
    document.getElementById('skm-loading-msg').textContent = '発話を分析中です…';

    try {
      const metrics    = this._calcMetrics(transcript);
      const analyzedAt = new Date().toISOString();

      const result = await API.sukuukun.analyzeSpeech({
        transcript,
        metrics,
        interviewer_id:   interviewerId   || undefined,
        interviewer_name: interviewerName || undefined,
        applicant_name:   applicantName   || undefined,
        analyzed_at:      analyzedAt,
      });

      this._showResult();
      this._renderSpeechResult(metrics, result);

    } catch (e) {
      document.getElementById('skm-loading').style.display    = 'none';
      document.getElementById('skm-input-area').style.display = 'block';
      Utils.notify('分析エラー: ' + e.message, 'error');
    }
  },

  // ── テキストから話者ターンを抽出（SukuukunPage._parseTurns と同一） ──
  _parseTurns(transcript) {
    const lines     = transcript.split('\n');
    const speakerRe = /^([^\n：:]{1,40})[：:]\s*(.*)/;

    const rawTurns = [];
    let curLabel = null;
    let curText  = [];

    for (const line of lines) {
      const m = speakerRe.exec(line.trim());
      if (m) {
        if (curLabel !== null) rawTurns.push({ rawLabel: curLabel, text: curText.join(' ').trim() });
        curLabel = m[1].trim();
        curText  = [m[2]];
      } else if (curLabel !== null && line.trim()) {
        curText.push(line.trim());
      }
    }
    if (curLabel !== null) rawTurns.push({ rawLabel: curLabel, text: curText.join(' ').trim() });
    if (rawTurns.length === 0) return [];

    const SALES_KEYWORDS     = /営業|講師|スタッフ|担当|インタビュアー|面接官|MC|司会/i;
    const APPLICANT_KEYWORDS = /応募者|生徒|お客様|候補者|受講者|クライアント|応募|面接者/i;
    const roleMap = {};

    for (const t of rawTurns) {
      const lbl = t.rawLabel;
      if (roleMap[lbl]) continue;
      if (SALES_KEYWORDS.test(lbl))          roleMap[lbl] = 'sales';
      else if (APPLICANT_KEYWORDS.test(lbl)) roleMap[lbl] = 'applicant';
    }

    const unknownLabels = [...new Set(rawTurns.map(t => t.rawLabel).filter(l => !roleMap[l]))];
    if (unknownLabels.length > 0) {
      const charCount = {};
      for (const t of rawTurns) {
        if (!unknownLabels.includes(t.rawLabel)) continue;
        charCount[t.rawLabel] = (charCount[t.rawLabel] || 0) + t.text.replace(/\s+/g, '').length;
      }
      const hasSales     = Object.values(roleMap).includes('sales');
      const hasApplicant = Object.values(roleMap).includes('applicant');

      if (hasSales && !hasApplicant) {
        for (const lbl of unknownLabels) roleMap[lbl] = 'applicant';
      } else if (!hasSales && hasApplicant) {
        for (const lbl of unknownLabels) roleMap[lbl] = 'sales';
      } else if (!hasSales && !hasApplicant) {
        const sorted = Object.entries(charCount).sort((a, b) => b[1] - a[1]);
        if (sorted.length === 1) {
          roleMap[sorted[0][0]] = 'sales';
        } else if (sorted.length >= 2) {
          roleMap[sorted[0][0]] = 'sales';
          for (let i = 1; i < sorted.length; i++) roleMap[sorted[i][0]] = 'applicant';
        }
      } else {
        for (const lbl of unknownLabels) roleMap[lbl] = 'applicant';
      }
    }

    return rawTurns.map(t => ({
      speaker:  roleMap[t.rawLabel] || 'other',
      rawLabel: t.rawLabel,
      text:     t.text,
    }));
  },

  // ── メトリクス算出（SukuukunPage._calcMetrics と同一） ──
  _calcMetrics(transcript) {
    const turns      = this._parseTurns(transcript);
    const totalChars = transcript.replace(/\s+/g, '').length || 1;

    let salesChars = 0, applicantChars = 0;
    for (const t of turns) {
      const c = t.text.replace(/\s+/g, '').length;
      if (t.speaker === 'sales')          salesChars     += c;
      else if (t.speaker === 'applicant') applicantChars += c;
    }
    const salesRatio     = Math.round(salesChars / totalChars * 100);
    const applicantRatio = Math.round(applicantChars / totalChars * 100);
    const applicantTurns = turns.filter(t => t.speaker === 'applicant').length;

    const CHARS_PER_SEC = 400 / 60;
    const salesBlocks = [];
    let buf = 0;
    for (const t of turns) {
      if (t.speaker === 'sales') {
        buf += t.text.replace(/\s+/g, '').length;
      } else {
        if (buf > 0) { salesBlocks.push(buf); buf = 0; }
      }
    }
    if (buf > 0) salesBlocks.push(buf);

    const blockSecs      = salesBlocks.map(c => Math.round(c / CHARS_PER_SEC));
    const maxMonologueSec = blockSecs.length ? Math.max(...blockSecs) : 0;
    const mono3minCount  = blockSecs.filter(s => s > 180).length;
    const mono5minCount  = blockSecs.filter(s => s > 300).length;

    const silenceRe     = /\(沈黙\)|\[沈黙\]|（沈黙）|間\.\.\.|\.\.\.\s*(沈黙|pause|silence)/gi;
    const silenceCount  = (transcript.match(silenceRe) || []).length;

    const interruptRe   = /[—ーっっ]\s*$/;
    let salesInterrupts = 0, applicantInterrupts = 0;
    for (let i = 1; i < turns.length; i++) {
      const prev = turns[i - 1];
      const cur  = turns[i];
      if (interruptRe.test(prev.text)) {
        if (cur.speaker === 'sales')          salesInterrupts++;
        else if (cur.speaker === 'applicant') applicantInterrupts++;
      }
    }

    return {
      speech_ratio: {
        sales_ratio:     salesRatio,
        applicant_ratio: applicantRatio,
        sales_chars:     salesChars,
        applicant_chars: applicantChars,
      },
      monologue: {
        max_sec:         maxMonologueSec,
        over_3min_count: mono3minCount,
        over_5min_count: mono5minCount,
      },
      applicant_engagement: {
        turn_count:       applicantTurns,
        silence_over_15s: silenceCount,
      },
      interruptions: {
        sales_to_applicant:    salesInterrupts,
        applicant_to_sales:    applicantInterrupts,
      },
      _turns_detected: turns.length,
    };
  },

  // ── 発話比率分析結果表示（SukuukunPage._renderSpeechResult と同等） ──
  _renderSpeechResult(metrics, ai) {
    const resultEl = document.getElementById('skm-result');
    if (!resultEl) return;

    const sr   = metrics.speech_ratio;
    const mono = metrics.monologue;
    const eng  = metrics.applicant_engagement;
    const intr = metrics.interruptions;
    const emo  = ai.emotions || {};
    const notes = ai.emotion_notes || {};

    const salesPct   = sr.sales_ratio;
    const appPct     = sr.applicant_ratio;
    const salesColor = salesPct > 80 ? '#dc2626' : salesPct > 65 ? '#d97706' : '#2563eb';

    const fmtSec  = s => s >= 60 ? `${Math.floor(s/60)}分${s%60}秒` : `${s}秒`;
    const emoColor = v => v >= 70 ? '#dc2626' : v >= 40 ? '#d97706' : '#16a34a';
    const posColor = v => v >= 60 ? '#16a34a' : v >= 30 ? '#d97706' : '#dc2626';

    const actionsHtml = (ai.actions || []).map((a, i) => `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:#f0fdf4;border-radius:6px;border-left:3px solid #16a34a;margin-bottom:6px">
        <span style="background:#16a34a;color:white;font-size:10px;font-weight:700;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</span>
        <span style="font-size:12px;color:#1f2937;line-height:1.5">${Utils.escHtml(a)}</span>
      </div>`).join('');

    resultEl.innerHTML = `
      <!-- ヘッダー -->
      <div style="padding:10px 14px;background:linear-gradient(135deg,#6366f1,#818cf8);border-radius:10px;margin-bottom:14px;color:white;display:flex;align-items:center;gap:8px">
        <i class="fas fa-wave-square" style="font-size:18px"></i>
        <div>
          <div style="font-size:13px;font-weight:700">発話比率分析レポート</div>
          <div style="font-size:11px;opacity:0.85">Gemini AI による感情シグナル・改善アドバイス付き</div>
        </div>
      </div>

      <!-- 発話比率 -->
      <div style="margin-bottom:12px;padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
        <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:8px">
          <i class="fas fa-comments" style="color:#6366f1;margin-right:5px"></i>発話比率
        </div>
        <div style="margin-bottom:5px">
          <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:600;margin-bottom:3px">
            <span style="color:${salesColor}">🎙️ 講師 ${salesPct}%</span>
            <span style="color:#374151">${sr.sales_chars.toLocaleString()}文字</span>
          </div>
          <div style="background:#e5e7eb;border-radius:3px;height:8px;overflow:hidden">
            <div style="height:100%;width:${salesPct}%;background:${salesColor};border-radius:3px;transition:width 0.6s ease"></div>
          </div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:600;margin-bottom:3px">
            <span style="color:#2563eb">👤 応募者 ${appPct}%</span>
            <span style="color:#374151">${sr.applicant_chars.toLocaleString()}文字</span>
          </div>
          <div style="background:#e5e7eb;border-radius:3px;height:8px;overflow:hidden">
            <div style="height:100%;width:${appPct}%;background:#2563eb;border-radius:3px;transition:width 0.6s ease"></div>
          </div>
        </div>
        ${salesPct > 75 ? `<div style="margin-top:7px;font-size:11px;color:#92400e;background:#fef3c7;padding:4px 8px;border-radius:4px">⚠️ 講師の発話比率が高めです。応募者に話してもらう時間を増やしましょう。</div>` : ''}
      </div>

      <!-- 連続発話 / 参加度 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div style="padding:10px 12px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
          <div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:7px">
            <i class="fas fa-microphone-alt" style="color:#f59e0b;margin-right:4px"></i>セールスの連続発話
          </div>
          <div style="font-size:11px;color:#374151;margin-bottom:3px">
            <span style="color:#6b7280">最長連続発話：</span>
            <span style="font-weight:700;color:${mono.max_sec > 300 ? '#dc2626' : mono.max_sec > 180 ? '#d97706' : '#16a34a'}">${fmtSec(mono.max_sec)}</span>
          </div>
          <div style="font-size:11px;color:#374151;margin-bottom:3px">
            <span style="color:#6b7280">3分超モノローグ：</span>
            <span style="font-weight:700;color:${mono.over_3min_count > 0 ? '#d97706' : '#16a34a'}">${mono.over_3min_count}回</span>
          </div>
          <div style="font-size:11px;color:#374151">
            <span style="color:#6b7280">5分超モノローグ：</span>
            <span style="font-weight:700;color:${mono.over_5min_count > 0 ? '#dc2626' : '#16a34a'}">${mono.over_5min_count}回</span>
          </div>
        </div>
        <div style="padding:10px 12px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
          <div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:7px">
            <i class="fas fa-user-check" style="color:#2563eb;margin-right:4px"></i>応募者の参加度
          </div>
          <div style="font-size:11px;color:#374151;margin-bottom:3px">
            <span style="color:#6b7280">発話ターン数：</span>
            <span style="font-weight:700;color:${eng.turn_count < 10 ? '#dc2626' : eng.turn_count < 20 ? '#d97706' : '#16a34a'}">${eng.turn_count}回</span>
          </div>
          <div style="font-size:11px;color:#374151;margin-bottom:7px">
            <span style="color:#6b7280">15秒超の沈黙：</span>
            <span style="font-weight:700;color:${eng.silence_over_15s > 3 ? '#d97706' : '#16a34a'}">${eng.silence_over_15s}回</span>
          </div>
          <div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:5px">
            <i class="fas fa-bolt" style="color:#dc2626;margin-right:4px"></i>割り込み
          </div>
          <div style="font-size:11px;color:#374151;margin-bottom:2px">
            <span style="color:#6b7280">講師→応募者：</span>
            <span style="font-weight:700">${intr.sales_to_applicant}回</span>
          </div>
          <div style="font-size:11px;color:#374151">
            <span style="color:#6b7280">応募者→講師：</span>
            <span style="font-weight:700">${intr.applicant_to_sales}回</span>
          </div>
        </div>
      </div>

      <!-- 感情シグナル -->
      <div style="margin-bottom:12px;padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
        <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:8px">
          <i class="fas fa-heart-pulse" style="color:#ec4899;margin-right:5px"></i>感情シグナル
          <span style="font-size:10px;font-weight:400;color:#9ca3af;margin-left:6px">Gemini AI 推定</span>
        </div>
        ${[
          { label:'😕 困惑推定',     val: emo.confusion||0, color: emoColor(emo.confusion||0), note: notes.confusion_reason },
          { label:'😰 ストレス推定', val: emo.stress||0,    color: emoColor(emo.stress||0),    note: notes.stress_reason },
          { label:'😊 ポジティブ',   val: emo.positive||0,  color: posColor(emo.positive||0),  note: notes.positive_reason },
        ].map(e => `
          <div style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
              <span style="font-size:11px;font-weight:600;color:#374151">${e.label}</span>
              <span style="font-size:13px;font-weight:700;color:${e.color}">${e.val}%</span>
            </div>
            <div style="background:#e5e7eb;border-radius:3px;height:6px;overflow:hidden;margin-bottom:3px">
              <div style="height:100%;width:${e.val}%;background:${e.color};border-radius:3px;transition:width 0.6s ease"></div>
            </div>
            ${e.note ? `<div style="font-size:10px;color:#6b7280">${Utils.escHtml(e.note)}</div>` : ''}
          </div>`).join('')}
      </div>

      <!-- 改善アドバイス -->
      ${ai.advice ? `
      <div style="margin-bottom:12px;padding:12px 14px;background:#eff6ff;border-radius:8px;border-left:3px solid #3b82f6">
        <div style="font-size:12px;font-weight:700;color:#1e40af;margin-bottom:6px">
          <i class="fas fa-lightbulb"></i> 改善アドバイス
        </div>
        <div style="font-size:12px;color:#1f2937;line-height:1.7">${Utils.escHtml(ai.advice)}</div>
      </div>` : ''}

      <!-- 具体的な改善アクション -->
      ${actionsHtml ? `
      <div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:7px">
          <i class="fas fa-list-check" style="color:#16a34a;margin-right:5px"></i>具体的な改善アクション
        </div>
        ${actionsHtml}
      </div>` : ''}

      <!-- ボタン -->
      <div style="display:flex;justify-content:center;gap:10px;margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb">
        <button class="btn btn-secondary btn-sm" onclick="SukuukunModal._backToInput()">
          <i class="fas fa-arrow-left"></i> 入力に戻る
        </button>
        <button class="btn btn-sm" onclick="SukuukunModal.close()"
          style="background:#6b7280;border-color:#6b7280;color:white">
          <i class="fas fa-times"></i> 閉じる
        </button>
      </div>`;
  },
};
