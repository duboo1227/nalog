const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
for (const u of ["https://www.hankyung.com/article/2026111084421", "https://www.hankyung.com/article/2026111083071"]) {
  const h = await (await fetch(u, { headers: UA })).text();
  const ctx = [...new Set((h.match(/.{0,70}(20\d\d[-.]\d\d[-.]\d\d[ T]?\d\d:\d\d|datePublished|published_time|입력).{0,50}/g) || []).map(x => x.replace(/\s+/g, " ")))].slice(0, 12);
  console.log("==", u); ctx.forEach(c => console.log("  » " + c.slice(0, 160)));
}
