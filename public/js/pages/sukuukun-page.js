// すくう君 専用ページ — ソース管理 + 採点 + 履歴
const SukuukunPage = {
  sources: [],
  history: [],
  users:   [],          // ユーザー一覧（担当者フィルタ用）
  activeTab: 'evaluate',
  editingSourceId: null,
  historyFilterInterviewerId: '',  // 履歴フィルタ: 担当者ID（''=全員）
  historyActiveUserId: '__all__',  // 担当者別タブ: '__all__'=全員, それ以外はuser.id(文字列)
  historyAll: [],                  // 全履歴キャッシュ（タブ切替用）

  render() {
    return `
      <div class="page-header">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#fbbf24);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;box-shadow:0 2px 8px rgba(245,158,11,0.35)">🤖</div>
          <div>
            <div class="page-title" style="color:#92400e">すくう君</div>
            <div class="page-subtitle">Gemini AI による営業トーク採点・評価システム</div>
          </div>
        </div>
      </div>
      <div class="page-body">
        <!-- タブ -->
        <div style="display:flex;gap:4px;margin-bottom:16px;background:white;border-radius:10px;padding:4px;box-shadow:0 1px 4px rgba(0,0,0,0.08);width:fit-content">
          ${[
            { id:'evaluate', icon:'fa-robot',    label:'採点する' },
            { id:'sources',  icon:'fa-book-open',label:'ソース管理' },
            { id:'history',  icon:'fa-history',  label:'採点履歴' },
          ].map(t => `
            <button id="tab-${t.id}" onclick="SukuukunPage.switchTab('${t.id}')"
              style="padding:7px 16px;border-radius:7px;border:none;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;transition:all 0.15s;
                ${this.activeTab === t.id
                  ? 'background:#f59e0b;color:white;box-shadow:0 2px 6px rgba(245,158,11,0.4)'
                  : 'background:transparent;color:#6b7280'}">
              <i class="fas ${t.icon}"></i>${t.label}
            </button>
          `).join('')}
        </div>

        <!-- 採点タブ -->
        <div id="pane-evaluate" style="display:${this.activeTab==='evaluate'?'block':'none'}">
          ${this._renderEvaluatePane()}
        </div>

        <!-- ソース管理タブ -->
        <div id="pane-sources" style="display:${this.activeTab==='sources'?'block':'none'}">
          ${this._renderSourcesPane()}
        </div>

        <!-- 履歴タブ -->
        <div id="pane-history" style="display:${this.activeTab==='history'?'block':'none'}">
          ${this._renderHistoryPane()}
        </div>
      </div>
    `;
  },

  // ── 採点ペイン ──────────────────────────────────────────
  _renderEvaluatePane() {
    // 担当者ドロップダウン選択肢
    const userOptions = this.users.map(u =>
      `<option value="${u.id}" data-name="${Utils.escHtml(u.name)}">${Utils.escHtml(u.name)}</option>`
    ).join('');

    // ログイン中ユーザーをデフォルト選択
    const currentUser = typeof Auth !== 'undefined' ? Auth.user : null;
    const currentUserId = currentUser?.id || '';

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <!-- 入力 -->
        <div class="card">
          <div class="card-header" style="background:#fffbeb;border-bottom:1px solid #fde68a">
            <div class="card-title" style="color:#92400e"><i class="fas fa-microphone" style="margin-right:6px"></i>文字起こし入力</div>
          </div>
          <div class="card-body">

            <!-- 3列：応募者・担当者・結果 -->
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">
              <div>
                <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:4px">
                  <i class="fas fa-user" style="color:#f59e0b;margin-right:3px"></i>応募者氏名（任意）
                </label>
                <input type="text" id="eval-applicant-name" class="form-control"
                  placeholder="例: 山田 太郎" style="font-size:12px">
              </div>
              <div>
                <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:4px">
                  <i class="fas fa-user-tie" style="color:#2563eb;margin-right:3px"></i>面接担当者
                </label>
                <select id="eval-interviewer" class="form-control" style="font-size:12px">
                  <option value="">-- 選択 --</option>
                  ${userOptions}
                </select>
              </div>
              <div>
                <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:4px">
                  <i class="fas fa-clipboard-check" style="color:#059669;margin-right:3px"></i>面接結果
                </label>
                <select id="eval-interview-result" class="form-control" style="font-size:12px">
                  <option value="">-- 選択 --</option>
                  <option value="契約">契約</option>
                  <option value="辞退">辞退</option>
                  <option value="持ち帰り">持ち帰り</option>
                </select>
              </div>
            </div>

            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
                <label style="font-size:12px;font-weight:600;color:#374151">文字起こしテキスト <span style="color:#dc2626">*</span></label>
                <span id="eval-char-count" style="font-size:11px;color:#9ca3af">0 文字</span>
              </div>
              <textarea id="eval-transcript" rows="15" class="form-control"
                placeholder="面接・セールスの文字起こしをここに貼り付けてください。
NotebookLM・音声認識ツール等で書き起こしたテキストをそのままペーストしてOKです。
長文（2時間分以上）にも対応しています。

例：
営業: こんにちは！本日はお時間いただきありがとうございます。
応募者: よろしくお願いします。
営業: ぜひ○○さんのことをもっと教えていただければと思いまして…"
                style="font-size:12px;line-height:1.65;resize:vertical;min-height:280px"></textarea>
            </div>
            <div id="eval-source-badge" style="margin-top:10px;font-size:11px;color:#6b7280;display:flex;align-items:center;gap:5px">
              <i class="fas fa-circle-notch fa-spin"></i> ソース読み込み中...
            </div>
            <div style="display:flex;justify-content:flex-end;margin-top:12px">
              <button id="eval-submit-btn" onclick="SukuukunPage.submitEvaluate()"
                style="padding:10px 24px;background:#f59e0b;border:none;border-radius:8px;color:white;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 2px 8px rgba(245,158,11,0.4)">
                <i class="fas fa-robot"></i> すくう君に採点してもらう
              </button>
            </div>
          </div>
        </div>

        <!-- 結果 -->
        <div id="eval-result-area">
          <div class="card" style="height:100%">
            <div class="card-header" style="background:#f0fdf4;border-bottom:1px solid #bbf7d0">
              <div class="card-title" style="color:#166534"><i class="fas fa-chart-bar" style="margin-right:6px"></i>採点結果</div>
            </div>
            <div class="card-body" id="eval-result-body" style="min-height:300px;display:flex;align-items:center;justify-content:center">
              <div style="text-align:center;color:#9ca3af">
                <div style="font-size:40px;margin-bottom:12px">📝</div>
                <div style="font-size:14px">文字起こしを入力して採点ボタンを押してください</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <script>
        // ログイン中ユーザーをデフォルト選択
        (function(){
          const sel = document.getElementById('eval-interviewer');
          if (sel && '${currentUserId}') sel.value = '${currentUserId}';
        })();
      </script>
    `;
  },

  // ── ソース管理ペイン ──────────────────────────────────
  _renderSourcesPane() {
    return `
      <div style="display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start">
        <!-- ソース一覧 -->
        <div>
          <div class="card">
            <div class="card-header" style="background:#fffbeb;border-bottom:1px solid #fde68a;display:flex;align-items:center;justify-content:space-between">
              <div class="card-title" style="color:#92400e;font-size:13px"><i class="fas fa-book-open" style="margin-right:5px"></i>ソース一覧</div>
              <span id="source-count-badge" style="font-size:11px;background:#fde68a;color:#92400e;border-radius:12px;padding:1px 8px;font-weight:700">0件</span>
            </div>
            <div class="card-body" style="padding:8px" id="source-list-wrap">
              <div style="text-align:center;padding:24px;color:#9ca3af;font-size:12px">
                <i class="fas fa-spinner fa-spin"></i> 読み込み中...
              </div>
            </div>
          </div>
        </div>

        <!-- 追加・編集フォーム -->
        <div>
          <div class="card">
            <div class="card-header" style="background:#fafafa;border-bottom:1px solid #e5e7eb">
              <div class="card-title" style="font-size:13px" id="source-form-title">
                <i class="fas fa-plus-circle" style="color:#f59e0b;margin-right:5px"></i>ソースを追加
              </div>
            </div>
            <div class="card-body">
              <!-- 追加タイプ切り替え -->
              <div style="display:flex;gap:8px;margin-bottom:14px" id="source-type-tabs">
                <button id="stype-text" onclick="SukuukunPage.switchSourceType('text')"
                  style="flex:1;padding:7px;border-radius:6px;border:2px solid #f59e0b;background:#f59e0b;color:white;font-size:12px;font-weight:600;cursor:pointer">
                  <i class="fas fa-align-left"></i> テキスト
                </button>
                <button id="stype-pdf" onclick="SukuukunPage.switchSourceType('pdf')"
                  style="flex:1;padding:7px;border-radius:6px;border:2px solid #e5e7eb;background:white;color:#6b7280;font-size:12px;font-weight:600;cursor:pointer">
                  <i class="fas fa-file-pdf" style="color:#dc2626"></i> PDFアップロード
                </button>
              </div>

              <div id="source-form-fields">
                <!-- テキストフォーム（デフォルト） -->
                <div id="source-text-form">
                  <div class="form-group" style="margin-bottom:10px">
                    <label class="form-label">タイトル <span style="color:#dc2626">*</span></label>
                    <input type="text" id="source-title-text" class="form-control" placeholder="例: 2026_04_セールストークスクリプト">
                  </div>
                  <div class="form-group" style="margin-bottom:10px">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
                      <label class="form-label" style="margin:0">内容 <span style="color:#dc2626">*</span></label>
                      <span id="source-text-count" style="font-size:11px;color:#9ca3af">0 文字</span>
                    </div>
                    <textarea id="source-content-text" rows="14" class="form-control"
                      placeholder="テキストをここに貼り付けてください（PDFや資料の内容をコピー&ペースト）"
                      style="font-size:12px;line-height:1.6;resize:vertical;min-height:280px"></textarea>
                  </div>
                  <div style="display:flex;gap:8px;justify-content:flex-end">
                    <button class="btn btn-secondary btn-sm" onclick="SukuukunPage.cancelEdit()">キャンセル</button>
                    <button class="btn btn-sm" id="source-save-text-btn" onclick="SukuukunPage.saveTextSource()"
                      style="background:#f59e0b;border-color:#f59e0b;color:white">
                      <i class="fas fa-save"></i> <span id="source-save-text-label">保存</span>
                    </button>
                  </div>
                </div>

                <!-- PDFフォーム -->
                <div id="source-pdf-form" style="display:none">
                  <div class="form-group" style="margin-bottom:10px">
                    <label class="form-label">タイトル（空白時はファイル名を使用）</label>
                    <input type="text" id="source-title-pdf" class="form-control" placeholder="例: セールストークスクリプト2026年4月版">
                  </div>
                  <div class="form-group" style="margin-bottom:14px">
                    <label class="form-label">PDFファイル <span style="color:#dc2626">*</span></label>
                    <div id="pdf-drop-zone"
                      style="border:2px dashed #e5e7eb;border-radius:10px;padding:32px 20px;text-align:center;cursor:pointer;transition:all 0.2s;background:#fafafa"
                      onclick="document.getElementById('source-pdf-input').click()"
                      ondragover="SukuukunPage.onDragOver(event)"
                      ondragleave="SukuukunPage.onDragLeave(event)"
                      ondrop="SukuukunPage.onDrop(event)">
                      <i class="fas fa-file-pdf" style="font-size:32px;color:#dc2626;margin-bottom:8px;display:block"></i>
                      <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">PDFをドロップ または クリックして選択</div>
                      <div style="font-size:11px;color:#9ca3af">最大20MB / テキスト抽出可能なPDFのみ対応</div>
                    </div>
                    <input type="file" id="source-pdf-input" accept=".pdf" style="display:none"
                      onchange="SukuukunPage.onPdfSelected(event)">
                    <div id="pdf-selected-info" style="display:none;margin-top:8px;padding:8px 12px;background:#f0fdf4;border-radius:6px;font-size:12px;color:#166534">
                      <i class="fas fa-check-circle"></i> <span id="pdf-selected-name"></span>
                    </div>
                  </div>
                  <div style="display:flex;gap:8px;justify-content:flex-end">
                    <button class="btn btn-secondary btn-sm" onclick="SukuukunPage.cancelEdit()">キャンセル</button>
                    <button class="btn btn-sm" id="source-save-pdf-btn" onclick="SukuukunPage.savePdfSource()"
                      style="background:#dc2626;border-color:#dc2626;color:white">
                      <i class="fas fa-upload"></i> アップロード・保存
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  // ── 履歴ペイン ───────────────────────────────────────
  _renderHistoryPane() {
    // 担当者タブ：全員 + 各ユーザー
    const tabs = [{ id: '__all__', name: '全員' }, ...this.users.map(u => ({ id: String(u.id), name: u.name }))];
    const tabsHtml = tabs.map(t => {
      const active = this.historyActiveUserId === t.id;
      // このタブの件数
      const count = t.id === '__all__'
        ? this.historyAll.length
        : this.historyAll.filter(h => String(h.interviewer_id) === t.id).length;
      return `
        <button onclick="SukuukunPage.switchHistoryTab('${t.id}')"
          style="padding:6px 14px;border-radius:6px;border:none;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all 0.15s;display:flex;align-items:center;gap:5px;
            ${active
              ? 'background:#f59e0b;color:white;box-shadow:0 2px 6px rgba(245,158,11,0.35)'
              : 'background:white;color:#6b7280;border:1px solid #e5e7eb'}">
          <i class="fas ${t.id === '__all__' ? 'fa-users' : 'fa-user'}" style="font-size:11px"></i>
          ${Utils.escHtml(t.name)}
          ${count > 0 ? `<span style="background:${active?'rgba(255,255,255,0.35)':'#f3f4f6'};color:${active?'white':'#6b7280'};border-radius:8px;padding:0 6px;font-size:10px">${count}</span>` : ''}
        </button>`;
    }).join('');

    return `
      <div class="card">
        <div class="card-header" style="background:#fffbeb;border-bottom:1px solid #fde68a;padding-bottom:0">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div class="card-title" style="color:#92400e"><i class="fas fa-history" style="margin-right:6px"></i>採点履歴</div>
            <button class="btn btn-secondary btn-sm" onclick="SukuukunPage.loadHistory()" style="font-size:11px">
              <i class="fas fa-sync-alt"></i> 更新
            </button>
          </div>
          <!-- 担当者別タブ -->
          <div id="history-user-tabs" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:10px;flex-wrap:nowrap">
            ${tabsHtml}
          </div>
        </div>
        <div class="card-body" style="padding:0" id="history-list-wrap">
          <div style="text-align:center;padding:32px;color:#9ca3af">
            <i class="fas fa-spinner fa-spin"></i> 読み込み中...
          </div>
        </div>
      </div>

      <!-- 採点詳細モーダル -->
      <div id="history-detail-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9000;overflow-y:auto;padding:24px 16px">
        <div style="max-width:680px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
          <div style="background:linear-gradient(135deg,#f59e0b,#fbbf24);padding:14px 20px;display:flex;align-items:center;justify-content:space-between">
            <div style="color:white;font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px">
              <i class="fas fa-robot"></i> 採点結果詳細
            </div>
            <button onclick="SukuukunPage.closeHistoryDetail()"
              style="background:rgba(255,255,255,0.25);border:none;border-radius:6px;color:white;width:28px;height:28px;cursor:pointer;font-size:14px">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div id="history-detail-body" style="padding:20px">
            <div style="text-align:center;color:#9ca3af;padding:24px"><i class="fas fa-spinner fa-spin"></i></div>
          </div>
        </div>
      </div>
    `;
  },

  // ── マウント ──────────────────────────────────────────
  async mount() {
    // ユーザー一覧を取得（担当者DD用）
    try {
      this.users = await API.users.list();
    } catch (e) {
      this.users = [];
    }

    // 採点タブのイベント
    const ta = document.getElementById('eval-transcript');
    if (ta) {
      ta.addEventListener('input', () => {
        const len = ta.value.length;
        const el = document.getElementById('eval-char-count');
        if (el) {
          el.textContent = `${len.toLocaleString()} 文字`;
          el.style.color = len >= 50 ? '#059669' : '#9ca3af';
        }
      });
    }
    const sc = document.getElementById('source-content-text');
    if (sc) {
      sc.addEventListener('input', () => {
        const el = document.getElementById('source-text-count');
        if (el) el.textContent = `${sc.value.length.toLocaleString()} 文字`;
      });
    }

    // ログイン中ユーザーをデフォルト選択
    const currentUser = typeof Auth !== 'undefined' ? Auth.user : null;
    if (currentUser?.id) {
      const sel = document.getElementById('eval-interviewer');
      if (sel) sel.value = String(currentUser.id);
    }

    await this.loadSources();
    this._updateSourceBadge();

    if (this.activeTab === 'history') await this.loadHistory();
  },

  // ── タブ切り替え ──────────────────────────────────────
  switchTab(tab) {
    this.activeTab = tab;
    ['evaluate','sources','history'].forEach(t => {
      const pane = document.getElementById(`pane-${t}`);
      const btn  = document.getElementById(`tab-${t}`);
      if (pane) pane.style.display = t === tab ? 'block' : 'none';
      if (btn) {
        if (t === tab) {
          btn.style.background = '#f59e0b';
          btn.style.color = 'white';
          btn.style.boxShadow = '0 2px 6px rgba(245,158,11,0.4)';
        } else {
          btn.style.background = 'transparent';
          btn.style.color = '#6b7280';
          btn.style.boxShadow = 'none';
        }
      }
    });
    if (tab === 'history') this.loadHistory();
  },

  // ── ソース読み込み ────────────────────────────────────
  async loadSources() {
    try {
      this.sources = await API.sukuukun.sources.list();
      this._renderSourceList();
      this._updateSourceBadge();
    } catch (e) {
      const wrap = document.getElementById('source-list-wrap');
      if (wrap) wrap.innerHTML = `<div style="padding:12px;color:#dc2626;font-size:12px">${Utils.escHtml(e.message)}</div>`;
    }
  },

  _updateSourceBadge() {
    const badge = document.getElementById('source-count-badge');
    if (badge) badge.textContent = `${this.sources.length}件`;

    const evalBadge = document.getElementById('eval-source-badge');
    if (evalBadge) {
      if (this.sources.length === 0) {
        evalBadge.innerHTML = `<i class="fas fa-exclamation-circle" style="color:#d97706"></i>
          <span style="color:#d97706">ソース未登録。「ソース管理」タブからスクリプト等を追加すると採点精度が上がります</span>`;
      } else {
        const names = this.sources.map(s => s.title).join('、');
        evalBadge.innerHTML = `<i class="fas fa-check-circle" style="color:#059669"></i>
          <span style="color:#059669">参照ソース ${this.sources.length}件：${Utils.escHtml(names.length > 60 ? names.slice(0,60)+'…' : names)}</span>`;
      }
    }
  },

  _renderSourceList() {
    const wrap = document.getElementById('source-list-wrap');
    if (!wrap) return;

    if (this.sources.length === 0) {
      wrap.innerHTML = `
        <div style="text-align:center;padding:24px 12px;color:#9ca3af">
          <i class="fas fa-folder-open" style="font-size:28px;margin-bottom:8px;display:block"></i>
          <div style="font-size:12px">ソースがありません。<br>テキストまたはPDFを追加してください。</div>
        </div>`;
      return;
    }

    wrap.innerHTML = this.sources.map(s => `
      <div class="source-item" id="source-item-${s.id}"
        style="padding:8px 10px;border-radius:7px;margin-bottom:4px;cursor:pointer;border:1px solid transparent;transition:all 0.15s;display:flex;align-items:flex-start;gap:8px"
        onmouseenter="this.style.background='#fffbeb';this.style.borderColor='#fde68a'"
        onmouseleave="this.style.background='transparent';this.style.borderColor='transparent'"
        onclick="SukuukunPage.selectSource(${s.id})">
        <div style="flex-shrink:0;padding-top:1px">
          <i class="fas ${s.source_type==='pdf' ? 'fa-file-pdf' : 'fa-align-left'}"
            style="color:${s.source_type==='pdf'?'#dc2626':'#6b7280'};font-size:13px"></i>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Utils.escHtml(s.title)}</div>
          <div style="font-size:10px;color:#9ca3af;margin-top:1px">
            ${s.char_count ? s.char_count.toLocaleString()+'文字' : ''}
            ${s.file_name ? '・'+Utils.escHtml(s.file_name) : ''}
          </div>
        </div>
        <button onclick="event.stopPropagation();SukuukunPage.deleteSource(${s.id})"
          style="flex-shrink:0;background:none;border:none;color:#9ca3af;cursor:pointer;padding:2px 4px;border-radius:4px;font-size:11px"
          title="削除" onmouseenter="this.style.color='#dc2626'" onmouseleave="this.style.color='#9ca3af'">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `).join('');
  },

  // ── ソース選択（編集フォームに展開）────────────────────
  async selectSource(id) {
    try {
      const s = await API.sukuukun.sources.get(id);
      this.editingSourceId = id;

      // テキストタイプに切り替え（編集はテキストのみ）
      this.switchSourceType('text');
      document.getElementById('source-form-title').innerHTML =
        `<i class="fas fa-edit" style="color:#f59e0b;margin-right:5px"></i>ソースを編集`;

      // タイプ切り替えボタンを非表示
      const typeTabs = document.getElementById('source-type-tabs');
      if (typeTabs) typeTabs.style.display = 'none';

      document.getElementById('source-title-text').value = s.title;
      document.getElementById('source-content-text').value = s.content;
      const el = document.getElementById('source-text-count');
      if (el) el.textContent = `${s.content.length.toLocaleString()} 文字`;
      const lbl1 = document.getElementById('source-save-text-label');
      if (lbl1) lbl1.textContent = '更新';
    } catch (e) {
      Utils.notify('読み込みエラー: ' + e.message, 'error');
    }
  },

  cancelEdit() {
    this.editingSourceId = null;

    // フォームタイトルをリセット
    const formTitle = document.getElementById('source-form-title');
    if (formTitle) formTitle.innerHTML =
      `<i class="fas fa-plus-circle" style="color:#f59e0b;margin-right:5px"></i>ソースを追加`;

    // タイプ切り替えボタンを表示
    const typeTabs = document.getElementById('source-type-tabs');
    if (typeTabs) typeTabs.style.display = 'flex';

    // フォーム入力をクリア
    const titleInput = document.getElementById('source-title-text');
    if (titleInput) titleInput.value = '';
    const contentInput = document.getElementById('source-content-text');
    if (contentInput) contentInput.value = '';
    const el = document.getElementById('source-text-count');
    if (el) el.textContent = '0 文字';

    // 保存ボタンを確実に復元（disabled 解除 + ラベルリセット）
    const btn = document.getElementById('source-save-text-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-save"></i> <span id="source-save-text-label">保存</span>';
    }

    this.switchSourceType('text');
  },

  // ── ソースタイプ切り替え ──────────────────────────────
  switchSourceType(type) {
    const textForm = document.getElementById('source-text-form');
    const pdfForm  = document.getElementById('source-pdf-form');
    const textBtn  = document.getElementById('stype-text');
    const pdfBtn   = document.getElementById('stype-pdf');

    if (type === 'text') {
      if (textForm) textForm.style.display = 'block';
      if (pdfForm)  pdfForm.style.display  = 'none';
      if (textBtn) { textBtn.style.background='#f59e0b'; textBtn.style.borderColor='#f59e0b'; textBtn.style.color='white'; }
      if (pdfBtn)  { pdfBtn.style.background='white';   pdfBtn.style.borderColor='#e5e7eb'; pdfBtn.style.color='#6b7280'; }
    } else {
      if (textForm) textForm.style.display = 'none';
      if (pdfForm)  pdfForm.style.display  = 'block';
      if (pdfBtn)  { pdfBtn.style.background='#dc2626'; pdfBtn.style.borderColor='#dc2626'; pdfBtn.style.color='white'; }
      if (textBtn) { textBtn.style.background='white';  textBtn.style.borderColor='#e5e7eb'; textBtn.style.color='#6b7280'; }
    }
  },

  // ── テキストソース保存 ────────────────────────────────
  async saveTextSource() {
    const title   = document.getElementById('source-title-text').value.trim();
    const content = document.getElementById('source-content-text').value.trim();
    if (!title)   { Utils.notify('タイトルを入力してください', 'error'); return; }
    if (!content) { Utils.notify('内容を入力してください', 'error'); return; }

    const btn = document.getElementById('source-save-text-btn');
    const isEditing = !!this.editingSourceId;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...'; }

    try {
      if (isEditing) {
        await API.sukuukun.sources.update(this.editingSourceId, { title, content });
        Utils.notify('ソースを更新しました', 'success');
      } else {
        await API.sukuukun.sources.addText({ title, content });
        Utils.notify('ソースを追加しました', 'success');
      }
      this.cancelEdit();
      await this.loadSources();
    } catch (e) {
      Utils.notify('保存エラー: ' + e.message, 'error');
      // エラー時はボタンを元に戻す（cancelEdit は呼ばない）
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-save"></i> <span id="source-save-text-label">${isEditing ? '更新' : '保存'}</span>`;
      }
    }
  },

  // ── PDF DnD ───────────────────────────────────────────
  _selectedPdfFile: null,

  onDragOver(e) {
    e.preventDefault();
    const dz = document.getElementById('pdf-drop-zone');
    if (dz) { dz.style.borderColor='#f59e0b'; dz.style.background='#fffbeb'; }
  },
  onDragLeave(e) {
    const dz = document.getElementById('pdf-drop-zone');
    if (dz) { dz.style.borderColor='#e5e7eb'; dz.style.background='#fafafa'; }
  },
  onDrop(e) {
    e.preventDefault();
    this.onDragLeave(e);
    const file = e.dataTransfer?.files?.[0];
    if (file) this._setPdfFile(file);
  },
  onPdfSelected(e) {
    const file = e.target.files?.[0];
    if (file) this._setPdfFile(file);
  },
  _setPdfFile(file) {
    if (file.type !== 'application/pdf') { Utils.notify('PDFファイルのみ対応しています', 'error'); return; }
    this._selectedPdfFile = file;
    const info = document.getElementById('pdf-selected-info');
    const name = document.getElementById('pdf-selected-name');
    if (info) info.style.display = 'block';
    if (name) name.textContent = `${file.name}（${(file.size/1024/1024).toFixed(1)}MB）`;
    const dz = document.getElementById('pdf-drop-zone');
    if (dz) { dz.style.borderColor='#f59e0b'; dz.style.background='#fffbeb'; }
  },

  // ── PDFソース保存 ─────────────────────────────────────
  async savePdfSource() {
    if (!this._selectedPdfFile) { Utils.notify('PDFファイルを選択してください', 'error'); return; }

    const title = document.getElementById('source-title-pdf').value.trim();
    const btn   = document.getElementById('source-save-pdf-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 解析中...'; }

    try {
      const result = await API.sukuukun.sources.uploadPdf(this._selectedPdfFile, title);
      Utils.notify(`PDFを保存しました（${result.pages || '?'}ページ・${result.char_count?.toLocaleString() || '?'}文字）`, 'success');
      this._selectedPdfFile = null;
      document.getElementById('source-title-pdf').value = '';
      document.getElementById('pdf-selected-info').style.display = 'none';
      document.getElementById('source-pdf-input').value = '';
      const dz = document.getElementById('pdf-drop-zone');
      if (dz) { dz.style.borderColor='#e5e7eb'; dz.style.background='#fafafa'; }
      await this.loadSources();
    } catch (e) {
      Utils.notify('PDFアップロードエラー: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i> アップロード・保存'; }
    }
  },

  // ── ソース削除 ────────────────────────────────────────
  async deleteSource(id) {
    const s = this.sources.find(x => x.id === id);
    if (!s) return;
    if (!confirm(`「${s.title}」を削除しますか？`)) return;
    try {
      await API.sukuukun.sources.delete(id);
      Utils.notify('削除しました', 'success');
      if (this.editingSourceId === id) this.cancelEdit();
      await this.loadSources();
    } catch (e) {
      Utils.notify('削除エラー: ' + e.message, 'error');
    }
  },

  // ── 採点実行 ──────────────────────────────────────────
  async submitEvaluate() {
    const transcript    = document.getElementById('eval-transcript')?.value.trim() || '';
    const applicantName = document.getElementById('eval-applicant-name')?.value.trim() || '';

    const interviewerSel  = document.getElementById('eval-interviewer');
    const interviewerId   = interviewerSel?.value ? Number(interviewerSel.value) : null;
    const interviewerName = interviewerId
      ? (interviewerSel.options[interviewerSel.selectedIndex]?.dataset?.name || '')
      : '';

    const interviewResult = document.getElementById('eval-interview-result')?.value || '';

    if (transcript.length < 50) {
      Utils.notify('文字起こしテキストが短すぎます（50文字以上）', 'error');
      return;
    }

    const btn = document.getElementById('eval-submit-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 採点中…'; }

    const resultBody = document.getElementById('eval-result-body');
    if (resultBody) {
      resultBody.innerHTML = `
        <div style="text-align:center;color:#6b7280">
          <div style="font-size:36px;margin-bottom:12px;animation:spin 2s linear infinite;display:inline-block">⚙️</div>
          <div style="font-size:14px;font-weight:600;margin-bottom:6px">すくう君が採点中です…</div>
          <div style="font-size:12px;color:#9ca3af">Gemini AIが文字起こしを分析しています</div>
        </div>
        <style>@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}</style>`;
    }

    try {
      const data = await API.sukuukun.evaluate({
        transcript,
        applicantName:   applicantName   || undefined,
        interviewerId:   interviewerId   || undefined,
        interviewerName: interviewerName || undefined,
        interviewResult: interviewResult || undefined,
      });

      if (data.parseError) {
        if (resultBody) resultBody.innerHTML = `<pre style="font-size:11px;padding:12px;white-space:pre-wrap;overflow-x:auto">${Utils.escHtml(data.raw||'')}</pre>`;
        return;
      }
      this._renderEvalResult(data, transcript.length, applicantName, interviewerName, interviewResult);
    } catch (e) {
      if (resultBody) {
        resultBody.innerHTML = `
          <div style="text-align:center;color:#dc2626;padding:24px">
            <i class="fas fa-exclamation-circle" style="font-size:32px;margin-bottom:8px;display:block"></i>
            <div style="font-size:13px;font-weight:600">${Utils.escHtml(e.message)}</div>
          </div>`;
      }
      Utils.notify('採点エラー: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-robot"></i> すくう君に採点してもらう'; }
    }
  },

  _scoreColor(s, max) {
    const p = s/max;
    if (p >= 0.8) return '#16a34a';
    if (p >= 0.6) return '#2563eb';
    if (p >= 0.4) return '#d97706';
    return '#dc2626';
  },

  _renderEvalResult(data, txLen, applicantName, interviewerName, interviewResult) {
    const resultBody = document.getElementById('eval-result-body');
    if (!resultBody) return;

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
      const s   = data.scores?.[c.key] || {};
      const sc  = s.score ?? 0;
      const col = this._scoreColor(sc, 20);
      return `
        <div style="margin-bottom:10px;padding:10px 12px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <div style="font-size:12px;font-weight:600;color:#1f2937;display:flex;align-items:center;gap:5px">
              <i class="fas ${c.icon}" style="color:${col};width:14px;text-align:center"></i>${c.label}
            </div>
            <div style="font-size:16px;font-weight:700;color:${col}">${sc}<span style="font-size:10px;color:#9ca3af;font-weight:400">/20</span></div>
          </div>
          <div style="background:#e5e7eb;border-radius:3px;height:5px;overflow:hidden;margin-bottom:7px">
            <div class="sbar" style="height:100%;width:${Math.round(sc/20*100)}%;background:${col};border-radius:3px;transition:width 0.6s ease"></div>
          </div>
          ${s.good    ? `<div style="font-size:11px;color:#374151;margin-bottom:3px;display:flex;gap:4px"><span style="color:#059669;font-weight:600;flex-shrink:0">👍</span><span>${Utils.escHtml(s.good)}</span></div>` : ''}
          ${s.improve ? `<div style="font-size:11px;color:#374151;display:flex;gap:4px"><span style="color:#d97706;font-weight:600;flex-shrink:0">💡</span><span>${Utils.escHtml(s.improve)}</span></div>` : ''}
        </div>`;
    }).join('');

    const hlHtml = (data.highlights||[]).length
      ? (data.highlights.map(h => `<div style="font-size:11px;padding:6px 10px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:0 5px 5px 0;margin-bottom:5px;line-height:1.55">${Utils.escHtml(h)}</div>`).join(''))
      : '';

    // メタバッジ
    const metaBadges = [
      applicantName   && `<span style="background:#eff6ff;color:#1e40af;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">👤 ${Utils.escHtml(applicantName)}</span>`,
      interviewerName && `<span style="background:#f0fdf4;color:#166534;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">🎙️ ${Utils.escHtml(interviewerName)}</span>`,
      interviewResult && `<span style="background:${interviewResult==='契約'?'#dcfce7':interviewResult==='辞退'?'#fee2e2':'#fef3c7'};color:${interviewResult==='契約'?'#166534':interviewResult==='辞退'?'#991b1b':'#92400e'};font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">📋 ${Utils.escHtml(interviewResult)}</span>`,
    ].filter(Boolean).join(' ');

    resultBody.innerHTML = `
      <div style="width:100%">
        <!-- 総合スコア -->
        <div style="text-align:center;padding:16px;background:${color}18;border-radius:10px;border:2px solid ${color};margin-bottom:14px">
          ${metaBadges ? `<div style="margin-bottom:8px;display:flex;justify-content:center;gap:6px;flex-wrap:wrap">${metaBadges}</div>` : ''}
          <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:2px">総合スコア</div>
          <div style="font-size:52px;font-weight:800;color:${color};line-height:1">${total}</div>
          <div style="font-size:12px;color:#6b7280">/ 100点</div>
          <div style="font-size:10px;color:#9ca3af;margin-top:4px">参照ソース: ${data.sourceCount||0}件 ・ 文字数: ${txLen.toLocaleString()} 文字 ・ ${new Date().toLocaleString('ja-JP')}</div>
        </div>

        <!-- 総合コメント -->
        ${data.summary ? `<div style="margin-bottom:12px;padding:10px 12px;background:#eff6ff;border-radius:8px;border-left:3px solid #3b82f6">
          <div style="font-size:11px;font-weight:600;color:#1e40af;margin-bottom:4px"><i class="fas fa-comment-dots"></i> 総合コメント</div>
          <div style="font-size:12px;color:#1f2937;line-height:1.65">${Utils.escHtml(data.summary)}</div>
        </div>` : ''}

        <!-- 各項目 -->
        <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:6px"><i class="fas fa-list-check" style="color:#f59e0b"></i> 各項目の採点</div>
        ${barsHtml}

        <!-- 注目発言 -->
        ${hlHtml ? `<div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;margin-top:4px"><i class="fas fa-bookmark" style="color:#f59e0b"></i> 注目の発言</div>${hlHtml}` : ''}

        <div style="margin-top:14px;padding-top:12px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end">
          <button onclick="SukuukunPage.loadHistory()" class="btn btn-secondary btn-sm" style="font-size:11px">
            <i class="fas fa-history"></i> 履歴を見る
          </button>
        </div>
      </div>`;

    // スコアバーアニメーション
    setTimeout(() => {
      resultBody.querySelectorAll('.sbar').forEach(b => {
        const w = b.style.width; b.style.width = '0';
        setTimeout(() => { b.style.width = w; }, 60);
      });
    }, 80);
  },

  // ── 履歴読み込み（全件取得してキャッシュ）──────────────
  async loadHistory() {
    const wrap = document.getElementById('history-list-wrap');
    if (wrap) wrap.innerHTML = `<div style="text-align:center;padding:32px;color:#9ca3af"><i class="fas fa-spinner fa-spin"></i></div>`;
    try {
      // 全件取得（担当者フィルタなし）
      this.historyAll = await API.sukuukun.history.list({});
      // タブを再描画してカウント更新
      this._refreshHistoryTabs();
      // 現在タブのデータを描画
      this._renderHistoryTable();
    } catch (e) {
      if (wrap) wrap.innerHTML = `<div style="padding:16px;color:#dc2626;font-size:12px">${Utils.escHtml(e.message)}</div>`;
    }
  },

  // ── 担当者タブ再描画 ──────────────────────────────────
  _refreshHistoryTabs() {
    const container = document.getElementById('history-user-tabs');
    if (!container) return;
    const tabs = [{ id: '__all__', name: '全員' }, ...this.users.map(u => ({ id: String(u.id), name: u.name }))];
    container.innerHTML = tabs.map(t => {
      const active = this.historyActiveUserId === t.id;
      const count = t.id === '__all__'
        ? this.historyAll.length
        : this.historyAll.filter(h => String(h.interviewer_id) === t.id).length;
      return `
        <button onclick="SukuukunPage.switchHistoryTab('${t.id}')"
          style="padding:6px 14px;border-radius:6px;border:none;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all 0.15s;display:flex;align-items:center;gap:5px;
            ${active
              ? 'background:#f59e0b;color:white;box-shadow:0 2px 6px rgba(245,158,11,0.35)'
              : 'background:white;color:#6b7280;border:1px solid #e5e7eb'}">
          <i class="fas ${t.id === '__all__' ? 'fa-users' : 'fa-user'}" style="font-size:11px"></i>
          ${Utils.escHtml(t.name)}
          ${count > 0 ? `<span style="background:${active?'rgba(255,255,255,0.35)':'#f3f4f6'};color:${active?'white':'#6b7280'};border-radius:8px;padding:0 6px;font-size:10px">${count}</span>` : ''}
        </button>`;
    }).join('');
  },

  // ── 担当者タブ切り替え ────────────────────────────────
  switchHistoryTab(userId) {
    this.historyActiveUserId = userId;
    this._refreshHistoryTabs();
    this._renderHistoryTable();
  },

  // ── 履歴テーブル描画（タブのアクティブユーザーでフィルタ）──
  _renderHistoryTable() {
    const wrap = document.getElementById('history-list-wrap');
    if (!wrap) return;

    const list = this.historyActiveUserId === '__all__'
      ? this.historyAll
      : this.historyAll.filter(h => String(h.interviewer_id) === this.historyActiveUserId);

    if (list.length === 0) {
      wrap.innerHTML = `<div style="text-align:center;padding:32px;color:#9ca3af;font-size:13px">採点履歴はありません</div>`;
      return;
    }

    const rows = list.map(h => {
      const sc  = h.total_score ?? '-';
      const col = typeof sc === 'number' ? this._scoreColor(sc, 100) : '#9ca3af';
      const sources = (() => { try { return JSON.parse(h.source_snapshot || '[]'); } catch(e){ return []; } })();

      const resultBadge = h.interview_result
        ? `<span style="font-size:10px;padding:1px 7px;border-radius:10px;font-weight:600;
              background:${h.interview_result==='契約'?'#dcfce7':h.interview_result==='辞退'?'#fee2e2':'#fef3c7'};
              color:${h.interview_result==='契約'?'#166534':h.interview_result==='辞退'?'#991b1b':'#92400e'}">
            ${Utils.escHtml(h.interview_result)}</span>`
        : '<span style="color:#d1d5db;font-size:11px">-</span>';

      // 全員タブのときだけ担当者列を表示
      const interviewerCell = this.historyActiveUserId === '__all__'
        ? `<td style="padding:8px 12px;font-size:11px;color:#374151;font-weight:600">${Utils.escHtml(h.interviewer_name||h.evaluator_name||'')}</td>`
        : '';

      return `<tr style="border-bottom:1px solid #f3f4f6;transition:background 0.1s" onmouseenter="this.style.background='#fffbeb'" onmouseleave="this.style.background=''">
          <td style="padding:8px 12px;font-size:12px;color:#374151">${Utils.escHtml(h.applicant_name || '（氏名なし）')}</td>
          <td style="padding:8px 12px;text-align:center">
            <span style="font-size:16px;font-weight:700;color:${col}">${sc}</span>
            <span style="font-size:10px;color:#9ca3af">/100</span>
          </td>
          ${interviewerCell}
          <td style="padding:8px 12px;text-align:center">${resultBadge}</td>
          <td style="padding:8px 12px;font-size:11px;color:#9ca3af">${h.transcript_length ? h.transcript_length.toLocaleString()+'文字' : '-'}</td>
          <td style="padding:8px 12px;font-size:11px;color:#9ca3af">${sources.map(s=>Utils.escHtml(s.title)).join('、') || '（なし）'}</td>
          <td style="padding:8px 12px;font-size:11px;color:#9ca3af;white-space:nowrap">${new Date(h.created_at).toLocaleString('ja-JP')}</td>
          <td style="padding:8px 12px">
            <button onclick="SukuukunPage.openHistoryDetail(${h.id})"
              style="padding:4px 10px;border-radius:5px;border:1px solid #f59e0b;background:#fffbeb;color:#b45309;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all 0.15s"
              onmouseenter="this.style.background='#f59e0b';this.style.color='white'"
              onmouseleave="this.style.background='#fffbeb';this.style.color='#b45309'">
              <i class="fas fa-chart-bar"></i> 詳細
            </button>
          </td>
        </tr>`;
    }).join('');

    const interviewerHeader = this.historyActiveUserId === '__all__'
      ? `<th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600">面接担当</th>`
      : '';

    wrap.innerHTML = `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600">応募者名</th>
              <th style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7280;font-weight:600">スコア</th>
              ${interviewerHeader}
              <th style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7280;font-weight:600">結果</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600">文字数</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600">参照ソース</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600">採点日時</th>
              <th style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7280;font-weight:600"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },

  // ── 採点詳細モーダルを開く ────────────────────────────
  async openHistoryDetail(id) {
    const modal = document.getElementById('history-detail-modal');
    const body  = document.getElementById('history-detail-body');
    if (!modal || !body) return;
    modal.style.display = 'block';
    body.innerHTML = `<div style="text-align:center;padding:32px;color:#9ca3af"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`;

    try {
      const h = await API.sukuukun.history.get(id);
      const ev = h.result_json || {};
      const total = ev.total_score ?? h.total_score ?? 0;
      const color = this._scoreColor(total, 100);

      const cats = [
        { key:'rapport',        label:'ラポール構築', icon:'fa-handshake' },
        { key:'hearing',        label:'ヒアリング',   icon:'fa-headphones' },
        { key:'value_proposal', label:'価値提案',     icon:'fa-star' },
        { key:'closing',        label:'クロージング', icon:'fa-flag-checkered' },
        { key:'overall_flow',   label:'全体の流れ',   icon:'fa-stream' },
      ];

      const barsHtml = cats.map(c => {
        const s  = ev.scores?.[c.key] || {};
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
              <div style="height:100%;width:${Math.round(sc/20*100)}%;background:${cl};border-radius:3px"></div>
            </div>
            ${s.good    ? `<div style="font-size:11px;color:#374151;margin-bottom:3px;display:flex;gap:4px"><span style="color:#059669;font-weight:600;flex-shrink:0">👍</span><span>${Utils.escHtml(s.good)}</span></div>` : ''}
            ${s.improve ? `<div style="font-size:11px;color:#374151;display:flex;gap:4px"><span style="color:#d97706;font-weight:600;flex-shrink:0">💡</span><span>${Utils.escHtml(s.improve)}</span></div>` : ''}
          </div>`;
      }).join('');

      const hlHtml = (ev.highlights||[]).map(hl =>
        `<div style="font-size:11px;padding:6px 10px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:0 5px 5px 0;margin-bottom:5px;line-height:1.55">${Utils.escHtml(hl)}</div>`
      ).join('');

      // メタバッジ
      const badges = [
        h.applicant_name   && `<span style="background:#eff6ff;color:#1e40af;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">👤 ${Utils.escHtml(h.applicant_name)}</span>`,
        (h.interviewer_name||h.evaluator_name) && `<span style="background:#f0fdf4;color:#166534;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">🎙️ ${Utils.escHtml(h.interviewer_name||h.evaluator_name)}</span>`,
        h.interview_result && `<span style="background:${h.interview_result==='契約'?'#dcfce7':h.interview_result==='辞退'?'#fee2e2':'#fef3c7'};color:${h.interview_result==='契約'?'#166534':h.interview_result==='辞退'?'#991b1b':'#92400e'};font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">📋 ${Utils.escHtml(h.interview_result)}</span>`,
      ].filter(Boolean).join(' ');

      const sources = Array.isArray(h.source_snapshot) ? h.source_snapshot : (() => { try { return JSON.parse(h.source_snapshot||'[]'); } catch(e){ return []; } })();

      body.innerHTML = `
        <!-- 総合スコア -->
        <div style="text-align:center;padding:16px;background:${color}18;border-radius:10px;border:2px solid ${color};margin-bottom:16px">
          ${badges ? `<div style="margin-bottom:8px;display:flex;justify-content:center;gap:6px;flex-wrap:wrap">${badges}</div>` : ''}
          <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:2px">総合スコア</div>
          <div style="font-size:52px;font-weight:800;color:${color};line-height:1">${total}</div>
          <div style="font-size:12px;color:#6b7280">/ 100点</div>
          <div style="font-size:10px;color:#9ca3af;margin-top:4px">
            参照ソース: ${sources.length}件
            ${h.transcript_length ? '・ 文字数: '+h.transcript_length.toLocaleString()+' 文字' : ''}
            ・ ${new Date(h.created_at).toLocaleString('ja-JP')}
          </div>
        </div>

        <!-- 総合コメント -->
        ${ev.summary ? `
        <div style="margin-bottom:14px;padding:10px 12px;background:#eff6ff;border-radius:8px;border-left:3px solid #3b82f6">
          <div style="font-size:11px;font-weight:600;color:#1e40af;margin-bottom:4px"><i class="fas fa-comment-dots"></i> 総合コメント</div>
          <div style="font-size:12px;color:#1f2937;line-height:1.65">${Utils.escHtml(ev.summary)}</div>
        </div>` : ''}

        <!-- 各項目 -->
        <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:8px"><i class="fas fa-list-check" style="color:#f59e0b;margin-right:4px"></i>各項目の採点</div>
        ${barsHtml}

        <!-- 注目発言 -->
        ${hlHtml ? `<div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;margin-top:4px"><i class="fas fa-bookmark" style="color:#f59e0b;margin-right:4px"></i>注目の発言</div>${hlHtml}` : ''}
      `;
    } catch (e) {
      body.innerHTML = `<div style="color:#dc2626;padding:16px;font-size:13px"><i class="fas fa-exclamation-circle"></i> 読み込みエラー: ${Utils.escHtml(e.message)}</div>`;
    }
  },

  // ── 採点詳細モーダルを閉じる ──────────────────────────
  closeHistoryDetail() {
    const modal = document.getElementById('history-detail-modal');
    if (modal) modal.style.display = 'none';
  },

  // ── 履歴フィルタ（後方互換のため残す）───────────────────
  filterHistory(interviewerId) {
    this.historyFilterInterviewerId = interviewerId || '';
    this.loadHistory();
  }
};
