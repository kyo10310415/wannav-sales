// Users Management Page
const UsersPage = {
  users: [],
  editingUser: null,

  render() {
    return `
      <div class="page-header">
        <div>
          <div class="page-title"><i class="fas fa-users" style="margin-right:8px;color:var(--primary)"></i>ユーザー管理</div>
          <div class="page-subtitle">システムユーザーの管理</div>
        </div>
        <button class="btn btn-primary" id="add-user-btn">
          <i class="fas fa-plus"></i> ユーザー追加
        </button>
      </div>
      <div class="page-body">
        <div class="card" style="margin-bottom:16px">
          <div class="card-body" style="padding:12px 16px">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--gray-700)">
                  <i class="fas fa-calendar-check" style="color:#7c3aed;margin-right:6px"></i>Googleカレンダー同期
                </div>
                <div style="font-size:11px;color:var(--gray-500);margin-top:2px">
                  各ユーザーが自分のGoogleアカウントを連携すると、「面接予約」イベントから面接日を自動取得できます
                </div>
              </div>
              <button class="btn btn-sm" id="calendar-sync-btn"
                style="margin-left:auto;background:#7c3aed;border-color:#7c3aed;color:white;white-space:nowrap">
                <i class="fas fa-sync-alt"></i> カレンダーを同期
              </button>
            </div>
            <div id="calendar-sync-result" style="display:none;margin-top:10px"></div>
          </div>
        </div>

        <!-- 自分のGoogle連携カード -->
        <div class="card" style="margin-bottom:16px" id="my-google-card">
          <div class="card-body" style="padding:12px 16px">
            <div style="font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:8px">
              <i class="fab fa-google" style="color:#4285f4;margin-right:6px"></i>自分のGoogleアカウント連携
            </div>
            <div id="my-google-status">
              <div class="loading-spinner" style="justify-content:flex-start"><div class="spinner"></div><span>確認中...</span></div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-body" style="padding:0">
            <div class="table-container" id="users-table-wrap">
              <div class="loading-spinner"><div class="spinner"></div><span>読み込み中...</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- User Modal -->
      <div id="user-modal" style="display:none">
        <div class="modal-overlay">
          <div class="modal" style="max-width:500px">
            <div class="modal-header">
              <div class="modal-title" id="user-modal-title">ユーザー追加</div>
              <button class="modal-close" id="user-modal-close"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
              <div id="user-modal-error" style="display:none"></div>
              <form id="user-form">
                <div class="form-group">
                  <label class="form-label">ログインID <span class="required">*</span></label>
                  <input type="text" id="user-login-id" class="form-control" placeholder="半角英数字" required>
                </div>
                <div class="form-group">
                  <label class="form-label">名前 <span class="required">*</span></label>
                  <input type="text" id="user-name" class="form-control" placeholder="氏名" required>
                </div>
                <div class="form-group">
                  <label class="form-label">権限 <span class="required">*</span></label>
                  <select id="user-role" class="form-control">
                    <option value="sales">セールス</option>
                    <option value="admin">管理者</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">
                    <i class="fas fa-calendar-alt" style="color:#7c3aed;margin-right:4px"></i>
                    GoogleカレンダーID
                    <span style="font-size:10px;color:var(--gray-400);font-weight:400;margin-left:4px">（任意）</span>
                  </label>
                  <input type="text" id="user-calendar-id" class="form-control"
                    placeholder="例: user@example.com または xxxx@group.calendar.google.com">
                  <div style="font-size:11px;color:var(--gray-400);margin-top:4px">
                    取得対象のカレンダーID。通常はGmailアドレスと同じです。
                  </div>
                </div>
                <div id="user-pass-info" class="alert alert-info" style="display:none">
                  <i class="fas fa-info-circle"></i>
                  <span>初期パスワードは <strong>1111</strong> に設定されます（初回ログイン時に変更必須）</span>
                </div>
              </form>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" id="user-modal-cancel">キャンセル</button>
              <button class="btn btn-primary" id="user-modal-save"><i class="fas fa-save"></i> 保存</button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  async mount() {
    document.getElementById('add-user-btn').addEventListener('click', () => this.openModal());
    document.getElementById('user-modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('user-modal-cancel').addEventListener('click', () => this.closeModal());
    document.getElementById('user-modal-save').addEventListener('click', () => this.saveUser());
    document.getElementById('calendar-sync-btn').addEventListener('click', () => this.runCalendarSync());

    // Google連携状態を確認
    this.loadMyGoogleStatus();
    await this.loadUsers();
  },

  // ============================================================
  // 自分のGoogle連携状態表示
  // ============================================================
  async loadMyGoogleStatus() {
    const el = document.getElementById('my-google-status');
    if (!el) return;
    try {
      const status = await API.calendar.status();
      if (status.linked) {
        el.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;
              border-radius:6px;padding:5px 10px;font-size:12px;font-weight:600">
              <i class="fas fa-check-circle"></i> 連携済み: ${Utils.escHtml(status.email)}
            </span>
            <button class="btn btn-secondary btn-sm" id="google-unlink-btn">
              <i class="fas fa-unlink"></i> 連携解除
            </button>
          </div>`;
        document.getElementById('google-unlink-btn')?.addEventListener('click', () => this.unlinkGoogle());
      } else {
        el.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:12px;color:var(--gray-500)">未連携</span>
            <button class="btn btn-sm" id="google-link-btn"
              style="background:#4285f4;border-color:#4285f4;color:white">
              <i class="fab fa-google"></i> Googleアカウントを連携する
            </button>
          </div>`;
        document.getElementById('google-link-btn')?.addEventListener('click', () => this.linkGoogle());
      }
    } catch (e) {
      el.innerHTML = `<span style="font-size:12px;color:var(--gray-400)">状態を取得できませんでした</span>`;
    }
  },

  // Google OAuth 連携開始（ポップアップ）
  async linkGoogle() {
    const btn = document.getElementById('google-link-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 処理中...'; }

    try {
      const { url } = await API.calendar.authUrl();
      const popup = window.open(url, 'google_auth',
        'width=600,height=700,scrollbars=yes,resizable=yes');

      // ポップアップからのメッセージを待機
      const handler = async (event) => {
        if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
          window.removeEventListener('message', handler);
          Utils.notify(`Googleアカウントを連携しました（${event.data.email}）`, 'success');
          await this.loadMyGoogleStatus();
          await this.loadUsers();
        } else if (event.data?.type === 'GOOGLE_AUTH_ERROR') {
          window.removeEventListener('message', handler);
          Utils.notify('連携に失敗しました: ' + event.data.error, 'error');
          await this.loadMyGoogleStatus();
        }
      };
      window.addEventListener('message', handler);

      // ポップアップが閉じられたら状態を更新
      const timer = setInterval(async () => {
        if (popup.closed) {
          clearInterval(timer);
          window.removeEventListener('message', handler);
          await this.loadMyGoogleStatus();
        }
      }, 1000);

    } catch (err) {
      Utils.notify('認証URLの取得に失敗しました: ' + err.message, 'error');
      await this.loadMyGoogleStatus();
    }
  },

  // Google連携解除
  async unlinkGoogle() {
    if (!confirm('Googleアカウントの連携を解除しますか？')) return;
    try {
      await API.calendar.revokeToken();
      Utils.notify('Googleアカウントの連携を解除しました', 'success');
      await this.loadMyGoogleStatus();
      await this.loadUsers();
    } catch (err) {
      Utils.notify('解除に失敗しました: ' + err.message, 'error');
    }
  },

  // ============================================================
  // ユーザー一覧ロード
  // ============================================================
  async loadUsers() {
    const wrap = document.getElementById('users-table-wrap');
    try {
      this.users = await API.users.list();
      this.renderTable();
    } catch (err) {
      wrap.innerHTML = `<div class="alert alert-error" style="margin:20px">
        <i class="fas fa-exclamation-circle"></i><span>${err.message}</span></div>`;
    }
  },

  renderTable() {
    const wrap = document.getElementById('users-table-wrap');
    if (!this.users.length) {
      wrap.innerHTML = `<div class="empty-state"><i class="fas fa-users"></i>
        <h3>ユーザーがいません</h3><p>「ユーザー追加」ボタンから追加してください</p></div>`;
      return;
    }

    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>ログインID</th>
            <th>名前</th>
            <th>権限</th>
            <th style="min-width:130px">カレンダーID</th>
            <th style="min-width:120px">Google連携</th>
            <th>ステータス</th>
            <th>登録日</th>
            <th style="text-align:right">操作</th>
          </tr>
        </thead>
        <tbody>
          ${this.users.map(u => `
            <tr>
              <td><span class="tag">#${u.id}</span></td>
              <td><code style="font-size:12px;background:var(--gray-100);padding:2px 6px;border-radius:4px">
                ${Utils.escHtml(u.login_id)}</code></td>
              <td><strong>${Utils.escHtml(u.name)}</strong></td>
              <td>${Utils.roleBadge(u.role)}</td>
              <td style="font-size:11px;color:var(--gray-500);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${u.calendar_id
                  ? `<span title="${Utils.escHtml(u.calendar_id)}">
                      <i class="fas fa-calendar-alt" style="color:#7c3aed;margin-right:3px"></i>
                      ${Utils.escHtml(u.calendar_id)}</span>`
                  : '<span style="color:var(--gray-300)">未設定</span>'}
              </td>
              <td style="font-size:11px">
                ${u.google_email
                  ? `<span style="background:#f0fdf4;color:#166534;border-radius:4px;padding:2px 7px;white-space:nowrap">
                      <i class="fas fa-check-circle"></i> ${Utils.escHtml(u.google_email)}</span>`
                  : '<span style="color:var(--gray-300)">未連携</span>'}
              </td>
              <td>
                ${u.must_change_password
                  ? '<span class="badge" style="background:#fef3c7;color:#92400e"><i class="fas fa-exclamation-triangle" style="margin-right:3px"></i>PW変更待ち</span>'
                  : '<span class="badge" style="background:#dcfce7;color:#166534"><i class="fas fa-check" style="margin-right:3px"></i>正常</span>'}
              </td>
              <td style="color:var(--gray-500)">${Utils.formatDate(u.created_at)}</td>
              <td>
                <div style="display:flex;gap:6px;justify-content:flex-end">
                  <button class="btn btn-secondary btn-sm" onclick="UsersPage.openModal(${u.id})">
                    <i class="fas fa-edit"></i> 編集
                  </button>
                  <button class="btn btn-warning btn-sm" onclick="UsersPage.resetPassword(${u.id}, '${Utils.escHtml(u.name)}')">
                    <i class="fas fa-key"></i> PW
                  </button>
                  ${u.id !== Auth.user.id ? `
                  <button class="btn btn-danger btn-sm" onclick="UsersPage.deleteUser(${u.id}, '${Utils.escHtml(u.name)}')">
                    <i class="fas fa-trash"></i>
                  </button>` : ''}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  openModal(userId = null) {
    this.editingUser = userId ? this.users.find(u => u.id === userId) : null;
    const modal   = document.getElementById('user-modal');
    const title   = document.getElementById('user-modal-title');
    const passInfo = document.getElementById('user-pass-info');
    const errorEl = document.getElementById('user-modal-error');

    errorEl.style.display = 'none';
    title.textContent = this.editingUser ? 'ユーザー編集' : 'ユーザー追加';
    passInfo.style.display = this.editingUser ? 'none' : 'flex';

    document.getElementById('user-login-id').value   = this.editingUser?.login_id   || '';
    document.getElementById('user-name').value       = this.editingUser?.name       || '';
    document.getElementById('user-role').value       = this.editingUser?.role       || 'sales';
    document.getElementById('user-calendar-id').value= this.editingUser?.calendar_id|| '';

    modal.style.display = 'block';
    document.getElementById('user-login-id').focus();
  },

  closeModal() {
    document.getElementById('user-modal').style.display = 'none';
    this.editingUser = null;
  },

  async saveUser() {
    const errorEl = document.getElementById('user-modal-error');
    const saveBtn = document.getElementById('user-modal-save');
    errorEl.style.display = 'none';

    const login_id    = document.getElementById('user-login-id').value.trim();
    const name        = document.getElementById('user-name').value.trim();
    const role        = document.getElementById('user-role').value;
    const calendar_id = document.getElementById('user-calendar-id').value.trim();

    if (!login_id || !name) {
      errorEl.style.display = 'flex';
      errorEl.className = 'alert alert-error';
      errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i><span>IDと名前は必須です</span>`;
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...';

    try {
      if (this.editingUser) {
        await API.users.update(this.editingUser.id, { login_id, name, role, calendar_id: calendar_id || null });
        Utils.notify('ユーザー情報を更新しました', 'success');
      } else {
        await API.users.create({ login_id, name, role, calendar_id: calendar_id || null });
        Utils.notify('ユーザーを追加しました', 'success');
      }
      this.closeModal();
      await this.loadUsers();
    } catch (err) {
      errorEl.style.display = 'flex';
      errorEl.className = 'alert alert-error';
      errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i><span>${err.message}</span>`;
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save"></i> 保存';
    }
  },

  async resetPassword(userId, name) {
    if (!confirm(`「${name}」のパスワードを初期値（1111）にリセットしますか？`)) return;
    try {
      await API.users.resetPassword(userId);
      Utils.notify(`${name} のパスワードをリセットしました`, 'success');
      await this.loadUsers();
    } catch (err) {
      Utils.notify(err.message, 'error');
    }
  },

  async deleteUser(userId, name) {
    if (!confirm(`「${name}」を削除しますか？\nこの操作は取り消せません。`)) return;
    try {
      await API.users.delete(userId);
      Utils.notify(`${name} を削除しました`, 'success');
      await this.loadUsers();
    } catch (err) {
      Utils.notify(err.message, 'error');
    }
  },

  // ============================================================
  // Googleカレンダー一括同期
  // ============================================================
  async runCalendarSync() {
    const btn      = document.getElementById('calendar-sync-btn');
    const resultEl = document.getElementById('calendar-sync-result');
    if (!btn || !resultEl) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 同期中...';
    resultEl.style.display = 'none';

    try {
      const res = await API.calendar.sync();
      const matchedItems   = (res.results || []).filter(r => r.matched);
      const unmatchedItems = (res.results || []).filter(r => !r.matched);

      let html = `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;border-radius:6px;padding:10px 14px">
          <div style="font-weight:600;margin-bottom:6px">
            <i class="fas fa-check-circle"></i>
            同期完了：${res.matched}件 / ${res.totalEvents}件のイベントを照合
          </div>`;

      if (matchedItems.length > 0) {
        html += `<div style="font-size:11px;margin-top:6px;max-height:120px;overflow-y:auto">`;
        matchedItems.forEach(r => {
          html += `<div style="padding:2px 0">
            <i class="fas fa-check" style="color:#16a34a;margin-right:4px"></i>
            ${Utils.escHtml(r.guestName)} → <strong>${Utils.escHtml(r.interviewDate)}</strong></div>`;
        });
        html += `</div>`;
      }

      if (res.totalEvents === 0) {
        html += `<div style="font-size:11px;margin-top:6px;color:#92400e">
          <i class="fas fa-exclamation-triangle"></i>
          イベントが0件でした。Google連携済みのユーザーのカレンダーIDが正しく設定されているか確認してください。
        </div>`;
      }

      if (unmatchedItems.length > 0) {
        html += `<div style="font-size:11px;margin-top:8px;padding-top:8px;border-top:1px solid #bbf7d0;color:#92400e">
          <strong>未照合 ${unmatchedItems.length}件：</strong>`;
        unmatchedItems.forEach(r => {
          html += `<div style="padding:2px 0">
            <i class="fas fa-question-circle" style="margin-right:4px"></i>
            ${Utils.escHtml(r.guestName || '(名前なし)')}</div>`;
        });
        html += `</div>`;
      }

      html += `</div>`;
      resultEl.innerHTML = html;
      resultEl.style.display = 'block';

      Utils.notify(`カレンダー同期完了：${res.matched}件の面接日を設定しました`, 'success');

      if (typeof ApplicantsPage !== 'undefined' && ApplicantsPage.applicants.length > 0) {
        try {
          ApplicantsPage.interviewDates = await API.interviewDates.list();
          ApplicantsPage.renderTable();
        } catch (_) {}
      }
    } catch (err) {
      resultEl.innerHTML = `
        <div class="alert alert-error">
          <i class="fas fa-exclamation-circle"></i>
          <span>同期エラー: ${Utils.escHtml(err.message)}</span>
        </div>`;
      resultEl.style.display = 'block';
      Utils.notify('カレンダー同期に失敗しました', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-sync-alt"></i> カレンダーを同期';
    }
  }
};
