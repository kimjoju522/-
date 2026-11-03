// Gemini로 자유로운 입력("동성로 근처 밥집 보여줘")을 { sido, sigungu, keyword } 로 정리
// GEMINI_API_KEY 가 없거나 호출이 실패하면 null → 규칙 기반 파서로 대체
import { SIDO } from './sbiz.js';

const SIDO_NAMES = SIDO.filter((s) => s.names.length).map((s) => s.names[0]);

const PROMPT = `사용자가 한국의 상권(구획)을 찾으려고 입력한 문장에서 위치 정보만 뽑아라.
- sido: 다음 중 하나의 정식 명칭, 알 수 없으면 null: ${SIDO_NAMES.join(', ')}
  (입력에 시도가 없어도 유명한 지명이면 추론해서 채운다. 예: 동성로 → 대구광역시)
- sigungu: 시군구 이름(예: 중구), 없거나 모르면 null
- keyword: 상권·거리·동네 이름의 핵심 부분만 (예: "동성로", "성수동", "테헤란로"). "맛집", "근처", "식당" 같은 말은 뺀다.

입력: `;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    sido: { type: 'STRING', nullable: true },
    sigungu: { type: 'STRING', nullable: true },
    keyword: { type: 'STRING' },
  },
  required: ['keyword'],
};

export async function parseWithGemini(q) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT + q }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const out = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
    if (!out.keyword) return null;
    const sido = SIDO.find((s) => s.names.includes(out.sido));
    return {
      sidoCodes: sido ? sidoCodes(sido.code) : SIDO.map((s) => s.code),
      sigungu: out.sigungu || null,
      keyword: String(out.keyword).replace(/\s+/g, ''),
    };
  } catch (e) {
    console.warn('Gemini 파싱 실패, 규칙 기반으로 대체:', e.message);
    return null;
  }
}

// 강원·전북은 특별자치도 전환 전 코드도 함께 조회
export function sidoCodes(code) {
  return [code, ...(code === '51' ? ['42'] : code === '52' ? ['45'] : [])];
}
