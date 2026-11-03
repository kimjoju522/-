# 비플페이 식당 지도

구획 이름(예: `대구 동성로`, `동성로 근처 밥집`)을 입력하면 그 상권 안의 식당을 공공데이터에서 수집해 지도(OpenStreetMap)에 표시합니다.
사용자가 식당을 눌러 **비플페이 가능 / 불가능**을 제보하면 모두에게 공유됩니다. 로그인은 없습니다.

- 가능: 형광색 테두리가 깜빡임
- 불가능: 회색 테두리
- 미확인: 흰색 테두리

## 구성

| 파일 | 역할 |
|---|---|
| `index.html`, `app.js`, `style.css` | 지도 화면 (Leaflet + OpenStreetMap, 키 불필요) |
| `api/collect.js` | 구획 이름 → 상권 폴리곤 + 식당 수집 (Vercel 함수) |
| `api/config.js` | 브라우저에 공개 가능한 Supabase 설정 전달 |
| `lib/gemini.js` | 자연어 입력에서 시도 · 시군구 · 상권 이름 추출 (Gemini) |
| `lib/sbiz.js` | 소상공인시장진흥공단 상가(상권)정보 API |
| `supabase/schema.sql` | 테이블 · 권한 · 실시간 설정 |
| `scripts/dev.js` | 로컬 실행 서버 |

수집 흐름: Gemini가 입력에서 위치를 정리 (키가 없거나 실패하면 규칙으로 처리) → 그 시도의 상권 목록에서 이름이 맞는 상권을 찾음 (여러 개면 고르게 함) → 상권 폴리곤과 그 안의 음식점(업종 대분류 I2)을 가져옴 → Supabase에 30일간 캐시.

## 준비할 키

1. **공공데이터 인증키** (필수): [소상공인시장진흥공단_상가(상권)정보_API](https://www.data.go.kr/data/15012005/openapi.do) 활용신청 → 일반 인증키(Decoding)
2. **Gemini API 키** (선택): [Google AI Studio](https://aistudio.google.com/apikey)에서 발급. 검색 한 번에 짧은 호출 1회.
3. **Supabase** (제보 공유용): 새 프로젝트 → SQL Editor에서 `supabase/schema.sql` 실행 → Project Settings > API 에서 URL, anon key, service_role key 복사

## 로컬 실행

```bash
cp .env.example .env   # 키 채우기
npm install
npm run dev            # http://localhost:3000
```

## Vercel 배포

GitHub 저장소를 Vercel에 연결하고, `.env.example`의 값들을 Vercel 프로젝트 Environment Variables에 넣으면 됩니다.
`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `DATA_GO_KR_KEY`는 서버 함수에서만 쓰이며 브라우저로 나가지 않습니다.

## 알아둘 점

- 상권 경계는 소상공인시장진흥공단 기준입니다.
- 식당 데이터는 분기마다 갱신되는 공공데이터라 최근 개·폐업이 늦게 반영됩니다.
- 제보는 로그인 없이 받으며, 가장 최근 제보가 식당의 상태가 됩니다.
- OpenStreetMap 기본 타일 서버는 소규모 사용을 전제로 합니다. 사용자가 많아지면 유료 타일 제공자로 바꾸세요.
