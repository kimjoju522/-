import { createClient } from '@supabase/supabase-js';

// 서버 전용 클라이언트 (service role). 설정이 없으면 null → 저장 없이 동작
export function serverDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
