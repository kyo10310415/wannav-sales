// すくう君モーダル — 営業トーク文字起こし採点・評価
// open(opts) opts: { applicantName, interviewResult }
const SukuukunModal = {
  _opts: {},
  _users: [],   // ユーザー一覧キャッシュ

  // opts: { applicantName?: string, interviewResult?: string }
  async open(opts = {}) {
    this._opts = opts;
    this._removeExisting();

    // ユーザー一覧を取得（キャッシュ済みなら再取得しない）
    if (!this._users.length) {
      try {
        this._users = await API.users.list();
      } catch (e) {
        this._users = [];
      }
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

  _render() {
    const opts = this._opts;
    const applicantName  = opts.applicantName  || '';
    const interviewResult = opts.interviewResult || '';

    // 担当者ドロップダウン選択肢
    const userOptions = this._users.map(u =>
      `<option value="${u.id}" data-name="${Utils.escHtml(u.name)}">${Utils.escHtml(u.name)}</option>`
    ).join('');

    // 現在ログイン中のユーザーをデフォルト選択
    const currentUser = typeof Auth !== 'undefined' ? Auth.user : null;
    const currentUserId = currentUser?.id || '';

    const overlay = document.createElement('div');
    overlay.id = 'sukuukun-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;z-index:1100';

    overlay.innerHTML = `
      <div class="modal" style="max-width:860px;width:95vw">
        <div class="modal-header" style="background:linear-gradient(135deg,#fef3c7 0%,#fffbeb 100%);border-bottom:2px solid #f59e0b">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:38px;height:38px;border-radius:50%;background:#f59e0b;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">
              🤖
            </div>
            <div>
              <div class="modal-title" style="color:#92400e">
                すくう君 — 営業トーク採点
              </div>
              <div style="font-size:12px;color:#a16207;margin-top:2px">
                ${applicantName ? `対象：${Utils.escHtml(applicantName)}　|　` : ''}Gemini AI による採点・フィードバック
              </div>
            </div>
          </div>
          <button class="modal-close" id="sukuukun-close" style="color:#92400e"><i class="fas fa-times"></i></button>
        </div>

        <div class="modal-body" style="padding:0;max-height:82vh;overflow-y:auto">

          <!-- ① 入力エリア -->
          <div id="sukuukun-input-area" style="padding:16px 20px">

            <!-- 情報入力 3列 -->
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px">

              <!-- 応募者氏名 -->
              <div>
                <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:4px">
                  <i class="fas fa-user" style="color:#f59e0b;margin-right:4px"></i>応募者氏名
                </label>
                <input type="text" id="skm-applicant-name" class="form-control"
                  style="font-size:13px"
                  placeholder="例: 山田 太郎"
                  value="${Utils.escHtml(applicantName)}">
              </div>

              <!-- 面接担当者 -->
              <div>
                <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:4px">
                  <i class="fas fa-user-tie" style="color:#2563eb;margin-right:4px"></i>面接担当者
                </label>
                <select id="skm-interviewer" class="form-control" style="font-size:13px">
                  <option value="">-- 担当者を選択 --</option>
                  ${userOptions}
                </select>
              </div>

              <!-- 面接結果 -->
              <div>
                <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:4px">
                  <i class="fas fa-clipboard-check" style="color:#059669;margin-right:4px"></i>面接結果
                </label>
                <select id="skm-interview-result" class="form-control" style="font-size:13px">
                  <option value="">-- 結果を選択 --</option>
                  <option value="契約"   ${interviewResult==='契約'    ? 'selected':''}>契約</option>
                  <option value="辞退"   ${interviewResult==='辞退'    ? 'selected':''}>辞退</option>
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
              <button class="btn btn-sm" id="skm-submit"
                style="background:#f59e0b;border-color:#f59e0b;color:white;font-weight:600;padding:8px 20px">
                <i class="fas fa-robot"></i> すくう君に採点してもらう
              </button>
            </div>
          </div>

          <!-- ② ローディング -->
          <div id="skm-loading" style="display:none;padding:48px 20px;text-align:center">
            <div style="font-size:40px;margin-bottom:14px;animation:skm-spin 2s linear infinite;display:inline-block">⚙️</div>
            <div style="font-size:15px;font-weight:600;color:#374151;margin-bottom:6px">すくう君が採点中です…</div>
            <div style="font-size:12px;color:#6b7280">Gemini AI が文字起こしを分析しています。しばらくお待ちください。</div>
          </div>

          <!-- ③ 結果エリア -->
          <div id="skm-result" style="display:none;padding:16px 20px"></div>
        </div>
      </div>

      <style>
        @keyframes skm-spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        .skm-score-bar { transition: width 0.6s ease; }
      </style>
    `;

    document.body.appendChild(overlay);

    // ---- イベント ----
    document.getElementById('sukuukun-close').addEventListener('click', () => this.close());
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

    document.getElementById('skm-submit').addEventListener('click', () => this._submit());
  },

  async _loadSourceBadge() {
    const badge = document.getElementById('skm-source-badge');
    if (!badge) return;
    try {
      const sources = await API.sukuukun.sources.list();
      if (sources.length === 0) {
        badge.innerHTML = `<i class="fas fa-exclamation-circle" style="color:#d97706"></i>
          <span style="color:#d97706">ソース未登録。「すくう君」ページのソース管理からスクリプトを追加すると採点精度が上がります。</span>`;
      } else {
        const names = sources.map(s => s.title).join('、');
        badge.innerHTML = `<i class="fas fa-check-circle" style="color:#059669"></i>
          <span style="color:#059669">参照ソース ${sources.length}件：${Utils.escHtml(names.length > 70 ? names.slice(0,70)+'…' : names)}</span>`;
      }
    } catch (e) {
      badge.innerHTML = `<i class="fas fa-exclamation-circle" style="color:#9ca3af"></i>
        <span style="color:#9ca3af">ソース情報の取得に失敗しました</span>`;
    }
  },

  async _submit() {
    const transcript = (document.getElementById('skm-transcript')?.value || '').trim();
    if (transcript.length < 50) {
      Utils.notify('文字起こしテキストが短すぎます（50文字以上必要）', 'error');
      return;
    }

    const applicantName = (document.getElementById('skm-applicant-name')?.value || '').trim();

    const interviewerSel = document.getElementById('skm-interviewer');
    const interviewerId   = interviewerSel?.value ? Number(interviewerSel.value) : null;
    const interviewerName = interviewerId
      ? (interviewerSel.options[interviewerSel.selectedIndex]?.dataset?.name || '')
      : '';

    const interviewResult = document.getElementById('skm-interview-result')?.value || '';

    // ローディング表示
    document.getElementById('sukuukun-input-area').style.display = 'none';
    document.getElementById('skm-loading').style.display = 'block';
    document.getElementById('skm-result').style.display = 'none';

    try {
      const data = await API.sukuukun.evaluate({
        transcript,
        applicantName:  applicantName  || undefined,
        interviewerId:  interviewerId  || undefined,
        interviewerName: interviewerName || undefined,
        interviewResult: interviewResult || undefined,
      });

      document.getElementById('skm-loading').style.display = 'none';
      document.getElementById('skm-result').style.display = 'block';

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

      this._renderResult(data, transcript.length, applicantName, interviewerName, interviewResult);

    } catch (err) {
      document.getElementById('skm-loading').style.display = 'none';
      document.getElementById('sukuukun-input-area').style.display = 'block';
      Utils.notify('採点エラー: ' + err.message, 'error');
    }
  },

  _retryBtn() {
    return `<div style="text-align:center;margin-top:16px">
      <button class="btn btn-secondary btn-sm" onclick="SukuukunModal._goBack()">
        <i class="fas fa-arrow-left"></i> 入力に戻る
      </button>
    </div>`;
  },

  _goBack() {
    document.getElementById('skm-result').style.display = 'none';
    document.getElementById('sukuukun-input-area').style.display = 'block';
  },

  _scoreColor(score, max) {
    const p = score / max;
    if (p >= 0.8) return '#16a34a';
    if (p >= 0.6) return '#2563eb';
    if (p >= 0.4) return '#d97706';
    return '#dc2626';
  },
  _scoreBg(score, max) {
    const p = score / max;
    if (p >= 0.8) return '#dcfce7';
    if (p >= 0.6) return '#dbeafe';
    if (p >= 0.4) return '#fef3c7';
    return '#fee2e2';
  },

  _renderResult(data, txLen, applicantName, interviewerName, interviewResult) {
    const total    = data.total_score ?? 0;
    const color    = this._scoreColor(total, 100);
    const bg       = this._scoreBg(total, 100);

    const cats = [
      { key:'rapport',        label:'ラポール構築', icon:'fa-handshake' },
      { key:'hearing',        label:'ヒアリング',   icon:'fa-headphones' },
      { key:'value_proposal', label:'価値提案',     icon:'fa-star' },
      { key:'closing',        label:'クロージング', icon:'fa-flag-checkered' },
      { key:'overall_flow',   label:'全体の流れ',   icon:'fa-stream' },
    ];

    const scoresHtml = cats.map(c => {
      const s  = data.scores?.[c.key] || {};
      const sc = s.score ?? 0;
      const cl = this._scoreColor(sc, 20);
      return `
        <div style="margin-bottom:12px;padding:11px 13px;background:#f9fafb;border-radius:9px;border:1px solid #e5e7eb">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div style="font-size:12px;font-weight:600;color:#1f2937;display:flex;align-items:center;gap:5px">
              <i class="fas ${c.icon}" style="color:${cl};width:14px;text-align:center"></i>${c.label}
            </div>
            <div style="font-size:17px;font-weight:700;color:${cl}">${sc}<span style="font-size:10px;color:#9ca3af;font-weight:400">/20</span></div>
          </div>
          <div style="background:#e5e7eb;border-radius:3px;height:5px;margin-bottom:8px;overflow:hidden">
            <div class="skm-score-bar" style="height:100%;width:${Math.round(sc/20*100)}%;background:${cl};border-radius:3px"></div>
          </div>
          ${s.good    ? `<div style="font-size:11px;margin-bottom:3px;display:flex;gap:5px"><span style="color:#059669;font-weight:600;flex-shrink:0">👍</span><span style="color:#374151;line-height:1.5">${Utils.escHtml(s.good)}</span></div>` : ''}
          ${s.improve ? `<div style="font-size:11px;display:flex;gap:5px"><span style="color:#d97706;font-weight:600;flex-shrink:0">💡</span><span style="color:#374151;line-height:1.5">${Utils.escHtml(s.improve)}</span></div>` : ''}
        </div>`;
    }).join('');

    const hlHtml = (data.highlights||[]).length
      ? `<div style="margin-top:12px">
          <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:7px">
            <i class="fas fa-bookmark" style="color:#f59e0b;margin-right:4px"></i>注目の発言・場面
          </div>
          ${data.highlights.map(h=>`
            <div style="font-size:11px;color:#374151;padding:7px 10px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:0 6px 6px 0;margin-bottom:5px;line-height:1.6">${Utils.escHtml(h)}</div>
          `).join('')}
        </div>`
      : '';

    // メタ情報バッジ
    const metaBadges = [
      applicantName   && `<span style="background:#eff6ff;color:#1e40af;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">👤 ${Utils.escHtml(applicantName)}</span>`,
      interviewerName && `<span style="background:#f0fdf4;color:#166534;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">🎙️ ${Utils.escHtml(interviewerName)}</span>`,
      interviewResult && `<span style="background:${interviewResult==='契約'?'#dcfce7':interviewResult==='辞退'?'#fee2e2':'#fef3c7'};color:${interviewResult==='契約'?'#166534':interviewResult==='辞退'?'#991b1b':'#92400e'};font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">📋 ${Utils.escHtml(interviewResult)}</span>`,
    ].filter(Boolean).join(' ');

    document.getElementById('skm-result').innerHTML = `
      <!-- 総合スコア -->
      <div style="text-align:center;padding:18px;background:${bg};border-radius:12px;margin-bottom:14px;border:2px solid ${color}">
        ${metaBadges ? `<div style="margin-bottom:8px;display:flex;justify-content:center;gap:6px;flex-wrap:wrap">${metaBadges}</div>` : ''}
        <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:2px">総合スコア</div>
        <div style="font-size:54px;font-weight:800;color:${color};line-height:1">${total}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:2px">/ 100点</div>
        <div style="font-size:10px;color:#9ca3af;margin-top:5px">
          参照ソース: ${data.sourceCount||0}件 ・ 文字数: ${txLen.toLocaleString()} 文字 ・ ${new Date().toLocaleString('ja-JP')}
        </div>
      </div>

      <!-- 総合コメント -->
      ${data.summary ? `
      <div style="margin-bottom:14px;padding:11px 13px;background:#eff6ff;border-radius:9px;border-left:4px solid #3b82f6">
        <div style="font-size:11px;font-weight:600;color:#1e40af;margin-bottom:5px"><i class="fas fa-comment-dots"></i> 総合コメント</div>
        <div style="font-size:12px;color:#1f2937;line-height:1.7">${Utils.escHtml(data.summary)}</div>
      </div>` : ''}

      <!-- 各項目 -->
      <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:7px">
        <i class="fas fa-list-check" style="color:#f59e0b;margin-right:4px"></i>各項目の採点
      </div>
      ${scoresHtml}
      ${hlHtml}

      <!-- ボタン -->
      <div style="display:flex;justify-content:center;gap:10px;margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb">
        <button class="btn btn-secondary btn-sm" onclick="SukuukunModal._goBack()">
          <i class="fas fa-arrow-left"></i> 別の文字起こしを採点
        </button>
        <button class="btn btn-sm" onclick="SukuukunModal.close()"
          style="background:#6b7280;border-color:#6b7280;color:white">
          <i class="fas fa-times"></i> 閉じる
        </button>
      </div>
    `;

    // スコアバーアニメーション
    setTimeout(() => {
      document.querySelectorAll('.skm-score-bar').forEach(b => {
        const w = b.style.width; b.style.width = '0';
        setTimeout(() => { b.style.width = w; }, 60);
      });
    }, 80);
  }
};
