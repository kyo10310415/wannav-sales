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

  // Date から ISO 8601 週番号文字列 (YYYY-WXX) を返す
  // ISO 8601: 月曜始まり、1/4 が含まれる週が W01
  // SQLite の isoWeekPeriod() と完全一致
  _isoWeekStr(d) {
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
    const monBased = (date.getDay() + 6) % 7; // 月=0, 火=1, ..., 日=6
    const thu = new Date(date);
    thu.setDate(date.getDate() + 3 - monBased); // 当週の木曜日
    const year = thu.getFullYear();
    const jan4 = new Date(year, 0, 4, 12, 0, 0);
    const jan4MonBased = (jan4.getDay() + 6) % 7;
    const yearFirstThu = new Date(year, 0, 4 + (3 - jan4MonBased), 12, 0, 0);
    const week = Math.round((thu - yearFirstThu) / (7 * 86400000)) + 1;
    return year + '-W' + String(week).padStart(2, '0');
  },

  // YYYY-WXX の value からその週の月曜日(Date)を返す
  // ISO 8601 準拠: 1/4 が含まれる週が W01、月曜〜日曜
  _weekMonday(weekStr) {
    // weekStr: '2026-W21'
    const [yearStr, wPart] = weekStr.split('-W');
    const year  = parseInt(yearStr);
    const week  = parseInt(wPart);
    // その年の W01 の月曜日 = 1/4 が含まれる週の月曜日
    const jan4       = new Date(year, 0, 4, 12, 0, 0);
    const jan4MonBased = (jan4.getDay() + 6) % 7; // 月=0
    const w01Monday  = new Date(year, 0, 4 - jan4MonBased, 12, 0, 0);
    // 指定週の月曜日
    const monday = new Date(w01Monday);
    monday.setDate(w01Monday.getDate() + (week - 1) * 7);
    // 日曜日 = 月曜+6
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { monday, sunday };
  },

  // YYYY-WXX から「YYYY年 M月D日（月）〜M月D日（日）」の表示ラベルを生成
  weekRangeLabel(weekStr) {
    if (!weekStr) return '';
    try {
      const { monday, sunday } = this._weekMonday(weekStr);
      const fmt = (d) => `${d.getMonth() + 1}月${d.getDate()}日`;
      const [yearStr] = weekStr.split('-W');
      return `${yearStr}年 ${fmt(monday)}〜${fmt(sunday)}`;
    } catch { return weekStr; }
  },

  // Get week periods for last N weeks (ISO 8601: 月曜始まり)
  getRecentWeeks(n = 12) {
    const weeks = [];
    const now = new Date();
    for (let i = 0; i < n; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      const weekStr = this._isoWeekStr(d);
      if (!weeks.find(w => w.value === weekStr)) {
        weeks.push({ value: weekStr, label: this.weekRangeLabel(weekStr) });
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
