// GET /api/collect?q=대구 동성로   → 상권을 찾아 식당 수집
// GET /api/collect?zone=<상권번호>  → 후보 중 하나를 고른 경우
import { findZones, getZone, getRestaurants, parseQuery } from '../lib/sbiz.js';
import { parseWithGemini } from '../lib/gemini.js';
import { serverDb } from '../lib/db.js';

const CACHE_DAYS = 30; // 공단 데이터는 분기 갱신이라 한 달 캐시면 충분

export default async function handler(req, res) {
  const { q, zone: zoneId } = req.query;
  try {
    let zone;
    if (zoneId) {
      zone = await getZone(zoneId);
    } else {
      if (!q || !String(q).trim()) return res.status(400).json({ error: '구획 이름을 입력하세요.' });
      const where = (await parseWithGemini(q)) || parseQuery(q);
      let zones = await findZones(where);
      // AI가 시군구를 잘못 짚었을 수 있으니 시군구 조건 없이 한 번 더
      if (!zones.length && where.sigungu) zones = await findZones({ ...where, sigungu: null });
      if (!zones.length) return res.status(404).json({ error: `"${q}"에 해당하는 상권을 찾지 못했습니다.` });
      if (zones.length > 1) return res.status(200).json({ candidates: zones.map(({ polygon, ...z }) => z) });
      zone = zones[0];
    }
    if (!zone) return res.status(404).json({ error: '상권 정보를 찾지 못했습니다.' });

    const db = serverDb();
    if (!db) {
      const stores = await getRestaurants(zone.id);
      return res.status(200).json({ zone, stores, saved: false });
    }

    const { data: cached } = await db.from('zones').select('fetched_at').eq('id', zone.id).maybeSingle();
    const fresh = cached && Date.now() - new Date(cached.fetched_at) < CACHE_DAYS * 864e5;
    if (!fresh) {
      const stores = await getRestaurants(zone.id);
      const { error: zErr } = await db.from('zones').upsert({ ...zone, fetched_at: new Date().toISOString() });
      if (zErr) throw zErr;
      // pay_status 는 건드리지 않도록 수집 필드만 upsert
      for (let i = 0; i < stores.length; i += 500) {
        const { error } = await db.from('stores').upsert(stores.slice(i, i + 500));
        if (error) throw error;
      }
    }
    const { data: stores, error } = await db.from('stores').select('*').eq('zone_id', zone.id);
    if (error) throw error;
    res.status(200).json({ zone, stores, saved: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
