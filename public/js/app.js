// Main App Router
const App = {
  currentPage: null,
  changePasswordOverlay: null,

  pages: {
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
      this.navigate('applicants');
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
      this.navigate('applicants');
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
            ${navItems.filter(n => n.show).map(n => `
              <div class="nav-item ${this.currentPage === n.page ? 'active' : ''}" id="${n.id}" onclick="App.navigate('${n.page}')">
                <i class="fas ${n.icon}"></i>
                <span>${n.label}</span>
              </div>
            `).join('')}
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
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
