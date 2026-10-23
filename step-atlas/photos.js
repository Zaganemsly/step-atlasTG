/* СТЕПЬ — фото с Wikimedia Commons (автор и лицензия подтягиваются вместе со снимком).
   Правила: без людей, без руин и построек (для природы), без карт и рисунков; у каждого места по 4 фото,
   выбор запоминается; плохое фото можно убрать кнопкой ✕ (навсегда на этом устройстве) или внести в data/photo-blocklist.json. */
(function (root) {
  "use strict";
  const API = "https://commons.wikimedia.org/w/api.php";
  const TTL = 7 * 24 * 3600 * 1000;
  const mem = new Map();
  const claimed = new Map(); // sourceUrl -> id точки: один снимок не повторяется в разных местах
  const blocked = new Set();

  const BAD_FILE = /\.(svg|gif|tif|tiff|webm|ogv|pdf)$/i;
  const BAD_COMMON = /(\bmap\b|карта|flag|герб|logo|coat of arms|схема|diagram|stamp|марка|плакат|poster|scheme|locator|panorama of the city)/i;
  const BAD_PEOPLE = /(portrait|selfie|wedding|\bman\b|\bmen\b|woman|women|people|person|girl|boy|child|children|family|tourist|group of|crowd|рыбак|человек|девушк|мужчин|женщин|портрет|семья|туристы|дети|ребён|толпа)/i;
  const BAD_FISH = /(fisherman|fishermen|angler|angling|holding|held|caught|catch|record|fishing|trophy|cooked|fillet|dish|recipe|market|coin|drawing|painting|illustration|lure|bait|hook|net\b|рыбак|улов|жарен|блюдо|рыбалк|человек|приманк|воблер|монет)/i;
  const BAD_MIL = /(radar|радар|\bРЛС\b|military|army|armed forces|soldier|солдат|воен|армия|армейск|weapon|missile|ракет|зенит|\bПВО\b|air defen[cs]e|antenna|антенн|\btank\b|vehicle|camouflage|камуфляж|training ground|полигон|exercise|учени|aircraft|самол[её]т|helicopter|вертол[её]т|truck|грузовик|\bЗИЛ\b|Урал-|КамАЗ)/i;
  const BAD_BUILD = /(ruin|ruins|развал|руин|abandon|заброш|derelict|building|здани|church|церк|храм|mosque|мечеть|house\b|дом\b|памятник|monument|street|улиц|\bcar\b|truck|\bbus\b|автобус|wreck|кладбищ|cemetery|interior|интерьер|museum|музей|bridge|мост|factory|завод|garbage|мусор|railway|вокзал|station)/i;
  const BAD_SPECIES = /(drawing|illustration|painting|herbarium|specimen|museum|taxiderm|\begg|skeleton|skull|stamp|coin|distribution|range map|рисунок|гербарий|чучело|яйц|скелет|ареал|logo|cooked|dish|zoo\b|cage|aquarium)/i;

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
  function lsGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } }
  function lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) {} }
  function readCache(key) {
    if (mem.has(key)) return mem.get(key);
    const o = lsGet("stepPhotos:" + key);
    if (o && Date.now() - o.t < TTL && Array.isArray(o.v)) { mem.set(key, o.v); return o.v; }
    return null;
  }
  function writeCache(key, v) { mem.set(key, v); lsSet("stepPhotos:" + key, { t: Date.now(), v }); }

  /* ---- чёрный список ---- */
  (lsGet("stepPhotoBlock") || []).forEach(u => blocked.add(u));
  function isBlocked(p) {
    for (const b of blocked) if (b.startsWith("author:")) { if ((p.author || "").toLowerCase().includes(b.slice(7).toLowerCase())) return true; }
    else if (p.sourceUrl === b || p.url === b || (b.length > 12 && (p.sourceUrl.includes(b) || p.url.includes(b)))) return true;
    return false;
  }
  function block(p) {
    const k = p && (p.sourceUrl || p.url);
    if (!k) return;
    blocked.add(k);
    lsSet("stepPhotoBlock", [...blocked]);
  }
  function setBlocked(list) { (list || []).forEach(u => { if (typeof u === "string" && u) blocked.add(u); }); }

  /* уже выданные другим точкам снимки */
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("stepPlaceB:")) {
        const arr = lsGet(k) || [];
        arr.forEach(p => claimed.set(p.sourceUrl || p.url, k.slice(11)));
      }
    }
  } catch (_) {}

  /* Очередь запросов: не больше 2 одновременно, чтобы Commons не отвечал 429; повтор при сбое. */
  let active = 0; const waiting = [];
  function slot() { return new Promise(res => { if (active < 2) { active++; res(); } else waiting.push(res); }); }
  function release() { const n = waiting.shift(); if (n) n(); else active--; }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function api(params) {
    await slot();
    try {
      let lastErr;
      for (let i = 0; i < 3; i++) {
        try { const j = await apiOnce(params); root.StepPhotos && (root.StepPhotos.lastError = ""); return j; } catch (e) { lastErr = e; if (root.StepPhotos) root.StepPhotos.lastError = String(e && e.message || e); await sleep(600 * (i + 1)); }
      }
      throw lastErr;
    } finally { release(); }
  }
  async function apiOnce(params) {
    const q = new URLSearchParams(Object.assign({
      action: "query", format: "json", origin: "*",
      prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "720",
      iiextmetadatafilter: "Artist|LicenseShortName|ImageDescription|ObjectName|Categories"
    }, params));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(API + "?" + q.toString(), { signal: ctrl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      if (j && j.error) throw new Error(j.error.code || "api error");
      return j;
    } finally { clearTimeout(timer); }
  }

  /* mode: fish | nature (природа, река, степь) | place (города, история) | species (растения, животные) */
  function normalize(page, mode) {
    const ii = page && page.imageinfo && page.imageinfo[0];
    if (!ii || !/^image\/(jpeg|png)$/.test(ii.mime || "")) return null;
    if ((ii.width || 0) < 700 || (ii.height || 0) < 400) return null;
    const title = page.title || "";
    if (BAD_FILE.test(title) || BAD_COMMON.test(title)) return null;
    const md = ii.extmetadata || {};
    const desc = strip(md.ImageDescription && md.ImageDescription.value);
    const cats = strip(md.Categories && md.Categories.value);
    const hay = title + " " + desc + " " + cats;
    const titleDesc = title + " " + desc;
    if (BAD_MIL.test(hay)) return null;
    let weak = false;
    if (mode === "fish") {
      // рыба: строгий разбор по названию и описанию; категории не считаем, там часто «Fishing in …».
      if (BAD_PEOPLE.test(titleDesc) && /(fisherm|angler|holding|рыбак|человек|man\b|woman|person)/i.test(titleDesc)) return null;
      if (BAD_FISH.test(titleDesc) || ii.height > ii.width * 1.2 || BAD_PEOPLE.test(cats)) weak = true;
    } else if (BAD_PEOPLE.test(hay)) return null;
    if (mode === "nature" && (BAD_BUILD.test(hay) || ii.height > ii.width * 1.1)) return null;
    if (mode === "species" && (BAD_SPECIES.test(hay) || BAD_BUILD.test(title))) return null;
    const author = strip(md.Artist && md.Artist.value).slice(0, 80);
    const license = strip(md.LicenseShortName && md.LicenseShortName.value);
    return {
      url: ii.thumburl || ii.url,
      alt: strip(md.ObjectName && md.ObjectName.value) || title.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""),
      author: author || "Wikimedia Commons",
      license: license || "",
      sourceUrl: ii.descriptionurl || "",
      weak: weak || undefined
    };
  }

  async function search(q, mode) {
    const key = "s5:" + mode + ":" + q;
    const hit = readCache(key);
    if (hit) return hit;
    const j = await api({ generator: "search", gsrsearch: q + " filetype:bitmap", gsrnamespace: "6", gsrlimit: "50" });
    const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    const out = pages.map(p => normalize(p, mode)).filter(Boolean);
    if (out.length) writeCache(key, out);
    return out;
  }
  async function category(cat, mode) {
    const key = "c5:" + mode + ":" + cat;
    const hit = readCache(key);
    if (hit) return hit;
    const j = await api({ generator: "categorymembers", gcmtitle: cat, gcmtype: "file", gcmlimit: "80" });
    const pages = Object.values((j.query && j.query.pages) || {});
    const out = pages.map(p => normalize(p, mode)).filter(Boolean);
    if (out.length) writeCache(key, out);
    return out;
  }

  /* Запасные запросы по типу точки: если нужного места нет, берём похожие поблизости. */
  const NEAR = {
    fishing: ["Волга Астраханская область", "река Ахтуба", "дельта Волги", "Волга река берег", "протока дельта Волги", "камыш река", "Волга рассвет", "Волга закат река", "река Россия берег камыш", "ерик Астраханская область"],
    nature: ["дельта Волги", "камыш дельта Волги", "пойма Волги", "Астраханская область природа", "Волго-Ахтубинская пойма", "ерик пойма", "степь Астраханская область", "озеро камыш Россия юг"],
    places: ["Астраханская область", "Астрахань", "Прикаспийская низменность", "Астраханская область степь", "Волга Астрахань"]
  };

  async function forPlace(loc, want) {
    want = want || 4;
    const mode = loc.type === "places" ? "place" : "nature";
    const key = "stepPlaceB:" + loc.id;
    let picks = (lsGet(key) || []).filter(p => !isBlocked(p));
    if (picks.length >= want) return picks.slice(0, want);
    const have = new Set(picks.map(p => p.url));
    picks.forEach(p => claimed.set(p.sourceUrl || p.url, loc.id));
    const queries = (loc.photoQueries || []).concat(loc.photoNear || [], NEAR[loc.type] || []);
    for (const q of queries) {
      if (picks.length >= want) break;
      let list = [];
      try { list = await search(q, mode); } catch (_) { continue; }
      for (const p of seededShuffle(list, hash(loc.id + q))) {
        if (picks.length >= want) break;
        if (have.has(p.url) || isBlocked(p)) continue;
        const owner = claimed.get(p.sourceUrl || p.url);
        if (owner && owner !== loc.id) continue;
        have.add(p.url);
        claimed.set(p.sourceUrl || p.url, loc.id);
        picks.push(p);
      }
    }
    lsSet(key, picks);
    return picks;
  }

  async function forFish(fish, want) {
    want = want || 4;
    const picked = [], seen = new Set();
    const weakPool = [];
    const push = list => {
      for (const p of seededShuffle(list, hash(fish.id))) {
        if (picked.length >= want) break;
        if (seen.has(p.url) || isBlocked(p)) continue;
        if (p.weak) { weakPool.push(p); continue; }
        seen.add(p.url); picked.push(p);
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
    // не хватило идеальных: добираем менее подходящие, но без людей и техники
    for (const p of weakPool) {
      if (picked.length >= want) break;
      if (!seen.has(p.url)) { seen.add(p.url); picked.push(p); }
    }
    return picked;
  }

  /* Растения и животные: категория вида (латинское имя), затем поиск по латыни и по русскому названию. */
  async function forSpecies(item, want) {
    want = want || 4;
    const picked = [], seen = new Set();
    const push = list => {
      for (const p of seededShuffle(list, hash(item.latin || item.name))) {
        if (picked.length >= want) break;
        if (!seen.has(p.url) && !isBlocked(p)) { seen.add(p.url); picked.push(p); }
      }
    };
    if (item.latin) { try { push(await category("Category:" + item.latin, "species")); } catch (_) {} }
    for (const t of [item.latin, item.name].filter(Boolean)) {
      if (picked.length >= want) break;
      try { push(await search(t, "species")); } catch (_) {}
    }
    return picked;
  }

  root.StepPhotos = { forPlace, forFish, forSpecies, block, setBlocked, lastError: "" };
})(window);
