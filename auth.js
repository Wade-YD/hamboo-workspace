// auth.js - 登录/注册逻辑
let authMode = 'login'; // 'login' | 'register'

function toggleAuthMode() {
  authMode = authMode === 'login' ? 'register' : 'login';
  document.getElementById('authTitle').textContent = authMode === 'login' ? '登录 hamboo工作台' : '注册 hamboo工作台';
  document.getElementById('authBtn').textContent = authMode === 'login' ? '登录' : '注册';
  document.getElementById('authSwitchText').textContent = authMode === 'login' ? '没有账号？' : '已有账号？';
  document.getElementById('authSwitchLink').textContent = authMode === 'login' ? '注册' : '登录';
  document.getElementById('authErr').textContent = '';
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

  let result;
  if (authMode === 'login') {
    result = await supabase.auth.signInWithPassword({ email, password });
  } else {
    result = await supabase.auth.signUp({ email, password });
    if (!result.error && result.data.user) {
      errEl.textContent = '注册成功！请查看邮箱确认（如未收到检查垃圾邮件）';
      btn.textContent = authMode === 'login' ? '登录' : '注册';
      btn.disabled = false;
      return;
    }
  }

  if (result.error) {
    errEl.textContent = result.error.message || '操作失败，请重试';
    btn.textContent = authMode === 'login' ? '登录' : '注册';
    btn.disabled = false;
  }
  // 登录成功后 auth state change 会自动触发
}

// 监听认证状态
supabase.auth.onAuthStateChange(async (event, session) => {
  if (session) {
    document.getElementById('auth-overlay').classList.add('hidden');
    document.getElementById('app-content').classList.remove('hidden');
    await initCloudData(); // 在 db.js 中定义
  } else {
    document.getElementById('auth-overlay').classList.remove('hidden');
    document.getElementById('app-content').classList.add('hidden');
  }
});

// 登出（供外部调用）
async function logout() {
  await supabase.auth.signOut();
}
