// API client wrapper
const API = {
  baseURL: '/api',

  getToken() {
    return localStorage.getItem('token');
  },

  getHeaders() {
    const token = this.getToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  },

  async request(method, path, data = null) {
    const options = {
      method,
      headers: this.getHeaders(),
    };
    if (data) {
      options.body = JSON.stringify(data);
    }
    const response = await fetch(`${this.baseURL}${path}`, options);
    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      // 401/403 はセッション切れ → 自動ログアウトしてログイン画面へ
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // ページをリロードしてログイン画面に戻す
        // (Auth/App が未ロードの場合でも確実に動作)
        if (typeof Auth !== 'undefined') Auth.user = null;
        if (typeof App !== 'undefined') {
          App.showLogin();
        } else {
          window.location.reload();
        }
        const err = new Error('セッションの有効期限が切れました。再度ログインしてください。');
        err.status = response.status;
        throw err;
      }
      const err = new Error(json.error || `HTTP ${response.status}`);
      err.status = response.status;
      err.data = json;
      throw err;
    }
    return json;
  },

  get: (path) => API.request('GET', path),
  post: (path, data) => API.request('POST', path, data),
  put: (path, data) => API.request('PUT', path, data),
  delete: (path) => API.request('DELETE', path),

  // Auth
  auth: {
    login: (data) => API.post('/auth/login', data),
    me: () => API.get('/auth/me'),
    changePassword: (data) => API.post('/auth/change-password', data),
  },

  // Users
  users: {
    list: () => API.get('/users'),
    sales: () => API.get('/users/sales'),
    create: (data) => API.post('/users', data),
    update: (id, data) => API.put(`/users/${id}`, data),
    delete: (id) => API.delete(`/users/${id}`),
    resetPassword: (id) => API.post(`/users/${id}/reset-password`),
  },

  // Sales Reports
  salesReports: {
    list: () => API.get('/sales-reports'),
    get: (id) => API.get(`/sales-reports/${id}`),
    create: (data) => API.post('/sales-reports', data),
    update: (id, data) => API.put(`/sales-reports/${id}`, data),
    delete: (id) => API.delete(`/sales-reports/${id}`),
  },

  // Spreadsheet
  spreadsheet: {
    applicants: (params) => {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      return API.get(`/spreadsheet/applicants${q}`);
    },
    applicantsCount: (params) => {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      return API.get(`/spreadsheet/applicants/count${q}`);
    },
    cacheStatus: () => API.get('/spreadsheet/cache-status'),
    cacheClear: () => API.post('/spreadsheet/cache-clear'),
  },

  // Interview Dates
  interviewDates: {
    list: () => API.get('/interview-dates'),
    save: (key, date) => API.put(`/interview-dates/${encodeURIComponent(key)}`, { interview_date: date }),
  },

  // Calendar
  calendar: {
    sync:       () => API.post('/calendar/sync'),
    status:     () => API.get('/calendar/status'),
    authUrl:    () => API.get('/calendar/auth-url'),
    revokeToken:() => API.delete('/calendar/token'),
  },

  // Stats
  stats: {
    weekly: () => API.get('/stats/weekly'),
    monthly: () => API.get('/stats/monthly'),
    allPeriods: (type) => API.get(`/stats/all-periods?type=${type}`),
    summary: (params) => {
      const q = new URLSearchParams(params).toString();
      return API.get(`/stats/summary?${q}`);
    },
  },
};
