// Authentication state management
const Auth = {
  user: null,

  init() {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (token && userStr) {
      try {
        this.user = JSON.parse(userStr);
      } catch (e) {
        this.logout();
      }
    }
  },

  login(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    this.user = user;
  },

  logout(redirect = true) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.user = null;
    if (redirect && typeof App !== 'undefined') {
      App.showLogin();
    }
  },

  isLoggedIn() {
    return !!localStorage.getItem('token') && !!this.user;
  },

  isAdmin() {
    return this.user && this.user.role === 'admin';
  },

  mustChangePassword() {
    return this.user && this.user.must_change_password == 1;
  },

  updateUser(userData) {
    this.user = { ...this.user, ...userData };
    localStorage.setItem('user', JSON.stringify(this.user));
  }
};

Auth.init();
