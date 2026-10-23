/* СТЕПЬ — фото с Wikimedia Commons (автор и лицензия подтягиваются вместе со снимком).
   Фильтры отсекают снимки с людьми, карты, значки. Для рыб берём только кадры, где в центре рыба. */
(function (root) {
  "use strict";
  const API = "https://commons.wikimedia.org/w/api.php";
  const TTL = 7 * 24 * 3600 * 1000;
  const mem = new Map();
  const usedByPlaces = new Set();

  const BAD_FILE = /\.(svg|gif|tif|tiff|webm|ogv|pdf)$/i;
  const BAD_COMMON = /(\bmap\b|карта|flag|герб|logo|coat of arms|схема|diagram|stamp|марка|плакат|poster|scheme|locator)/i;
  const BAD_PEOPLE = /(portrait|selfie|wedding|\bman\b|\bmen\b|woman|women|people|person|girl|boy|child|children|family|tourist|group of|рыбак|человек|девушк|мужчин|женщин|портрет|семья|туристы|дети|ребён)/i;
  const BAD_FISH = /(fisherman|fishermen|angler|angling|holding|held|caught|catch|record|fishing|trophy|cooked|fillet|dish|recipe|market|coin|drawing|painting|illustration|lure|bait|hook|net\b|рыбак|улов|жарен|блюдо|рыбалк|человек|приманк|воблер|монет)/i;

  function strip(html) {
    if (!html) return "";
    const d = document.createElement("div");
    d.innerHTML = String(html);
    return (d.textContent || "").replace(/\s+/g, " ").trim();
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seededShuffle(arr, seed) {
    const a = arr.slice();
    let s = seed || 1;
    for (let i = a.length - 1; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function readCache(key) {
    if (mem.has(key)) return mem.get(key);
    try {
      const raw = localStorage.getItem("stepPhotos:" + key);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && Date.now() - o.t < TTL && Array.isArray(o.v)) { mem.set(key, o.v); return o.v; }
      }
    } catch (_) {}
    return null;
  }
  function writeCache(key, v) {
    mem.set(key, v);
    try { localStorage.setItem("stepPhotos:" + key, JSON.stringify({ t: Date.now(), v })); } catch (_) {}
  }

  async function api(params) {
    const q = new URLSearchParams(Object.assign({
      action: "query", format: "json", origin: "*",
      prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "720",
      iiextmetadatafilter: "Artist|LicenseShortName|ImageDescription|ObjectName"
    }, params));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(API + "?" + q.toString(), { signal: ctrl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  function normalize(page, mode) {
    const ii = page && page.imageinfo && page.imageinfo[0];
    if (!ii || !/^image\/(jpeg|png)$/.test(ii.mime || "")) return null;
    if ((ii.width || 0) < 700 || (ii.height || 0) < 400) return null;
    const title = page.title || "";
    if (BAD_FILE.test(title) || BAD_COMMON.test(title)) return null;
    const md = ii.extmetadata || {};
    const desc = strip(md.ImageDescription && md.ImageDescription.value);
    const hay = title + " " + desc;
    if (BAD_PEOPLE.test(hay)) return null;
    if (mode === "fish" && BAD_FISH.test(hay)) return null;
    if (mode === "fish" && ii.height > ii.width * 1.2) return null;
    const author = strip(md.Artist && md.Artist.value).slice(0, 80);
    const license = strip(md.LicenseShortName && md.LicenseShortName.value);
    return {
      url: ii.thumburl || ii.url,
      alt: strip(md.ObjectName && md.ObjectName.value) || title.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""),
      author: author || "Wikimedia Commons",
      license: license || "",
      sourceUrl: ii.descriptionurl || ""
    };
  }

  async function search(q, mode) {
    const key = "s:" + mode + ":" + q;
    const hit = readCache(key);
    if (hit) return hit;
    const j = await api({ generator: "search", gsrsearch: q + " filetype:bitmap", gsrnamespace: "6", gsrlimit: "30" });
    const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    const out = pages.map(p => normalize(p, mode)).filter(Boolean);
    writeCache(key, out);
    return out;
  }
  async function category(cat, mode) {
    const key = "c:" + mode + ":" + cat;
    const hit = readCache(key);
    if (hit) return hit;
    const j = await api({ generator: "categorymembers", gcmtitle: cat, gcmtype: "file", gcmlimit: "60" });
    const pages = Object.values((j.query && j.query.pages) || {});
    const out = pages.map(p => normalize(p, mode)).filter(Boolean);
    writeCache(key, out);
    return out;
  }

  /* Фото места: сначала точные запросы, затем соседние. Каждый снимок используется только в одной точке. */
  async function forPlace(loc, want) {
    want = want || 4;
    const queries = (loc.photoQueries || []).concat(loc.photoNear || []);
    const picked = [];
    const seen = new Set();
    for (const q of queries) {
      if (picked.length >= want) break;
      let list = [];
      try { list = await search(q, "place"); } catch (_) { continue; }
      for (const p of seededShuffle(list, hash(loc.id + q))) {
        if (picked.length >= want) break;
        if (seen.has(p.url) || usedByPlaces.has(p.url)) continue;
        seen.add(p.url);
        picked.push(p);
      }
    }
    picked.forEach(p => usedByPlaces.add(p.url));
    return picked;
  }

  /* Фото рыбы: категория вида, потом поиск по латинскому и русскому названию. */
  async function forFish(fish, want) {
    want = want || 3;
    const picked = [];
    const seen = new Set();
    const push = list => {
      for (const p of seededShuffle(list, hash(fish.id))) {
        if (picked.length >= want) break;
        if (!seen.has(p.url)) { seen.add(p.url); picked.push(p); }
      }
    };
    for (const c of fish.commons || []) {
      if (picked.length >= want) break;
      try { push(await category(c, "fish")); } catch (_) {}
    }
    for (const t of fish.searchTerms || [fish.latin]) {
      if (picked.length >= want) break;
      try { push(await search(t, "fish")); } catch (_) {}
    }
    return picked;
  }

  root.StepPhotos = { forPlace, forFish };
})(window);
