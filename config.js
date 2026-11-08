// 사이트 설정 — anon 키는 공개돼도 되는 키 (데이터는 Supabase 보안 규칙으로 본인만 접근)
window.APP_CONFIG = {
  SUPABASE_URL: "https://qgdidlazohzuowefhjzs.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_Z0gb1Dpc9Bkz7NWwXDa6Vw_Wc8AaTiF",
  // 뉴스 JSON 위치 (GitHub 저장소 원본 — 커밋 즉시 반영)
  NEWS_BASE: "https://raw.githubusercontent.com/duboo1227/nalog/main/data/news/"
};
