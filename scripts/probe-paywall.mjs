// 임시: 오늘 수집된 기사 페이지를 열어 유료(구독자 전용) 표시 문구가 있는지 조사
import { readFile } from "node:fs/promises";
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const d = JSON.parse(await readFile(`data/news/${date}.json`, "utf8"));
const MARK = /(구독자\s?전용|유료\s?회원|유료\s?기사|멤버십\s?전용|회원\s?전용|프리미엄9|더중앙플러스|더중플|매경\s?\+|매경플러스|조선\s?멤버십|구독하고\s|구독\s?후\s|구독하시면|이어서 읽|전문을 보시려면|paywall|premium-content|isPremium|is_premium|premiumYn|"isAccessibleForFree"\s*:\s*"?false)/gi;
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "accept-language": "ko-KR,ko;q=0.9" };
for (const s of d.sources) {
  const arts = [...(s.tops || []), ...s.items].filter(i => !i.link.includes("news.google.com")).slice(0, 14);
  for (const a of arts) {
    try {
      const r = await fetch(a.link, { headers: UA, redirect: "follow" });
      const html = await r.text();
      const hits = [...new Set((html.match(MARK) || []).map(x => x.trim()))].slice(0, 6);
      console.log(`[${s.name}] ${hits.length ? "★" : "-"} ${a.title.slice(0, 34)} | ${a.link.slice(-40)} | ${hits.join(", ")}`);
    } catch (e) { console.log(`[${s.name}] ERR ${a.link} ${e.message}`); }
  }
}
