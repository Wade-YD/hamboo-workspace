// db.js - Supabase 数据层 + 离线同步
// ====== IndexedDB 本地缓存 ======
let idb = null;

function initOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('hamboo_offline', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache', { keyPath: 'module' });
      }
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => { idb = e.target.result; resolve(idb); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function idbOp(storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    if (!idb) { resolve(null); return; }
    try {
      const tx = idb.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = fn(store);
      if (req) {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } else {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }
    } catch(e) { resolve(null); }
  });
}

async function getCached(module) {
  try {
    const result = await idbOp('cache', 'readonly', s => s.get(module));
    return result ? result.data : null;
  } catch(e) { return null; }
}

async function setCached(module, value) {
  try {
    await idbOp('cache', 'readwrite', s => s.put({ module, data: value, ts: Date.now() }));
  } catch(e) { /* silent */ }
}

async function addToQueue(module, value) {
  try {
    await idbOp('queue', 'readwrite', s => s.add({ module, value, ts: Date.now() }));
  } catch(e) { /* silent */ }
}

async function getQueue() {
  try {
    return await idbOp('queue', 'readonly', s => s.getAll()) || [];
  } catch(e) { return []; }
}

async function clearQueueItem(id) {
  try {
    await idbOp('queue', 'readwrite', s => s.delete(id));
  } catch(e) { /* silent */ }
}

// ====== 在线状态 ======
function isOnline() { return navigator.onLine; }

// ====== 数据操作 ======
async function cloudLoad(module, defaultVal = null) {
  // 尝试从 Supabase 加载
  if (isOnline()) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data, error } = await supabase
          .from('workspace_data')
          .select('data')
          .eq('user_id', user.id)
          .eq('module', module)
          .maybeSingle();
        
        if (!error && data) {
          // 更新本地缓存
          await setCached(module, data.data);
          return data.data;
        }
        if (!error) {
          await setCached(module, defaultVal);
          return defaultVal;
        }
      }
    } catch(e) {
      console.warn('cloudLoad online failed, trying cache:', module, e.message);
    }
  }
  
  // 离线回退：从 IndexedDB 缓存读取
  const cached = await getCached(module);
  return cached !== null ? cached : defaultVal;
}

async function cloudSave(module, value) {
  // 立即写入本地缓存
  await setCached(module, value);
  
  if (isOnline()) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      // 先查询是否已有记录
      const { data: existing } = await supabase
        .from('workspace_data')
        .select('id')
        .eq('user_id', user.id)
        .eq('module', module)
        .maybeSingle();
      
      if (existing) {
        await supabase.from('workspace_data')
          .update({ data: value, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase.from('workspace_data')
          .insert({ user_id: user.id, module, data: value, updated_at: new Date().toISOString() });
      }
    } catch(e) {
      // 在线写入失败，加入离线队列
      console.warn('cloudSave online failed, queuing:', module, e.message);
      await addToQueue(module, value);
    }
  } else {
    // 离线：加入同步队列
    await addToQueue(module, value);
  }
  
  updateOnlineStatus();
}

// ====== 同步队列处理 ======
let syncInProgress = false;

async function processQueue() {
  if (syncInProgress || !isOnline()) return;
  syncInProgress = true;
  updateOnlineStatus();
  
  try {
    const queue = await getQueue();
    if (queue.length === 0) { syncInProgress = false; updateOnlineStatus(); return; }
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { syncInProgress = false; return; }
    
    for (const item of queue) {
      try {
        const { data: existing } = await supabase
          .from('workspace_data')
          .select('id')
          .eq('user_id', user.id)
          .eq('module', item.module)
          .maybeSingle();
        
        if (existing) {
          await supabase.from('workspace_data')
            .update({ data: item.value, updated_at: new Date().toISOString() })
            .eq('id', existing.id);
        } else {
          await supabase.from('workspace_data')
            .insert({ user_id: user.id, module: item.module, data: item.value, updated_at: new Date().toISOString() });
        }
        await clearQueueItem(item.id);
      } catch(e) {
        console.warn('Queue item failed:', item.module, e.message);
        break; // 失败则停止，保留剩余队列等下次重试
      }
    }
  } catch(e) { /* silent */ }
  
  syncInProgress = false;
  updateOnlineStatus();
}

// ====== 状态指示器 ======
function updateOnlineStatus() {
  const el = document.getElementById('sync-status');
  if (!el) return;
  
  if (!isOnline()) {
    el.className = 'offline';
    el.textContent = '离线模式 · 数据暂存本地，联网后自动同步';
  } else if (syncInProgress) {
    el.className = 'syncing';
    el.textContent = '同步中...';
  } else {
    getQueue().then(q => {
      if (q && q.length > 0) {
        el.className = 'syncing';
        el.textContent = `同步中... (${q.length} 条待同步)`;
        processQueue();
      } else {
        el.className = '';
        el.textContent = '在线 · 数据已同步';
      }
    }).catch(() => {
      el.className = '';
      el.textContent = '在线 · 数据已同步';
    });
  }
}

// ====== 初始化：从云端加载所有数据 ======
async function initCloudData() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

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

  todos = t;
  if (a) accounts = a;
  if (m && m.length) metrics = m;
  ideas = i;
  diets = d;
  ledger = l;
  weights = w;
  heightCm = h?.v || 160;
  budget = b;

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
    const baseDate = '2026-07-29';
    [['xhs1',4624],['xhs2',657],['dy1',873]].forEach(([aid, fans]) => {
      metrics.push({ id: uid(), accountId: aid, date: baseDate, fans });
    });
    cloudSave('metrics', metrics);
  }

  if (typeof renderAll === 'function') renderAll();
}

// ====== 实时同步监听 ======
function enableRealtime() {
  supabase.auth.getUser().then(({ data: { user } }) => {
    if (!user) return;
    
    supabase
      .channel('workspace-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'workspace_data',
        filter: `user_id=eq.${user.id}`
      }, async (payload) => {
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
  });
}

// ====== 启动 ======
initOfflineDB().then(() => {
  // 监听网络状态变化
  window.addEventListener('online', () => {
    updateOnlineStatus();
    processQueue();
  });
  window.addEventListener('offline', () => updateOnlineStatus());
  
  // 初始状态
  updateOnlineStatus();
  
  // 如果已登录，检查是否有待同步数据
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      processQueue();
    }
  });
});

// 初始化后开启实时同步
document.addEventListener('DOMContentLoaded', () => {
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      document.getElementById('auth-overlay').classList.add('hidden');
      document.getElementById('app-content').classList.remove('hidden');
      initCloudData().then(() => enableRealtime());
    }
  });
});
