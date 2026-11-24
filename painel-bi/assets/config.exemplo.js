/*
 * Ouvidoria BI: MODELO de configuracao do painel
 * -------------------------------------------------------------
 * 1. Copie este arquivo com o nome "config.js" (mesma pasta).
 * 2. Preencha com os dados do projeto Supabase:
 *      Supabase > Project Settings > API
 *        - Project URL           -> SUPABASE_URL
 *        - Project API keys: anon -> SUPABASE_ANON_KEY
 *
 * O arquivo config.js real NAO e versionado (esta no .gitignore).
 * NUNCA coloque aqui a chave "service_role".
 */
window.PAINEL_CONFIG = {
  SUPABASE_URL: 'https://SEU-PROJETO.supabase.co',
  SUPABASE_ANON_KEY: 'SUA_CHAVE_PUBLICA_ANON',

  // Estimativa de horas doadas: cada sessao REALIZADA vale este valor.
  // Ex.: 1 = 60 min | 0.75 = 45 min | 0.83 = 50 min
  HORAS_POR_SESSAO: 1,

  // Encerra a sessao do painel apos este tempo sem uso (minutos).
  MINUTOS_INATIVIDADE: 30
};
