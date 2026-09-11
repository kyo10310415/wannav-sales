// すくう君採点・発話比率履歴 共通CSVエクスポート
const SukuukunExport = {
  _localDate(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  },

  open() {
    document.getElementById('sukuukun-export-overlay')?.remove();

    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const overlay = document.createElement('div');
    overlay.id = 'sukuukun-export-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px;width:94vw" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div class="modal-title">
            <i class="fas fa-file-csv" style="color:#059669;margin-right:7px"></i>過去データCSVエクスポート
          </div>
          <button class="modal-close" onclick="SukuukunExport.close()"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
          <div style="font-size:12px;color:var(--gray-500);line-height:1.7;margin-bottom:16px">
            指定期間の「すくう君採点履歴」と「発話比率履歴」を1つのCSVに出力します。
            日付は日本時間で判定します。
          </div>
          <div id="sukuukun-export-error" class="alert alert-error" style="display:none;margin-bottom:12px"></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
            <div class="form-group" style="margin:0">
              <label class="form-label" for="sukuukun-export-from">対象期間 From</label>
              <input type="date" id="sukuukun-export-from" class="form-control"
                value="${this._localDate(firstDay)}">
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label" for="sukuukun-export-to">対象期間 To</label>
              <input type="date" id="sukuukun-export-to" class="form-control"
                value="${this._localDate(today)}">
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="SukuukunExport.close()">キャンセル</button>
          <button class="btn" id="sukuukun-export-download" onclick="SukuukunExport.download()"
            style="background:#059669;border-color:#059669;color:white">
            <i class="fas fa-download"></i> CSVをダウンロード
          </button>
        </div>
      </div>`;

    overlay.addEventListener('click', () => this.close());
    document.body.appendChild(overlay);
    document.getElementById('sukuukun-export-from')?.focus();
  },

  close() {
    document.getElementById('sukuukun-export-overlay')?.remove();
  },

  async download() {
    const dateFrom = document.getElementById('sukuukun-export-from')?.value || '';
    const dateTo = document.getElementById('sukuukun-export-to')?.value || '';
    const errorEl = document.getElementById('sukuukun-export-error');
    const button = document.getElementById('sukuukun-export-download');

    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      if (errorEl) {
        errorEl.style.display = 'flex';
        errorEl.textContent = '開始日と終了日を正しい順序で指定してください。';
      }
      return;
    }

    if (errorEl) errorEl.style.display = 'none';
    if (button) {
      button.disabled = true;
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 作成中...';
    }

    try {
      const { blob, count } = await API.sukuukun.exportHistoryCsv({ dateFrom, dateTo });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `すくう君・発話比率履歴_${dateFrom.replace(/-/g, '')}_${dateTo.replace(/-/g, '')}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      this.close();
      Utils.notify(`CSVをダウンロードしました（${count}件）`, 'success');
    } catch (error) {
      if (errorEl) {
        errorEl.style.display = 'flex';
        errorEl.textContent = error.message;
      }
      if (button) {
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-download"></i> CSVをダウンロード';
      }
    }
  },
};
