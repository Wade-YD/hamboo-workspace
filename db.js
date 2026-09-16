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

// 清除某模块的所有待同步队列条目
async function removeQueuedFor(module) {
  try {
    const queue = await getQueue();
    for (const item of queue) {
      if (item.module === module) await clearQueueItem(item.id);
    }
  } catch(e) { /* silent */ }
}

// 统一写入路径：写本地缓存 → 在线 upsert 云端 → 失败入队 / 成功清队列
// fromQueue=true 表示来自队列重放（processQueue），失败时不重复入队，由调用方保留原条目
async function syncModule(module, value, fromQueue = false) {
  // 立即写入本地缓存
  await setCached(module, value);

  if (!isOnline()) {
    // 离线：加入同步队列（队列条目含 ts 时间戳）
    if (!fromQueue) await addToQueue(module, value);
    updateOnlineStatus();
    return false;
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      if (!fromQueue) await addToQueue(module, value);
      updateOnlineStatus();
      return false;
    }

    // supabase-js 不抛异常，必须显式解构检查 error
    const { error } = await supabase
      .from('workspace_data')
      .upsert(
        { user_id: user.id, module, data: value, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,module' }
      );

    if (error) {
      console.warn('syncModule failed, queuing:', module, error.message);
      if (!fromQueue) await addToQueue(module, value);
      updateOnlineStatus();
      return false;
    }

    // 写入成功：本次已写入最新值，该模块更早的待同步条目可清除（队列重放时由 processQueue 逐条清除）
    if (!fromQueue) await removeQueuedFor(module);
    updateOnlineStatus();
    return true;
  } catch(e) {
    console.warn('syncModule exception, queuing:', module, e.message);
    if (!fromQueue) await addToQueue(module, value);
    updateOnlineStatus();
    return false;
  }
}

async function cloudSave(module, value) {
  // 对外入口保持签名与行为不变，统一转发到 syncModule
  return syncModule(module, value);
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

    // 按入队时间升序重放，保证同模块最新值最后写入
    queue.sort((a, b) => (a.ts || 0) - (b.ts || 0));

    for (const item of queue) {
      // 重放前对比云端 updated_at：云端较新则丢弃本地条目（以云端为准）
      try {
        const { data: existing } = await supabase
          .from('workspace_data')
          .select('updated_at')
          .eq('user_id', user.id)
          .eq('module', item.module)
          .maybeSingle();

        if (existing && existing.updated_at && item.ts &&
            new Date(existing.updated_at) > new Date(item.ts)) {
          await clearQueueItem(item.id);
          continue;
        }
      } catch(e) { /* 时间戳对比失败则继续尝试覆盖 */ }

      const ok = await syncModule(item.module, item.value, true);
      if (!ok) {
        // 写入失败：保留条目并中止本轮，等下次重试
        syncInProgress = false;
        updateOnlineStatus();
        return;
      }
      await clearQueueItem(item.id);
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
// 去重标志：防止 auth.js 的 SIGNED_IN 路径与本文件 DOMContentLoaded 路径重复初始化（登出时在 resetCloudState 中重置）
let cloudDataReady = false;

async function initCloudData() {
  if (cloudDataReady) return;
  cloudDataReady = true;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { cloudDataReady = false; return; }

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
  // 通知 index.html 解除启动加载锁（云数据已就绪，写操作可放开）
  if (typeof window.__onCloudReady === 'function') window.__onCloudReady();
}

// ====== 实时同步监听 ======
let realtimeChannel = null;

// 读取 index.html 侧的内存模块变量（db.js 与其共享全局词法作用域）
function getLocalModule(module) {
  switch (module) {
    case 'todos': return todos;
    case 'accounts': return accounts;
    case 'metrics': return metrics;
    case 'ideas': return ideas;
    case 'diets': return diets;
    case 'ledger': return ledger;
    case 'weights': return weights;
    case 'heightCm': return { v: heightCm };
    case 'budget': return budget;
  }
  return undefined;
}

function setLocalModule(module, value) {
  switch (module) {
    case 'todos': todos = value || []; break;
    case 'accounts': accounts = value; break;
    case 'metrics': metrics = value || []; break;
    case 'ideas': ideas = value || []; break;
    case 'diets': diets = value || []; break;
    case 'ledger': ledger = value || []; break;
    case 'weights': weights = value || []; break;
    case 'heightCm': heightCm = value?.v || 160; break;
    case 'budget': budget = value; break;
  }
}

function enableRealtime() {
  if (realtimeChannel) return; // 防止重复订阅
  supabase.auth.getUser().then(({ data: { user } }) => {
    if (!user) return;

    realtimeChannel = supabase
      .channel('workspace-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'workspace_data',
        filter: `user_id=eq.${user.id}`
      }, async (payload) => {
        const module = payload.new?.module || payload.old?.module;
        if (!module) return;

        // 回声消除：推送内容与本地一致（自己保存触发的事件）则不渲染
        if (payload.new && JSON.stringify(payload.new.data) === JSON.stringify(getLocalModule(module))) return;

        const fresh = await cloudLoad(module);
        setLocalModule(module, fresh);
        // 传模块名，index.html 侧 renderAll 支持可选 module 参数按模块分发（无参时全量）
        if (typeof renderAll === 'function') renderAll(module);
      })
      .subscribe();
  });
}

// 关闭实时同步（登出时调用）
function disableRealtime() {
  if (realtimeChannel) {
    const ch = realtimeChannel;
    realtimeChannel = null;
    try { supabase.removeChannel(ch); } catch(e) { /* silent */ }
  }
}

// 清空本地 IndexedDB（cache + queue 两个 objectStore）
async function clearLocalData() {
  try {
    if (!idb) await initOfflineDB();
    await idbOp('cache', 'readwrite', s => s.clear());
    await idbOp('queue', 'readwrite', s => s.clear());
  } catch(e) { /* silent */ }
}

// 登出清理钩子（auth.js 在 signOut 成功后调用）
// 注意：内存模块变量定义在 index.html，db.js 与 initCloudData 一样直接重置这些全局绑定；
// 若 index.html 新增模块，需同步维护 setLocalModule / getLocalModule / 此处的重置列表
async function resetCloudState() {
  cloudDataReady = false;
  disableRealtime();
  todos = []; accounts = null; metrics = null; ideas = []; diets = [];
  ledger = []; weights = []; heightCm = 160; budget = null;
  await clearLocalData();
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
