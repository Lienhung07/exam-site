(function () {
  const $ = id => document.getElementById(id);
  const msg = (text, type = 'err') => { const m = $('auth-msg'); m.textContent = text; m.className = 'msg ' + type; };
  const clearMsg = () => { $('auth-msg').className = 'msg hidden'; };

  function show(which) {
    const login = which === 'login';
    $('form-login').classList.toggle('hidden', !login);
    $('form-register').classList.toggle('hidden', login);
    $('tab-login').classList.toggle('active', login);
    $('tab-register').classList.toggle('active', !login);
    clearMsg();
  }
  $('tab-login').addEventListener('click', () => show('login'));
  $('tab-register').addEventListener('click', () => show('register'));

  if (!App.configured) { App.showConfigBanner(); return; }

  async function goHome() {
    const { data: { session } } = await App.sb.auth.getSession();
    if (!session) return false;
    const { data: p } = await App.sb.from('profiles').select('role').eq('id', session.user.id).single();
    location.replace(p && p.role === 'admin' ? 'admin.html' : 'exam.html');
    return true;
  }
  goHome();

  $('form-login').addEventListener('submit', async e => {
    e.preventDefault(); clearMsg();
    const btn = $('btn-login'); btn.disabled = true;
    const { error } = await App.sb.auth.signInWithPassword({ email: $('login-email').value.trim(), password: $('login-pass').value });
    btn.disabled = false;
    if (error) return msg(App.errMsg(error));
    goHome();
  });

  $('form-register').addEventListener('submit', async e => {
    e.preventDefault(); clearMsg();
    const btn = $('btn-register'); btn.disabled = true;
    const { data, error } = await App.sb.auth.signUp({
      email: $('reg-email').value.trim(),
      password: $('reg-pass').value,
      options: { data: { full_name: $('reg-name').value.trim(), employee_id: $('reg-empid').value.trim() } }
    });
    btn.disabled = false;
    if (error) return msg(App.errMsg(error));
    if (data.session) return goHome();
    msg('註冊成功！請（先到信箱完成驗證，再）等待管理員核准後即可考試。', 'ok');
  });
})();
