const DEFAULT_CENTER = [46.25, 48.0];
const DEFAULT_ZOOM = 9;
/* Астраханская область: left, top, right, bottom (для поиска адресов) */
const OBLAST_VIEWBOX = "44.4,49.2,50.3,45.0";
const $ = id => document.getElementById(id);
/* Режим редактора: откройте страницу с ?edit=1 один раз. Только там видны ✕ и кнопки фиксации фото. */
const EDITOR = (() => {
  try {
    if (/[?&]edit=1/.test(location.search)) localStorage.setItem("stepEditor", "1");
    if (/[?&]edit=0/.test(location.search)) localStorage.removeItem("stepEditor");
    return localStorage.getItem("stepEditor") === "1";
  } catch (_) { return /[?&]edit=1/.test(location.search); }
})();

const map = L.map("map", { zoomControl: false, scrollWheelZoom: true, attributionControl: false }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
// Подпись карты: только обязательная ссылка на OpenStreetMap.
L.control.attribution({ prefix: false }).addTo(map);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
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
    button("Показать на карте", "", () => { closeDetails(); map.flyTo([loc.lat, loc.lng], Math.max(map.getZoom(), 12)); }),
    button("Скопировать координаты", "", () => {
      const text = fmtCoord(loc);
      copyText(text).then(ok => toast(ok ? "Координаты скопированы: " + text : "Не удалось скопировать. Координаты: " + text, 4500));
    })
  );
  const sos = el("a", "Экстренный вызов 112", "btn ghost");
  sos.href = "tel:112";
  actions.append(sos);

  renderPhotos(loc, null, true);
  loadPlacePhotos(loc, token);
  renderPlants(loc);
  renderAnimals(loc);
  renderDetailBans(loc);
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
  const marker = L.marker([loc.lat, loc.lng], { icon: iconFor(loc.type), title: loc.title || "Точка атласа", alt: loc.title || "Точка атласа", zIndexOffset: 300 });
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
function fmtSigned(n) { const r = Math.round(n * 10) / 10; return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r).toFixed(1).replace(".", ","); }
function fmtHM(h) { const m = Math.round(h * 60); return String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
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
function fishListFor(loc, forScore) {
  const freq = loc.fishFreq || {};
  return (loc.fish || []).filter(id => !(forScore && freq[id] === "rare")).map(id => fishById.get(id)).filter(Boolean);
}
const FREQ_TEXT = { often: "встречается часто", sometimes: "встречается иногда", rare: "встречается редко" };
async function loadWeatherFor(loc, token) {
  try {
    const w = await getWeather(loc);
    const analysis = StepWeather.analyze(w, fishListFor(loc, true), loc.type, loc.id);
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
  const danger = analysis.care.some(t => t.level === "danger");
  const v = analysis.verdict;
  if (v && !danger) {
    const head = el("div", null, "wx-verdict");
    head.append(document.createTextNode("Клёв сегодня: "), el("span", v.label, "chance c" + v.level));
    const bar = el("div", null, "bite-bar");
    const fill = el("i", null, v.score >= 70 ? "" : v.score >= 45 ? "mid" : "low");
    fill.style.width = Math.max(4, v.score) + "%";
    bar.append(fill);
    box.append(head, bar, el("p", v.text, "wx-wish"));
  } else box.append(el("p", analysis.wish, "wx-wish"));
  const used = [];
  if (w.pressureMmHg !== null) {
    let t = "давление " + w.pressureMmHg + " мм рт. ст.";
    const parts = [];
    if (w.pressureTrend3h !== null) parts.push("за 3 ч " + fmtSigned(w.pressureTrend3h * 0.750062));
    if (w.pressureTrend24h !== null) parts.push("за сутки " + fmtSigned(w.pressureTrend24h * 0.750062));
    if (parts.length) t += " (" + parts.join(", ") + ")";
    used.push(t);
  }
  used.push("ветер " + fmtNum(w.windMs, 1) + " м/с");
  if (w.cloud !== null) used.push("облачность " + Math.round(w.cloud) + "%");
  if (w.sunriseH !== null && w.sunsetH !== null) used.push("восход " + fmtHM(w.sunriseH) + ", закат " + fmtHM(w.sunsetH));
  if (w.moon) used.push("Луна: " + w.moon.name);
  box.append(el("p", "Что учтено: " + used.join("; ") + ".", "fish-note"));
  const weatherNote = el("p", null, "fish-note");
  const meteoLink = el("a", "Weather data by Open-Meteo.com");
  meteoLink.href = "https://open-meteo.com/";
  meteoLink.target = "_blank";
  meteoLink.rel = "noopener noreferrer";
  meteoLink.addEventListener("click", e => { e.preventDefault(); openExternal(meteoLink.href); });
  weatherNote.append(
    document.createTextNode("Погода: "), meteoLink,
    document.createTextNode(". Единой научной формулы клёва нет. Оценка собрана по рекомендациям рыболовных изданий: ровное давление и его плавный рост хороши, резкие скачки плохи, в жару рыба уходит на глубину, лучше всего зорьки. Это ориентир, а не гарантия.")
  );
  box.append(weatherNote);
}
function renderFish(loc, analysis, token) {
  const box = $("detailFish");
  const list = fishListFor(loc);
  if (!list.length) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  box.replaceChildren(el("h2", "Какая рыба здесь, когда клюёт и каков шанс"));

  const scoreById = new Map(analysis ? analysis.ranked.map(r => [r.fishId, r]) : []);
  let order = analysis ? analysis.ranked.map(r => fishById.get(r.fishId)).filter(Boolean) : list;
  if (analysis) { const inOrder = new Set(order.map(f => f.id)); order = order.concat(list.filter(f => !inOrder.has(f.id))); }
  const SHOW = 6;
  const rows = [];
  order.forEach(f => {
    const row = el("div", null, "fish-row");
    const head = el("div", null, "fish-head");
    const title = el("div");
    title.append(el("strong", f.name), document.createTextNode(" "), el("em", f.latin));
    head.append(title);
    const fq = loc.fishFreq && loc.fishFreq[f.id];
    if (fq && FREQ_TEXT[fq]) head.append(el("span", FREQ_TEXT[fq], "fish-freq " + fq));
    row.append(head);
    if (f.legal) {
      const L = f.legal, bits = [];
      bits.push(L.minCm ? "не мельче " + L.minCm + " см" : "размер не указан");
      if (L.norm) bits.push("норма " + L.norm);
      row.append(el("p", "Правила: " + bits.join(", ") + "." + (L.note ? " " + L.note : "") + " Сверьте с актуальными правилами.", "fish-legal"));
    }
    if (fq === "rare" && !scoreById.get(f.id)) row.append(el("p", "Встречается редко: шанс поймать сейчас не оцениваем.", "fish-note"));
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
    lazyRun(row, () => fillFishGallery(f, gal, token));
    rows.push(row);
  });
  rows.forEach((r, i) => { if (i >= SHOW) r.hidden = true; box.append(r); });
  if (rows.length > SHOW) {
    const more = el("button", "Показать ещё " + (rows.length - SHOW) + " " + (rows.length - SHOW === 1 ? "вид" : "видов"), "more-btn");
    more.type = "button";
    more.addEventListener("click", () => { rows.forEach(r => { r.hidden = false; }); more.remove(); });
    box.append(more);
  }
  box.append(el("p", "Список видов составлен по справочным данным о нижней Волге и дельте. Это не наблюдения именно в этой точке. Запрещённые виды (осетровые, кутум, рыбец, налим и другие) смотрите в разделе «Запреты».", "fish-note"));
}
/* Зафиксированная подборка фото (data/photos.json): у всех пользователей одни и те же снимки. */
let fixedPhotos = { places: {}, fish: {}, species: {} };
async function loadFixedPhotos() {
  try {
    const r = await fetch("data/photos.json");
    if (!r.ok) return;
    const j = await r.json();
    fixedPhotos = { places: j.places || {}, fish: j.fish || {}, species: j.species || {} };
  } catch (_) {}
}
const failedUrls = new Set();
const usable = list => (list || []).filter(p => p && p.url && !failedUrls.has(p.url));
const fishPhotoCache = new Map();
async function fillFishGallery(f, gal, token) {
  let photos = usable(f.photos && f.photos.length ? f.photos : fixedPhotos.fish[f.id]);
  if (photos.length < 3) {
    photos = fishPhotoCache.get(f.id);
    if (!photos) {
      try { photos = await StepPhotos.forFish(f, 4); } catch (_) { photos = []; }
      fishPhotoCache.set(f.id, photos);
    }
    photos = usable(photos);
  }
  if (token !== detailToken || !gal.isConnected) return;
  const again = (bad, broken) => { if (broken && bad) failedUrls.add(bad.url); fishPhotoCache.delete(f.id); fillFishGallery(f, gal, detailToken); };
  const figs = photos.map(p => photoFigure(p, f.name, again)).filter(Boolean);
  gal.hidden = false;
  if (!figs.length) { gal.replaceChildren(retryNote(again)); return; }
  gal.replaceChildren(...figs);
}
const speciesCache = new Map();
function lazyRun(node, fn) {
  if (!("IntersectionObserver" in window)) { fn(); return; }
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { root: detailSheet, rootMargin: "250px" });
  io.observe(node);
}
async function fillSpecies(item, gal, token) {
  const key = item.latin || item.name;
  let photos = usable(item.photos && item.photos.length ? item.photos : fixedPhotos.species[key]);
  if (photos.length < 3) {
    photos = speciesCache.get(key);
    if (!photos) {
      try { photos = await StepPhotos.forSpecies(item, 4); } catch (_) { photos = []; }
      speciesCache.set(key, photos);
    }
    photos = usable(photos);
  }
  if (token !== detailToken || !gal.isConnected) return;
  const again = (bad, broken) => { if (broken && bad) failedUrls.add(bad.url); speciesCache.delete(key); fillSpecies(item, gal, detailToken); };
  const figs = photos.map(p => photoFigure(p, item.name, again)).filter(Boolean);
  gal.replaceChildren(...(figs.length ? figs : [retryNote(again)]));
}
function retryNote(again) {
  const box = el("div", null, "photo-retry");
  box.append(el("span", "Фото не загрузились (нет связи с Wikimedia Commons или ничего подходящего)." + (StepPhotos.lastError ? " Ошибка: " + StepPhotos.lastError + "." : "") + " "));
  const b = el("button", "Повторить"); b.type = "button";
  b.addEventListener("click", () => { b.disabled = true; again(); });
  box.append(b);
  return box;
}
function speciesGallery(item, token) {
  const gal = el("div", null, "fish-gallery");
  lazyRun(gal, () => fillSpecies(item, gal, token));
  return gal;
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
    row.append(speciesGallery(p, detailToken));
    box.append(row);
  });
  box.append(el("p", "Растения подобраны по справочникам для дельты и поймы Волги. Это значит, что они растут в регионе, но в конкретной точке их может не быть.", "fish-note"));
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
    row.append(speciesGallery(a, detailToken));
    box.append(row);
  });
  box.append(el("p", "Животные и птицы взяты из справочников для дельты и поймы Волги. Они обитают в регионе, но встретить их именно здесь не гарантировано.", "fish-note"));
}

/* ---------- Фото ---------- */
function safeUrl(u) {
  try { const x = new URL(u); return x.protocol === "https:" ? x.href : ""; } catch (_) { return ""; }
}
function photoFigure(p, alt, onReject) {
  const src = safeUrl(p && p.url);
  if (!src) return null;
  const fig = document.createElement("figure");
  const img = document.createElement("img");
  img.src = src; img.alt = p.alt || alt || ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => { fig.remove(); if (onReject) onReject(p, true); });
  fig.append(img);
  if (onReject && EDITOR) {
    const x = el("button", "✕", "ph-x");
    x.type = "button"; x.title = "Не то фото: убрать и заменить"; x.setAttribute("aria-label", "Не то фото: убрать и заменить");
    x.addEventListener("click", e => { e.stopPropagation(); StepPhotos.block(p); fig.remove(); onReject(p); });
    fig.append(x);
  }
  const credit = [p.author, p.license, p.near ? "похожее место" : ""].filter(Boolean).join(" · ");
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
  const figs = (photos || []).map(p => photoFigure(p, loc.title, (bad, broken) => { if (broken && bad) failedUrls.add(bad.url); loc._photos = null; loadPlacePhotos(loc, detailToken); })).filter(Boolean);
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
    const own = usable(Array.isArray(loc.photos) && loc.photos.length ? loc.photos : fixedPhotos.places[loc.id]).slice();
    let extra = [];
    if (own.length < 4) { try { extra = await StepPhotos.forPlace(loc, 4 - own.length); } catch (_) {} }
    loc._photos = usable(own.concat(extra)).slice(0, 4);
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
    (danger ? "⚠ " : "") + fmtTemp(w.tempC) + ", ветер " + fmtNum(w.windMs, 0) + " м/с" + (analysis.verdict ? ", клёв: " + analysis.verdict.label : best ? ", шанс поймать: " + best.chance.label : "");
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
    updatePill(selectedLoc, w, StepWeather.analyze(w, fishListFor(selectedLoc, true), selectedLoc.type, selectedLoc.id));
  } catch (err) { console.warn("Погода недоступна", err); updatePillError(); }
}

/* ================= Данные и уточнение координат ================= */
/* Данные копируются в localStorage: при плохой связи в дельте вместо пустого экрана показываем сохранённое. */
const offlineState = { used: false };
async function fetchJsonCached(url) {
  const key = "stepData:" + url;
  try {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const text = await r.text();
    const data = JSON.parse(text);
    try { localStorage.setItem(key, text); } catch (_) {}
    return data;
  } catch (err) {
    let cached = null;
    try { cached = localStorage.getItem(key); } catch (_) {}
    if (cached) {
      try { const data = JSON.parse(cached); offlineState.used = true; return data; } catch (_) {}
    }
    throw err;
  }
}
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch (_) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0;left:-1000px";
    document.body.append(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (_) { return false; }
}
window.addEventListener("offline", () => toast("Нет связи. Карта и точки работают из сохранённого, погода и фото могут не загрузиться.", 5500));
window.addEventListener("online", () => toast("Связь восстановлена."));
async function loadFish() {
  try {
    const data = await fetchJsonCached("data/fish.json");
    if (Array.isArray(data)) data.forEach(f => { if (f && f.id) fishById.set(f.id, f); });
  } catch (err) { console.error("Не удалось загрузить data/fish.json", err); }
}
async function loadBlocklist() {
  try {
    const r = await fetch("data/photo-blocklist.json");
    if (r.ok) StepPhotos.setBlocked(await r.json());
  } catch (_) {}
}
async function loadPoints() {
  try {
    const data = await fetchJsonCached("data/points.json");
    if (!Array.isArray(data)) throw new Error("Формат points.json должен быть массивом");
    locations = data;
    locations.forEach(addLocation);
    if (!selectedLoc && locations.length) selectedLoc = locations[0];
    refreshPill();
    snapAll();
    if (offlineState.used) toast("Нет связи: показаны сохранённые точки.", 5500);
  } catch (err) {
    console.error("Не удалось загрузить data/points.json", err);
    toast(navigator.onLine === false
      ? "Нет связи, а сохранённых данных ещё нет. Откройте приложение там, где есть сеть."
      : "Не удалось загрузить точки. Закройте приложение и откройте снова.", 6000);
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
  searchMarker = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "", html: '<div class="search-pin"></div>', iconSize: [24, 24], iconAnchor: [12, 12] }), title: p.name, zIndexOffset: 600 }).addTo(map);
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

/* ================= Запреты и правила ================= */
let bansData = null;
const bansSheet = $("bansSheet");
let bansPrevFocus = null;
async function loadBans() {
  try {
    bansData = await fetchJsonCached("data/bans.json");
  } catch (err) { console.warn("Не удалось загрузить data/bans.json", err); }
  updateBanPill();
  if (selectedLoc && detailSheet.classList.contains("open")) renderDetailBans(selectedLoc);
}
function bansSnapshot() { return bansData && window.StepBans ? StepBans.snapshot(bansData, new Date()) : null; }
function sourceLinks(ids) {
  const p = el("p", null, "rule-src");
  p.append(document.createTextNode("Источники: "));
  let n = 0;
  (ids || []).forEach(id => {
    const s = bansData && bansData.sources && bansData.sources[id];
    const url = s && safeUrl(s.url.replace(/^http:/, "https:"));
    if (!s) return;
    if (n++) p.append(document.createTextNode(" · "));
    if (url) { const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = s.title; p.append(a); }
    else p.append(document.createTextNode(s.title));
  });
  return n ? p : document.createTextNode("");
}
function updateBanPill() {
  const pill = $("banPill");
  const snap = bansSnapshot();
  if (!snap) { pill.hidden = true; return; }
  const act = snap.active.find(i => i.rule.kind === "seasonal" && i.rule.level === "danger");
  const soon = snap.upcoming.find(i => i.rule.kind === "seasonal" && i.rule.level === "danger" && i.status.daysToStart <= 30);
  if (act) {
    pill.hidden = false; pill.dataset.level = "on";
    pill.textContent = "⚠ " + act.rule.title + " · ещё " + StepBans.daysText(act.status.daysLeft);
  } else if (soon) {
    pill.hidden = false; pill.dataset.level = "soon";
    pill.textContent = "Скоро: " + soon.rule.title.toLowerCase() + " с " + StepBans.fmtDate(soon.status.start) + " (через " + StepBans.daysText(soon.status.daysToStart) + ")";
  } else pill.hidden = true;
}
function ruleCard(item) {
  const r = item.rule;
  const d = document.createElement("details");
  d.className = "rule " + r.level;
  if (item.status.state === "active" && r.level === "danger") d.open = true;
  const sum = document.createElement("summary");
  sum.append(el("b", r.title), el("span", StepBans.statusLine(item), "rule-status"));
  d.append(sum, el("p", r.short, "rule-short"));
  const ul = el("ul", null, "rule-list");
  (r.details || []).forEach(t => ul.append(el("li", t)));
  d.append(ul);
  if (r.note) d.append(el("p", "Важно: " + r.note, "rule-note"));
  if (r.uncertain) d.append(el("p", "Данных недостаточно: проверьте перед выездом.", "rule-note"));
  d.append(sourceLinks(r.sources));
  return d;
}
function bansBanner(snap) {
  const danger = snap.active.filter(i => i.rule.level === "danger" && i.rule.kind === "seasonal");
  const box = el("div", null, "ban-banner " + (danger.length ? "on" : "off"));
  if (danger.length) {
    danger.forEach(i => {
      box.append(el("b", "Сейчас действует: " + i.rule.title), el("p", StepBans.statusLine(i) + ". " + (i.rule.details && i.rule.details[1] ? i.rule.details[1] : i.rule.short)));
    });
  } else {
    box.append(el("b", "Сезонного запрета на рыбу сейчас нет"));
    const next = snap.upcoming[0];
    box.append(el("p", next ? "Ближайший: " + next.rule.title.toLowerCase() + ". " + StepBans.statusLine(next) + "." : "Ближайших сезонных запретов в данных нет."));
    box.append(el("p", "Постоянные правила действуют всегда: зимовальные ямы, запрещённые виды, размеры и нормы вылова."));
  }
  return box;
}
function timelineEl() {
  const wrap = el("div", null, "tl");
  const months = el("div", null, "tl-months");
  StepBans.MONTH_SHORT.forEach(m => months.append(el("span", m)));
  wrap.append(months);
  StepBans.timeline(bansData).forEach(row => {
    wrap.append(el("div", row.title, "tl-label"));
    const track = el("div", null, "tl-track");
    row.segments.forEach(([a, b]) => {
      const s = el("i", null, "tl-seg " + row.level);
      s.style.left = (a * 100) + "%"; s.style.width = ((b - a) * 100) + "%";
      track.append(s);
    });
    wrap.append(track);
  });
  const now = el("div", null, "tl-now");
  now.style.left = (StepBans.todayFraction(new Date()) * 100) + "%";
  now.append(el("span", "сегодня"));
  wrap.append(now);
  return wrap;
}
function renderBans() {
  const body = $("bansBody");
  body.replaceChildren();
  const snap = bansSnapshot();
  if (!snap) {
    body.append(el("div", "Не удалось загрузить данные о запретах. Проверьте интернет и откройте раздел ещё раз.", "wx-error"));
    return;
  }
  body.append(bansBanner(snap));
  body.append(el("h2", "Год по месяцам"), timelineEl());
  const groups = [
    ["Действуют сейчас", snap.active.filter(i => i.rule.kind !== "permanent")],
    ["Скоро", snap.upcoming],
    ["Всегда", snap.always],
    ["Срок закончился, уточните", snap.expired]
  ];
  groups.forEach(([title, list]) => {
    if (!list.length) return;
    body.append(el("h2", title));
    list.forEach(i => body.append(ruleCard(i)));
  });
  if (bansData.infoOtherRegion) {
    const o = bansData.infoOtherRegion;
    const box = el("div", null, "ban-banner off");
    box.append(el("b", o.title), el("p", o.text), sourceLinks(o.sources));
    body.append(box);
  }
  const foot = el("div", null, "rule-foot");
  foot.append(el("p", bansData.disclaimer));
  if (bansData.hotline) foot.append(el("p", bansData.hotline.name + ": " + bansData.hotline.phone));
  foot.append(el("p", "Данные в атласе сверены: " + StepBans.fmtDate(new Date(bansData.checkedAt + "T12:00:00")) + "."));
  const off = bansData.sources && bansData.sources.order695;
  if (off) { const a = document.createElement("a"); a.href = off.url.replace(/^http:/, "https:"); a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = "Официальный текст Правил (приказ № 695)"; const p = el("p"); p.append(a); foot.append(p); }
  body.append(foot);
}
function openBans() {
  bansPrevFocus = document.activeElement;
  closeDetails();
  renderBans();
  bansSheet.inert = false;
  const appShell = document.querySelector(".app-shell");
  if (appShell) appShell.inert = true;
  bansSheet.classList.add("open");
  sheetBackdrop.classList.add("open");
  const tg = tgApp();
  if (tg && tg.BackButton) { try { tg.BackButton.show(); } catch (_) {} }
  bansSheet.scrollTop = 0;
  bansSheet.focus({ preventScroll: true });
}
function closeBans() {
  if (!bansSheet.classList.contains("open")) return;
  bansSheet.classList.remove("open");
  sheetBackdrop.classList.remove("open");
  bansSheet.inert = true;
  const appShell = document.querySelector(".app-shell");
  if (appShell) appShell.inert = false;
  const tg = tgApp();
  if (tg && tg.BackButton) { try { tg.BackButton.hide(); } catch (_) {} }
  if (bansPrevFocus && typeof bansPrevFocus.focus === "function") bansPrevFocus.focus({ preventScroll: true });
}
/* Блок «Запреты и правила» в карточке рыболовной точки */
function renderDetailBans(loc) {
  const box = $("detailBans");
  const snap = bansSnapshot();
  if (loc.type !== "fishing" || !snap) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  box.replaceChildren(el("h2", "Запреты и правила"));
  const spawn = snap.active.find(i => i.rule.id === "spawn");
  const others = snap.active.filter(i => i.rule.id !== "spawn" && i.rule.kind !== "permanent");
  if (spawn) {
    const b = el("div", null, "ban-banner on");
    b.append(el("b", "Сейчас нерестовый запрет"), el("p", StepBans.statusLine(spawn) + ". " + spawn.rule.details[1]));
    box.append(b);
  } else {
    const b = el("div", null, "ban-banner off");
    b.append(el("b", "Сезонного запрета на рыбу сейчас нет"));
    const next = snap.upcoming[0];
    if (next) b.append(el("p", next.rule.title + ": " + StepBans.statusLine(next) + "."));
    box.append(b);
  }
  others.forEach(i => box.append(el("p", i.rule.title + ": " + StepBans.statusLine(i) + ".", "fish-note")));
  box.append(el("p", "Всегда: зимовальные ямы, запрещённые виды, минимальные размеры, нормы вылова и допустимые снасти.", "fish-note"));
  const row = el("div", null, "detail-actions");
  row.append(button("Календарь запретов", "primary", () => openBans()));
  box.append(row);
}

/* ================= Где я и маршрут ================= */
const route = { start: null, dest: null, mode: null, msg: "", info: null, parsed: null, gap: 0, line: null, destMarker: null, meMarker: null, meCircle: null, busy: false };
const nav = { active: false, watchId: null, poll: null, follow: true, voice: (() => { try { return localStorage.getItem("stepNavVoice") !== "0"; } catch (_) { return true; } })(), spoken: {}, hint: undefined, offCount: 0, lastReroute: 0, wake: null, pos: null, heading: null, arrived: false, tgFails: 0, voiceWarned: false, view: null };
async function getPosition() {
  let p = await tgLocation();
  if (!p) p = await browserLocation();
  return p;
}

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
    const p = await getPosition();
    route.msg = "";
    setStart({ lat: p.lat, lng: p.lng, acc: p.acc, name: "Моё местоположение", gps: true }, true);
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
    route.meMarker = L.marker(ll, { icon: meIcon(), title: "Вы здесь", zIndexOffset: 900 }).addTo(map);
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
  if (nav.active) stopNav();
  route.start = route.dest = route.mode = route.info = route.parsed = null; route.gap = 0; route.msg = ""; route.failure = null;
  [route.line, route.destMarker, route.meMarker, route.meCircle].forEach(l => { if (l) map.removeLayer(l); });
  route.line = route.destMarker = route.meMarker = route.meCircle = null;
  renderRouteBar();
}
async function requestRoute(a, b) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const j = await res.json();
    if (j && j.routes && j.routes[0]) {
      const r = j.routes[0];
      const parsed = StepNav.parseRoute(r);
      const end = parsed.coords[parsed.coords.length - 1];
      return { geometry: r.geometry, parsed, info: { km: r.distance / 1000, min: Math.round(r.duration / 60), straight: false, gapM: StepNav.dist(end, b) } };
    }
  } catch (_) {}
  return null;
}
function drawRoute(res, a, b) {
  if (route.line) { map.removeLayer(route.line); route.line = null; }
  if (res) {
    route.line = L.geoJSON(res.geometry, { style: { color: "#c2462d", weight: 5, opacity: .85 } }).addTo(map);
    route.parsed = res.parsed; route.info = res.info; route.gap = res.info.gapM;
  } else {
    route.line = L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: "#c2462d", weight: 4, dashArray: "8 8" }).addTo(map);
    route.parsed = null; route.gap = 0; route.info = { km: distKm(a, b), min: null, straight: true };
  }
}
async function buildRoute() {
  const { start, dest } = route;
  if (!start || !dest) return;
  if (route.line) { map.removeLayer(route.line); route.line = null; }
  route.info = null; route.parsed = null; route.gap = 0;
  if (!nav.active) map.fitBounds(L.latLngBounds([[start.lat, start.lng], [dest.lat, dest.lng]]), { padding: [60, 60], maxZoom: 13 });
  const res = await requestRoute(start, dest);
  if (!route.start || route.dest !== dest) return;
  drawRoute(res, route.start || start, dest);
  renderRouteBar();
  if (nav.active) updateNavProgress();
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
  bar.classList.toggle("idle", !start && !dest && !route.failure && !route.msg && !nav.active);
  bar.hidden = false;
  if (nav.active) { renderNavBar(bar); return; }
  if (!start && !dest && !route.failure && !route.msg) {
    // Постоянная плашка: поставить «я здесь» и «куда ехать»
    const idle = el("div", null, "rb-row");
    const hint = route.mode === "pickStart" ? "Нажмите на карте, где вы находитесь."
      : route.mode === "pickDest" ? "Нажмите на карте, куда нужно доехать."
      : "Поставьте точку, где вы, и точку, куда ехать. Ехать можно прямо в приложении.";
    idle.append(
      button("Я здесь (определить)", "primary", locate),
      button("Старт на карте", route.mode === "pickStart" ? "primary" : "", () => { route.mode = "pickStart"; toast("Нажмите на карте точку старта"); renderRouteBar(); }),
      button("Куда ехать", route.mode === "pickDest" ? "primary" : "", () => { route.mode = "pickDest"; toast("Нажмите на карте, куда нужно доехать"); renderRouteBar(); })
    );
    bar.replaceChildren(el("p", "Маршрут", "rb-title"), el("p", hint, "rb-text"), idle);
    return;
  }
  const nodes = [];
  const row = el("div", null, "rb-row");
  const cancel = button("Сбросить", "ghost", clearRoute);
  if (route.msg) {
    nodes.push(el("p", route.msg, "rb-title"));
  } else if (start && dest) {
    nodes.push(el("p", "Маршрут: " + (dest.name || "выбранная точка"), "rb-title"));
    const info = route.info;
    let text;
    if (!info) text = "Строим маршрут…";
    else if (info.straight) text = "Дорожный маршрут не построился: по прямой около " + fmtNum(info.km, 0) + " км. В приложении можно ехать по азимуту, а полный маршрут откройте в навигаторе ниже.";
    else {
      text = "По дорогам около " + fmtNum(info.km, 0) + " км, примерно " + fmtDur(info.min) + ". В дельте и степи дороги бывают грунтовыми, закрытыми или затопленными.";
      if (info.gapM > 300) text += " Дорога заканчивается примерно в " + StepNav.fmtKm(info.gapM) + " от точки, дальше без дороги.";
    }
    nodes.push(el("p", text, "rb-text"));
    row.append(button("Продолжить здесь", "primary", startNav));
    routeLinks().forEach(([name, url]) => row.append(button(name + " ↗", "", () => openExternal(url))));
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

/* ================= Навигация внутри приложения ================= */
function speak(text) {
  if (!nav.voice || !text) return;
  if (!("speechSynthesis" in window)) {
    if (!nav.voiceWarned) { nav.voiceWarned = true; toast("Голос не поддерживается на этом устройстве, подсказки останутся на экране."); }
    return;
  }
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU"; u.rate = 1;
    const v = speechSynthesis.getVoices().find(x => /^ru/i.test(x.lang));
    if (v) u.voice = v;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch (_) {}
}
async function keepAwake(on) {
  try {
    if (on) { if ("wakeLock" in navigator && !nav.wake) nav.wake = await navigator.wakeLock.request("screen"); }
    else if (nav.wake) { await nav.wake.release(); nav.wake = null; }
  } catch (_) { nav.wake = null; }
}
document.addEventListener("visibilitychange", () => { if (nav.active && document.visibilityState === "visible") { nav.wake = null; keepAwake(true); } });

function meIcon() {
  return L.divIcon({ className: "", html: '<div class="me-dot"></div><div class="me-arrow" hidden></div>', iconSize: [26, 26], iconAnchor: [13, 13] });
}
function moveMe(p) {
  if (!route.meMarker) {
    route.meMarker = L.marker([p.lat, p.lng], { icon: meIcon(), title: "Вы здесь", zIndexOffset: 900 }).addTo(map);
    route.meMarker.on("click", e => { if (e.originalEvent) L.DomEvent.stopPropagation(e); onMeTap(); });
  } else { route.meMarker.setLatLng([p.lat, p.lng]); if (!map.hasLayer(route.meMarker)) route.meMarker.addTo(map); }
  const node = route.meMarker.getElement && route.meMarker.getElement();
  const arrow = node && node.querySelector(".me-arrow");
  if (arrow) {
    if (nav.heading === null) arrow.hidden = true;
    else { arrow.hidden = false; arrow.style.transform = "translate(-50%, -50%) rotate(" + Math.round(nav.heading) + "deg)"; }
  }
}

function tgLocationOnce() {
  return new Promise(resolve => {
    const tg = tgApp();
    const lm = tg && tg.LocationManager;
    if (!lm || typeof lm.getLocation !== "function") return resolve(null);
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(null), 6000);
    const get = () => {
      try {
        lm.getLocation(d => finish(d && Number.isFinite(d.latitude)
          ? { lat: d.latitude, lng: d.longitude, acc: d.horizontal_accuracy || null, heading: Number.isFinite(d.course) ? d.course : null, speed: Number.isFinite(d.speed) ? d.speed : null }
          : null));
      } catch (_) { finish(null); }
    };
    try { if (lm.isInited) get(); else lm.init(get); } catch (_) { finish(null); }
  });
}
function startTracking() {
  const useBrowser = () => {
    if (!navigator.geolocation) { toast("Слежение за положением недоступно на этом устройстве."); return; }
    nav.watchId = navigator.geolocation.watchPosition(
      pos => onFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null, speed: Number.isFinite(pos.coords.speed) ? pos.coords.speed : null }),
      err => { if (err.code === 1) { toast("Нет доступа к геопозиции. Разрешите его в настройках."); stopNav(); } },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
  };
  const tg = tgApp();
  if (tg && tg.LocationManager && typeof tg.LocationManager.getLocation === "function") {
    const tick = async () => {
      if (!nav.active || nav.arrived) return;
      const p = await tgLocationOnce();
      if (p) { nav.tgFails = 0; onFix(p); }
      else if (++nav.tgFails >= 3) { nav.poll = null; useBrowser(); return; }
      nav.poll = setTimeout(tick, 2500);
    };
    tick();
  } else useBrowser();
}
function stopTracking() {
  if (nav.watchId !== null && navigator.geolocation) { try { navigator.geolocation.clearWatch(nav.watchId); } catch (_) {} }
  nav.watchId = null;
  if (nav.poll) { clearTimeout(nav.poll); nav.poll = null; }
}

async function startNav() {
  if (!route.dest || nav.active) return;
  toast("Определяем ваше местоположение…");
  let p;
  try { p = await getPosition(); } catch (err) { locationFailed(err); return; }
  Object.assign(nav, { active: true, follow: true, spoken: {}, hint: undefined, offCount: 0, arrived: false, pos: null, heading: null, tgFails: 0, view: { mode: "building" }, lastReroute: Date.now() });
  document.querySelector(".map-wrap").classList.add("nav-on");
  layerPanel.classList.remove("open");
  setStart({ lat: p.lat, lng: p.lng, acc: p.acc, name: "Моё местоположение", gps: true }, false);
  keepAwake(true);
  startTracking();
  onFix(p);
  speak("Навигация включена");
  toast("Дороги в дельте и степи бывают грунтовыми, закрытыми или затопленными. Следите за дорогой, а не за экраном.", 6500);
}
function stopNav() {
  stopTracking();
  keepAwake(false);
  try { if ("speechSynthesis" in window) speechSynthesis.cancel(); } catch (_) {}
  nav.active = false; nav.arrived = false; nav.view = null;
  document.querySelector(".map-wrap").classList.remove("nav-on");
  $("navBanner").hidden = true;
  renderRouteBar();
}
function onFix(p) {
  if (!nav.active) return;
  const prev = nav.pos;
  nav.pos = p;
  let h = Number.isFinite(p.heading) && (!Number.isFinite(p.speed) || p.speed > 1) ? p.heading : null;
  if (h === null && prev && StepNav.dist(prev, p) > 8) h = StepNav.bearing(prev, p);
  if (h !== null) nav.heading = h;
  moveMe(p);
  route.start = Object.assign({}, route.start, { lat: p.lat, lng: p.lng, acc: p.acc });
  if (nav.follow) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15), { animate: true });
  updateNavProgress();
}
function updateNavProgress() {
  const p = nav.pos;
  if (!nav.active || nav.arrived || !p || !route.dest) return;
  const toDest = StepNav.dist(p, route.dest);
  let view;
  if (route.parsed) {
    const loc = StepNav.locate(route.parsed, p, nav.hint);
    nav.hint = loc.idx;
    nav.offCount = loc.off > 100 ? nav.offCount + 1 : 0;
    if (nav.offCount >= 2 && Date.now() - nav.lastReroute > 12000) reroute(p);
    const rem = StepNav.remaining(route.parsed, loc.along);
    const nx = StepNav.nextManeuver(route.parsed, loc.along);
    const lastMile = route.gap > 300 && rem.meters < 80;
    if (toDest < 40 || (!lastMile && rem.meters < 30 && route.gap <= 300)) return arrive();
    if (lastMile) view = { mode: "lastmile", g: StepNav.straightGuide(p, route.dest) };
    else {
      view = { mode: "road", nx, rem, offRoute: loc.off > 100 };
      if (!view.offRoute && nx) { const cue = StepNav.voiceCue(nx, nav.spoken); if (cue) speak(cue); }
    }
  } else if (route.info && route.info.straight) {
    if (toDest < 40) return arrive();
    view = { mode: "straight", g: StepNav.straightGuide(p, route.dest) };
  } else view = { mode: "building" };
  nav.view = view;
  renderNavBanner();
  renderRouteBar();
}
async function reroute(p) {
  nav.lastReroute = Date.now(); nav.offCount = 0;
  const res = await requestRoute(p, route.dest);
  if (!nav.active) return;
  if (!res) { toast("Не удалось перестроить маршрут. Проверьте связь."); return; }
  drawRoute(res, p, route.dest);
  nav.hint = undefined; nav.spoken = {};
  toast("Маршрут перестроен");
  speak("Маршрут перестроен");
  updateNavProgress();
}
function arrive() {
  if (nav.arrived) return;
  nav.arrived = true;
  nav.view = { mode: "arrived" };
  stopTracking();
  speak("Вы приехали");
  renderNavBanner();
  renderRouteBar();
}
function renderNavBanner() {
  const b = $("navBanner");
  if (!nav.active || !nav.view) { b.hidden = true; return; }
  b.hidden = false;
  const v = nav.view;
  let glyph = "↑", top = "", text = "", street = "", rot = null;
  if (v.mode === "building") { glyph = "…"; text = "Строим маршрут"; }
  else if (v.mode === "arrived") { glyph = "⚑"; text = "Вы приехали"; street = route.dest && route.dest.name || ""; }
  else if (v.mode === "straight" || v.mode === "lastmile") {
    glyph = "➤";
    rot = Math.round(v.g.bearing - (nav.heading === null ? 0 : nav.heading));
    top = StepNav.fmtKm(v.g.meters);
    text = (v.mode === "lastmile" ? "Дорога закончилась. " : "") + "Двигайтесь на " + v.g.compass;
    street = nav.heading === null ? "Стрелка показывает направление к точке при север-вверх на карте." : "Стрелка показывает направление к точке относительно вашего движения.";
  } else if (v.offRoute) { glyph = "⟲"; text = "Вы сошли с маршрута"; street = "Перестраиваем маршрут…"; }
  else if (v.nx) {
    const ph = StepNav.phrase(v.nx.m);
    glyph = ph.glyph; text = ph.text; street = ph.street;
    const d = StepNav.fmtDist(v.nx.dist);
    top = d.charAt(0).toUpperCase() + d.slice(1);
  }
  const gEl = el("div", glyph, "nb-glyph");
  if (rot !== null) gEl.style.transform = "rotate(" + rot + "deg)";
  const body = el("div", null, "nb-body");
  if (top) body.append(el("div", top, "nb-dist"));
  body.append(el("div", text, "nb-text"));
  if (street) body.append(el("div", street, "nb-street"));
  b.replaceChildren(gEl, body);
}
function renderNavBar(bar) {
  const v = nav.view || {};
  const nodes = [];
  const row = el("div", null, "rb-row");
  if (v.mode === "arrived") {
    nodes.push(el("p", "Вы приехали", "rb-title"), el("p", "Навигация завершена. Проверьте правила и доступ на месте.", "rb-text"));
    row.append(button("Готово", "primary", stopNav));
  } else {
    let title = "Строим маршрут…";
    if (v.mode === "road" && v.rem) title = "Осталось " + StepNav.fmtKm(v.rem.meters) + ", около " + StepNav.fmtEta(v.rem.seconds);
    else if (v.g) title = "До точки " + StepNav.fmtKm(v.g.meters) + " по прямой";
    nodes.push(el("p", title, "rb-title"));
    row.append(button(nav.voice ? "🔊 Голос" : "🔇 Голос", "", () => {
      nav.voice = !nav.voice;
      try { localStorage.setItem("stepNavVoice", nav.voice ? "1" : "0"); } catch (_) {}
      if (!nav.voice) { try { speechSynthesis.cancel(); } catch (_) {} } else speak("Голос включён");
      renderRouteBar();
    }));
    if (!nav.follow) row.append(button("К моему положению", "primary", () => { nav.follow = true; if (nav.pos) map.setView([nav.pos.lat, nav.pos.lng], Math.max(map.getZoom(), 15)); renderRouteBar(); }));
    else row.append(button("Весь маршрут", "", () => {
      nav.follow = false;
      if (nav.pos && route.dest) map.fitBounds(L.latLngBounds([[nav.pos.lat, nav.pos.lng], [route.dest.lat, route.dest.lng]]), { padding: [70, 70], maxZoom: 14 });
      renderRouteBar();
    }));
    if (nav.pos && route.dest) {
      const a = nav.pos, d = route.dest;
      row.append(button("Яндекс ↗", "", () => openExternal(`https://yandex.ru/maps/?rtext=${a.lat},${a.lng}~${d.lat},${d.lng}&rtt=auto`)));
    }
    row.append(button("Завершить", "ghost", () => { stopNav(); }));
  }
  nodes.push(row);
  bar.replaceChildren(...nodes);
}
map.on("dragstart", () => { if (nav.active && nav.follow) { nav.follow = false; renderRouteBar(); } });

map.on("click", e => {
  layerPanel.classList.remove("open");
  const p = { lat: e.latlng.lat, lng: e.latlng.lng };
  if (route.mode === "pickDest") setDestination({ lat: p.lat, lng: p.lng, name: "Точка на карте (" + fmtCoord(p) + ")" });
  else if (route.mode === "pickStart") { route.failure = null; setStart({ lat: p.lat, lng: p.lng, acc: null, name: "Старт на карте" }, false); }
});
$("locate").addEventListener("click", locate);

/* ================= Остальные обработчики ================= */
$("closeDetail").addEventListener("click", closeDetails);
sheetBackdrop.addEventListener("click", () => { closeDetails(); closeBans(); });
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    if (detailSheet.classList.contains("open")) closeDetails();
    if (bansSheet.classList.contains("open")) closeBans();
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
    if (btn.dataset.action === "bans") { openBans(); return; }
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
        else if (bansSheet.classList.contains("open")) closeBans();
        else tg.BackButton.hide();
      });
      tg.BackButton.hide();
    }
  } catch (err) { console.warn("Telegram WebApp initialization skipped", err); }
}
detailSheet.inert = true;
bansSheet.inert = true;
$("banPill").addEventListener("click", openBans);
$("closeBans").addEventListener("click", closeBans);
$("editorTools").hidden = !EDITOR;
$("lockPhotos").addEventListener("click", async () => {
  const btn = $("lockPhotos"), st = $("lockStatus");
  btn.disabled = true;
  const out = { places: {}, fish: {}, species: {} };
  const slim = l => (l || []).slice(0, 4).map(p => ({ url: p.url, alt: p.alt, author: p.author, license: p.license, sourceUrl: p.sourceUrl, near: p.near || undefined }));
  const locs = locations.filter(l => !l.adhoc);
  let i = 0;
  for (const loc of locs) {
    i++; st.textContent = "Фиксируем: " + i + " из " + locs.length + " (" + loc.title + ")";
    try {
      const fixed = usable(fixedPhotos.places[loc.id] || loc.photos);
      out.places[loc.id] = slim(fixed.length >= 4 ? fixed : usable(fixed.concat(await StepPhotos.forPlace(loc, 4 - fixed.length))));
    } catch (_) {}
    for (const id of loc.fish || []) {
      const f = fishById.get(id);
      if (!f || out.fish[id]) continue;
      try { const fx = usable(fixedPhotos.fish[id]); out.fish[id] = slim(fx.length >= 3 ? fx : usable(await StepPhotos.forFish(f, 4))); } catch (_) {}
    }
    for (const it of [].concat(loc.plants || [], loc.animals || [])) {
      const key = it.latin || it.name;
      if (!key || out.species[key]) continue;
      try { const fx = usable(fixedPhotos.species[key]); out.species[key] = slim(fx.length >= 3 ? fx : usable(await StepPhotos.forSpecies(it, 4))); } catch (_) {}
    }
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = "photos.json"; a.textContent = "Скачать photos.json"; a.className = "btn primary";
  st.replaceChildren(document.createTextNode("Готово: мест " + Object.keys(out.places).length + ", рыб " + Object.keys(out.fish).length + ", видов " + Object.keys(out.species).length + ". "), a);
  btn.disabled = false;
  try { a.click(); } catch (_) {}
});
$("exportBlocked").addEventListener("click", () => {
  const list = StepPhotos.getBlocked();
  const box = $("blockedText");
  if (!list.length) { box.hidden = true; toast("Вы пока не убирали фото кнопкой ✕."); return; }
  box.value = JSON.stringify(list, null, 2);
  box.hidden = false; box.focus(); box.select();
  let copied = false;
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(box.value); copied = true; } } catch (_) {}
  toast(copied ? "Список (" + list.length + ") скопирован. Отправьте его разработчику." : "Список (" + list.length + ") выделен: скопируйте его и отправьте разработчику.", 5000);
});
renderRouteBar();
initTelegram();
syncNavigation();
Promise.all([loadFish(), loadBlocklist(), loadBans(), loadFixedPhotos()]).then(loadPoints);
setTimeout(() => map.invalidateSize(), 100);
