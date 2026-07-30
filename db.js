// db.js - Supabase 数据层（替代 localStorage）
// ====== 数据操作 ======

// 从 Supabase 加载指定模块数据
async function cloudLoad(module, defaultVal = null) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return defaultVal;
  
  const { data, error } = await supabase
    .from('workspace_data')
    .select('data')
    .eq('user_id', user.id)
    .eq('module', module)
    .maybeSingle();
  
  if (error) {
    console.error('cloudLoad error:', module, error);
    return defaultVal;
  }
  return data ? data.data : defaultVal;
}

// 保存数据到 Supabase（先查后写，避免依赖数据库唯一约束）
async function cloudSave(module, value) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  
  try {
    // 先查询是否已有该模块的记录
    const { data: existing } = await supabase
      .from('workspace_data')
      .select('id')
      .eq('user_id', user.id)
      .eq('module', module)
      .maybeSingle();
    
    if (existing) {
      // 更新已有记录
      const { error } = await supabase
        .from('workspace_data')
        .update({ data: value, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) console.error('cloudSave update error:', module, error);
    } else {
      // 插入新记录
      const { error } = await supabase
        .from('workspace_data')
        .insert({
          user_id: user.id,
          module: module,
          data: value,
          updated_at: new Date().toISOString()
        });
      if (error) console.error('cloudSave insert error:', module, error);
    }
  } catch (e) {
    console.error('cloudSave error:', module, e);
  }
}

// ====== 初始化：从云端加载所有数据 ======
async function initCloudData() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // 并行加载所有模块
  const [t, a, m, i, d, l, w, h, b] = await Promise.all([
    cloudLoad('todos', []),
    cloudLoad('accounts', null),
    cloudLoad('metrics', []),
    cloudLoad('ideas', []),
    cloudLoad('diets', []),
    cloudLoad('ledger', []),
    cloudLoad('weights', []),
    cloudLoad('heightCm', { v: 160 }),
    cloudLoad('budget', null),
  ]);

  // 填充到全局变量
  todos = t;
  if (a) accounts = a;
  if (m && m.length) metrics = m;
  ideas = i;
  diets = d;
  ledger = l;
  weights = w;
  heightCm = h?.v || 160;
  budget = b;

  // 如果没有预置账号，初始化
  if (!accounts) {
    accounts = [
      {id:'xhs1',platform:'小红书',name:'米妮汉堡包',status:'更新中',url:'https://xhslink.cn/m/6bavfH4LXdF',note:'主力账号'},
      {id:'xhs2',platform:'小红书',name:'426266',status:'更新中',url:'https://xhslink.cn/m/6GCcpvyLrwK',note:'13.5K 赞藏'},
      {id:'dy1',platform:'抖音',name:'米妮汉堡包',status:'更新中',url:'https://v.douyin.com/D3DyGEKtlxU/',note:'短视频阵地'},
      {id:'xhs3',platform:'小红书',name:'用户426266',status:'更新中',url:'https://xhslink.cn/m/1j6bhCePQZG',note:'715 赞与收藏'}
    ];
    cloudSave('accounts', accounts);
  }
  if (!metrics || !metrics.length) {
    metrics = [];
    // 录入基线
    const baseDate = '2026-07-29';
    [['xhs1',4624],['xhs2',657],['dy1',873]].forEach(([aid, fans]) => {
      metrics.push({ id: uid(), accountId: aid, date: baseDate, fans });
    });
    cloudSave('metrics', metrics);
  }

  // 触发渲染
  if (typeof renderAll === 'function') renderAll();
}

// ====== 实时同步监听 ======
async function enableRealtime() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  supabase
    .channel('workspace-changes')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'workspace_data',
      filter: `user_id=eq.${user.id}`
    }, async (payload) => {
      // 收到远端变更，重新加载对应模块
      const module = payload.new?.module || payload.old?.module;
      if (!module) return;
      
      const fresh = await cloudLoad(module);
      switch (module) {
        case 'todos': todos = fresh || []; break;
        case 'accounts': accounts = fresh; break;
        case 'metrics': metrics = fresh || []; break;
        case 'ideas': ideas = fresh || []; break;
        case 'diets': diets = fresh || []; break;
        case 'ledger': ledger = fresh || []; break;
        case 'weights': weights = fresh || []; break;
        case 'heightCm': heightCm = fresh?.v || 160; break;
        case 'budget': budget = fresh; break;
      }
      if (typeof renderAll === 'function') renderAll();
    })
    .subscribe();
}

// 初始化后开启实时同步
document.addEventListener('DOMContentLoaded', () => {
  // 检查是否已登录
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      document.getElementById('auth-overlay').classList.add('hidden');
      document.getElementById('app-content').classList.remove('hidden');
      initCloudData().then(() => enableRealtime());
    }
  });
});
