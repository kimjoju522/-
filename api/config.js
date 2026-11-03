// 브라우저에 공개해도 되는 설정만 내려줌
export default function handler(req, res) {
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
  });
}
