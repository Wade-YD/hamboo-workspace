// supabase.js - hamboo工作台 云端配置
(function() {
  const SUPABASE_URL = 'https://qcrgrgiyqxaqzzqrauzl.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_O1QZ5DCTtiS0-3jpTGQjBw_PiAaU06K';
  // supabase.min.js 创建了 window.supabase（SDK 工厂），这里创建客户端实例替换它
  window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
})();
