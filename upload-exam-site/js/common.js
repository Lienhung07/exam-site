// 共用：Supabase 連線、登入守門、XSS 跳脫、提示訊息
(function () {
  const cfg = window.APP_CONFIG || {};
  const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cfg.SUPABASE_URL || '') &&
    cfg.SUPABASE_ANON_KEY && !/YOUR-/.test(cfg.SUPABASE_ANON_KEY);

  window.App = {
    configured,
    sb: null,
    profile: null,

    // 所有動態內容一律經過 esc() 才能放進 innerHTML，避免 XSS
    esc(v) {
      return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    toast(msg, type = '') {
      let host = document.getElementById('toast-host');
      if (!host) { host = document.createElement('div'); host.id = 'toast-host'; document.body.appendChild(host); }
      const t = document.createElement('div');
      t.className = 'toast ' + type;
      t.textContent = msg;
      host.appendChild(t);
      setTimeout(() => t.remove(), 4200);
    },

    // 把 Supabase / Postgres 錯誤轉為友善訊息
    errMsg(e) {
      const m = (e && (e.message || e.error_description)) || String(e);
      if (/Invalid login credentials/i.test(m)) return '帳號或密碼錯誤';
      if (/Email not confirmed/i.test(m)) return '請先到信箱點選驗證連結';
      if (/User already registered/i.test(m)) return '此 Email 已註冊';
      if (/rate limit/i.test(m)) return '操作太頻繁，請稍後再試';
      if (/row-level security|permission denied/i.test(m)) return '沒有權限執行此操作';
      if (/duplicate key/i.test(m)) return '資料重複（名稱已存在）';
      return m;
    },

    fmtDate(s) {
      if (!s) return '—';
      return new Date(s).toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    },

    // CSV 匯出（含 BOM 讓 Excel 正確顯示中文；並防止公式注入）
    downloadCSV(filename, rows) {
      const cell = v => {
        let s = String(v ?? '');
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return '"' + s.replace(/"/g, '""') + '"';
      };
      const csv = '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },

    // 分頁抓完所有資料（Supabase 單次預設上限 1000 筆）
    async fetchAll(buildQuery) {
      const out = []; const size = 1000;
      for (let from = 0; ; from += size) {
        const { data, error } = await buildQuery().range(from, from + size - 1);
        if (error) throw error;
        out.push(...data);
        if (data.length < size) break;
      }
      return out;
    },

    async signOut() {
      await App.sb.auth.signOut();
      location.href = 'index.html';
    },

    // 頁面守門：未登入 → 回登入頁；要求管理者但不是 → 回考試頁
    async requireAuth({ admin = false } = {}) {
      if (!configured) { App.showConfigBanner(); return null; }
      const { data: { session } } = await App.sb.auth.getSession();
      if (!session) { location.replace('index.html'); return null; }
      const { data: p, error } = await App.sb.from('profiles').select('id,email,full_name,employee_id,role,approved').eq('id', session.user.id).single();
      if (error || !p) { await App.sb.auth.signOut(); location.replace('index.html'); return null; }
      App.profile = p;
      if (admin && p.role !== 'admin') { location.replace('exam.html'); return null; }
      const who = document.getElementById('who');
      if (who) who.textContent = (p.full_name || p.email) + (p.role === 'admin' ? '（管理者）' : '');
      const out = document.getElementById('btn-logout');
      if (out) out.addEventListener('click', App.signOut);
      return p;
    },

    showConfigBanner() {
      const b = document.createElement('div');
      b.className = 'banner';
      b.textContent = '尚未設定 Supabase：請編輯 js/config.js 填入 Project URL 與 anon key。';
      document.body.prepend(b);
    }
  };

  if (configured && window.supabase) {
    App.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      // 使用 sessionStorage：關閉分頁即登出，降低共用電腦的風險
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: window.sessionStorage }
    });
  }
})();
