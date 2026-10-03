// 前台：選科目 → 考試 → 結果 → 考試記錄 / 檢討
(async function () {
  const { esc, toast, errMsg, fmtDate } = App;
  const $ = id => document.getElementById(id);
  const VIEWS = ['subjects', 'exam', 'result', 'history', 'review'];
  const LETTERS = ['A', 'B', 'C', 'D', 'E'];

  const me = await App.requireAuth();
  if (!me) return;
  if (me.role === 'admin') $('link-admin').classList.remove('hidden');

  // 尚未通過管理員審核：只顯示等待畫面（資料庫端同樣會拒絕開考與讀取科目）
  if (me.role !== 'admin' && !me.approved) {
    $('main-tabs').classList.add('hidden');
    $('view-subjects').innerHTML = `
      <div class="card result-hero">
        <h2>帳號審核中</h2>
        <p class="muted">您的帳號（${esc(me.email)}）已建立，需由管理員核准後才能開始考試。<br>核准後重新整理本頁即可使用。</p>
        <button class="btn secondary" id="btn-recheck" type="button">重新檢查審核狀態</button>
      </div>`;
    $('btn-recheck').addEventListener('click', () => location.reload());
    return;
  }

  let cur = null; // 目前進行中的考試 { data, answers, idx, timer, offset }

  function show(name) {
    VIEWS.forEach(v => $('view-' + v).classList.toggle('hidden', v !== name));
    const tabbed = name === 'subjects' || name === 'history';
    $('main-tabs').classList.toggle('hidden', !tabbed && name !== 'review' && name !== 'result');
    document.querySelectorAll('#main-tabs .tab').forEach(t =>
      t.classList.toggle('active', t.dataset.view === (name === 'review' ? 'history' : name === 'result' ? 'subjects' : name)));
    window.scrollTo(0, 0);
  }
  $('main-tabs').addEventListener('click', e => {
    const t = e.target.closest('.tab'); if (!t) return;
    if (t.dataset.view === 'subjects') loadSubjects(); else loadHistory();
  });

  /* ---------------- 科目列表 ---------------- */
  async function loadSubjects() {
    show('subjects');
    const box = $('view-subjects');
    box.innerHTML = '<p class="muted">載入中…</p>';
    const [subj, rec] = await Promise.all([
      App.sb.from('subjects').select('id,name,description,pass_score,questions_per_exam,duration_min').eq('is_active', true).order('name'),
      App.sb.from('training_records').select('subject_id,status,best_score,attempts').eq('user_id', me.id)
    ]);
    if (subj.error) { box.innerHTML = '<div class="msg err">' + esc(errMsg(subj.error)) + '</div>'; return; }
    const recMap = Object.fromEntries((rec.data || []).map(r => [r.subject_id, r]));
    if (!subj.data.length) { box.innerHTML = '<div class="card muted">目前沒有開放的考試科目。</div>'; return; }

    box.innerHTML = '<h2>選擇考試科目</h2><div class="grid cols-3">' + subj.data.map(s => {
      const r = recMap[s.id];
      const badge = !r ? '<span class="badge gray">尚未考試</span>'
        : r.status === 'completed' ? '<span class="badge ok">已及格完訓</span>' : '<span class="badge bad">尚未及格</span>';
      return `<div class="card">
        <div class="row between"><h3>${esc(s.name)}</h3>${badge}</div>
        <p class="muted small">${esc(s.description) || '&nbsp;'}</p>
        <ul class="small muted" style="padding-left:18px;margin:8px 0 14px">
          <li>題數：${s.questions_per_exam} 題</li><li>時間：${s.duration_min} 分鐘</li><li>及格分數：${s.pass_score} 分</li>
          ${r ? `<li>已考 ${r.attempts} 次，最高 ${r.best_score} 分</li>` : ''}
        </ul>
        <button class="btn block" data-start="${esc(s.id)}" type="button">開始考試</button>
      </div>`;
    }).join('') + '</div>';
  }
  $('view-subjects').addEventListener('click', async e => {
    const b = e.target.closest('[data-start]'); if (!b) return;
    b.disabled = true;
    try { await startExam(b.dataset.start); }
    catch (err) { toast(errMsg(err), 'err'); b.disabled = false; }
  });

  /* ---------------- 考試 ---------------- */
  async function startExam(subjectId) {
    const { data, error } = await App.sb.rpc('start_exam', { p_subject_id: subjectId });
    if (error) throw error;
    const key = 'ans_' + data.exam_id;
    let saved = {};
    try { saved = JSON.parse(sessionStorage.getItem(key) || '{}'); } catch (_) { /* ignore */ }
    cur = { data, key, answers: saved, idx: 0, offset: new Date(data.server_now).getTime() - Date.now(), timer: null, submitting: false };
    renderExam();
    cur.timer = setInterval(tick, 500);
    tick();
  }

  function remainingMs() { return new Date(cur.data.expires_at).getTime() - (Date.now() + cur.offset); }

  function tick() {
    if (!cur) return;
    const ms = Math.max(0, remainingMs());
    const el = $('timer');
    if (el) {
      const s = Math.ceil(ms / 1000);
      el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
      el.classList.toggle('low', s <= 60);
    }
    if (ms <= 0 && !cur.submitting) { toast('時間到，系統自動交卷'); submit(true); }
  }

  function renderExam() {
    show('exam');
    const { data, answers, idx } = cur;
    const qs = data.questions, q = qs[idx];
    const answered = Object.keys(answers).length;
    $('view-exam').innerHTML = `
      <div class="exam-head row between">
        <div><strong>${esc(data.subject)}</strong> <span class="badge gray">卷別 ${esc(data.paper_code)}</span>
          <div class="small muted">及格 ${data.pass_score} 分 ・ 已作答 ${answered}/${qs.length}</div></div>
        <div class="timer" id="timer">--:--</div>
      </div>
      <div class="exam-layout noselect">
        <div class="card">
          <div class="muted small">第 ${idx + 1} / ${qs.length} 題</div>
          <div class="q-text">${esc(q.content)}</div>
          ${q.options.map((o, i) => `
            <label class="opt ${answers[q.id] === i ? 'selected' : ''}">
              <input type="radio" name="opt" value="${i}" ${answers[q.id] === i ? 'checked' : ''}>
              <span><strong>${LETTERS[i]}.</strong> ${esc(o)}</span>
            </label>`).join('')}
          <div class="row between" style="margin-top:16px">
            <button class="btn secondary" data-nav="-1" type="button" ${idx === 0 ? 'disabled' : ''}>上一題</button>
            ${idx < qs.length - 1
              ? '<button class="btn" data-nav="1" type="button">下一題</button>'
              : '<button class="btn" data-submit type="button">交卷</button>'}
          </div>
        </div>
        <div class="card">
          <h3>題號</h3>
          <div class="qnav">${qs.map((x, i) =>
            `<button type="button" data-goto="${i}" class="${answers[x.id] !== undefined ? 'answered' : ''} ${i === idx ? 'current' : ''}">${i + 1}</button>`).join('')}</div>
          <button class="btn block" style="margin-top:16px" data-submit type="button">交卷</button>
        </div>
      </div>`;
    tick();
  }

  $('view-exam').addEventListener('click', e => {
    if (!cur) return;
    const nav = e.target.closest('[data-nav]');
    const go = e.target.closest('[data-goto]');
    if (nav) { cur.idx += Number(nav.dataset.nav); renderExam(); }
    else if (go) { cur.idx = Number(go.dataset.goto); renderExam(); }
    else if (e.target.closest('[data-submit]')) submit(false);
  });
  $('view-exam').addEventListener('change', e => {
    if (!cur || e.target.name !== 'opt') return;
    cur.answers[cur.data.questions[cur.idx].id] = Number(e.target.value);
    try { sessionStorage.setItem(cur.key, JSON.stringify(cur.answers)); } catch (_) { /* ignore */ }
    renderExam();
  });
  // 考試中禁止右鍵 / 複製（僅作為基本防護）
  $('view-exam').addEventListener('contextmenu', e => e.preventDefault());
  $('view-exam').addEventListener('copy', e => e.preventDefault());

  async function submit(auto) {
    if (!cur || cur.submitting) return;
    const total = cur.data.questions.length, done = Object.keys(cur.answers).length;
    if (!auto && done < total && !confirm(`還有 ${total - done} 題未作答，確定要交卷嗎？`)) return;
    if (!auto && done === total && !confirm('確定要交卷嗎？交卷後無法修改。')) return;
    cur.submitting = true;
    clearInterval(cur.timer);
    const { data, error } = await App.sb.rpc('submit_exam', { p_exam_id: cur.data.exam_id, p_answers: cur.answers });
    if (error) { toast(errMsg(error), 'err'); cur.submitting = false; cur.timer = setInterval(tick, 500); return; }
    try { sessionStorage.removeItem(cur.key); } catch (_) { /* ignore */ }
    const examId = cur.data.exam_id, subject = cur.data.subject;
    cur = null;
    renderResult(data, examId, subject);
  }

  function renderResult(r, examId, subject) {
    show('result');
    $('view-result').innerHTML = `
      <div class="card result-hero ${r.passed ? 'pass' : 'fail'}">
        <div class="muted">${esc(subject)}</div>
        <div class="score">${r.score}<span style="font-size:1.4rem"> 分</span></div>
        <div class="verdict">${r.passed ? '✔ 通過' : '✘ 不通過'}</div>
        <p class="muted">答對 ${r.correct_count} / ${r.total} 題 ・ 及格分數 ${r.pass_score} 分</p>
        <div class="row" style="justify-content:center;margin-top:12px">
          <button class="btn" data-review="${esc(examId)}" type="button">查看答題結果與解析</button>
          <button class="btn secondary" id="btn-back" type="button">回科目列表</button>
        </div>
      </div>`;
  }
  $('view-result').addEventListener('click', e => {
    const r = e.target.closest('[data-review]');
    if (r) return openReview(r.dataset.review);
    if (e.target.closest('#btn-back')) loadSubjects();
  });

  /* ---------------- 考試記錄 ---------------- */
  async function loadHistory() {
    show('history');
    const box = $('view-history');
    box.innerHTML = '<p class="muted">載入中…</p>';
    const { data, error } = await App.sb.from('exams')
      .select('id,paper_code,status,score,passed,correct_count,total,pass_score,submitted_at,started_at,subjects(name)')
      .eq('user_id', me.id).eq('status', 'submitted').order('submitted_at', { ascending: false }).limit(200);
    if (error) { box.innerHTML = '<div class="msg err">' + esc(errMsg(error)) + '</div>'; return; }
    if (!data.length) { box.innerHTML = '<div class="card muted">尚無考試記錄。</div>'; return; }
    box.innerHTML = `<h2>我的考試記錄</h2><div class="table-wrap"><table>
      <thead><tr><th>交卷時間</th><th>科目</th><th>卷別</th><th>分數</th><th>答對</th><th>結果</th><th></th></tr></thead><tbody>
      ${data.map(x => `<tr>
        <td>${fmtDate(x.submitted_at)}</td><td>${esc(x.subjects && x.subjects.name)}</td><td>${esc(x.paper_code)}</td>
        <td><strong>${x.score}</strong></td><td>${x.correct_count}/${x.total}</td>
        <td>${x.passed ? '<span class="badge ok">通過</span>' : '<span class="badge bad">不通過</span>'}</td>
        <td><button class="btn sm secondary" data-review="${esc(x.id)}" type="button">查看明細</button></td></tr>`).join('')}
      </tbody></table></div>`;
  }
  $('view-history').addEventListener('click', e => {
    const r = e.target.closest('[data-review]'); if (r) openReview(r.dataset.review);
  });

  async function openReview(examId) {
    show('review');
    const box = $('view-review');
    box.innerHTML = '<p class="muted">載入中…</p>';
    const [ex, qs] = await Promise.all([
      App.sb.from('exams').select('paper_code,score,passed,correct_count,total,pass_score,submitted_at,subjects(name)').eq('id', examId).single(),
      App.sb.from('exam_questions').select('position,content,options,answer_index,selected_index,is_correct,explanation').eq('exam_id', examId).order('position')
    ]);
    if (ex.error || qs.error) { box.innerHTML = '<div class="msg err">' + esc(errMsg(ex.error || qs.error)) + '</div>'; return; }
    const e = ex.data;
    box.innerHTML = `
      <div class="row between" style="margin-bottom:14px">
        <h2 style="margin:0">${esc(e.subjects && e.subjects.name)} 考試明細</h2>
        <button class="btn secondary" id="btn-hist" type="button">← 返回記錄</button>
      </div>
      <div class="card" style="margin-bottom:18px">
        <span class="badge ${e.passed ? 'ok' : 'bad'}">${e.passed ? '通過' : '不通過'}</span>
        <strong style="margin-left:8px">${e.score} 分</strong>
        <span class="muted"> ・ 答對 ${e.correct_count}/${e.total} ・ 及格 ${e.pass_score} 分 ・ 卷別 ${esc(e.paper_code)} ・ ${fmtDate(e.submitted_at)}</span>
      </div>
      <div class="card">${qs.data.map(q => `
        <div class="review-q ${q.is_correct ? 'right' : 'wrong'}">
          <div><span class="badge ${q.is_correct ? 'ok' : 'bad'}">${q.is_correct ? '答對' : (q.selected_index == null ? '未作答' : '答錯')}</span>
            <strong style="margin-left:6px">第 ${q.position} 題</strong></div>
          <div class="q-text" style="margin-top:6px">${esc(q.content)}</div>
          ${q.options.map((o, i) => {
            const cls = i === q.answer_index ? 'correct' : (i === q.selected_index ? 'mine-wrong' : '');
            const tag = i === q.answer_index ? ' ✔ 正確答案' : (i === q.selected_index ? ' ✘ 你的答案' : '');
            return `<div class="review-opt ${cls}"><strong>${LETTERS[i]}.</strong> ${esc(o)}<span class="small">${tag}</span></div>`;
          }).join('')}
          ${!q.is_correct && q.explanation ? `<div class="explain"><strong>錯誤說明：</strong>${esc(q.explanation)}</div>` : ''}
          ${q.is_correct && q.explanation ? `<div class="explain"><strong>解析：</strong>${esc(q.explanation)}</div>` : ''}
        </div>`).join('')}</div>`;
  }
  $('view-review').addEventListener('click', e => { if (e.target.closest('#btn-hist')) loadHistory(); });

  window.addEventListener('beforeunload', e => { if (cur) { e.preventDefault(); e.returnValue = ''; } });

  loadSubjects();
})();
