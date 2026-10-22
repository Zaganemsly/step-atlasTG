const DEFAULT_CENTER = [46.25, 48.0];
const DEFAULT_ZOOM = 9;
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
let userMarker = null;
let previousFocus = null;
let toastTimer = null;
const fishById = new Map();
const weatherCache = new Map();
const WEATHER_TTL_MS = 10 * 60 * 1000;
let selectedLoc = null;
let detailToken = 0;

const detailSheet = document.getElementById("detailSheet");
const sheetBackdrop = document.getElementById("sheetBackdrop");
const layerPanel = document.getElementById("layerPanel");
const layersToggle = document.getElementById("layersToggle");

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}
function iconFor(type) {
  const color = type === "fishing" ? "blue" : type === "nature" ? "orange" : "green";
  const glyph = type === "fishing" ? "≈" : type === "nature" ? "✦" : "⌂";
  return L.divIcon({
    className: "",
    html: `<div class="map-dot dot-${color}" aria-hidden="true"><span>${glyph}</span></div>`,
    iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -15]
  });
}
function openDetails(loc) {
  previousFocus = document.activeElement;
  document.getElementById("detailCategory").textContent = loc.category || "ТОЧКА АТЛАСА";
  document.getElementById("detailTitle").textContent = loc.title;
  document.getElementById("detailDescription").textContent = loc.description || "";
  document.getElementById("detailContent").innerHTML = (loc.details || []).map(([label, value]) =>
    `<div class="info-card"><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></div>`
  ).join("");
  selectedLoc = loc;
  const token = ++detailToken;
  renderPhotos(loc);
  renderHistory(loc);
  renderSpecies(loc);
  renderPlants(loc);
  renderFish(loc, null);
  renderWeatherLoading();
  loadWeatherFor(loc, token);
  const sourceNote = document.getElementById("sourceNote");
  sourceNote.replaceChildren();
  sourceNote.append(document.createTextNode(
    `${loc.verified ? "Данные отмечены как проверенные." : "Демонстрационная или ещё не проверенная запись."} ${loc.source || ""}`
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
        link.href = safeUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = label || safeUrl;
        sourceNote.append(link);
      } else {
        sourceNote.append(document.createTextNode(label));
      }
    });
  }
  detailSheet.inert = false;
  const appShell = document.querySelector(".app-shell");
  if (appShell) appShell.inert = true;
  detailSheet.classList.add("open");
  sheetBackdrop.classList.add("open");
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg && tg.BackButton) {
    try { tg.BackButton.show(); } catch (_) {}
  }
  detailSheet.focus({ preventScroll: true });
}
function closeDetails() {
  const wasOpen = detailSheet.classList.contains("open");
  detailSheet.classList.remove("open");
  sheetBackdrop.classList.remove("open");
  detailSheet.inert = true;
  const appShell = document.querySelector(".app-shell");
  if (appShell) appShell.inert = false;
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg && tg.BackButton) {
    try { tg.BackButton.hide(); } catch (_) {}
  }
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

/* ---------- Погода, рыбы, растения, фото ---------- */
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function fmtTemp(t) {
  const r = Math.round(t);
  return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r) + "°";
}
function fmtNum(n, digits) {
  return n.toFixed(digits).replace(".", ",");
}
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
  const hit = weatherCache.get(loc.id);
  if (hit && Date.now() - hit.t < WEATHER_TTL_MS) return hit.w;
  if (!window.StepWeather) throw new Error("weather.js не загружен");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(StepWeather.weatherUrl(loc.lat, loc.lng), { signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const w = StepWeather.parseWeather(await res.json());
    if (!w) throw new Error("Неожиданный ответ погоды");
    weatherCache.set(loc.id, { t: Date.now(), w });
    return w;
  } finally {
    clearTimeout(timer);
  }
}
function kindFor(loc) {
  return loc.type === "fishing" ? "fishing" : "walk";
}
function fishListFor(loc) {
  return (loc.fish || []).map(id => fishById.get(id)).filter(Boolean);
}
async function loadWeatherFor(loc, token) {
  try {
    const w = await getWeather(loc);
    const analysis = StepWeather.analyze(w, fishListFor(loc), kindFor(loc));
    updatePill(loc, w, analysis);
    if (token !== detailToken) return;
    renderWeather(w, analysis);
    renderFish(loc, analysis);
  } catch (err) {
    console.warn("Погода недоступна", err);
    if (token !== detailToken) return;
    renderWeatherError();
    updatePillError();
  }
}
function renderWeatherLoading() {
  const box = document.getElementById("detailWeather");
  box.hidden = false;
  box.replaceChildren(el("h2", "Погода на месте"), el("div", "Загружаем погоду…", "wx-error"));
}
function renderWeatherError() {
  const box = document.getElementById("detailWeather");
  box.hidden = false;
  box.replaceChildren(
    el("h2", "Погода на месте"),
    el("div", "Не удалось загрузить погоду. Проверьте интернет и попробуйте открыть точку ещё раз. Советы по сезону ниже остаются в силе.", "wx-error")
  );
}
function renderWeather(w, analysis) {
  const box = document.getElementById("detailWeather");
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
  box.append(el("p", "Оценка клёва — ориентир по сезону, температуре воздуха, давлению, ветру и времени суток, а не гарантия. Погода: Open-Meteo.", "fish-note"));
}
function renderFish(loc, analysis) {
  const box = document.getElementById("detailFish");
  const list = fishListFor(loc);
  if (!list.length) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  box.replaceChildren(el("h2", "Какая рыба здесь и когда клюёт"));

  const scoreById = new Map(analysis ? analysis.ranked.map(r => [r.fishId, r]) : []);
  const order = analysis ? analysis.ranked.map(r => fishById.get(r.fishId)) : list;
  order.forEach(f => {
    const row = el("div", null, "fish-row");
    const head = el("div", null, "fish-head");
    const title = el("div");
    title.append(el("strong", f.name), document.createTextNode(" "), el("em", f.latin));
    head.append(title);
    const s = scoreById.get(f.id);
    if (s) head.append(el("span", "сейчас: " + s.label + " · " + s.score, "fish-score"));
    row.append(head);
    if (s) {
      const bar = el("div", null, "bite-bar");
      const fill = el("i", null, s.score >= 70 ? "" : s.score >= 45 ? "mid" : "low");
      fill.style.width = Math.max(4, s.score) + "%";
      bar.append(fill);
      row.append(bar);
    }
    const months = StepWeather.formatMonths(f.peakMonths);
    const good = StepWeather.formatMonths(f.goodMonths);
    row.append(el("p", "Лучшее время: " + months + ". Берёт, но слабее: " + good + ".", "fish-note"));
    row.append(el("p", f.why, "fish-note"));
    if (s) row.append(el("p", "Сегодня: " + s.reasons.slice(0, 3).join("; ") + ".", "fish-note"));
    (f.photos || []).slice(0, 1).forEach(p => {
      const fig = figureFor(p, f.name);
      if (fig) row.append(fig);
    });
    box.append(row);
  });
}
function renderPlants(loc) {
  const box = document.getElementById("detailPlants");
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
function commonsName(file) {
  return encodeURIComponent(String(file).replace(/ /g, "_"));
}
function photoSrc(photo) {
  if (!photo) return null;
  try {
    if (typeof photo.file === "string" && photo.file) {
      return "https://commons.wikimedia.org/wiki/Special:FilePath/" + commonsName(photo.file) + "?width=900";
    }
    if (typeof photo.url === "string") {
      const u = new URL(photo.url);
      return u.protocol === "https:" ? u.href : null;
    }
  } catch (_) {}
  return null;
}
function photoPage(photo) {
  try {
    if (photo.file) return "https://commons.wikimedia.org/wiki/File:" + commonsName(photo.file);
    if (photo.sourceUrl) {
      const u = new URL(photo.sourceUrl);
      return u.protocol === "https:" ? u.href : null;
    }
  } catch (_) {}
  return null;
}
/* Фото всегда с подписью: автор, лицензия, ссылка на страницу файла на Commons. */
function figureFor(photo, alt, cls) {
  const src = photoSrc(photo);
  if (!src) return null;
  const fig = document.createElement("figure");
  fig.className = cls || "photo-fig";
  const img = document.createElement("img");
  img.src = src;
  img.alt = photo.alt || alt || "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  fig.append(img);
  const cap = document.createElement("figcaption");
  const parts = [];
  if (photo.author) parts.push("Фото: " + photo.author);
  if (photo.license) parts.push(photo.license);
  if (photo.note) parts.push(photo.note);
  cap.append(document.createTextNode(parts.join(" · ")));
  const page = photoPage(photo);
  if (page) {
    const a = document.createElement("a");
    a.href = page; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.textContent = parts.length ? " · Wikimedia Commons" : "Wikimedia Commons";
    cap.append(a);
  }
  fig.append(cap);
  return fig;
}
function renderPhotos(loc) {
  const box = document.getElementById("detailGallery");
  box.replaceChildren();
  const figures = (loc.photos || []).map(p => figureFor(p, loc.title, "gallery-fig")).filter(Boolean);
  if (figures.length) {
    box.hidden = false;
    box.className = "detail-gallery";
    figures.forEach(f => box.append(f));
  } else {
    box.hidden = false;
    box.className = "photo-empty";
    box.textContent = "Фото этого места появятся после проверки лицензий: берём только снимки без людей, с указанием автора и лицензии.";
  }
}
function renderHistory(loc) {
  const box = document.getElementById("detailHistory");
  const items = loc.history || [];
  if (!items.length) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  box.replaceChildren(el("h2", "История места"));
  items.forEach(h => {
    const row = el("div", null, "hist-row");
    row.append(el("b", h.period), el("p", h.text));
    box.append(row);
  });
}
function renderSpecies(loc) {
  const box = document.getElementById("detailSpecies");
  const items = loc.species || [];
  if (!items.length) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  box.replaceChildren(el("h2", "Обитатели: птицы, звери, растения"));
  items.forEach(s => {
    const row = el("div", null, "species-row");
    const head = el("div", null, "species-head");
    const left = el("div");
    left.append(el("span", s.kind === "plant" ? "РАСТЕНИЕ" : "ЖИВОТНОЕ", "kind " + (s.kind === "plant" ? "plant" : "")), el("strong", s.name));
    if (s.latin) left.append(document.createTextNode(" "), el("em", s.latin));
    head.append(left);
    if (s.status) head.append(el("span", s.status, "badge"));
    row.append(head);
    if (s.note) row.append(el("p", s.note, "fish-note"));
    const fig = figureFor(s.photo, s.name);
    if (fig) row.append(fig);
    box.append(row);
  });
}

/* ---------- Плашка «Погода на месте» ---------- */
function updatePill(loc, w, analysis) {
  if (selectedLoc && loc.id !== selectedLoc.id) return;
  const danger = analysis.care.some(t => t.level === "danger");
  document.getElementById("pillIcon").textContent = weatherIcon(w.code);
  document.getElementById("pillTitle").textContent = loc.title.split(" — ")[0];
  const best = analysis.ranked[0];
  document.getElementById("pillText").textContent =
    (danger ? "⚠ " : "") + fmtTemp(w.tempC) + ", ветер " + fmtNum(w.windMs, 0) + " м/с" + (best ? ", клёв: " + best.label : "");
  const pill = document.getElementById("weatherButton");
  pill.dataset.level = danger ? "danger" : "ok";
}
function updatePillError() {
  document.getElementById("pillTitle").textContent = "Погода на месте";
  document.getElementById("pillText").textContent = "Не загрузилась. Нажмите, чтобы повторить";
}
async function refreshPill() {
  if (!selectedLoc) return;
  document.getElementById("pillText").textContent = "Загружаем условия…";
  try {
    const w = await getWeather(selectedLoc);
    updatePill(selectedLoc, w, StepWeather.analyze(w, fishListFor(selectedLoc), kindFor(selectedLoc)));
  } catch (err) {
    console.warn("Погода недоступна", err);
    updatePillError();
  }
}
async function loadFish() {
  try {
    const response = await fetch("data/fish.json");
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();
    if (Array.isArray(data)) data.forEach(f => { if (f && f.id) fishById.set(f.id, f); });
  } catch (err) {
    console.error("Не удалось загрузить data/fish.json", err);
  }
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
  } catch (err) {
    console.error("Не удалось загрузить data/points.json", err);
    toast("Не удалось загрузить точки. Запустите проект через локальный сервер (см. README).");
  }
}

document.getElementById("closeDetail").addEventListener("click", closeDetails);
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
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusable.length) { event.preventDefault(); detailSheet.focus(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

document.getElementById("layersToggle").addEventListener("click", () => layerPanel.classList.toggle("open"));
document.getElementById("closeLayers").addEventListener("click", () => layerPanel.classList.remove("open"));
document.querySelectorAll("[data-layer]").forEach(input => {
  input.addEventListener("change", () => {
    setLayerVisible(input.dataset.layer, input.checked);
    syncNavigation();
  });
});
document.getElementById("zoomIn").addEventListener("click", () => map.zoomIn());
document.getElementById("zoomOut").addEventListener("click", () => map.zoomOut());
document.getElementById("resetView").addEventListener("click", () => map.setView(DEFAULT_CENTER, DEFAULT_ZOOM));

document.getElementById("locate").addEventListener("click", () => {
  if (!navigator.geolocation) return toast("Геолокация не поддерживается этим браузером.");
  toast("Запрашиваем доступ к местоположению…");
  navigator.geolocation.getCurrentPosition(pos => {
    const point = [pos.coords.latitude, pos.coords.longitude];
    map.setView(point, 12);
    if (!userMarker) {
      userMarker = L.circleMarker(point, { radius: 7, color: "#fff", weight: 3, fillColor: "#2d7db1", fillOpacity: 1 }).addTo(map);
      userMarker.bindPopup("Вы здесь");
    } else {
      userMarker.setLatLng(point);
      if (!map.hasLayer(userMarker)) userMarker.addTo(map);
    }
  }, () => toast("Не удалось получить местоположение. Проверь разрешения браузера."), { enableHighAccuracy: true, timeout: 8000 });
});

document.getElementById("weatherButton").addEventListener("click", () => {
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
      const loc = locations.find(l => l.type === filter);
      if (loc) map.setView([loc.lat, loc.lng], 10);
      toast(filter === "fishing" ? "Показаны рыболовные метки" : filter === "nature" ? "Показаны метки природы" : "Показаны интересные места");
    } else if (filter === "all") map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  });
});
function searchText(l) {
  const fish = fishListFor(l).map(f => f.name + " " + f.latin);
  const species = (l.species || []).map(s => s.name + " " + (s.latin || ""));
  const plants = (l.plants || []).map(p => p.name);
  return [l.title, l.description, l.category, ...fish, ...species, ...plants].join(" ").toLocaleLowerCase("ru");
}
const search = document.getElementById("search");
search.addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  const q = search.value.trim().toLocaleLowerCase("ru");
  if (!q) return;
  const found = locations.find(l => searchText(l).includes(q));
  if (!found) return toast("Пока не нашли это место в стартовом каталоге. Добавим данные по мере развития атласа.");
  setLayerVisible(found.type, true);
  syncNavigation();
  map.setView([found.lat, found.lng], 12);
  openDetails(found);
});

function initTelegram() {
  const tg = window.Telegram && window.Telegram.WebApp;
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
  } catch (err) {
    console.warn("Telegram WebApp initialization skipped", err);
  }
}
detailSheet.inert = true;
initTelegram();
syncNavigation();
loadFish().then(loadPoints);
setTimeout(() => map.invalidateSize(), 100);
