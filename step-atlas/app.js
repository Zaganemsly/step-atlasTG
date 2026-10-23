const DEFAULT_CENTER = [46.25, 48.0];
const DEFAULT_ZOOM = 9;
/* Астраханская область: left, top, right, bottom (для поиска адресов) */
const OBLAST_VIEWBOX = "44.4,49.2,50.3,45.0";
const $ = id => document.getElementById(id);

const map = L.map("map", { zoomControl: false, scrollWheelZoom: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
}).addTo(map);

const layerGroups = {
  fishing: L.layerGroup().addTo(map),
  nature: L.layerGroup().addTo(map),
  places: L.layerGroup().addTo(map)
};
const markers = new Map();
let locations = [];
let previousFocus = null;
let toastTimer = null;
const fishById = new Map();
const weatherCache = new Map();
const WEATHER_TTL_MS = 10 * 60 * 1000;
let selectedLoc = null;
let detailToken = 0;

const detailSheet = $("detailSheet");
const sheetBackdrop = $("sheetBackdrop");
const layerPanel = $("layerPanel");
const layersToggle = $("layersToggle");

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(message, ms) {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), ms || 3200);
}
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function button(text, cls, onClick) {
  const b = el("button", text, "btn " + (cls || ""));
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}
function tgApp() { return window.Telegram && window.Telegram.WebApp; }
function openExternal(url) {
  const tg = tgApp();
  try {
    if (tg && typeof tg.openLink === "function") return tg.openLink(url);
  } catch (_) {}
  window.open(url, "_blank", "noopener");
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function distKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtCoord(p) { return p.lat.toFixed(5) + ", " + p.lng.toFixed(5); }

function iconFor(type) {
  const color = type === "fishing" ? "blue" : type === "nature" ? "orange" : "green";
  const glyph = type === "fishing" ? "≈" : type === "nature" ? "✦" : "⌂";
  return L.divIcon({
    className: "",
    html: `<div class="map-pin pin-${color}" aria-hidden="true"><span>${glyph}</span></div>`,
    iconSize: [32, 38], iconAnchor: [16, 34], popupAnchor: [0, -32]
  });
}

/* ================= Карточка точки ================= */
function openDetails(loc) {
  previousFocus = document.activeElement;
  $("detailCategory").textContent = loc.category || "ТОЧКА АТЛАСА";
  $("detailTitle").textContent = loc.title;
  $("detailDescription").textContent = loc.description || "";
  $("detailContent").innerHTML = (loc.details || []).map(([label, value]) =>
    `<div class="info-card"><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></div>`
  ).join("");
  selectedLoc = loc;
  const token = ++detailToken;

  const actions = $("detailActions");
  actions.replaceChildren(
    button("Проложить маршрут сюда", "primary", () => { closeDetails(); setDestination({ lat: loc.lat, lng: loc.lng, name: loc.title }); }),
    button("Показать на карте", "", () => { closeDetails(); map.flyTo([loc.lat, loc.lng], Math.max(map.getZoom(), 12)); })
  );

  renderPhotos(loc, null, true);
  loadPlacePhotos(loc, token);
  renderPlants(loc);
  renderAnimals(loc);
  renderFish(loc, null, token);
  renderWeatherLoading();
  loadWeatherFor(loc, token);

  const sourceNote = $("sourceNote");
  sourceNote.replaceChildren();
  sourceNote.append(document.createTextNode(
    `${loc.verified ? "Данные отмечены как проверенные." : "Запись ещё не вычитана редактором."} ${loc.source || ""}`
  ));
  if (Array.isArray(loc.sources) && loc.sources.length) {
    sourceNote.append(document.createTextNode(" Источники: "));
    loc.sources.forEach((item, index) => {
      if (index) sourceNote.append(document.createTextNode(" · "));
      const url = typeof item === "string" ? item : item && item.url;
      const label = typeof item === "string" ? item : (item && (item.title || item.url)) || "";
      let safeUrl = "";
      try {
        const parsed = new URL(url, window.location.href);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") safeUrl = parsed.href;
      } catch (_) {}
      if (safeUrl) {
        const link = document.createElement("a");
        link.href = safeUrl; link.target = "_blank"; link.rel = "noopener noreferrer";
        link.textContent = label || safeUrl;
        sourceNote.append(link);
      } else sourceNote.append(document.createTextNode(label));
    });
  }
  detailSheet.inert = false;
  const appShell = document.querySelector(".app-shell");
  if (appShell) appShell.inert = true;
  detailSheet.classList.add("open");
  sheetBackdrop.classList.add("open");
  const tg = tgApp();
  if (tg && tg.BackButton) { try { tg.BackButton.show(); } catch (_) {} }
  detailSheet.focus({ preventScroll: true });
}
function closeDetails() {
  const wasOpen = detailSheet.classList.contains("open");
  detailSheet.classList.remove("open");
  sheetBackdrop.classList.remove("open");
  detailSheet.inert = true;
  const appShell = document.querySelector(".app-shell");
  if (appShell) appShell.inert = false;
  const tg = tgApp();
  if (tg && tg.BackButton) { try { tg.BackButton.hide(); } catch (_) {} }
  if (wasOpen && previousFocus && typeof previousFocus.focus === "function") previousFocus.focus({ preventScroll: true });
}
function setLayerVisible(key, visible) {
  const group = layerGroups[key];
  if (!group) return;
  if (visible) group.addTo(map); else map.removeLayer(group);
  const checkbox = document.querySelector(`[data-layer="${key}"]`);
  if (checkbox) checkbox.checked = visible;
}
function syncNavigation() {
  const visible = Object.keys(layerGroups).filter(key => map.hasLayer(layerGroups[key]));
  let next = "all";
  if (visible.length === 1) next = visible[0];
  else if (visible.length === 0 || visible.length !== 3) next = "custom";
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === next);
    btn.setAttribute("aria-pressed", String(btn.dataset.filter === next));
  });
}
function addLocation(loc) {
  if (!loc || !loc.id || !Object.prototype.hasOwnProperty.call(layerGroups, loc.type) || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return;
  const marker = L.marker([loc.lat, loc.lng], { icon: iconFor(loc.type), title: loc.title || "Точка атласа", alt: loc.title || "Точка атласа" });
  marker.on("click", () => openDetails(loc));
  marker.addTo(layerGroups[loc.type]);
  markers.set(loc.id, marker);
}

/* ================= Погода, рыбы, растения, животные ================= */
function fmtTemp(t) {
  const r = Math.round(t);
  return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r) + "°";
}
function fmtNum(n, digits) { return n.toFixed(digits).replace(".", ","); }
function pressureText(w) {
  if (w.pressureMmHg === null) return "нет данных";
  let t = w.pressureMmHg + " мм рт. ст.";
  if (w.pressureTrend3h !== null) {
    const d = w.pressureTrend3h;
    t += Math.abs(d) <= 1 ? ", стабильно" : d < 0 ? ", падает" : ", растёт";
  }
  return t;
}
function weatherIcon(code) {
  if (code === null) return "☼";
  if (code <= 1) return "☼";
  if (code <= 3) return "☁";
  if (code === 45 || code === 48) return "≋";
  if (code >= 95) return "ϟ";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "❄";
  return "☂";
}
async function getWeather(loc) {
  const key = loc.id + ":" + loc.lat.toFixed(2) + ":" + loc.lng.toFixed(2);
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.t < WEATHER_TTL_MS) return hit.w;
  if (!window.StepWeather) throw new Error("weather.js не загружен");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(StepWeather.weatherUrl(loc.lat, loc.lng), { signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const w = StepWeather.parseWeather(await res.json());
    if (!w) throw new Error("Неожиданный ответ погоды");
    weatherCache.set(key, { t: Date.now(), w });
    return w;
  } finally { clearTimeout(timer); }
}
function fishListFor(loc) { return (loc.fish || []).map(id => fishById.get(id)).filter(Boolean); }
async function loadWeatherFor(loc, token) {
  try {
    const w = await getWeather(loc);
    const analysis = StepWeather.analyze(w, fishListFor(loc), loc.type);
    updatePill(loc, w, analysis);
    if (token !== detailToken) return;
    renderWeather(w, analysis);
    renderFish(loc, analysis, token);
  } catch (err) {
    console.warn("Погода недоступна", err);
    if (token !== detailToken) return;
    renderWeatherError();
    updatePillError();
  }
}
function renderWeatherLoading() {
  const box = $("detailWeather");
  box.hidden = false;
  box.replaceChildren(el("h2", "Погода на месте"), el("div", "Загружаем погоду…", "wx-error"));
}
function renderWeatherError() {
  const box = $("detailWeather");
  box.hidden = false;
  box.replaceChildren(
    el("h2", "Погода на месте"),
    el("div", "Не удалось загрузить погоду. Проверьте интернет и откройте точку ещё раз.", "wx-error")
  );
}
function renderWeather(w, analysis) {
  const box = $("detailWeather");
  box.hidden = false;
  box.replaceChildren(el("h2", "Погода на месте сейчас"));
  const now = el("div", null, "wx-now");
  now.append(el("div", fmtTemp(w.tempC), "wx-temp"));
  const l1 = el("div", null, "wx-line");
  l1.append(el("b", w.description ? w.description[0].toUpperCase() + w.description.slice(1) : "Погода"), document.createTextNode(", ощущается как " + fmtTemp(w.feelsC)));
  const l2 = el("div", "Ветер " + fmtNum(w.windMs, 1) + " м/с, порывы до " + fmtNum(w.gustMs, 1) + " м/с · давление " + pressureText(w) + (w.precipMm > 0 ? " · осадки " + fmtNum(w.precipMm, 1) + " мм" : ""), "wx-line");
  now.append(l1, l2);
  box.append(now);
  if (analysis.care.length) {
    const ul = el("ul", null, "wx-tips");
    analysis.care.forEach(t => ul.append(el("li", t.text, "wx-tip " + t.level)));
    box.append(ul);
  }
  box.append(el("p", analysis.wish, "wx-wish"));
  box.append(el("p", "Погода: Open-Meteo. Оценка клёва — ориентир по сезону, температуре, давлению, ветру и времени суток, а не гарантия.", "fish-note"));
}
function renderFish(loc, analysis, token) {
  const box = $("detailFish");
  const list = fishListFor(loc);
  if (!list.length) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  box.replaceChildren(el("h2", "Какая рыба здесь, когда клюёт и каков шанс"));

  const scoreById = new Map(analysis ? analysis.ranked.map(r => [r.fishId, r]) : []);
  const order = analysis ? analysis.ranked.map(r => fishById.get(r.fishId)) : list;
  order.forEach(f => {
    const row = el("div", null, "fish-row");
    const head = el("div", null, "fish-head");
    const title = el("div");
    title.append(el("strong", f.name), document.createTextNode(" "), el("em", f.latin));
    head.append(title);
    row.append(head);
    const s = scoreById.get(f.id);
    if (s) {
      const c = el("div");
      c.append(document.createTextNode("Шанс поймать сейчас: "), el("span", s.chance.label, "chance c" + s.chance.level));
      row.append(c);
      const bar = el("div", null, "bite-bar");
      const fill = el("i", null, s.score >= 70 ? "" : s.score >= 45 ? "mid" : "low");
      fill.style.width = Math.max(4, s.score) + "%";
      bar.append(fill);
      row.append(bar);
    }
    row.append(el("p", "Лучший сезон: " + StepWeather.formatMonths(f.peakMonths) + ". Берёт, но слабее: " + StepWeather.formatMonths(f.goodMonths) + ".", "fish-note"));
    if (s) {
      row.append(el("p", "Лучшее время суток: " + s.window + ".", "fish-note"));
      if (s.nextPeak && s.nextPeak.months > 0 && s.score < 45) {
        row.append(el("p", "До пика сезона: примерно " + s.nextPeak.months + " мес. (" + s.nextPeak.name + ").", "fish-note"));
      }
      row.append(el("p", "Почему так сейчас: " + s.reasons.slice(0, 3).join("; ") + ".", "fish-note"));
    }
    row.append(el("p", f.why, "fish-note"));
    const gal = el("div", null, "fish-gallery");
    gal.hidden = true;
    row.append(gal);
    fillFishGallery(f, gal, token);
    box.append(row);
  });
}
const fishPhotoCache = new Map();
async function fillFishGallery(f, gal, token) {
  let photos = f.photos && f.photos.length ? f.photos : fishPhotoCache.get(f.id);
  if (!photos) {
    try { photos = await StepPhotos.forFish(f, 3); } catch (_) { photos = []; }
    fishPhotoCache.set(f.id, photos);
  }
  if (token !== detailToken || !gal.isConnected) return;
  const figs = photos.map(p => photoFigure(p, f.name, "fish-gallery")).filter(Boolean);
  if (!figs.length) return;
  gal.hidden = false;
  gal.replaceChildren(...figs);
}
function renderPlants(loc) {
  const box = $("detailPlants");
  const plants = loc.plants || [];
  if (!plants.length) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  box.replaceChildren(el("h2", "Травы и водные растения"));
  plants.forEach(p => {
    const row = el("div", null, "plant");
    row.append(el("b", p.name));
    if (p.latin) row.append(document.createTextNode(" "), el("i", p.latin));
    if (p.rare) row.append(el("span", "редкий, Красная книга РФ", "rare"));
    if (p.note) row.append(el("div", p.note));
    box.append(row);
  });
}
function renderAnimals(loc) {
  const box = $("detailAnimals");
  const list = loc.animals || [];
  if (!list.length) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  box.replaceChildren(el("h2", "Кого можно увидеть"));
  list.forEach(a => {
    const row = el("div", null, "animal");
    row.append(el("b", a.name));
    if (a.latin) row.append(document.createTextNode(" "), el("i", a.latin));
    if (a.note) row.append(el("div", a.note));
    box.append(row);
  });
  box.append(el("p", "Список по справочным источникам для района, а не данные наблюдений в этой точке.", "fish-note"));
}

/* ---------- Фото ---------- */
function safeUrl(u) {
  try { const x = new URL(u); return x.protocol === "https:" ? x.href : ""; } catch (_) { return ""; }
}
function photoFigure(p, alt, cls) {
  const src = safeUrl(p && p.url);
  if (!src) return null;
  const fig = document.createElement("figure");
  const img = document.createElement("img");
  img.src = src; img.alt = p.alt || alt || ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => fig.remove());
  fig.append(img);
  const credit = [p.author, p.license].filter(Boolean).join(" · ");
  const src2 = safeUrl(p.sourceUrl);
  if (credit || src2) {
    const cap = el("figcaption", credit);
    if (src2) {
      const a = document.createElement("a");
      a.href = src2; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.textContent = credit ? " · источник" : "источник";
      cap.append(a);
    }
    fig.append(cap);
  }
  return fig;
}
function renderPhotos(loc, photos, loading) {
  const box = $("detailGallery");
  box.replaceChildren();
  if (loading) { box.hidden = false; box.className = "photo-empty"; box.textContent = "Ищем фотографии места…"; return; }
  const figs = (photos || []).map(p => photoFigure(p, loc.title)).filter(Boolean);
  box.hidden = false;
  if (figs.length) {
    box.className = "detail-gallery";
    figs.forEach(f => box.append(f));
  } else {
    box.className = "photo-empty";
    box.textContent = loc.adhoc ? "Для произвольного адреса фото не подбираются." : "Не удалось подобрать фото места (нет интернета или ничего подходящего в открытых источниках).";
  }
}
async function loadPlacePhotos(loc, token) {
  if (loc.adhoc) { renderPhotos(loc, [], false); return; }
  if (!loc._photos) {
    const own = Array.isArray(loc.photos) ? loc.photos.slice() : [];
    let extra = [];
    if (own.length < 4) { try { extra = await StepPhotos.forPlace(loc, 4 - own.length); } catch (_) {} }
    loc._photos = own.concat(extra);
  }
  if (token !== detailToken) return;
  renderPhotos(loc, loc._photos, false);
}

/* ---------- Плашка «Погода на месте» ---------- */
function updatePill(loc, w, analysis) {
  if (selectedLoc && loc.id !== selectedLoc.id) return;
  const danger = analysis.care.some(t => t.level === "danger");
  $("pillIcon").textContent = weatherIcon(w.code);
  $("pillTitle").textContent = loc.title.split(" — ")[0];
  const best = analysis.ranked[0];
  $("pillText").textContent =
    (danger ? "⚠ " : "") + fmtTemp(w.tempC) + ", ветер " + fmtNum(w.windMs, 0) + " м/с" + (best ? ", шанс поймать: " + best.chance.label : "");
  $("weatherButton").dataset.level = danger ? "danger" : "ok";
}
function updatePillError() {
  $("pillTitle").textContent = "Погода на месте";
  $("pillText").textContent = "Не загрузилась. Нажмите, чтобы повторить";
}
async function refreshPill() {
  if (!selectedLoc) return;
  $("pillText").textContent = "Загружаем условия…";
  try {
    const w = await getWeather(selectedLoc);
    updatePill(selectedLoc, w, StepWeather.analyze(w, fishListFor(selectedLoc), selectedLoc.type));
  } catch (err) { console.warn("Погода недоступна", err); updatePillError(); }
}

/* ================= Данные и уточнение координат ================= */
async function loadFish() {
  try {
    const response = await fetch("data/fish.json");
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();
    if (Array.isArray(data)) data.forEach(f => { if (f && f.id) fishById.set(f.id, f); });
  } catch (err) { console.error("Не удалось загрузить data/fish.json", err); }
}
async function loadPoints() {
  try {
    const response = await fetch("data/points.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Формат points.json должен быть массивом");
    locations = data;
    locations.forEach(addLocation);
    if (!selectedLoc && locations.length) selectedLoc = locations[0];
    refreshPill();
    snapAll();
  } catch (err) {
    console.error("Не удалось загрузить data/points.json", err);
    toast("Не удалось загрузить точки. Запустите проект через локальный сервер (см. README).");
  }
}

/* Nominatim: не чаще 1 запроса в секунду (правила OSM). */
let lastGeoAt = 0;
async function nominatim(params, signal) {
  const wait = lastGeoAt + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastGeoAt = Date.now();
  const q = new URLSearchParams(Object.assign({ format: "jsonv2", "accept-language": "ru", addressdetails: "1", countrycodes: "ru" }, params));
  const res = await fetch("https://nominatim.openstreetmap.org/search?" + q.toString(), { signal });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}
async function geocodeOblast(text, signal) {
  const base = { limit: "8", bounded: "1", viewbox: OBLAST_VIEWBOX };
  const tries = [text];
  if (!/астрахан/i.test(text)) tries.push(text + ", Астраханская область");
  const seen = new Set(), out = [];
  for (const t of tries) {
    let list = [];
    try { list = await nominatim(Object.assign({ q: t }, base), signal); } catch (e) { if (e.name === "AbortError") throw e; }
    for (const r of list) { if (!seen.has(r.place_id)) { seen.add(r.place_id); out.push(r); } }
    if (out.length >= 3) break;
  }
  return out;
}
function shortName(r) {
  const a = r.address || {};
  const place = a.road || a.pedestrian || a.hamlet || a.village || a.town || a.city || a.suburb || r.name || (r.display_name || "").split(",")[0];
  const house = a.house_number ? " " + a.house_number : "";
  return (a.road && a.house_number ? a.road + house : place);
}
function subName(r) {
  return (r.display_name || "").split(",").map(s => s.trim()).filter(s => !/^(Россия|\d{5,6})$/.test(s)).slice(0, 5).join(", ");
}

/* Уточняем координаты населённых пунктов по OpenStreetMap, результат кэшируется на 30 дней. */
async function snapAll() {
  for (const loc of locations) {
    if (!loc.geocode || loc.coordsVerified) continue;
    const key = "stepSnap:" + loc.id;
    let ok = null;
    try {
      const raw = localStorage.getItem(key);
      if (raw) { const o = JSON.parse(raw); if (o && Date.now() - o.t < 30 * 864e5) ok = o; }
    } catch (_) {}
    if (!ok) {
      try {
        const list = await nominatim({ q: loc.geocode, limit: "1", bounded: "1", viewbox: OBLAST_VIEWBOX });
        if (list && list[0]) {
          ok = { t: Date.now(), lat: parseFloat(list[0].lat), lng: parseFloat(list[0].lon) };
          try { localStorage.setItem(key, JSON.stringify(ok)); } catch (_) {}
        }
      } catch (_) { continue; }
    }
    if (ok && Number.isFinite(ok.lat) && distKm(loc, ok) < 150) {
      loc.lat = ok.lat; loc.lng = ok.lng; loc.coordsVerified = "osm";
      const m = markers.get(loc.id);
      if (m) m.setLatLng([loc.lat, loc.lng]);
    }
  }
}

/* ================= Поиск по всей области ================= */
const search = $("search");
const results = $("searchResults");
let searchAbort = null;
function hideResults() { results.hidden = true; results.replaceChildren(); }
function showResults(nodes) { results.replaceChildren(...nodes); results.hidden = !nodes.length; }
function resItem(title, sub, onPick) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "sr-item";
  b.append(el("b", title));
  if (sub) b.append(el("small", sub));
  b.addEventListener("click", () => { hideResults(); onPick(); });
  return b;
}
function localMatches(q) {
  const t = q.toLocaleLowerCase("ru");
  return locations.filter(l => {
    const fishNames = fishListFor(l).map(f => f.name).join(" ");
    return (l.title + " " + (l.description || "") + " " + (l.category || "") + " " + fishNames).toLocaleLowerCase("ru").includes(t);
  }).slice(0, 6);
}
function pickLocal(loc) {
  setLayerVisible(loc.type, true);
  syncNavigation();
  map.flyTo([loc.lat, loc.lng], 12);
  openDetails(loc);
}
let searchMarker = null;
function pickAddress(r) {
  const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const title = shortName(r);
  placeSearchMarker({ lat, lng, name: title, sub: subName(r) });
}
function placeSearchMarker(p) {
  if (searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "", html: '<div class="search-pin"></div>', iconSize: [24, 24], iconAnchor: [12, 12] }), title: p.name }).addTo(map);
  const box = el("div");
  box.append(el("b", p.name || "Точка"), el("div", p.sub || fmtCoord(p), "fish-note"));
  const row = el("div", null, "rb-row");
  row.style.marginTop = "8px";
  row.append(
    button("Маршрут сюда", "primary", () => { map.closePopup(); setDestination({ lat: p.lat, lng: p.lng, name: p.name }); }),
    button("Погода", "", () => {
      map.closePopup();
      const adhoc = { id: "adhoc-" + p.lat.toFixed(4) + "-" + p.lng.toFixed(4), type: "places", adhoc: true, lat: p.lat, lng: p.lng, title: p.name || "Точка на карте", category: "АДРЕС · ПОИСК", description: p.sub || fmtCoord(p), details: [["Координаты", fmtCoord(p)]], source: "Адрес найден через OpenStreetMap (Nominatim)." };
      openDetails(adhoc);
    })
  );
  box.append(row);
  searchMarker.bindPopup(box).openPopup();
  map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 13));
}
function parseCoords(q) {
  const m = q.match(/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
  if (!m) return null;
  const a = parseFloat(m[1].replace(",", ".")), b = parseFloat(m[2].replace(",", "."));
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lng: b };
  return null;
}
async function runSearch(q) {
  const coords = parseCoords(q);
  if (coords) { placeSearchMarker({ lat: coords.lat, lng: coords.lng, name: "Точка по координатам", sub: fmtCoord(coords) }); hideResults(); return; }
  const local = localMatches(q);
  const nodes = [];
  if (local.length) {
    nodes.push(el("div", "ТОЧКИ АТЛАСА", "sr-head"));
    local.forEach(l => nodes.push(resItem(l.title, l.category, () => pickLocal(l))));
  }
  nodes.push(el("div", "ИЩЕМ АДРЕС ПО ВСЕЙ ОБЛАСТИ…", "sr-head"));
  showResults(nodes);
  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();
  const mine = searchAbort;
  let found = [];
  try { found = await geocodeOblast(q, mine.signal); }
  catch (e) {
    if (e.name === "AbortError") return;
    const n2 = nodes.slice(0, -1);
    n2.push(el("div", "Не удалось связаться с сервисом адресов. Проверьте интернет и повторите.", "sr-msg"));
    return showResults(n2);
  }
  const finalNodes = nodes.slice(0, -1);
  if (found.length) {
    finalNodes.push(el("div", "АДРЕСА И МЕСТА В АСТРАХАНСКОЙ ОБЛАСТИ", "sr-head"));
    found.forEach(r => finalNodes.push(resItem(shortName(r), subName(r), () => pickAddress(r))));
  } else if (!local.length) {
    finalNodes.push(el("div", "Ничего не нашли. Попробуйте иначе: «Камызяк, Ленина 10», «село Оля» или координаты «46.35, 48.03».", "sr-msg"));
  }
  showResults(finalNodes);
  if (!local.length && found.length === 1) { hideResults(); pickAddress(found[0]); }
}
search.addEventListener("keydown", event => {
  if (event.key === "Enter") { const q = search.value.trim(); if (q) runSearch(q); }
  if (event.key === "Escape") hideResults();
});
search.addEventListener("input", () => {
  const q = search.value.trim();
  if (q.length < 2) return hideResults();
  const local = localMatches(q);
  const nodes = local.map(l => resItem(l.title, l.category, () => pickLocal(l)));
  nodes.push(el("div", "Нажмите Enter, чтобы найти адрес по всей Астраханской области", "sr-msg"));
  showResults(nodes);
});
document.addEventListener("click", e => { if (!e.target.closest(".search-wrap")) hideResults(); });

/* ================= Где я и маршрут ================= */
const route = { start: null, dest: null, mode: null, msg: "", info: null, line: null, destMarker: null, meMarker: null, meCircle: null, busy: false };

function tgLocation() {
  return new Promise(resolve => {
    const tg = tgApp();
    const lm = tg && tg.LocationManager;
    if (!lm || typeof lm.init !== "function") return resolve(null);
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(null), 9000);
    try {
      lm.init(() => {
        try {
          lm.getLocation(d => finish(d && Number.isFinite(d.latitude) ? { lat: d.latitude, lng: d.longitude, acc: d.horizontal_accuracy || null } : null));
        } catch (_) { finish(null); }
      });
    } catch (_) { finish(null); }
  });
}
function browserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject({ code: 0 });
    const ok = p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
    navigator.geolocation.getCurrentPosition(ok, err => {
      if (err.code === 1) return reject(err);
      navigator.geolocation.getCurrentPosition(ok, reject, { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  });
}
async function locate() {
  if (route.busy) return;
  route.busy = true;
  route.msg = "Определяем ваше местоположение…";
  renderRouteBar();
  toast("Определяем местоположение…");
  try {
    let p = await tgLocation();
    if (!p) p = await browserLocation();
    route.msg = "";
    setStart({ lat: p.lat, lng: p.lng, acc: p.acc, name: "Моё местоположение" }, true);
  } catch (err) {
    route.msg = "";
    locationFailed(err);
  } finally { route.busy = false; renderRouteBar(); }
}
function locationFailed(err) {
  const tg = tgApp();
  let why;
  if (!window.isSecureContext) why = "Страница открыта не по HTTPS, поэтому браузер блокирует геолокацию.";
  else if (err && err.code === 1) why = tg ? "Доступ к геопозиции запрещён. Разрешите его для Telegram в настройках телефона или откройте атлас в обычном браузере." : "Доступ к геопозиции запрещён. Разрешите его для этого сайта в настройках браузера.";
  else if (err && err.code === 3) why = "Не удалось поймать сигнал за отведённое время. Выйдите на открытое место и повторите.";
  else if (err && err.code === 0) why = "Это устройство или встроенный браузер не поддерживает геолокацию.";
  else why = "Не получилось определить местоположение.";
  route.failure = { why, canBrowser: !!tg };
  route.mode = "pickStart";
  renderRouteBar();
}
function setStart(p, fly) {
  route.start = p;
  route.failure = null;
  const ll = [p.lat, p.lng];
  if (!route.meMarker) {
    route.meMarker = L.marker(ll, { icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [26, 26], iconAnchor: [13, 13] }), title: "Вы здесь", zIndexOffset: 900 }).addTo(map);
    route.meMarker.on("click", e => { if (e.originalEvent) L.DomEvent.stopPropagation(e); onMeTap(); });
  } else { route.meMarker.setLatLng(ll); if (!map.hasLayer(route.meMarker)) route.meMarker.addTo(map); }
  if (route.meCircle) map.removeLayer(route.meCircle);
  route.meCircle = null;
  if (p.acc && p.acc > 30 && p.acc < 50000) route.meCircle = L.circle(ll, { radius: p.acc, color: "#2d7db1", weight: 1, fillOpacity: .08, interactive: false }).addTo(map);
  if (fly) map.flyTo(ll, Math.max(map.getZoom(), 12));
  route.mode = route.dest ? null : "pickDest";
  if (route.dest) buildRoute();
  renderRouteBar();
}
function onMeTap() {
  if (!route.dest) route.mode = "pickDest";
  route.msg = "";
  renderRouteBar();
  toast("Нажмите на карте, куда нужно доехать");
}
function setDestination(d) {
  route.dest = d;
  route.failure = null;
  if (route.destMarker) map.removeLayer(route.destMarker);
  route.destMarker = L.marker([d.lat, d.lng], { icon: L.divIcon({ className: "", html: '<div class="dest-pin"></div>', iconSize: [30, 30], iconAnchor: [15, 30] }), title: d.name || "Пункт назначения", zIndexOffset: 800 }).addTo(map);
  route.mode = route.start ? null : "pickStart";
  if (route.start) buildRoute(); else map.flyTo([d.lat, d.lng], Math.max(map.getZoom(), 11));
  renderRouteBar();
}
function clearRoute() {
  route.start = route.dest = route.mode = route.info = null; route.msg = ""; route.failure = null;
  [route.line, route.destMarker, route.meMarker, route.meCircle].forEach(l => { if (l) map.removeLayer(l); });
  route.line = route.destMarker = route.meMarker = route.meCircle = null;
  renderRouteBar();
}
async function buildRoute() {
  const { start, dest } = route;
  if (!start || !dest) return;
  if (route.line) { map.removeLayer(route.line); route.line = null; }
  route.info = null;
  const straight = distKm(start, dest);
  const bounds = L.latLngBounds([[start.lat, start.lng], [dest.lat, dest.lng]]);
  map.fitBounds(bounds, { padding: [60, 60], maxZoom: 13 });
  let drawn = false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const j = await res.json();
    if (j && j.routes && j.routes[0]) {
      const r = j.routes[0];
      route.line = L.geoJSON(r.geometry, { style: { color: "#c2462d", weight: 5, opacity: .85 } }).addTo(map);
      route.info = { km: r.distance / 1000, min: Math.round(r.duration / 60), straight: false };
      drawn = true;
    }
  } catch (_) {}
  if (!drawn) {
    route.line = L.polyline([[start.lat, start.lng], [dest.lat, dest.lng]], { color: "#c2462d", weight: 4, dashArray: "8 8" }).addTo(map);
    route.info = { km: straight, min: null, straight: true };
  }
  renderRouteBar();
}
function routeLinks() {
  const { start: a, dest: b } = route;
  return [
    ["Яндекс Карты", `https://yandex.ru/maps/?rtext=${a.lat},${a.lng}~${b.lat},${b.lng}&rtt=auto`],
    ["Google Карты", `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=driving`],
    ["2ГИС", `https://2gis.ru/routeSearch/rtype/car/from/${a.lng},${a.lat}/to/${b.lng},${b.lat}`],
    ["OpenStreetMap", `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${a.lat}%2C${a.lng}%3B${b.lat}%2C${b.lng}`]
  ];
}
function fmtDur(min) { return min >= 60 ? Math.floor(min / 60) + " ч " + (min % 60) + " мин" : min + " мин"; }
function renderRouteBar() {
  const bar = $("routeBar");
  const { start, dest } = route;
  if (!start && !dest && !route.failure && !route.msg) { bar.hidden = true; bar.replaceChildren(); return; }
  bar.hidden = false;
  const nodes = [];
  const row = el("div", null, "rb-row");
  const cancel = button("Сбросить", "ghost", clearRoute);
  if (route.msg) {
    nodes.push(el("p", route.msg, "rb-title"));
  } else if (start && dest) {
    nodes.push(el("p", "Маршрут: " + (dest.name || "выбранная точка"), "rb-title"));
    const info = route.info;
    nodes.push(el("p", !info ? "Строим маршрут…" : info.straight
      ? "По прямой около " + fmtNum(info.km, 0) + " км. Дорожный маршрут не загрузился, откройте его в навигаторе ниже."
      : "По дорогам около " + fmtNum(info.km, 0) + " км, примерно " + fmtDur(info.min) + ". В дельте и степи дороги могут быть грунтовыми или закрытыми, сверяйтесь с навигатором.", "rb-text"));
    routeLinks().forEach(([name, url], i) => row.append(button(name, i === 0 ? "primary" : "", () => openExternal(url))));
    row.append(cancel);
  } else if (start && !dest) {
    nodes.push(el("p", "Вы здесь" + (start.acc ? " (±" + Math.round(start.acc) + " м)" : ""), "rb-title"));
    nodes.push(el("p", "Нажмите на карте, куда нужно доехать, или выберите точку атласа и нажмите «Проложить маршрут сюда».", "rb-text"));
    row.append(cancel);
  } else if (dest && !start) {
    nodes.push(el("p", "Куда: " + (dest.name || "выбранная точка"), "rb-title"));
    if (route.failure) nodes.push(el("p", route.failure.why, "rb-text"));
    else nodes.push(el("p", route.mode === "pickStart" ? "Нажмите на карте, откуда выезжаете, или определите местоположение." : "Откуда поедете?", "rb-text"));
    row.append(button("Определить где я", "primary", locate), button("Указать старт на карте", "", () => { route.mode = "pickStart"; toast("Нажмите на карте точку старта"); }));
    if (route.failure && route.failure.canBrowser) row.append(button("Открыть в браузере", "", () => openExternal(location.href)));
    row.append(cancel);
  } else if (route.failure) {
    nodes.push(el("p", "Не удалось определить местоположение", "rb-title"));
    nodes.push(el("p", route.failure.why + " Можно указать старт вручную: нажмите на карте нужную точку.", "rb-text"));
    row.append(button("Повторить", "primary", locate));
    if (route.failure.canBrowser) row.append(button("Открыть в браузере", "", () => openExternal(location.href)));
    row.append(cancel);
  }
  if (row.childNodes.length) nodes.push(row);
  bar.replaceChildren(...nodes);
}
map.on("click", e => {
  layerPanel.classList.remove("open");
  const p = { lat: e.latlng.lat, lng: e.latlng.lng };
  if (route.mode === "pickDest") setDestination({ lat: p.lat, lng: p.lng, name: "Точка на карте (" + fmtCoord(p) + ")" });
  else if (route.mode === "pickStart") { route.failure = null; setStart({ lat: p.lat, lng: p.lng, acc: null, name: "Старт на карте" }, false); }
});
$("locate").addEventListener("click", locate);

/* ================= Остальные обработчики ================= */
$("closeDetail").addEventListener("click", closeDetails);
sheetBackdrop.addEventListener("click", closeDetails);
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    if (detailSheet.classList.contains("open")) closeDetails();
    if (layerPanel.classList.contains("open")) {
      layerPanel.classList.remove("open");
      if (layersToggle) layersToggle.focus({ preventScroll: true });
    }
  }
  if (event.key === "Tab" && detailSheet.classList.contains("open")) {
    const focusable = [...detailSheet.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])')]
      .filter(n => !n.disabled && n.offsetParent !== null);
    if (!focusable.length) { event.preventDefault(); detailSheet.focus(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
layersToggle.addEventListener("click", () => layerPanel.classList.toggle("open"));
$("closeLayers").addEventListener("click", () => layerPanel.classList.remove("open"));
document.querySelectorAll("[data-layer]").forEach(input => {
  input.addEventListener("change", () => { setLayerVisible(input.dataset.layer, input.checked); syncNavigation(); });
});
$("zoomIn").addEventListener("click", () => map.zoomIn());
$("zoomOut").addEventListener("click", () => map.zoomOut());
$("resetView").addEventListener("click", () => map.setView(DEFAULT_CENTER, DEFAULT_ZOOM));
$("weatherButton").addEventListener("click", () => {
  if (!selectedLoc) return toast("Точки ещё загружаются. Попробуйте через секунду.");
  openDetails(selectedLoc);
  map.setView([selectedLoc.lat, selectedLoc.lng], Math.max(map.getZoom(), 10));
});
document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    const filter = btn.dataset.filter;
    Object.keys(layerGroups).forEach(key => setLayerVisible(key, filter === "all" || filter === key));
    syncNavigation();
    if (filter !== "all" && filter !== "custom") {
      const pts = locations.filter(l => l.type === filter);
      if (pts.length) map.fitBounds(L.latLngBounds(pts.map(l => [l.lat, l.lng])), { padding: [50, 50], maxZoom: 9 });
      toast(filter === "fishing" ? "Показаны рыболовные метки" : filter === "nature" ? "Показаны метки природы" : "Показаны интересные места");
    } else if (filter === "all") map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  });
});

function initTelegram() {
  const tg = tgApp();
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    if (tg.isVersionAtLeast && tg.isVersionAtLeast("7.7") && typeof tg.disableVerticalSwipes === "function") {
      try { tg.disableVerticalSwipes(); } catch (_) {}
    }
    if (tg.BackButton && typeof tg.BackButton.onClick === "function") {
      tg.BackButton.onClick(() => {
        if (detailSheet.classList.contains("open")) closeDetails();
        else tg.BackButton.hide();
      });
      tg.BackButton.hide();
    }
  } catch (err) { console.warn("Telegram WebApp initialization skipped", err); }
}
detailSheet.inert = true;
initTelegram();
syncNavigation();
loadFish().then(loadPoints);
setTimeout(() => map.invalidateSize(), 100);
