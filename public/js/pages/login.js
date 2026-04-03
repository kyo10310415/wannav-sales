// Login Page
const LoginPage = {
  render() {
    return `
      <div class="login-container">
        <div class="login-card">
          <div class="login-logo">
            <div class="icon"><i class="fas fa-chart-line"></i></div>
            <h1>WannaV Sales</h1>
            <p class="subtitle">営業管理システム</p>
          </div>
          <div id="login-error" style="display:none"></div>
          <form id="login-form">
            <div class="form-group">
              <label class="form-label">ログインID</label>
              <input type="text" id="login-id" class="form-control" placeholder="ログインIDを入力" autocomplete="username" required>
            </div>
            <div class="form-group">
              <label class="form-label">パスワード</label>
              <input type="password" id="login-pass" class="form-control" placeholder="パスワードを入力" autocomplete="current-password" required>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%; justify-content:center; padding:11px; font-size:14px; margin-top:4px;" id="login-btn">
              <i class="fas fa-sign-in-alt"></i> ログイン
            </button>
          </form>
          <p style="text-align:center; margin-top:20px; font-size:12px; color:var(--gray-400)">
            初期パスワード: 1111（初回ログイン時に変更必須）
          </p>
        </div>
      </div>
    `;
  },

  mount() {
    const form = document.getElementById('login-form');
    const errorEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.style.display = 'none';
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ログイン中...';

      const login_id = document.getElementById('login-id').value.trim();
      const password = document.getElementById('login-pass').value;

      try {
        const data = await API.auth.login({ login_id, password });
        Auth.login(data.token, data.user);

        if (data.user.must_change_password == 1) {
          App.showChangePassword(true); // forced
        } else {
          App.navigate('applicants');
        }
      } catch (err) {
        errorEl.style.display = 'flex';
        errorEl.className = 'alert alert-error';
        errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i><span>${err.message}</span>`;
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> ログイン';
      }
    });

    // Focus on login ID field
    document.getElementById('login-id').focus();
  }
};
