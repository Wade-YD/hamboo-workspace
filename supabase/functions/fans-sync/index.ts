// fans-sync — 工作台账号矩阵「刷新粉丝」后端
// 流程：JWT 鉴权 → XHS_ACCOUNTS 映射 → 携带 XHS_COOKIE 抓取小红书主页 SSR
//      → 解析 meta「有…位粉丝」→ 合并写入当日 metrics
// OpenSpec: fans-sync-workbench（设计决策 D1-D5）
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  // 请求凭 Bearer 头鉴权、不带 cookie，'*' 安全；多值 Origin 头不符合规范
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function fail(code, status = 502, detail) {
  return json({ error: code, ...(detail ? { detail } : {}) }, status);
}

// supabase-js 对 HTTP 错误返回 {error} 不抛异常，所有调用点必须显式检查
function clients(authHeader) {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const user = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  return { user, admin };
}

// UTC+8 当天，与用户录入习惯一致（设计 D5）
function todayCST() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// meta「有1,234位粉丝」/「有1.5万位粉丝」→ 整数（设计 D2）
function parseFansFromMeta(html) {
  const m = html.match(/content="([^"]*?位粉丝[^"]*?)"/);
  if (!m) return null;
  const num = m[1].match(/有([\d,.]+(?:[万亿])?)位粉丝/);
  if (!num) return null;
  const clean = num[1].replace(/,/g, '');
  let v;
  if (clean.includes('万')) v = Math.round(parseFloat(clean) * 10000);
  else if (clean.includes('亿')) v = Math.round(parseFloat(clean) * 1e8);
  else v = parseInt(clean, 10);
  return Number.isFinite(v) ? v : null;
}

// __INITIAL_STATE__ 的 interactions 数组：「获赞与收藏」精确值（如 135207）
// 实测 SSR 直出：{"type":"interaction","name":"获赞与收藏","count":"135207",...}
function parseLikedTotal(html) {
  const m = html.match(/"name":"获赞与收藏","count":"([\d,.]+(?:[万亿])?)"/);
  if (!m) return null;
  const clean = m[1].replace(/,/g, '');
  let v;
  if (clean.includes('万')) v = Math.round(parseFloat(clean) * 10000);
  else if (clean.includes('亿')) v = Math.round(parseFloat(clean) * 1e8);
  else v = parseInt(clean, 10);
  return Number.isFinite(v) ? v : null;
}

function xhsHeaders() {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cookie': Deno.env.get('XHS_COOKIE') ?? '',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // ---- 鉴权：工作台 JWT（设计 D4）----
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return fail('UNAUTHORIZED', 401);
  const { user, admin } = clients(authHeader);
  const { data: { user: authUser } } = await user.auth.getUser();
  if (!authUser) return fail('UNAUTHORIZED', 401);

  // ---- GET ?action=accounts：账号列表（映射面板备用）----
  if (req.method === 'GET') {
    const { data, error } = await admin.from('workspace_data')
      .select('data').eq('module', 'accounts').maybeSingle();
    if (error) return fail('DB_READ_FAILED', 500, error.message);
    const list = Array.isArray(data?.data) ? data.data : [];
    return json({ accounts: list.map((a) => ({ id: a.id, platform: a.platform, name: a.name })) });
  }

  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);

  const body = await req.json().catch(() => ({}));
  const accountId = typeof body.accountId === 'string' ? body.accountId : '';
  if (!accountId) return fail('MISSING_ACCOUNT_ID', 400);

  // ---- 账号映射（设计 D3）----
  let profiles = [];
  try { profiles = JSON.parse(Deno.env.get('XHS_ACCOUNTS') ?? '[]'); } catch { /* 配置缺失按未映射处理 */ }
  const target = profiles.find((p) => p.accountId === accountId);
  if (!target?.profileUrl) return fail('ACCOUNT_NOT_MAPPED', 400, `账号 ${accountId} 未配置小红书主页 URL`);
  // SSRF 加固：仅允许小红书域名
  let targetUrl;
  try {
    targetUrl = new URL(target.profileUrl);
  } catch {
    return fail('ACCOUNT_NOT_MAPPED', 400, 'profileUrl 格式无效');
  }
  if (!/^(\w+\.)?xiaohongshu\.com$/.test(targetUrl.hostname) || targetUrl.protocol !== 'https:') {
    return fail('ACCOUNT_NOT_MAPPED', 400, 'profileUrl 仅允许 https://*.xiaohongshu.com');
  }

  // ---- 抓取（设计 D1：完整头 + 登录 cookie + 不跟随重定向）----
  let resp;
  try {
    resp = await fetch(targetUrl.href, { headers: xhsHeaders(), redirect: 'manual' });
  } catch (e) {
    return fail('FETCH_FAILED', 502, String(e));
  }
  if (resp.status === 301 || resp.status === 302) return fail('XHS_AUTH_EXPIRED');
  if (resp.status !== 200) return fail('FETCH_FAILED', 502, `HTTP ${resp.status}`);

  const html = await resp.text();
  const fans = parseFansFromMeta(html);
  const likedTotal = parseLikedTotal(html); // 可选字段：提取失败不影响 fans 同步
  if (fans == null) {
    // 登录页体积远小于 SSR 主页且含登录特征；真主页但结构变化才是解析失败
    const looksLikeLogin = html.length < 80000 || /登录即刻|手机号登录/.test(html.slice(0, 20000));
    return fail(looksLikeLogin ? 'XHS_AUTH_EXPIRED' : 'XHS_PARSE_FAILED');
  }

  // ---- 合并写入当日 metrics（设计 D5；likedTotal 为扩展字段）----
  const date = todayCST();
  const { data: row, error: readErr } = await admin.from('workspace_data')
    .select('id, data').eq('module', 'metrics').eq('user_id', authUser.id).maybeSingle();
  if (readErr) return fail('DB_READ_FAILED', 500, readErr.message);

  const list = Array.isArray(row?.data) ? row.data : [];
  const existing = list.find((r) => r.accountId === accountId && r.date === date);
  if (existing) {
    existing.fans = fans; // 仅更新 fans 与 likedTotal，手动录入的 views/likes 等保持
    if (likedTotal != null) existing.likedTotal = likedTotal;
  } else {
    list.push({ id: crypto.randomUUID(), accountId, date, fans, likedTotal, views: null, likes: null, favs: null, cmts: null, posts: null });
  }

  const { error: upErr } = await admin.from('workspace_data')
    .upsert(
      { user_id: authUser.id, module: 'metrics', data: list, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,module' },
    );
  if (upErr) return fail('DB_WRITE_FAILED', 500, upErr.message);

  return json({ ok: true, fans, likedTotal, date });
});
