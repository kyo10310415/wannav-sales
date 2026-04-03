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
