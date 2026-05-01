// Main App Router
const App = {
  currentPage: null,
  changePasswordOverlay: null,

  pages: {
    today: {
      nav: 'nav-today',
      module: () => TodayInterviewsPage,
      title: '今日の面接',
      adminOnly: false,
    },
    applicants: {
      nav: 'nav-applicants',
      module: () => ApplicantsPage,
      title: '応募者一覧',
      adminOnly: false,
    },
    stats: {
      nav: 'nav-stats',
      module: () => StatsPage,
      title: 'データ集計',
      adminOnly: false,
    },
    sukuukun: {
      nav: 'nav-sukuukun',
      module: () => SukuukunPage,
      title: 'すくう君',
      adminOnly: false,
    },
    users: {
      nav: 'nav-users',
      module: () => UsersPage,
      title: 'ユーザー管理',
      adminOnly: true,
    },
  },

  init() {
    if (!Auth.isLoggedIn()) {
      this.showLogin();
    } else if (Auth.mustChangePassword()) {
      this.showChangePassword(true);
    } else {
      this.navigate('today');
    }
  },

  showLogin() {
    document.getElementById('app').innerHTML = LoginPage.render();
    LoginPage.mount();
  },

  showChangePassword(forced = false) {
    // Remove existing overlay if present
    const existing = document.getElementById('change-password-overlay-wrap');
    if (existing) existing.remove();

    const wrap = document.createElement('div');
    wrap.id = 'change-password-overlay-wrap';
    wrap.innerHTML = ChangePasswordPage.render(forced);
    document.body.appendChild(wrap);
    ChangePasswordPage.mount();
  },

  hideChangePassword() {
    const wrap = document.getElementById('change-password-overlay-wrap');
    if (wrap) wrap.remove();
  },

  navigate(page) {
    if (!Auth.isLoggedIn()) {
      this.showLogin();
      return;
    }

    const pageConfig = this.pages[page];
    if (!pageConfig) {
      this.navigate('applicants');
      return;
    }

    if (pageConfig.adminOnly && !Auth.isAdmin()) {
      this.navigate('today');
      return;
    }

    this.currentPage = page;
    const module = pageConfig.module();

    document.getElementById('app').innerHTML = this.renderLayout(module.render());
    this.mountLayout();
    module.mount();
  },

  renderLayout(content) {
    const user = Auth.user;
    const isAdmin = Auth.isAdmin();

    const navItems = [
      {
        id: 'nav-today',
        page: 'today',
        icon: 'fa-calendar-day',
        label: '今日の面接',
        show: true,
      },
      {
        id: 'nav-applicants',
        page: 'applicants',
        icon: 'fa-users',
        label: '応募者一覧',
        show: true,
      },
      {
        id: 'nav-stats',
        page: 'stats',
        icon: 'fa-chart-bar',
        label: 'データ集計',
        show: true,
      },
      {
        id: 'nav-sukuukun',
        page: 'sukuukun',
        icon: 'fa-robot',
        label: 'すくう君',
        show: true,
        style: 'background:#fffbeb;color:#92400e;border-left:3px solid #f59e0b',
      },
      {
        id: 'nav-users',
        page: 'users',
        icon: 'fa-user-cog',
        label: 'ユーザー管理',
        show: isAdmin,
      },
    ];

    return `
      <div class="layout">
        <nav class="sidebar">
          <div class="sidebar-logo">
            <h2><i class="fas fa-chart-line" style="margin-right:6px;color:#60a5fa"></i>WannaV Sales</h2>
            <span>営業管理システム</span>
          </div>
          <div class="sidebar-nav">
            ${navItems.filter(n => n.show).map(n => {
              const isActive = this.currentPage === n.page;
              const customStyle = n.style
                ? (isActive ? n.style + ';opacity:1;font-weight:700' : n.style)
                : '';
              return `
              <div class="nav-item ${isActive ? 'active' : ''}" id="${n.id}"
                onclick="App.navigate('${n.page}')"
                ${customStyle ? `style="${customStyle}"` : ''}>
                <i class="fas ${n.icon}"${n.style ? ` style="color:#f59e0b"` : ''}></i>
                <span>${n.label}</span>
              </div>`;
            }).join('')}
          </div>
          <div class="sidebar-footer">
            <div class="user-info">
              <div class="user-avatar">${user.name.charAt(0)}</div>
              <div class="user-details">
                <div class="user-name">${Utils.escHtml(user.name)}</div>
                <div class="user-role">${Utils.roleLabel(user.role)}</div>
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" style="width:100%;justify-content:center;margin-bottom:6px;font-size:11px" onclick="App.showChangePassword(false)">
              <i class="fas fa-key"></i> パスワード変更
            </button>
            <button id="sidebar-google-btn" class="btn btn-sm" style="width:100%;justify-content:center;margin-bottom:6px;font-size:11px;background:#4285f4;border-color:#4285f4;color:white">
              <i class="fab fa-google"></i> <span id="sidebar-google-label">Google連携を確認中...</span>
            </button>
            <button class="btn-logout" id="logout-btn">
              <i class="fas fa-sign-out-alt"></i> ログアウト
            </button>
          </div>
        </nav>
        <div class="main-content">
          ${content}
        </div>
      </div>
    `;
  },

  mountLayout() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        if (confirm('ログアウトしますか？')) {
          Auth.logout();
          this.showLogin();
        }
      });
    }

    // Google連携ボタン: 状態を取得してラベルと動作を切り替え
    this._mountGoogleBtn();
  },

  async _mountGoogleBtn() {
    const btn   = document.getElementById('sidebar-google-btn');
    const label = document.getElementById('sidebar-google-label');
    if (!btn || !label) return;

    try {
      const status = await API.calendar.status();
      if (status.linked) {
        // 連携済み: メールを短縮表示・クリックで解除
        const shortEmail = status.email
          ? (status.email.length > 18 ? status.email.substring(0, 16) + '…' : status.email)
          : '連携済み';
        label.textContent = shortEmail;
        btn.title = `連携済み: ${status.email}\nクリックで解除`;
        btn.style.background     = '#166534';
        btn.style.borderColor    = '#166534';
        btn.onclick = async () => {
          if (!confirm(`Googleアカウント（${status.email}）の連携を解除しますか？`)) return;
          try {
            await API.calendar.revokeToken();
            Utils.notify('Google連携を解除しました', 'success');
            this._mountGoogleBtn(); // ボタンを再描画
          } catch (e) {
            Utils.notify('解除に失敗しました: ' + e.message, 'error');
          }
        };
      } else {
        // 未連携: クリックでOAuthポップアップ
        label.textContent = 'Google連携する';
        btn.title = 'Googleカレンダーと連携する';
        btn.style.background  = '#4285f4';
        btn.style.borderColor = '#4285f4';
        btn.onclick = () => this._openGoogleAuth();
      }
    } catch (_) {
      label.textContent = 'Google連携する';
      btn.onclick = () => this._openGoogleAuth();
    }
  },

  async _openGoogleAuth() {
    const btn   = document.getElementById('sidebar-google-btn');
    const label = document.getElementById('sidebar-google-label');
    if (btn) { btn.disabled = true; }
    if (label) { label.textContent = '処理中...'; }

    try {
      const { url } = await API.calendar.authUrl();
      const popup = window.open(url, 'google_auth',
        'width=600,height=700,scrollbars=yes,resizable=yes');

      const handler = async (event) => {
        if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
          window.removeEventListener('message', handler);
          Utils.notify(`Google連携しました（${event.data.email}）`, 'success');
          this._mountGoogleBtn();
        } else if (event.data?.type === 'GOOGLE_AUTH_ERROR') {
          window.removeEventListener('message', handler);
          Utils.notify('連携に失敗しました: ' + event.data.error, 'error');
          this._mountGoogleBtn();
        }
      };
      window.addEventListener('message', handler);

      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          window.removeEventListener('message', handler);
          this._mountGoogleBtn();
        }
      }, 1000);

    } catch (err) {
      Utils.notify('認証URLの取得に失敗しました: ' + err.message, 'error');
      this._mountGoogleBtn();
    } finally {
      if (btn) btn.disabled = false;
    }
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
