// Configuration
// Vercel 部署使用相对路径 API

(function() {
  // 统一使用相对路径（Vercel + Express 后端）
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
})();
