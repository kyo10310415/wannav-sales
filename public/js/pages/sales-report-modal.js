// Sales Report Modal
const SalesReportModal = {
  applicant: null,
  salesUsers: [],
  editingReport: null,

  async open(applicant, existingReport = null) {
    this.applicant = applicant;
    this.editingReport = existingReport;

    // Load sales users
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
        <div class="modal-body" style="max-height:70vh;overflow-y:auto">
          <div id="sr-error" style="display:none"></div>
          <form id="sr-form">

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
                <input type="text" id="sr-fullname" class="form-control" value="${Utils.escHtml(r.applicant_full_name || fullName)}" placeholder="姓 名" required>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">学籍番号</label>
                <input type="text" id="sr-student-num" class="form-control" value="${Utils.escHtml(r.student_number || '')}" placeholder="学籍番号を入力">
              </div>
              <div class="form-group">
                <label class="form-label">面接時間</label>
                <input type="text" id="sr-interview-time" class="form-control" value="${Utils.escHtml(r.interview_time || '')}" placeholder="例: 60分">
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">結果</label>
              <input type="text" id="sr-result" class="form-control" value="${Utils.escHtml(r.result || '')}" placeholder="例: 契約、検討中、お断り">
            </div>

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
                <input type="text" id="sr-payment" class="form-control" value="${Utils.escHtml(r.payment_method || '')}" placeholder="例: クレジットカード">
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">NotionURL</label>
              <input type="text" id="sr-notion" class="form-control" value="${Utils.escHtml(r.notion_url || '')}" placeholder="https://...">
            </div>

            <div class="form-group">
              <label class="form-label">レッスン開始日</label>
              <input type="date" id="sr-lesson-start" class="form-control" value="${r.lesson_start_date || ''}">
            </div>

            <div class="form-group">
              <label class="form-label">キャラクターの権利</label>
              <input type="text" id="sr-char-rights" class="form-control" value="${Utils.escHtml(r.character_rights || '')}" placeholder="権利情報を入力">
            </div>

            <div class="form-group">
              <label class="form-label">詳細内容</label>
              <textarea id="sr-details" class="form-control" rows="4" placeholder="詳細を入力...">${Utils.escHtml(r.details || '')}</textarea>
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

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });
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

    const payload = {
      interviewer_id: parseInt(interviewerId),
      interviewer_name: interviewerName,
      applicant_full_name: fullName,
      applicant_last_name: this.applicant?.last_name || '',
      applicant_first_name: this.applicant?.first_name || '',
      applicant_email: this.applicant?.email || '',
      student_number: document.getElementById('sr-student-num').value.trim(),
      interview_time: document.getElementById('sr-interview-time').value.trim(),
      result: document.getElementById('sr-result').value.trim(),
      contract_plan: document.getElementById('sr-plan').value,
      payment_method: document.getElementById('sr-payment').value.trim(),
      notion_url: document.getElementById('sr-notion').value.trim(),
      lesson_start_date: document.getElementById('sr-lesson-start').value,
      character_rights: document.getElementById('sr-char-rights').value.trim(),
      details: document.getElementById('sr-details').value.trim(),
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

      // Refresh applicants page reports indicator
      if (typeof ApplicantsPage !== 'undefined') {
        await ApplicantsPage.loadReports();
      }
    } catch (err) {
      errorEl.style.display = 'flex';
      errorEl.className = 'alert alert-error';
      errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i><span>${err.message}</span>`;
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i class="fas fa-save"></i> ${this.editingReport ? '更新' : '保存'}`;
    }
  }
};
