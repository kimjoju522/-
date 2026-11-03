// 소상공인시장진흥공단 상가(상권)정보 API 클라이언트
// https://www.data.go.kr/data/15012005/openapi.do

const BASE = 'https://apis.data.go.kr/B553077/api/open/sdsc2';

// 시도코드 (강원·전북은 특별자치도 전환 전후 코드를 모두 둠)
export const SIDO = [
  { code: '11', names: ['서울특별시', '서울시', '서울'] },
  { code: '26', names: ['부산광역시', '부산시', '부산'] },
  { code: '27', names: ['대구광역시', '대구시', '대구'] },
  { code: '28', names: ['인천광역시', '인천시', '인천'] },
  { code: '29', names: ['광주광역시', '광주시', '광주'] },
  { code: '30', names: ['대전광역시', '대전시', '대전'] },
  { code: '31', names: ['울산광역시', '울산시', '울산'] },
  { code: '36', names: ['세종특별자치시', '세종시', '세종'] },
  { code: '41', names: ['경기도', '경기'] },
  { code: '51', names: ['강원특별자치도', '강원도', '강원'] },
  { code: '42', names: [] },
  { code: '43', names: ['충청북도', '충북'] },
  { code: '44', names: ['충청남도', '충남'] },
  { code: '52', names: ['전북특별자치도', '전라북도', '전북'] },
  { code: '45', names: [] },
  { code: '46', names: ['전라남도', '전남'] },
  { code: '47', names: ['경상북도', '경북'] },
  { code: '48', names: ['경상남도', '경남'] },
  { code: '50', names: ['제주특별자치도', '제주도', '제주'] },
];

const FOOD_CODE = 'I2'; // 상권업종 대분류: 음식

async function call(path, params) {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) throw new Error('DATA_GO_KR_KEY 환경변수가 없습니다.');
  const qs = new URLSearchParams({ serviceKey: key, type: 'json', ...params });
  const res = await fetch(`${BASE}/${path}?${qs}`);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // 인증 오류 등은 XML로 옴
    const msg = text.match(/<returnAuthMsg>(.*?)<\/returnAuthMsg>/)?.[1] || text.slice(0, 200);
    throw new Error(`공공데이터 API 오류: ${msg}`);
  }
  const code = data.header?.resultCode;
  if (code === '03') return { items: [], totalCount: 0 }; // NODATA_ERROR
  if (code && code !== '00') throw new Error(`공공데이터 API 오류: ${data.header?.resultMsg || code}`);
  const body = data.body || {};
  const items = Array.isArray(body.items) ? body.items : body.items?.item ? [].concat(body.items.item) : [];
  return { items, totalCount: Number(body.totalCount || items.length) };
}

// "POLYGON ((x y, ...))" / "MULTIPOLYGON (((...)))" → [[[lng, lat], ...], ...]
export function parseWkt(wkt) {
  const rings = [];
  for (const m of String(wkt).matchAll(/\(([^()]+)\)/g)) {
    const ring = m[1].split(',').map((pt) => pt.trim().split(/\s+/).map(Number));
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

// "대구 중구 동성로" → { sidoCodes: ['27'], keyword: '동성로', sigungu: '중구' }
export function parseQuery(q) {
  let words = String(q).trim().split(/\s+/).filter(Boolean);
  let sidoCodes = null;
  if (words.length > 1) {
    const hit = SIDO.find((s) => s.names.includes(words[0]));
    if (hit) {
      sidoCodes = [hit.code, ...(hit.code === '51' ? ['42'] : hit.code === '52' ? ['45'] : [])]; // 특별자치도 전환 전 코드 포함
      words = words.slice(1);
    }
  }
  let sigungu = null;
  if (words.length > 1 && /[시군구]$/.test(words[0])) {
    sigungu = words[0];
    words = words.slice(1);
  }
  return { sidoCodes: sidoCodes || SIDO.map((s) => s.code), keyword: words.join(''), sigungu };
}

function toZone(z) {
  return {
    id: String(z.trarNo),
    name: z.mainTrarNm,
    sido: z.ctprvnNm,
    sigungu: z.signguNm,
    polygon: parseWkt(z.coords),
  };
}

// 이름으로 상권 찾기. 정확히 일치하면 그것만, 아니면 포함하는 후보들을 돌려줌
// where: parseQuery() 또는 parseWithGemini() 결과
export async function findZones({ sidoCodes, keyword, sigungu }) {
  if (!keyword) return [];
  const results = await Promise.allSettled(
    sidoCodes.map((code) => call('storeZoneInAdmi', { divId: 'ctprvnCd', key: code }))
  );
  // 옛 시도코드(42, 45) 등 일부 실패는 무시하되, 전부 실패하면 원인(인증키 오류 등)을 그대로 알림
  const ok = results.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw results[0].reason;
  const k = norm(keyword);
  let hits = ok
    .flatMap((r) => r.value.items)
    .filter((z) => norm(z.mainTrarNm).includes(k) || k.includes(norm(z.mainTrarNm)))
    .filter((z) => !sigungu || norm(z.signguNm) === norm(sigungu));
  const exact = hits.filter((z) => norm(z.mainTrarNm) === k);
  if (exact.length) hits = exact;
  return hits.map(toZone);
}

export async function getZone(trarNo) {
  const { items } = await call('storeZoneOne', { key: trarNo });
  return items[0] ? toZone(items[0]) : null;
}

// 상권 안의 음식점 전부 (1000건씩 페이지 순회)
export async function getRestaurants(trarNo) {
  const rows = [];
  for (let page = 1; ; page++) {
    const { items, totalCount } = await call('storeListInArea', {
      key: trarNo,
      indsLclsCd: FOOD_CODE,
      numOfRows: '1000',
      pageNo: String(page),
    });
    rows.push(...items);
    if (!items.length || rows.length >= totalCount) break;
  }
  return rows.map((s) => ({
    id: String(s.bizesId),
    zone_id: String(trarNo),
    name: s.bizesNm,
    branch: s.brchNm || null,
    category: s.indsMclsNm || null,
    category_detail: s.indsSclsNm || null,
    road_address: s.rdnmAdr || null,
    jibun_address: s.lnoAdr || null,
    lat: Number(s.lat),
    lng: Number(s.lon),
  }));
}
