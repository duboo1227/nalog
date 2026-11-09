# 규나의 하루기록

매일 출근해서 쓰는 개인 기록 사이트.

1. 경제뉴스 — 중앙·매경·조선·동아·한경·서경·연합 경제면 헤드라인을 4시간마다(KST 02·06·10·14·18·22시) 자동 수집
2. 어제 일기
3. 독서 (하루 5쪽 목표)
4. 공부 기록
5. 초음파 케이스 모음 (이미지 첨부)

## 구조
- `index.html`, `style.css`, `app.js`, `config.js` — 사이트 (GitHub Pages)
- `scripts/fetch-news.mjs` + `.github/workflows/news.yml` — 뉴스 자동 수집 → `data/news/YYYY-MM-DD.json`
- `supabase/schema.sql` — 개인 기록 DB (본인만 읽고 쓰기, Row Level Security)

일기·독서·공부·케이스는 이 저장소가 아니라 Supabase에 비공개로 저장된다.
이 저장소에는 코드와 공개 뉴스 헤드라인만 있다.

## 뉴스 수동 수집
Actions 탭 → "경제뉴스 수집" → Run workflow
