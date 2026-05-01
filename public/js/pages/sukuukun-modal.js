// すくう君モーダル — 営業トーク文字起こし採点・評価
const SukuukunModal = {
  applicant: null,

  open(applicant) {
    this.applicant = applicant;
    this._removeExisting();
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
    const applicantName = this.applicant
      ? Utils.escHtml(this.applicant.full_name || '')
      : '';

    const overlay = document.createElement('div');
    overlay.id = 'sukuukun-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;z-index:1100';

    overlay.innerHTML = `
      <div class="modal" style="max-width:820px;width:95vw">
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
                ${applicantName ? `対象：${applicantName}` : ''}
                &nbsp;|&nbsp; Gemini AI による採点・フィードバック
              </div>
            </div>
          </div>
          <button class="modal-close" id="sukuukun-close" style="color:#92400e"><i class="fas fa-times"></i></button>
        </div>

        <div class="modal-body" style="padding:0;max-height:80vh;overflow-y:auto">
          <!-- 入力エリア -->
          <div id="sukuukun-input-area" style="padding:16px 20px">
            <div style="margin-bottom:10px">
              <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px">
                <i class="fas fa-file-alt" style="color:#f59e0b;margin-right:6px"></i>
                面接（セールス）の文字起こしを貼り付けてください
              </label>
              <div style="font-size:11px;color:#6b7280;margin-bottom:8px">
                ※ NotebookLM や音声認識ツールで書き起こしたテキストをそのまま貼り付けてください。
                約2時間分（文字数多数）でも対応可能です。
              </div>
              <textarea
                id="sukuukun-transcript"
                rows="14"
                class="form-control"
                placeholder="例：
営業: こんにちは、WannaVの○○と申します。
応募者: よろしくお願いします。
営業: 本日はお時間いただきありがとうございます...
（文字起こし全文をここに貼り付けてください）"
                style="font-size:12px;line-height:1.6;resize:vertical;min-height:200px"
              ></textarea>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span id="sukuukun-char-count" style="font-size:11px;color:#9ca3af">0 文字</span>
              <div style="display:flex;gap:8px">
                <button class="btn btn-secondary btn-sm" id="sukuukun-cancel">キャンセル</button>
                <button class="btn btn-sm" id="sukuukun-submit"
                  style="background:#f59e0b;border-color:#f59e0b;color:white;font-weight:600">
                  <i class="fas fa-robot"></i> すくう君に採点してもらう
                </button>
              </div>
            </div>
          </div>

          <!-- ローディング -->
          <div id="sukuukun-loading" style="display:none;padding:40px 20px;text-align:center">
            <div style="font-size:32px;margin-bottom:12px;animation:spin 2s linear infinite;display:inline-block">⚙️</div>
            <div style="font-size:15px;font-weight:600;color:#374151;margin-bottom:6px">すくう君が採点中です…</div>
            <div style="font-size:12px;color:#6b7280">Gemini AI が文字起こしを分析しています。しばらくお待ちください。</div>
          </div>

          <!-- 結果エリア -->
          <div id="sukuukun-result" style="display:none;padding:16px 20px">
          </div>
        </div>
      </div>

      <style>
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .sukuukun-score-bar { transition: width 0.6s ease; }
      </style>
    `;

    document.body.appendChild(overlay);

    // イベント設定
    document.getElementById('sukuukun-close').addEventListener('click', () => this.close());
    document.getElementById('sukuukun-cancel').addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });

    const textarea = document.getElementById('sukuukun-transcript');
    const charCount = document.getElementById('sukuukun-char-count');
    textarea.addEventListener('input', () => {
      const len = textarea.value.length;
      charCount.textContent = `${len.toLocaleString()} 文字`;
      charCount.style.color = len >= 50 ? '#059669' : '#9ca3af';
    });

    document.getElementById('sukuukun-submit').addEventListener('click', () => this._submit());
  },

  async _submit() {
    const transcript = document.getElementById('sukuukun-transcript').value.trim();
    if (transcript.length < 50) {
      Utils.notify('文字起こしテキストが短すぎます（50文字以上必要）', 'error');
      return;
    }

    // ローディング表示
    document.getElementById('sukuukun-input-area').style.display = 'none';
    document.getElementById('sukuukun-loading').style.display = 'block';
    document.getElementById('sukuukun-result').style.display = 'none';

    try {
      const token = localStorage.getItem('token');
      const applicantName = this.applicant?.full_name || '';

      const resp = await fetch('/api/sukuukun/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ transcript, applicantName })
      });

      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || `エラー (${resp.status})`);
      }

      document.getElementById('sukuukun-loading').style.display = 'none';
      document.getElementById('sukuukun-result').style.display = 'block';

      if (data.parseError) {
        // JSON解析失敗時はテキストで表示
        document.getElementById('sukuukun-result').innerHTML = `
          <div class="alert alert-error" style="margin-bottom:12px">
            <i class="fas fa-exclamation-triangle"></i>
            <span>JSON解析に失敗しました。生のレスポンスを表示します。</span>
          </div>
          <pre style="font-size:12px;background:#f9fafb;padding:12px;border-radius:8px;white-space:pre-wrap;overflow-x:auto">${Utils.escHtml(data.raw || '')}</pre>
          ${this._retryBtn()}
        `;
        return;
      }

      this._renderResult(data, transcript.length);

    } catch (err) {
      document.getElementById('sukuukun-loading').style.display = 'none';
      document.getElementById('sukuukun-input-area').style.display = 'block';
      Utils.notify('採点エラー: ' + err.message, 'error');
    }
  },

  _retryBtn() {
    return `
      <div style="text-align:center;margin-top:16px">
        <button class="btn btn-secondary btn-sm" onclick="SukuukunModal._goBack()">
          <i class="fas fa-arrow-left"></i> 入力に戻る
        </button>
      </div>`;
  },

  _goBack() {
    document.getElementById('sukuukun-result').style.display = 'none';
    document.getElementById('sukuukun-input-area').style.display = 'block';
  },

  _scoreColor(score, max) {
    const pct = score / max;
    if (pct >= 0.8) return '#16a34a';
    if (pct >= 0.6) return '#2563eb';
    if (pct >= 0.4) return '#d97706';
    return '#dc2626';
  },

  _scoreBg(score, max) {
    const pct = score / max;
    if (pct >= 0.8) return '#dcfce7';
    if (pct >= 0.6) return '#dbeafe';
    if (pct >= 0.4) return '#fef3c7';
    return '#fee2e2';
  },

  _renderResult(data, transcriptLen) {
    const totalScore = data.total_score ?? 0;
    const totalColor = this._scoreColor(totalScore, 100);
    const totalBg    = this._scoreBg(totalScore, 100);

    const categoryLabels = {
      rapport:        { label: 'ラポール構築', icon: 'fa-handshake' },
      hearing:        { label: 'ヒアリング',   icon: 'fa-ear-listen' },
      value_proposal: { label: '価値提案',     icon: 'fa-star' },
      closing:        { label: 'クロージング', icon: 'fa-flag-checkered' },
      overall_flow:   { label: '全体の流れ',   icon: 'fa-stream' },
    };

    const scoresHtml = Object.entries(categoryLabels).map(([key, meta]) => {
      const s = data.scores?.[key] || {};
      const score = s.score ?? 0;
      const color = this._scoreColor(score, 20);
      const barPct = Math.round((score / 20) * 100);
      const icon = meta.icon.startsWith('fa-ear') ? 'fa-headphones' : meta.icon; // FA互換

      return `
        <div style="margin-bottom:14px;padding:12px 14px;background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:13px;font-weight:600;color:#1f2937;display:flex;align-items:center;gap:6px">
              <i class="fas ${icon}" style="color:${color};width:16px;text-align:center"></i>
              ${meta.label}
            </div>
            <div style="font-size:18px;font-weight:700;color:${color}">${score}<span style="font-size:11px;color:#9ca3af;font-weight:400"> / 20</span></div>
          </div>
          <!-- スコアバー -->
          <div style="background:#e5e7eb;border-radius:4px;height:6px;margin-bottom:10px;overflow:hidden">
            <div class="sukuukun-score-bar" style="height:100%;width:${barPct}%;background:${color};border-radius:4px"></div>
          </div>
          ${s.good ? `
          <div style="font-size:11px;margin-bottom:4px;display:flex;gap:6px">
            <span style="color:#059669;font-weight:600;flex-shrink:0">👍 良い点</span>
            <span style="color:#374151;line-height:1.5">${Utils.escHtml(s.good)}</span>
          </div>` : ''}
          ${s.improve ? `
          <div style="font-size:11px;display:flex;gap:6px">
            <span style="color:#d97706;font-weight:600;flex-shrink:0">💡 改善点</span>
            <span style="color:#374151;line-height:1.5">${Utils.escHtml(s.improve)}</span>
          </div>` : ''}
        </div>
      `;
    }).join('');

    const highlightsHtml = (data.highlights || []).length > 0
      ? `<div style="margin-top:14px">
          <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:8px">
            <i class="fas fa-bookmark" style="color:#f59e0b;margin-right:5px"></i>注目の発言・場面
          </div>
          ${data.highlights.map(h => `
            <div style="font-size:11px;color:#374151;padding:8px 10px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:0 6px 6px 0;margin-bottom:6px;line-height:1.6">
              ${Utils.escHtml(h)}
            </div>`).join('')}
        </div>`
      : '';

    const applicantName = this.applicant?.full_name
      ? `（${Utils.escHtml(this.applicant.full_name)}）`
      : '';

    document.getElementById('sukuukun-result').innerHTML = `
      <!-- 総合スコア -->
      <div style="text-align:center;padding:20px;background:${totalBg};border-radius:12px;margin-bottom:16px;border:2px solid ${totalColor}">
        <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">
          総合スコア${applicantName}
        </div>
        <div style="font-size:56px;font-weight:800;color:${totalColor};line-height:1">
          ${totalScore}
        </div>
        <div style="font-size:14px;color:#6b7280;margin-top:2px">/ 100点</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:6px">
          文字数: ${transcriptLen.toLocaleString()} 文字 &nbsp;|&nbsp;
          評価日時: ${new Date().toLocaleString('ja-JP')}
        </div>
      </div>

      <!-- 総合コメント -->
      ${data.summary ? `
      <div style="margin-bottom:16px;padding:12px 14px;background:#eff6ff;border-radius:10px;border-left:4px solid #3b82f6">
        <div style="font-size:12px;font-weight:600;color:#1e40af;margin-bottom:6px">
          <i class="fas fa-comment-dots" style="margin-right:5px"></i>総合コメント
        </div>
        <div style="font-size:13px;color:#1f2937;line-height:1.7">${Utils.escHtml(data.summary)}</div>
      </div>` : ''}

      <!-- 各項目スコア -->
      <div style="margin-bottom:4px;font-size:12px;font-weight:600;color:#374151">
        <i class="fas fa-list-check" style="color:#f59e0b;margin-right:5px"></i>各項目の採点
      </div>
      ${scoresHtml}

      <!-- 注目の発言 -->
      ${highlightsHtml}

      <!-- 再採点 -->
      <div style="display:flex;justify-content:center;gap:10px;margin-top:18px;padding-top:14px;border-top:1px solid #e5e7eb">
        <button class="btn btn-secondary btn-sm" onclick="SukuukunModal._goBack()">
          <i class="fas fa-arrow-left"></i> 別の文字起こしを採点
        </button>
        <button class="btn btn-sm" onclick="SukuukunModal.close()"
          style="background:#6b7280;border-color:#6b7280;color:white">
          <i class="fas fa-times"></i> 閉じる
        </button>
      </div>
    `;

    // アニメーション: バーを少し遅らせて描画
    setTimeout(() => {
      document.querySelectorAll('.sukuukun-score-bar').forEach(bar => {
        const w = bar.style.width;
        bar.style.width = '0%';
        setTimeout(() => { bar.style.width = w; }, 50);
      });
    }, 100);
  }
};
