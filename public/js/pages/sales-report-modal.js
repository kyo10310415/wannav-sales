// Sales Report Modal
const SalesReportModal = {
  applicant: null,
  salesUsers: [],
  editingReport: null,
  editMode: 'overwrite', // 'overwrite'=内容編集（上書き）, 'append'=追記・新規報告

  // ── 選択肢定数 ──────────────────────────────────────────────
  INTERVIEW_CONTENT_OPTIONS: [
    '面接（2時間）','面接（1時間）','一次面接（30分）','二次面接（2時間）','二次面接（1時間）',
    'スクールの話','契約書読み合わせ','体験レッスン','WannaV面談（2時間）',
    '無職転生（1時間）','辞退者復活施策','Live2D企画（2時間）','転職面談',
    'クーリングオフ面談','無理筋いきなり面接（2時間）','EP専用面接（2時間）'
  ],
  RESULT_OPTIONS: [
    '契約','辞退','不合格','飛び','持ち帰り','一次面接','別日にスクールの話',
    '契約＆職業案内','持ち帰りから契約','職業案内','リスケ','二次面接辞退',
    'スクールの話を辞退','体験レッスン','契約＆職業案内（CP）','提携先へ案内',
    'クーリングオフ','クーリングオフ阻止'
  ],
  STAY_COUNT_OPTIONS: ['0','1','2','3','4','5'],
  NO_COUNT_OPTIONS:   ['0','1','2','3','4','5'],
  PAYMENT_OPTIONS:    ['銀行振込','教育ローン','クレジットカード'],
  CHARACTER_RIGHTS_OPTIONS: ['WannaVのキャラクター','キャラクター持ち込み','あとで決める'],
  JOIN_REASON_OPTIONS: [
    '面接担当者','体験レッスン担当者','カリキュラム','キャラクター無料貸し出し',
    'キャラクターイラスト50枚提供','Live2Dモデリング無料','月2回のマンツーマンレッスン',
    'オンライン','料金','入会費無料','実績'
  ],
  DECLINE_REASON_OPTIONS: [
    '費用が負担に感じたため','自分でやると決めたため','家族や周囲の理解が得られないため',
    '時間や生活との両立が難しいため','サービスや運営に対する信頼が持てなかったため',
    '説明と実際の内容にギャップを感じたため','将来の進路に迷いが生じたため',
    '十分な情報・実績が確認できなかったため','その他'
  ],

  // ── ヘルパー：セレクトHTML生成 ──────────────────────────────
  _select(id, options, current, placeholder = '選択してください') {
    const opts = options.map(o =>
      `<option value="${Utils.escHtml(o)}" ${current === o ? 'selected' : ''}>${Utils.escHtml(o)}</option>`
    ).join('');
    return `<select id="${id}" class="form-control">
      <option value="">${placeholder}</option>
      ${opts}
    </select>`;
  },

  // ── ヘルパー：複数選択チェックボックスHTML生成 ────────────────
  _checkboxGroup(name, options, currentCSV) {
    const selected = (currentCSV || '').split(',').map(s => s.trim()).filter(Boolean);
    return `<div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:4px">
      ${options.map(o => `
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;font-weight:400">
          <input type="checkbox" name="${name}" value="${Utils.escHtml(o)}"
            ${selected.includes(o) ? 'checked' : ''}
            style="width:14px;height:14px;accent-color:var(--primary)">
          ${Utils.escHtml(o)}
        </label>`).join('')}
    </div>`;
  },

  async open(applicant, existingReport = null, sheetType = 'as') {
    this.applicant = applicant;
    this.editingReport = existingReport;
    this.sheetType = sheetType;  // 'as' | 'gh'
    this.editMode = 'overwrite'; // 編集時はデフォルト「上書き」

    try {
      this.salesUsers = await API.users.sales();
    } catch (e) {
      this.salesUsers = []
    }

    this.renderModal();
    document.getElementById('sr-modal-overlay').style.display = 'flex';
    document.getElementById('sr-interviewer').focus();
  },

  close() {
    const overlay = document.getElementById('sr-modal-overlay');
    if (overlay) overlay.remove();
  },

  renderModal() {
    const existingOverlay = document.getElementById('sr-modal-overlay');
    if (existingOverlay) existingOverlay.remove();

    const r = this.editingReport || {};
    const applicant = this.applicant;
    const fullName = applicant
      ? `${applicant.last_name || ''} ${applicant.first_name || ''}`.trim()
      : (r.applicant_full_name || '');

    const overlay = document.createElement('div');
    overlay.id = 'sr-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';

    overlay.innerHTML = `
      <div class="modal" style="max-width:700px">
        <div class="modal-header">
          <div>
            <div class="modal-title">
              <i class="fas fa-clipboard-list" style="color:var(--primary);margin-right:8px"></i>
              ${this.editingReport ? '営業報告を編集' : '営業報告入力'}
            </div>
            <div style="font-size:12px;color:var(--gray-500);margin-top:2px">
              対象: ${Utils.escHtml(fullName)}
              ${applicant?.email ? `(${Utils.escHtml(applicant.email)})` : ''}
            </div>
          </div>
          <button class="modal-close" id="sr-close"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body" style="max-height:75vh;overflow-y:auto">
          <div id="sr-error" style="display:none"></div>

          ${this.editingReport ? `
          <!-- 編集モード選択 -->
          <div style="margin:0 0 14px;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span style="font-size:12px;font-weight:600;color:#374151;white-space:nowrap">編集モード：</span>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;padding:6px 12px;border-radius:6px;border:2px solid transparent;background:white;transition:all 0.15s" id="sr-mode-overwrite-label">
              <input type="radio" name="sr-edit-mode" value="overwrite" checked
                style="accent-color:var(--primary);width:15px;height:15px"
                onchange="SalesReportModal._setEditMode('overwrite')">
              <span><i class="fas fa-pen" style="margin-right:4px;color:#2563eb"></i><strong>内容を修正</strong></span>
              <span style="font-size:11px;color:#6b7280">（この報告を上書き）</span>
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;padding:6px 12px;border-radius:6px;border:2px solid transparent;background:white;transition:all 0.15s" id="sr-mode-append-label">
              <input type="radio" name="sr-edit-mode" value="append"
                style="accent-color:var(--primary);width:15px;height:15px"
                onchange="SalesReportModal._setEditMode('append')">
              <span><i class="fas fa-plus-circle" style="margin-right:4px;color:#059669"></i><strong>追記・新規報告</strong></span>
              <span style="font-size:11px;color:#6b7280">（新しい報告として追加）</span>
            </label>
          </div>` : ''}

          <form id="sr-form">

            <!-- ① 面接担当者 / 氏名 -->
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">面接担当者 <span class="required">*</span></label>
                <select id="sr-interviewer" class="form-control">
                  <option value="">選択してください</option>
                  ${this.salesUsers.map(u =>
                    `<option value="${u.id}" ${r.interviewer_id == u.id ? 'selected' : ''}>${Utils.escHtml(u.name)}</option>`
                  ).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">氏名（フルネーム）<span class="required">*</span></label>
                <input type="text" id="sr-fullname" class="form-control"
                  value="${Utils.escHtml(r.applicant_full_name || fullName)}" placeholder="姓 名" required>
              </div>
            </div>

            <!-- ② 学籍番号 / 面接日 -->
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">学籍番号</label>
                <input type="text" id="sr-student-num" class="form-control"
                  value="${Utils.escHtml(r.student_number || '')}" placeholder="学籍番号を入力">
              </div>
              <div class="form-group">
                <label class="form-label"><i class="fas fa-calendar-alt" style="color:#7c3aed;margin-right:4px"></i>面接日</label>
                <input type="date" id="sr-interview-date" class="form-control" value="${r.interview_date || ''}">
              </div>
            </div>

            <!-- ③ 面接内容 -->
            <div class="form-group">
              <label class="form-label">面接内容</label>
              ${this._select('sr-interview-content', this.INTERVIEW_CONTENT_OPTIONS, r.interview_content || '')}
            </div>

            <!-- ④ 結果 -->
            <div class="form-group">
              <label class="form-label">結果</label>
              ${this._select('sr-result', this.RESULT_OPTIONS, r.result || '')}
            </div>

            <!-- ⑤ STAYの回数 / NOの回数 -->
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">STAYの回数</label>
                ${this._select('sr-stay-count', this.STAY_COUNT_OPTIONS, String(r.stay_count ?? ''))}
              </div>
              <div class="form-group">
                <label class="form-label">NOの回数</label>
                ${this._select('sr-no-count', this.NO_COUNT_OPTIONS, String(r.no_count ?? ''))}
              </div>
            </div>

            <!-- ⑥ 契約したプラン名 / お支払い方法 -->
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">契約したプラン名</label>
                <select id="sr-plan" class="form-control">
                  <option value="">選択してください</option>
                  ${['スタンダードプラン','プレミアプラン','生徒プラン','EP'].map(p =>
                    `<option value="${p}" ${r.contract_plan === p ? 'selected' : ''}>${p}</option>`
                  ).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">お支払い方法</label>
                ${this._select('sr-payment', this.PAYMENT_OPTIONS, r.payment_method || '')}
              </div>
            </div>

            <!-- ⑦ キャラクターの権利 -->
            <div class="form-group">
              <label class="form-label">キャラクターの権利</label>
              ${this._select('sr-char-rights', this.CHARACTER_RIGHTS_OPTIONS, r.character_rights || '')}
            </div>

            <!-- ⑧ 入会した理由（複数回答OK） -->
            <div class="form-group">
              <label class="form-label">入会した理由
                <span style="font-size:10px;font-weight:400;color:var(--gray-500);margin-left:6px">複数回答OK</span>
              </label>
              ${this._checkboxGroup('sr-join-reasons', this.JOIN_REASON_OPTIONS, r.join_reasons || '')}
            </div>

            <!-- ⑨ 辞退理由（複数回答OK） -->
            <div class="form-group">
              <label class="form-label">辞退理由
                <span style="font-size:10px;font-weight:400;color:var(--gray-500);margin-left:6px">複数回答OK</span>
              </label>
              ${this._checkboxGroup('sr-decline-reasons', this.DECLINE_REASON_OPTIONS, r.decline_reasons || '')}
            </div>

            <!-- ⑩ 電話番号 -->
            <div class="form-group">
              <label class="form-label">電話番号
                <span style="font-size:10px;font-weight:400;color:var(--gray-500);margin-left:6px">契約以外の場合は未記入でOK</span>
              </label>
              <input type="tel" id="sr-phone" class="form-control"
                value="${Utils.escHtml(r.phone_number || '')}" placeholder="例: 090-1234-5678">
            </div>

            <!-- ⑪ NotionURL -->
            <div class="form-group">
              <label class="form-label">NotionURL</label>
              <input type="text" id="sr-notion" class="form-control"
                value="${Utils.escHtml(r.notion_url || '')}" placeholder="https://...">
            </div>

            <!-- ⑫ レッスン開始日 -->
            <div class="form-group">
              <label class="form-label">レッスン開始日</label>
              <input type="date" id="sr-lesson-start" class="form-control" value="${r.lesson_start_date || ''}">
            </div>

            <!-- ⑬ 詳細内容 -->
            <div class="form-group">
              <label class="form-label">詳細内容</label>
              <textarea id="sr-details" class="form-control" rows="4"
                placeholder="詳細を入力...">${Utils.escHtml(r.details || '')}</textarea>
            </div>

            <!-- ⑭ EP提案あり -->
            <div class="form-group">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none">
                <input type="checkbox" id="sr-ep-proposal"
                  ${r.ep_proposal ? 'checked' : ''}
                  style="width:16px;height:16px;accent-color:var(--primary);cursor:pointer">
                <span class="form-label" style="margin:0">EP提案あり</span>
              </label>
            </div>

          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="sr-cancel">キャンセル</button>
          <button class="btn btn-primary" id="sr-save">
            <i class="fas fa-${this.editingReport ? 'pen' : 'save'}"></i>
            <span id="sr-save-label">${this.editingReport ? '上書き保存' : '保存'}</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('sr-close').addEventListener('click', () => this.close());
    document.getElementById('sr-cancel').addEventListener('click', () => this.close());
    document.getElementById('sr-save').addEventListener('click', () => this.save());

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    // 初期モード表示を適用
    if (this.editingReport) this._applyEditModeStyle();
  },

  _setEditMode(mode) {
    this.editMode = mode;
    this._applyEditModeStyle();
  },

  _applyEditModeStyle() {
    const isOverwrite = this.editMode === 'overwrite';
    const overwriteLabel = document.getElementById('sr-mode-overwrite-label');
    const appendLabel    = document.getElementById('sr-mode-append-label');
    const saveLabel      = document.getElementById('sr-save-label');
    const saveBtn        = document.getElementById('sr-save');
    if (overwriteLabel) {
      overwriteLabel.style.borderColor = isOverwrite ? '#2563eb' : 'transparent';
      overwriteLabel.style.background  = isOverwrite ? '#eff6ff' : 'white';
    }
    if (appendLabel) {
      appendLabel.style.borderColor = !isOverwrite ? '#059669' : 'transparent';
      appendLabel.style.background  = !isOverwrite ? '#f0fdf4' : 'white';
    }
    if (saveLabel) {
      saveLabel.textContent = isOverwrite ? '上書き保存' : '追記保存';
    }
    if (saveBtn) {
      const icon = saveBtn.querySelector('i');
      if (icon) {
        icon.className = isOverwrite ? 'fas fa-pen' : 'fas fa-plus-circle';
      }
      saveBtn.style.background   = isOverwrite ? '' : '#059669';
      saveBtn.style.borderColor  = isOverwrite ? '' : '#059669';
    }
  },

  // ── チェックボックスの選択値をCSV文字列で取得 ─────────────────
  _getChecked(name) {
    return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`))
      .map(el => el.value)
      .join(',');
  },

  async save() {
    const errorEl = document.getElementById('sr-error');
    const saveBtn = document.getElementById('sr-save');
    errorEl.style.display = 'none';

    const interviewerSelect = document.getElementById('sr-interviewer');
    const interviewerId = interviewerSelect.value;
    const interviewerName = interviewerSelect.options[interviewerSelect.selectedIndex]?.text || '';
    const fullName = document.getElementById('sr-fullname').value.trim();

    if (!interviewerId || !fullName) {
      errorEl.style.display = 'flex';
      errorEl.className = 'alert alert-error';
      errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i><span>面接担当者と氏名は必須です</span>`;
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...';

    const stayVal = document.getElementById('sr-stay-count').value;
    const noVal   = document.getElementById('sr-no-count').value;

    const payload = {
      interviewer_id:    parseInt(interviewerId),
      interviewer_name:  interviewerName,
      applicant_full_name:  fullName,
      applicant_last_name:  this.applicant?.last_name  || '',
      applicant_first_name: this.applicant?.first_name || '',
      applicant_email:      this.applicant?.email      || '',
      student_number:    document.getElementById('sr-student-num').value.trim(),
      interview_date:    document.getElementById('sr-interview-date').value || null,
      interview_content: document.getElementById('sr-interview-content').value,
      result:            document.getElementById('sr-result').value,
      stay_count:        stayVal !== '' ? parseInt(stayVal) : 0,
      no_count:          noVal   !== '' ? parseInt(noVal)   : 0,
      contract_plan:     document.getElementById('sr-plan').value,
      payment_method:    document.getElementById('sr-payment').value,
      notion_url:        document.getElementById('sr-notion').value.trim(),
      lesson_start_date: document.getElementById('sr-lesson-start').value || null,
      character_rights:  document.getElementById('sr-char-rights').value,
      join_reasons:      this._getChecked('sr-join-reasons'),
      decline_reasons:   this._getChecked('sr-decline-reasons'),
      phone_number:      document.getElementById('sr-phone').value.trim(),
      details:           document.getElementById('sr-details').value.trim(),
      ep_proposal:       document.getElementById('sr-ep-proposal').checked ? 1 : 0,
      sheet_type:        this.sheetType || 'as',
    };

    try {
      if (this.editingReport) {
        if (this.editMode === 'overwrite') {
          await API.salesReports.overwrite(this.editingReport.id, payload);
          Utils.notify('営業報告を修正しました', 'success');
        } else {
          await API.salesReports.update(this.editingReport.id, payload);
          Utils.notify('営業報告を追記しました', 'success');
        }
      } else {
        await API.salesReports.create(payload);
        Utils.notify('営業報告を保存しました', 'success');
      }
      this.close();

      if (typeof ApplicantsPage !== 'undefined') {
        await ApplicantsPage.loadReports();
      }
    } catch (err) {
      errorEl.style.display = 'flex';
      errorEl.className = 'alert alert-error';
      errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i><span>${err.message}</span>`;
      saveBtn.disabled = false;
      const isOverwrite = this.editMode === 'overwrite';
      saveBtn.innerHTML = this.editingReport
        ? `<i class="fas fa-${isOverwrite ? 'pen' : 'plus-circle'}"></i> ${isOverwrite ? '上書き保存' : '追記保存'}`
        : `<i class="fas fa-save"></i> 保存`;
    }
  }
};
