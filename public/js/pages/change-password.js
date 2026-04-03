// Change Password Modal
const ChangePasswordPage = {
  forced: false,

  render(forced = false) {
    this.forced = forced;
    return `
      <div class="change-password-overlay">
        <div class="modal" style="max-width:440px">
          <div class="modal-header">
            <div>
              <div class="modal-title">
                <i class="fas fa-key" style="color:var(--warning);margin-right:8px"></i>
                ${forced ? '初回パスワード変更（必須）' : 'パスワード変更'}
              </div>
              ${forced ? '<p style="font-size:12px;color:var(--gray-500);margin-top:4px">セキュリティのため、パスワードを変更してください</p>' : ''}
            </div>
            ${!forced ? `<button class="modal-close" id="cp-close"><i class="fas fa-times"></i></button>` : ''}
          </div>
          <div class="modal-body">
            <div id="cp-error" style="display:none"></div>
            <form id="cp-form">
              ${!forced ? `
              <div class="form-group">
                <label class="form-label">現在のパスワード <span class="required">*</span></label>
                <input type="password" id="cp-current" class="form-control" placeholder="現在のパスワード">
              </div>
              ` : ''}
              <div class="form-group">
                <label class="form-label">新しいパスワード <span class="required">*</span></label>
                <input type="password" id="cp-new" class="form-control" placeholder="4文字以上" required>
              </div>
              <div class="form-group">
                <label class="form-label">新しいパスワード（確認）<span class="required">*</span></label>
                <input type="password" id="cp-confirm" class="form-control" placeholder="同じパスワードを入力" required>
              </div>
              <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px;" id="cp-btn">
                <i class="fas fa-save"></i> パスワードを変更
              </button>
            </form>
          </div>
        </div>
      </div>
    `;
  },

  mount() {
    const form = document.getElementById('cp-form');
    const errorEl = document.getElementById('cp-error');
    const btn = document.getElementById('cp-btn');
    const closeBtn = document.getElementById('cp-close');

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        App.hideChangePassword();
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.style.display = 'none';

      const newPass = document.getElementById('cp-new').value;
      const confirmPass = document.getElementById('cp-confirm').value;
      const currentPassEl = document.getElementById('cp-current');
      const currentPass = currentPassEl ? currentPassEl.value : null;

      if (newPass !== confirmPass) {
        errorEl.style.display = 'flex';
        errorEl.className = 'alert alert-error';
        errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i><span>新しいパスワードが一致しません</span>`;
        return;
      }

      if (newPass.length < 4) {
        errorEl.style.display = 'flex';
        errorEl.className = 'alert alert-error';
        errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i><span>パスワードは4文字以上で入力してください</span>`;
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 変更中...';

      try {
        const payload = { new_password: newPass };
        if (currentPass) payload.current_password = currentPass;

        const data = await API.auth.changePassword(payload);

        // Update token
        localStorage.setItem('token', data.token);
        Auth.updateUser({ must_change_password: 0 });

        Utils.notify('パスワードを変更しました', 'success');
        App.hideChangePassword();

        if (this.forced) {
          App.navigate('applicants');
        }
      } catch (err) {
        errorEl.style.display = 'flex';
        errorEl.className = 'alert alert-error';
        errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i><span>${err.message}</span>`;
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> パスワードを変更';
      }
    });
  }
};
