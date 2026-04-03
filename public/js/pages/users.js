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
          <div class="modal" style="max-width:480px">
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

    await this.loadUsers();
  },

  async loadUsers() {
    const wrap = document.getElementById('users-table-wrap');
    try {
      this.users = await API.users.list();
      this.renderTable();
    } catch (err) {
      wrap.innerHTML = `<div class="alert alert-error" style="margin:20px"><i class="fas fa-exclamation-circle"></i><span>${err.message}</span></div>`;
    }
  },

  renderTable() {
    const wrap = document.getElementById('users-table-wrap');
    if (!this.users.length) {
      wrap.innerHTML = `<div class="empty-state"><i class="fas fa-users"></i><h3>ユーザーがいません</h3><p>「ユーザー追加」ボタンから追加してください</p></div>`;
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
            <th>ステータス</th>
            <th>登録日</th>
            <th style="text-align:right">操作</th>
          </tr>
        </thead>
        <tbody>
          ${this.users.map(u => `
            <tr>
              <td><span class="tag">#${u.id}</span></td>
              <td><code style="font-size:12px;background:var(--gray-100);padding:2px 6px;border-radius:4px">${Utils.escHtml(u.login_id)}</code></td>
              <td><strong>${Utils.escHtml(u.name)}</strong></td>
              <td>${Utils.roleBadge(u.role)}</td>
              <td>
                ${u.must_change_password
                  ? '<span class="badge" style="background:#fef3c7;color:#92400e"><i class="fas fa-exclamation-triangle" style="margin-right:3px"></i>PW変更待ち</span>'
                  : '<span class="badge" style="background:#dcfce7;color:#166534"><i class="fas fa-check" style="margin-right:3px"></i>正常</span>'
                }
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
    const modal = document.getElementById('user-modal');
    const title = document.getElementById('user-modal-title');
    const passInfo = document.getElementById('user-pass-info');
    const errorEl = document.getElementById('user-modal-error');

    errorEl.style.display = 'none';
    title.textContent = this.editingUser ? 'ユーザー編集' : 'ユーザー追加';
    passInfo.style.display = this.editingUser ? 'none' : 'flex';

    document.getElementById('user-login-id').value = this.editingUser?.login_id || '';
    document.getElementById('user-name').value = this.editingUser?.name || '';
    document.getElementById('user-role').value = this.editingUser?.role || 'sales';

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

    const login_id = document.getElementById('user-login-id').value.trim();
    const name = document.getElementById('user-name').value.trim();
    const role = document.getElementById('user-role').value;

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
        await API.users.update(this.editingUser.id, { login_id, name, role });
        Utils.notify('ユーザー情報を更新しました', 'success');
      } else {
        await API.users.create({ login_id, name, role });
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
  }
};
