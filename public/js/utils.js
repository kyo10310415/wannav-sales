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

  // YYYY-WXX の value からその週の月曜日(Date)を返す
  _weekMonday(weekStr) {
    // weekStr: '2026-W15'
    const [yearStr, wPart] = weekStr.split('-W');
    const year = parseInt(yearStr);
    const week = parseInt(wPart);
    // 1月1日から week 番目の週の月曜日を計算
    // SQLiteの strftime('%W') は日曜始まり週番号なので合わせる
    const jan1 = new Date(year, 0, 1);
    // jan1 の曜日(0=日,1=月,...)
    const jan1Day = jan1.getDay(); // 0=Sun
    // 第1週の開始日（その年の最初の日曜日）
    const firstSunday = new Date(jan1);
    firstSunday.setDate(1 - jan1Day); // jan1 が日曜なら同日、月曜なら -1 日
    // week 番目の週の日曜日
    const weekSunday = new Date(firstSunday);
    weekSunday.setDate(firstSunday.getDate() + (week - 1) * 7);
    // 月曜日 = 日曜+1
    const monday = new Date(weekSunday);
    monday.setDate(weekSunday.getDate() + 1);
    // 土曜日 = 日曜+7
    const saturday = new Date(weekSunday);
    saturday.setDate(weekSunday.getDate() + 7);
    return { monday, saturday, sunday: weekSunday };
  },

  // YYYY-WXX から「〇月〇日（月）～〇月〇日（日）」の表示ラベルを生成
  weekRangeLabel(weekStr) {
    if (!weekStr) return '';
    try {
      const { monday, saturday } = this._weekMonday(weekStr);
      const fmt = (d) => `${d.getMonth() + 1}月${d.getDate()}日`;
      const [yearStr] = weekStr.split('-W');
      return `${yearStr}年 ${fmt(monday)}〜${fmt(saturday)}`;
    } catch { return weekStr; }
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
