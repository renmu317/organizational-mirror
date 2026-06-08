// Supabase Configuration
// 本地开发时使用本地 API，生产环境使用 Supabase Edge Functions

(function() {
  // 检测是否在本地开发环境
  const isLocalDev = window.location.hostname === 'localhost' ||
                     window.location.hostname === '127.0.0.1';

  if (isLocalDev) {
    // 本地开发：使用本地 Express API
    window.CONFIG = {
      SUPABASE_URL: null,
      SUPABASE_ANON_KEY: null,
      API_BASE: '',
      ENDPOINTS: {
        respond: '/api/respond',
        health: '/api/health',
        stats: '/api/stats'
      }
    };
  } else {
    // 生产环境：使用 Vercel 注入的环境变量
    const SUPABASE_URL = '__SUPABASE_URL__';
    const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';
    const API_BASE = `${SUPABASE_URL}/functions/v1`;

    window.CONFIG = {
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      API_BASE,
      ENDPOINTS: {
        respond: `${API_BASE}/respond`,
        health: `${API_BASE}/health`,
        stats: `${API_BASE}/stats`
      }
    };
  }
})();
