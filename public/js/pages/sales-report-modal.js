// Sales Report Modal
const SalesReportModal = {
  applicant: null,
  salesUsers: [],
  editingReport: null,

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

  async open(applicant, existingReport = null) {
    this.applicant = applicant;
    this.editingReport = existingReport;

    try {
      this.salesUsers = await API.users.sales();
    } catch (e) {
      this.salesUsers = [];
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
              ${this.editingReport ? '営業報告編集' : '営業報告入力'}
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

          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="sr-cancel">キャンセル</button>
          <button class="btn btn-primary" id="sr-save">
            <i class="fas fa-save"></i> ${this.editingReport ? '更新' : '保存'}
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
    };

    try {
      if (this.editingReport) {
        await API.salesReports.update(this.editingReport.id, payload);
        Utils.notify('営業報告を更新しました', 'success');
      } else {
        await API.salesReports.create(payload);
        Utils.notify('営業報告を保存しました', 'success');
      }
      this.close();

      if (typeof ApplicantsPage !== 'undefined') {
        await ApplicantsPage.loadReports();
      }
    } catch (err) {
      const isDuplicate = err.status === 409 || (err.message && err.message.includes('すでに登録'));
      errorEl.style.display = 'flex';
      errorEl.className = 'alert alert-error';
      if (isDuplicate) {
        // 重複エラー: 既存報告を開くリンクを表示
        const existingId = err.data?.existingId || null;
        const editLink = existingId
          ? `<br><a href="#" id="sr-open-existing" style="color:inherit;text-decoration:underline;font-weight:600">既存の営業報告を開いて編集する →</a>`
          : '';
        errorEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i><span>${err.message}${editLink}</span>`;
        if (existingId) {
          document.getElementById('sr-open-existing')?.addEventListener('click', async (e) => {
            e.preventDefault();
            this.close();
            try {
              const report = await API.salesReports.get(existingId);
              SalesReportModal.open(null, report);
            } catch (_) { Utils.notify('報告の取得に失敗しました', 'error'); }
          });
        }
      } else {
        errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i><span>${err.message}</span>`;
      }
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i class="fas fa-save"></i> ${this.editingReport ? '更新' : '保存'}`;
    }
  }
};
