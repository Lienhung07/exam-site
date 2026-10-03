// 後台：儀表板 / 訓練紀錄 / 題庫匯入管理 / 科目與及格分數
(async function () {
  const { esc, toast, errMsg, fmtDate } = App;
  const $ = id => document.getElementById(id);
  const VIEWS = ['dashboard', 'approvals', 'training', 'questions', 'subjects'];
  const LETTERS = ['A', 'B', 'C', 'D', 'E'];

  const me = await App.requireAuth({ admin: true });
  if (!me) return;

  let subjects = [];
  const loaded = {};

  async function loadSubjectList() {
    const { data, error } = await App.sb.from('subjects').select('*').order('name');
    if (error) throw error;
    subjects = data;
  }
  const subjectOptions = (withAll, selected) =>
    (withAll ? '<option value="">全部科目</option>' : '') +
    subjects.map(s => `<option value="${esc(s.id)}" ${s.id === selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

  /* ---------------- Tabs ---------------- */
  async function show(name) {
    VIEWS.forEach(v => $('view-' + v).classList.toggle('hidden', v !== name));
    document.querySelectorAll('#main-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
    try {
      await loadSubjectList();
      ({ dashboard: renderDashboard, approvals: renderApprovals, training: renderTraining, questions: renderQuestions, subjects: renderSubjects })[name]();
    } catch (e) { toast(errMsg(e), 'err'); }
  }

  /* ================= 帳號審核 ================= */
  function setPendingBadge(n) {
    const b = $('pending-badge');
    b.textContent = n; b.classList.toggle('hidden', !n);
  }
  async function renderApprovals() {
    const box = $('view-approvals');
    box.innerHTML = '<p class="muted">載入中…</p>';
    const { data, error } = await App.sb.from('profiles')
      .select('id,full_name,employee_id,email,approved,created_at').eq('role', 'user').order('created_at', { ascending: false }).limit(1000);
    if (error) { box.innerHTML = '<div class="msg err">' + esc(errMsg(error)) + '</div>'; return; }
    const pending = data.filter(u => !u.approved), approved = data.filter(u => u.approved);
    setPendingBadge(pending.length);
    const row = (u, actions) => `<tr><td>${esc(u.full_name)}</td><td>${esc(u.employee_id)}</td><td>${esc(u.email)}</td><td>${fmtDate(u.created_at)}</td><td class="row">${actions}</td></tr>`;
    const table = (rows, empty) => rows.length
      ? `<div class="table-wrap"><table><thead><tr><th>姓名</th><th>員工編號</th><th>Email</th><th>註冊時間</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
      : `<div class="card muted">${empty}</div>`;
    box.innerHTML = `
      <h3>待審核（${pending.length}）</h3>
      ${table(pending.map(u => row(u,
        `<button class="btn sm" data-approve="${esc(u.id)}" type="button">核准</button>
         <button class="btn sm danger" data-reject="${esc(u.id)}" type="button">拒絕並刪除</button>`)), '目前沒有待審核的帳號')}
      <h3 style="margin-top:24px">已核准（${approved.length}）</h3>
      ${table(approved.map(u => row(u, `<button class="btn sm danger" data-revoke="${esc(u.id)}" type="button">停用</button>`)), '尚無已核准的學員')}`;
  }
  $('view-approvals').addEventListener('click', async e => {
    const a = e.target.closest('[data-approve]'), r = e.target.closest('[data-reject]'), v = e.target.closest('[data-revoke]');
    let res;
    if (a) res = await App.sb.rpc('admin_set_approval', { p_user_id: a.dataset.approve, p_approved: true });
    else if (v) {
      if (!confirm('確定停用此帳號？停用後該員工將無法再考試（考試紀錄會保留）。')) return;
      res = await App.sb.rpc('admin_set_approval', { p_user_id: v.dataset.revoke, p_approved: false });
    } else if (r) {
      if (!confirm('確定拒絕並刪除此申請？該帳號會被永久刪除。')) return;
      res = await App.sb.rpc('admin_reject_user', { p_user_id: r.dataset.reject });
    } else return;
    if (res.error) return toast(errMsg(res.error), 'err');
    toast('已更新', 'ok'); renderApprovals();
  });
  $('main-tabs').addEventListener('click', e => { const t = e.target.closest('.tab'); if (t) show(t.dataset.view); });

  /* ================= 儀表板 ================= */
  async function renderDashboard() {
    const box = $('view-dashboard');
    box.innerHTML = '<p class="muted">載入中…</p>';
    const [stat, recent] = await Promise.all([
      App.sb.rpc('admin_dashboard', { p_days: 30 }),
      App.sb.from('exams').select('id,score,passed,paper_code,submitted_at,profiles(full_name,employee_id),subjects(name)')
        .eq('status', 'submitted').order('submitted_at', { ascending: false }).limit(15)
    ]);
    if (stat.error) { box.innerHTML = '<div class="msg err">' + esc(errMsg(stat.error)) + '</div>'; return; }
    const d = stat.data;
    setPendingBadge(d.pending);
    const rate = d.exams ? Math.round(100 * d.passed / d.exams) : 0;

    box.innerHTML = `
      <div class="grid kpis">
        <div class="kpi"><div class="label">學員人數</div><div class="value">${d.users}</div></div>
        <div class="kpi"><div class="label">已完成考試次數</div><div class="value">${d.exams}</div></div>
        <div class="kpi"><div class="label">整體通過率</div><div class="value">${rate}%</div></div>
        <div class="kpi"><div class="label">平均分數</div><div class="value">${d.avg_score}</div></div>
        <div class="kpi ok"><div class="label">及格完訓（人次）</div><div class="value">${d.completed}</div></div>
        <div class="kpi bad"><div class="label">尚未及格（人次）</div><div class="value">${d.failed}</div></div>
      </div>
      <div class="grid two" style="margin-top:18px">
        <div class="card"><h3>各科目通過率</h3>${subjectBars(d.by_subject)}</div>
        <div class="card"><h3>近 30 天考試趨勢</h3>${trendChart(d.daily)}
          <div class="legend"><span><i style="background:#9db6d6"></i>考試次數</span><span><i style="background:#1d7a4a"></i>通過次數</span></div></div>
      </div>
      <div class="card" style="margin-top:18px"><h3>最近考試</h3>${recentTable(recent.data || [])}</div>`;
  }

  function subjectBars(list) {
    if (!list.length) return '<p class="muted">尚無科目</p>';
    return list.map(s => {
      const r = s.exams ? Math.round(100 * s.passed / s.exams) : 0;
      return `<div class="bar-row"><span title="${esc(s.name)}">${esc(s.name)}</span>
        <div class="bar-track"><div class="bar-fill ${r >= 60 ? 'ok' : 'bad'}" style="width:${r}%"></div></div>
        <span>${s.exams ? r + '%' : '—'}</span></div>
        <div class="small muted" style="margin:-6px 0 6px 160px">${s.exams} 次考試 ・ 平均 ${s.avg_score} 分</div>`;
    }).join('');
  }

  function trendChart(daily) {
    if (!daily.length) return '<p class="muted">近 30 天尚無考試資料</p>';
    const W = 560, H = 220, pl = 34, pr = 10, pt = 12, pb = 28;
    const max = Math.max(4, ...daily.map(x => x.exams));
    // 長條圖：每天一組（考試次數 / 通過次數），只有一天資料時也清楚可讀
    const n = daily.length, slot = (W - pl - pr) / n;
    const bw = Math.min(26, slot * 0.38);
    const cx = i => pl + slot * (i + 0.5);
    const y = v => H - pb - v * (H - pt - pb) / max;
    const bars = daily.map((p, i) => {
      const one = (k, color, dx) => p[k] > 0
        ? `<rect x="${cx(i) + dx}" y="${y(p[k])}" width="${bw}" height="${H - pb - y(p[k])}" rx="3" fill="${color}"><title>${esc(p.day)}：${k === 'exams' ? '考試' : '通過'} ${p[k]} 次</title></rect>
           <text x="${cx(i) + dx + bw / 2}" y="${y(p[k]) - 4}" text-anchor="middle" font-size="11" fill="#3a4553">${p[k]}</text>` : '';
      const label = (n <= 10 || i === 0 || i === n - 1 || i % Math.ceil(n / 6) === 0)
        ? `<text x="${cx(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#64707f">${esc(p.day.slice(5))}</text>` : '';
      return one('exams', '#9db6d6', -bw) + one('passed', '#1d7a4a', 0) + label;
    }).join('');
    const grid = [0, .5, 1].map(f => { const v = Math.round(max * f); return `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="#dde3ea"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#64707f">${v}</text>`; }).join('');
    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="近30天考試趨勢">${grid}${bars}</svg>`;
  }

  function recentTable(rows) {
    if (!rows.length) return '<p class="muted">尚無考試紀錄</p>';
    return `<div class="table-wrap"><table><thead><tr><th>時間</th><th>姓名</th><th>工號</th><th>科目</th><th>卷別</th><th>分數</th><th>結果</th></tr></thead><tbody>${rows.map(r =>
      `<tr><td>${fmtDate(r.submitted_at)}</td><td>${esc(r.profiles && r.profiles.full_name)}</td><td>${esc(r.profiles && r.profiles.employee_id)}</td>
       <td>${esc(r.subjects && r.subjects.name)}</td><td>${esc(r.paper_code)}</td><td>${r.score}</td>
       <td>${r.passed ? '<span class="badge ok">通過</span>' : '<span class="badge bad">不通過</span>'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  /* ================= 訓練紀錄 ================= */
  let trainingRows = [];
  async function renderTraining() {
    const box = $('view-training');
    box.innerHTML = `
      <div class="card">
        <div class="row">
          <label class="field"><span>科目</span><select id="tr-subject">${subjectOptions(true)}</select></label>
          <label class="field"><span>狀態</span><select id="tr-status"><option value="">全部</option><option value="completed">及格完訓</option><option value="failed">未及格</option></select></label>
          <label class="field" style="flex:1;min-width:180px"><span>搜尋（姓名 / 工號 / Email）</span><input type="search" id="tr-q"></label>
          <button class="btn secondary" id="tr-export" type="button" style="align-self:flex-end">匯出 CSV</button>
        </div>
      </div>
      <div id="tr-table" style="margin-top:16px"><p class="muted">載入中…</p></div>`;
    try {
      trainingRows = await App.fetchAll(() => App.sb.from('training_records')
        .select('user_id,subject_id,attempts,best_score,last_score,status,completed_at,last_exam_at,note,profiles(full_name,employee_id,email),subjects(name)')
        .order('last_exam_at', { ascending: false }));
    } catch (e) { $('tr-table').innerHTML = '<div class="msg err">' + esc(errMsg(e)) + '</div>'; return; }
    drawTraining();
  }
  const trainingFiltered = () => {
    const sid = $('tr-subject').value, st = $('tr-status').value, q = $('tr-q').value.trim().toLowerCase();
    return trainingRows.filter(r => (!sid || r.subject_id === sid) && (!st || r.status === st) &&
      (!q || [r.profiles && r.profiles.full_name, r.profiles && r.profiles.employee_id, r.profiles && r.profiles.email].join(' ').toLowerCase().includes(q)));
  };
  function drawTraining() {
    const rows = trainingFiltered();
    const done = rows.filter(r => r.status === 'completed').length;
    $('tr-table').innerHTML = `<p class="muted small">共 ${rows.length} 筆 ・ 及格完訓 ${done} ・ 未及格 ${rows.length - done}</p>` +
      (rows.length ? `<div class="table-wrap"><table><thead><tr><th>姓名</th><th>工號</th><th>科目</th><th>狀態</th><th>考試次數</th><th>最高分</th><th>最近分數</th><th>完訓日</th><th>最近考試</th><th>備註</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr>
        <td>${esc(r.profiles && r.profiles.full_name)}<div class="small muted">${esc(r.profiles && r.profiles.email)}</div></td>
        <td>${esc(r.profiles && r.profiles.employee_id)}</td><td>${esc(r.subjects && r.subjects.name)}</td>
        <td>${r.status === 'completed' ? '<span class="badge ok">及格完訓</span>' : '<span class="badge bad">未及格</span>'}</td>
        <td>${r.attempts}</td><td>${r.best_score ?? '—'}</td><td>${r.last_score ?? '—'}</td>
        <td>${r.completed_at ? fmtDate(r.completed_at) : '—'}</td><td>${fmtDate(r.last_exam_at)}</td>
        <td><input type="text" maxlength="500" value="${esc(r.note)}" data-note="${esc(r.user_id)}|${esc(r.subject_id)}"></td>
        <td><button class="btn sm secondary" data-savenote="${esc(r.user_id)}|${esc(r.subject_id)}" type="button">儲存</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="card muted">沒有符合的紀錄</div>');
  }
  $('view-training').addEventListener('input', e => { if (['tr-q'].includes(e.target.id)) drawTraining(); });
  $('view-training').addEventListener('change', e => { if (['tr-subject', 'tr-status'].includes(e.target.id)) drawTraining(); });
  $('view-training').addEventListener('click', async e => {
    if (e.target.id === 'tr-export') {
      const rows = trainingFiltered();
      App.downloadCSV('training_records.csv', [['姓名', '工號', 'Email', '科目', '狀態', '考試次數', '最高分', '最近分數', '完訓日', '最近考試', '備註']]
        .concat(rows.map(r => [r.profiles && r.profiles.full_name, r.profiles && r.profiles.employee_id, r.profiles && r.profiles.email,
          r.subjects && r.subjects.name, r.status === 'completed' ? '及格完訓' : '未及格', r.attempts, r.best_score, r.last_score,
          r.completed_at ? fmtDate(r.completed_at) : '', fmtDate(r.last_exam_at), r.note])));
      return;
    }
    const b = e.target.closest('[data-savenote]'); if (!b) return;
    const [uid, sid] = b.dataset.savenote.split('|');
    const input = [...document.querySelectorAll('[data-note]')].find(i => i.dataset.note === b.dataset.savenote);
    const { error } = await App.sb.from('training_records').update({ note: input.value.trim() }).eq('user_id', uid).eq('subject_id', sid);
    if (error) return toast(errMsg(error), 'err');
    const row = trainingRows.find(r => r.user_id === uid && r.subject_id === sid); if (row) row.note = input.value.trim();
    toast('備註已儲存', 'ok');
  });

  /* ================= 科目與及格分數 ================= */
  function renderSubjects() {
    $('view-subjects').innerHTML = `
      <div class="card">
        <h3>新增科目</h3>
        <form id="form-subject" class="row" style="align-items:flex-end">
          <label class="field" style="flex:1;min-width:180px"><span>科目名稱</span><input type="text" id="ns-name" maxlength="80" required></label>
          <label class="field"><span>及格分數</span><input type="number" id="ns-pass" min="0" max="100" value="60" required style="width:90px"></label>
          <label class="field"><span>每次題數</span><input type="number" id="ns-count" min="1" max="200" value="10" required style="width:90px"></label>
          <label class="field"><span>時間(分)</span><input type="number" id="ns-dur" min="1" max="300" value="30" required style="width:90px"></label>
          <button class="btn" type="submit">新增</button>
        </form>
      </div>
      <h3 style="margin-top:22px">科目設定</h3>
      <div class="table-wrap"><table><thead><tr><th>科目名稱</th><th>說明</th><th>及格分數</th><th>每次題數</th><th>時間(分)</th><th>開放</th><th></th></tr></thead><tbody>
      ${subjects.map(s => `<tr data-row="${esc(s.id)}">
        <td><input type="text" data-f="name" maxlength="80" value="${esc(s.name)}"></td>
        <td><input type="text" data-f="description" maxlength="500" value="${esc(s.description)}"></td>
        <td><input type="number" data-f="pass_score" min="0" max="100" value="${s.pass_score}"></td>
        <td><input type="number" data-f="questions_per_exam" min="1" max="200" value="${s.questions_per_exam}"></td>
        <td><input type="number" data-f="duration_min" min="1" max="300" value="${s.duration_min}"></td>
        <td><input type="checkbox" data-f="is_active" ${s.is_active ? 'checked' : ''}></td>
        <td class="row"><button class="btn sm" data-save="${esc(s.id)}" type="button">儲存</button>
            <button class="btn sm danger" data-del="${esc(s.id)}" type="button">刪除</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">尚無科目，請先新增</td></tr>'}
      </tbody></table></div>
      <p class="small muted">提醒：修改及格分數只影響之後的考試；已完成的考試保留當時的及格標準。</p>`;
  }
  $('view-subjects').addEventListener('submit', async e => {
    if (e.target.id !== 'form-subject') return;
    e.preventDefault();
    const { error } = await App.sb.from('subjects').insert({
      name: $('ns-name').value.trim(), pass_score: +$('ns-pass').value, questions_per_exam: +$('ns-count').value, duration_min: +$('ns-dur').value });
    if (error) return toast(errMsg(error), 'err');
    toast('已新增科目', 'ok'); show('subjects');
  });
  $('view-subjects').addEventListener('click', async e => {
    const save = e.target.closest('[data-save]'), del = e.target.closest('[data-del]');
    if (save) {
      const row = document.querySelector(`[data-row="${CSS.escape(save.dataset.save)}"]`), p = {};
      row.querySelectorAll('[data-f]').forEach(i => { p[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value.trim(); });
      const { error } = await App.sb.from('subjects').update(p).eq('id', save.dataset.save);
      return error ? toast(errMsg(error), 'err') : toast('已儲存', 'ok');
    }
    if (del) {
      const s = subjects.find(x => x.id === del.dataset.del);
      if (!confirm(`確定刪除科目「${s.name}」？\n該科目的所有題目、考試與訓練紀錄都會一併刪除，無法復原！`)) return;
      if (prompt('請輸入科目名稱以確認刪除') !== s.name) return toast('名稱不符，已取消');
      const { error } = await App.sb.from('subjects').delete().eq('id', s.id);
      if (error) return toast(errMsg(error), 'err');
      toast('已刪除', 'ok'); show('subjects');
    }
  });

  /* ================= 題庫匯入與管理 ================= */
  let pending = null;      // 解析後待匯入的題目
  let qSubject = '', qPage = 0, qSearch = '';
  const PAGE = 20;

  function renderQuestions() {
    if (!qSubject && subjects.length) qSubject = subjects[0].id;
    $('view-questions').innerHTML = `
      <div class="card">
        <div class="row between"><h3 style="margin:0">匯入考古題</h3>
          <div class="row"><button class="btn sm secondary" id="tpl-xlsx" type="button">下載 Excel 範本</button>
          <button class="btn sm secondary" id="tpl-csv" type="button">下載 CSV 範本</button></div></div>
        <div class="row" style="margin-top:12px;align-items:flex-end">
          <label class="field"><span>匯入到科目</span><select id="q-subject">${subjectOptions(false, qSubject)}</select></label>
          <label class="field" style="flex:1;min-width:220px"><span>檔案（xlsx / xls / csv / pdf / txt，上限 10MB）</span>
            <input type="file" id="q-file" accept=".xlsx,.xls,.csv,.pdf,.txt"></label>
        </div>
        <details style="margin-top:12px"><summary class="small muted" style="cursor:pointer">Excel / CSV / PDF 格式說明</summary>
          <p class="small muted"><strong>Excel / CSV：</strong>第一列為欄位名稱：題目、選項A、選項B、選項C、選項D（選項E 可省略）、答案（A-E 或 1-5）、解析。</p>
          <p class="small muted"><strong>PDF / TXT：</strong>需為可選取文字的檔案（掃描圖片 PDF 無法解析），每題格式如下：</p>
<pre class="sample">1. 題目文字
A. 選項一
B. 選項二
C. 選項三
D. 選項四
答案：B
解析：說明文字（可省略）</pre></details>
        <div id="q-preview"></div>
      </div>
      <div class="card" id="q-list-card">
        <div class="row between"><h3 style="margin:0">題庫管理</h3>
          <input type="search" id="q-search" placeholder="搜尋題目關鍵字" style="max-width:260px" value="${esc(qSearch)}"></div>
        <div id="q-list" style="margin-top:12px"></div>
      </div>`;
    pending = null;
    loadQuestionList();
  }

  async function loadQuestionList() {
    const box = $('q-list'); if (!box) return;
    if (!qSubject) { box.innerHTML = '<p class="muted">請先到「科目與及格分數」新增科目</p>'; return; }
    box.innerHTML = '<p class="muted">載入中…</p>';
    let q = App.sb.from('questions').select('id,content,options,answer_index,explanation', { count: 'exact' }).eq('subject_id', qSubject);
    if (qSearch) q = q.ilike('content', '%' + qSearch.replace(/[%_\\]/g, m => '\\' + m) + '%');
    const { data, count, error } = await q.order('created_at', { ascending: false }).range(qPage * PAGE, qPage * PAGE + PAGE - 1);
    if (error) { box.innerHTML = '<div class="msg err">' + esc(errMsg(error)) + '</div>'; return; }
    const pages = Math.max(1, Math.ceil(count / PAGE));
    box.innerHTML = `<p class="muted small">此科目共 ${count} 題</p>` + (data.length ? `<div class="table-wrap"><table><thead><tr><th>題目 / 選項</th><th>答案</th><th></th></tr></thead><tbody>
      ${data.map(r => `<tr><td><div>${esc(r.content)}</div><div class="small muted">${r.options.map((o, i) => LETTERS[i] + '. ' + esc(o)).join('　')}</div>
        ${r.explanation ? `<div class="small" style="color:var(--warn)">解析：${esc(r.explanation)}</div>` : ''}</td>
        <td><strong>${LETTERS[r.answer_index]}</strong></td>
        <td><button class="btn sm danger" data-delq="${esc(r.id)}" type="button">刪除</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row between" style="margin-top:10px"><button class="btn sm secondary" data-page="-1" type="button" ${qPage === 0 ? 'disabled' : ''}>上一頁</button>
        <span class="small muted">第 ${qPage + 1} / ${pages} 頁</span>
        <button class="btn sm secondary" data-page="1" type="button" ${qPage + 1 >= pages ? 'disabled' : ''}>下一頁</button></div>` : '<p class="muted">沒有題目</p>');
  }

  $('view-questions').addEventListener('change', async e => {
    if (e.target.id === 'q-subject') { qSubject = e.target.value; qPage = 0; loadQuestionList(); }
    if (e.target.id === 'q-file') {
      const out = $('q-preview'); pending = null;
      const f = e.target.files[0]; if (!f) { out.innerHTML = ''; return; }
      out.innerHTML = '<p class="muted">解析中…</p>';
      try {
        const res = await Importer.parse(f);
        pending = res.valid;
        out.innerHTML = `<div class="msg ${res.errors.length ? 'info' : 'ok'}">解析完成：可匯入 <strong>${res.valid.length}</strong> 題，有問題 <strong>${res.errors.length}</strong> 題（將略過）</div>
          ${res.errors.length ? '<ul class="err-list">' + res.errors.slice(0, 100).map(x => `<li>第 ${esc(x.line)} 筆：${esc(x.error)} ${x.content ? '— ' + esc(x.content.slice(0, 30)) : ''}</li>`).join('') + '</ul>' : ''}
          ${res.valid.length ? `<div class="table-wrap" style="margin-top:12px;max-height:260px;overflow:auto"><table><thead><tr><th>#</th><th>題目</th><th>選項數</th><th>答案</th></tr></thead><tbody>
            ${res.valid.slice(0, 30).map(x => `<tr><td>${esc(x.line)}</td><td>${esc(x.content)}</td><td>${x.options.length}</td><td>${LETTERS[x.answer_index]}</td></tr>`).join('')}</tbody></table></div>
            ${res.valid.length > 30 ? `<p class="small muted">僅預覽前 30 題</p>` : ''}
            <button class="btn" id="q-import" type="button" style="margin-top:12px">確認匯入 ${res.valid.length} 題</button>` : ''}`;
      } catch (err) { out.innerHTML = '<div class="msg err">' + esc(errMsg(err)) + '</div>'; }
    }
  });

  $('view-questions').addEventListener('input', e => {
    if (e.target.id === 'q-search') {
      clearTimeout(renderQuestions._t);
      renderQuestions._t = setTimeout(() => { qSearch = e.target.value.trim(); qPage = 0; loadQuestionList(); }, 350);
    }
  });

  $('view-questions').addEventListener('click', async e => {
    const t = e.target;
    if (t.id === 'tpl-csv') return App.downloadCSV('question_template.csv', Importer.TEMPLATE);
    if (t.id === 'tpl-xlsx') {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(Importer.TEMPLATE), '題庫');
      return XLSX.writeFile(wb, 'question_template.xlsx');
    }
    const pg = t.closest('[data-page]');
    if (pg) { qPage = Math.max(0, qPage + Number(pg.dataset.page)); return loadQuestionList(); }
    const dq = t.closest('[data-delq]');
    if (dq) {
      if (!confirm('確定刪除此題？（歷史考試紀錄不受影響）')) return;
      const { error } = await App.sb.from('questions').delete().eq('id', dq.dataset.delq);
      if (error) return toast(errMsg(error), 'err');
      toast('已刪除', 'ok'); return loadQuestionList();
    }
    if (t.id === 'q-import' && pending && qSubject) {
      t.disabled = true;
      try {
        // 略過科目內已存在的相同題目
        const existing = await App.fetchAll(() => App.sb.from('questions').select('content').eq('subject_id', qSubject).order('created_at'));
        const seen = new Set(existing.map(x => x.content));
        const fresh = pending.filter(x => !seen.has(x.content));
        for (let i = 0; i < fresh.length; i += 200) {
          const chunk = fresh.slice(i, i + 200).map(x => ({ subject_id: qSubject, content: x.content, options: x.options, answer_index: x.answer_index, explanation: x.explanation }));
          const { error } = await App.sb.from('questions').insert(chunk);
          if (error) throw error;
        }
        toast(`匯入完成：新增 ${fresh.length} 題，略過重複 ${pending.length - fresh.length} 題`, 'ok');
        qPage = 0; renderQuestions();
      } catch (err) { toast(errMsg(err), 'err'); t.disabled = false; }
    }
  });

  show('dashboard');
})();
