// auth.js - 登录/注册逻辑（修复版：注册后自动登录）
let authMode = 'login';

function toggleAuthMode() {
  authMode = authMode === 'login' ? 'register' : 'login';
  document.getElementById('authTitle').textContent = authMode === 'login' ? '登录 hamboo工作台' : '注册 hamboo工作台';
  document.getElementById('authBtn').textContent = authMode === 'login' ? '登录' : '注册';
  document.getElementById('authSwitchText').textContent = authMode === 'login' ? '没有账号？' : '已有账号？';
  document.getElementById('authSwitchLink').textContent = authMode === 'login' ? '注册' : '登录';
  document.getElementById('authErr').textContent = '';
}

function resetBtn() {
  const btn = document.getElementById('authBtn');
  btn.textContent = authMode === 'login' ? '登录' : '注册';
  btn.disabled = false;
}

async function authSubmit() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authErr');

  if (!email || !password) {
    errEl.textContent = '请填写邮箱和密码';
    return;
  }

  const btn = document.getElementById('authBtn');
  btn.textContent = '处理中...';
  btn.disabled = true;
  errEl.textContent = '';

  try {
    if (authMode === 'register') {
      // 注册
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        if (error.message.includes('already registered') || error.message.includes('already exists')) {
          errEl.textContent = '该邮箱已注册，请切换到「登录」';
        } else {
          errEl.textContent = error.message;
        }
        resetBtn();
        return;
      }
      // 注册成功，如果 session 存在（未开邮件确认），自动进入
      if (data.session) {
        // 有 session，onAuthStateChange 会自动触发
        return;
      }
      // 需要邮件确认
      errEl.textContent = '注册成功！如开启邮件确认，请查收验证邮件后登录。';
      // 自动切换到登录模式
      toggleAuthMode();
      resetBtn();
      return;
    }

    // 登录
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      errEl.textContent = error.message === 'Invalid login credentials' 
        ? '邮箱或密码错误，请重试' 
        : error.message;
      resetBtn();
      return;
    }
    // 登录成功，onAuthStateChange 自动触发
  } catch (e) {
    errEl.textContent = '网络错误，请检查连接后重试';
    resetBtn();
  }
}

// 监听认证状态
supabase.auth.onAuthStateChange(async (event, session) => {
  if (session) {
    document.getElementById('auth-overlay').classList.add('hidden');
    document.getElementById('app-content').classList.remove('hidden');
    await initCloudData();
  } else {
    document.getElementById('auth-overlay').classList.remove('hidden');
    document.getElementById('app-content').classList.add('hidden');
  }
});

async function logout() {
  await supabase.auth.signOut();
}
