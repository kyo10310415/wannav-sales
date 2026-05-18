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

  // すくう君
  sukuukun: {
    sources: {
      list:      ()         => API.get('/sukuukun/sources'),
      get:       (id)       => API.get(`/sukuukun/sources/${id}`),
      addText:   (data)     => API.post('/sukuukun/sources/text', data),
      update:    (id, data) => API.put(`/sukuukun/sources/${id}`, data),
      delete:    (id)       => API.delete(`/sukuukun/sources/${id}`),
      uploadPdf: (file, title) => {
        const token = API.getToken();
        const form = new FormData();
        form.append('pdf', file);
        if (title) form.append('title', title);
        return fetch('/api/sukuukun/sources/pdf', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        }).then(async r => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          return j;
        });
      },
    },
    // data: { transcript, applicantName, interviewerId, interviewerName, interviewResult }
    evaluate: (data)  => API.post('/sukuukun/evaluate', data),
    // data: { transcript, metrics, interviewer_id, interviewer_name, applicant_name, analyzed_at }
    analyzeSpeech: (data) => API.post('/sukuukun/analyze-speech', data),
    speechStats: {
      // 担当者別月次集計 opts: { month: 'YYYY-MM' }
      summary: (opts) => {
        const q = opts?.month ? `?month=${opts.month}` : '';
        return API.get(`/sukuukun/speech-stats${q}`);
      },
      // 詳細一覧 opts: { month, interviewer_id }
      detail: (opts) => {
        const p = new URLSearchParams();
        if (opts?.month)          p.set('month',          opts.month);
        if (opts?.interviewer_id) p.set('interviewer_id', opts.interviewer_id);
        return API.get(`/sukuukun/speech-stats/detail?${p.toString()}`);
      },
      // 存在する年月一覧
      months: () => API.get('/sukuukun/speech-stats/months'),
    },
    history: {
      // opts: { interviewer_id } (任意)
      list:  (opts)   => {
        const q = opts?.interviewer_id ? `?interviewer_id=${opts.interviewer_id}` : '';
        return API.get(`/sukuukun/history${q}`);
      },
      get:   (id) => API.get(`/sukuukun/history/${id}`),
    },
    // 応募者別の採点・発話比率履歴を取得
    byApplicant: (key) => API.get(`/sukuukun/by-applicant/${encodeURIComponent(key)}`),
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

  // Data Analysis
  analysis: {
    run: (data) => API.post('/analysis/run', data),
    exportSheet: (data) => API.post('/analysis/export-sheet', data),
  },

  // Notion Profiles
  notion: {
    profiles:   ()   => API.get('/notion/profiles'),
    profile:    (sn) => API.get(`/notion/profiles/${encodeURIComponent(sn)}`),
    sync:       ()   => API.post('/notion/sync', {}),
    syncStatus: ()   => API.get('/notion/sync-status'),
  },
};
