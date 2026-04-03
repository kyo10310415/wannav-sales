// Utility functions
const Utils = {
  // Show notification
  notify(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `notification notification-${type}`;
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    const colors = { success: '#16a34a', error: '#dc2626', info: '#2563eb' };
    el.innerHTML = `
      <i class="fas ${icons[type] || icons.info}" style="color:${colors[type] || colors.info}"></i>
      <span>${message}</span>
    `;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'slideIn 0.3s ease reverse';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  },

  // Format date
  formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString('ja-JP', {
        year: 'numeric', month: '2-digit', day: '2-digit'
      });
    } catch { return dateStr; }
  },

  formatDateTime(dateStr) {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleString('ja-JP', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    } catch { return dateStr; }
  },

  // Escape HTML
  escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  },

  // Role label
  roleLabel(role) {
    return role === 'admin' ? '管理者' : 'セールス';
  },

  roleBadge(role) {
    const cls = role === 'admin' ? 'badge-admin' : 'badge-sales';
    return `<span class="badge ${cls}">${this.roleLabel(role)}</span>`;
  },

  // Debounce
  debounce(fn, delay) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  },

  // Get week periods for last N weeks
  getRecentWeeks(n = 12) {
    const weeks = [];
    const now = new Date();
    for (let i = 0; i < n; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      const year = d.getFullYear();
      const startOfYear = new Date(year, 0, 1);
      const weekNum = Math.ceil(((d - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
      const weekStr = `${year}-W${String(weekNum).padStart(2, '0')}`;
      if (!weeks.find(w => w.value === weekStr)) {
        weeks.push({ value: weekStr, label: `${year}年 第${weekNum}週` });
      }
    }
    return weeks;
  },

  // Get month periods for last N months
  getRecentMonths(n = 12) {
    const months = [];
    const now = new Date();
    for (let i = 0; i < n; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({
        value: monthStr,
        label: `${d.getFullYear()}年${d.getMonth() + 1}月`
      });
    }
    return months;
  },

  // Result badge
  resultBadge(result) {
    if (!result) return '-';
    if (result.includes('契約')) {
      return `<span class="badge badge-contract"><i class="fas fa-check-circle" style="margin-right:3px"></i>${this.escHtml(result)}</span>`;
    }
    return `<span class="badge badge-default">${this.escHtml(result)}</span>`;
  },

  // Plan label
  planLabel(plan) {
    if (!plan) return '-';
    return `<span class="tag">${this.escHtml(plan)}</span>`;
  },

  // Simple pagination helper
  paginate(data, page, perPage) {
    const start = (page - 1) * perPage;
    return {
      items: data.slice(start, start + perPage),
      total: data.length,
      totalPages: Math.ceil(data.length / perPage),
      page,
      perPage
    };
  }
};
