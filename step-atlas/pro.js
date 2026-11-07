/* СТЕПЬ Pro: туры по видам рыбы, награды, оплата, места Pro.
   Этот файл ПУБЛИЧНЫЙ: в нём нет ни секретов, ни платного содержимого. Платные данные (этапы туров, 30 мест,
   координаты, отчёты, медали) приходят только с сервера после проверки подписи Telegram и подписки.
   Подключение сервера: адрес в config.js (PRO_API). Пока он пуст, туры видны как витрина, покупка недоступна. */
(function () {
  "use strict";
  const CFG = window.STEP_CONFIG || {};
  const API = String(CFG.PRO_API || "").replace(/\/+$/, "");
  const M = window.StepMedals;
  const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const MONTH_NOM = ["", "январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  const DISTRICT_RE = /^(akhtuba|bakhtemir|lower-volga)-\d\d$/;

  /* ---------------- мелочи ---------------- */
  function h(tag, attrs) {
    const n = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (let i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach(c => { if (c === null || c === undefined || c === false) return; n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    }
    return n;
  }
  const $$ = id => document.getElementById(id);
  const tg = () => window.Telegram && window.Telegram.WebApp;
  const initData = () => { const t = tg(); return (t && t.initData) || ""; };
  const pause = ms => new Promise(r => setTimeout(r, ms));
  function lsGet(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (_) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  const todayAst = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);   // Астрахань: UTC+4
  function fmtDay(iso) { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return d + " " + MONTHS[m - 1] + " " + y; }
  function fmtTs(ms) { return fmtDay(new Date(ms + 4 * 3600e3).toISOString()); }
  function fmtMin(min) { return min >= 60 ? Math.floor(min / 60) + " ч " + (min % 60) + " мин" : min + " мин"; }
  const stripDay = t => String(t || "").replace(/^День\s+\d+\.\s*/, "");
  /* Ориентир трофея для платины: у полного тура в medals.platinum, у витрины в trophyHint */
  const trophyHintOf = t => (t && t.medals && t.medals.platinum && t.medals.platinum.trophyHint) || (t && t.trophyHint) || "";
  const trophyMinOf = t => Number(t && t.medals && t.medals.platinum && t.medals.platinum.minKg) || 0;
  function plural(n, a, b, c) { n = Math.abs(n) % 100; const d = n % 10; return n > 10 && n < 20 ? c : d === 1 ? a : d >= 2 && d <= 4 ? b : c; }
  function fishName(id) { const f = typeof fishById !== "undefined" && fishById.get(id); return f ? f.name : id; }

  /* ---------------- состояние ---------------- */
  const S = {
    status: API ? "init" : "noapi",       // init | ok | noapi | notg | network | error
    me: null, pro: false, plans: (CFG.FALLBACK_PLANS || []).slice(),
    teaser: null, tours: null, progress: null, spots: null, spotsMeta: null, spotLocs: [],
    chat: { msgs: [], loaded: false, loading: false, sending: false, on: true, left: null, limit: 20, draft: "", err: "", place: false, scroll: false },
    stack: [], rootTab: "tours", loading: {}, errors: {},
    seen: new Set(lsGet("stepMedalsSeen", [])), fresh: new Set(), planSel: "3m", sharing: false,
    promo: null, promoOpen: false, promoBusy: false, promoErr: "", promoDraft: ""
  };

  /* ---------------- запросы к серверу ---------------- */
  const ERR = {
    unauthorized: "Откройте атлас в Telegram, чтобы войти.",
    pro_required: "Для этого нужна подписка Pro.",
    network: "Нет связи с сервером. Проверьте интернет и повторите.",
    timeout: "Сервер долго не отвечает. Повторите чуть позже.",
    no_api: "Сервер Pro пока не подключён.",
    no_active_tour: "Сначала начните тур.",
    tour_active: "У вас уже идёт другой тур. Завершите или отмените его.",
    bad_date: "Выберите дату старта, не раньше сегодняшней.",
    consent_required: "Нужно подтвердить согласие.",
    consent_changed: "Текст согласия обновился. Откройте тур заново.",
    same_date: "На эту календарную дату уже засчитан другой день тура.",
    too_early: "День тура ещё не начался: отметка возможна со дня старта.",
    too_late: "Время тура вышло. Завершите тур, чтобы получить медаль.",
    rate_limited: "Слишком много попыток. Подождите немного.",
    bad_request: "Проверьте введённые данные.",
    photo_too_big: "Фото слишком большое. Выберите другое.",
    not_found: "Не найдено.",
    petrovich_limit: "На сегодня вопросы закончились: Петрович отдыхает до завтра.",
    petrovich_busy: "Петрович сегодня нарасхват. Загляните позже.",
    petrovich_unavailable: "Петрович не расслышал. Повторите вопрос чуть позже.",
    petrovich_off: "Петрович пока не подключён.",
    empty: "Напишите вопрос.",
    too_long: "Слишком длинный вопрос: до 500 знаков.",
    bad_image: "Картинка не подошла. Обновите приложение и повторите.",
    share_unavailable: "Telegram не принял картинку. Повторите чуть позже.",
    promo_invalid: "Такого промокода нет. Проверьте буквы и цифры: код выглядит как STEP-XXXX-XXXX.",
    promo_used: "Этот промокод уже использован.",
    promo_locked: "Слишком много неверных кодов. Попробуйте позже.",
    promo_busy: "Этим промокодом сейчас оплачивает другой человек. Повторите через 15 минут.",
    promo_plan: "Этот промокод действует на другой тариф.",
    server: "Ошибка на сервере. Повторите позже."
  };
  function errText(e) {
    if (e && e.code === "promo_plan" && e.data && e.data.plan) { const p = S.plans.find(x => x.id === e.data.plan); if (p) return "Этот промокод действует только на тариф «" + p.title + "»."; }
    return (e && ERR[e.code]) || "Не получилось: " + ((e && e.code) || "ошибка");
  }
  function apiErr(code, status, data) { const e = new Error(code); e.code = code; e.status = status || 0; e.data = data || null; e.isApi = true; return e; }
  async function api(path, opts) {
    opts = opts || {};
    if (!API) throw apiErr("no_api");
    const headers = {};
    const idt = initData();
    if (idt) headers.Authorization = "tma " + idt;
    let body = opts.body;
    if (body && !(body instanceof FormData)) { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 15000);
    try {
      const r = await fetch(API + path, { method: opts.method || (body ? "POST" : "GET"), headers, body, signal: ctrl.signal });
      let data = null;
      try { data = await r.json(); } catch (_) {}
      if (!r.ok) throw apiErr((data && data.error) || (r.status >= 500 ? "server" : "http_" + r.status), r.status, data);
      return data;
    } catch (e) {
      if (e && e.isApi) throw e;
      throw apiErr(e && e.name === "AbortError" ? "timeout" : "network");
    } finally { clearTimeout(timer); }
  }

  /* ---------------- общий лист ---------------- */
  const sheet = () => $$("proSheet");
  const appShell = () => document.querySelector(".app-shell");
  let prevFocus = null;
  function isOpen() { return sheet().classList.contains("open"); }
  function tab() { return S.rootTab; }
  function showSheet() {
    if (isOpen()) return;
    prevFocus = document.activeElement;
    sheet().inert = false;
    if (appShell()) appShell().inert = true;
    sheet().classList.add("open");
    $$("sheetBackdrop").classList.add("open");
    const t = tg();
    if (t && t.BackButton) { try { t.BackButton.show(); } catch (_) {} }
    sheet().focus({ preventScroll: true });
    syncNavigation();
  }
  function closeAll() {
    if (!isOpen()) return;
    sheet().classList.remove("open");
    $$("sheetBackdrop").classList.remove("open");
    sheet().inert = true;
    if (appShell()) appShell().inert = false;
    const t = tg();
    if (t && t.BackButton) { try { t.BackButton.hide(); } catch (_) {} }
    S.stack = [];
    if (prevFocus && typeof prevFocus.focus === "function") { try { prevFocus.focus({ preventScroll: true }); } catch (_) {} }
    syncNavigation();
  }
  function push(name, args) { S.stack.push({ name, args: args || {} }); render(); }
  function replaceTop(name, args) { S.stack[S.stack.length - 1] = { name, args: args || {} }; render(); }
  function back() { if (!isOpen()) return; if (S.stack.length > 1) { S.stack.pop(); render(); } else closeAll(); }
  function open(root, args) {
    if (typeof closeDetails === "function") closeDetails();
    if (typeof closeBans === "function") closeBans();
    S.rootTab = root === "awards" ? "awards" : root === "petrovich" ? "petrovich" : root === "offer" ? "map" : "tours";
    S.stack = [{ name: root, args: args || {} }];
    showSheet();
    render();
    syncNavigation();
  }
  const VIEWS = {};
  function render(keepScroll) {
    const v = S.stack[S.stack.length - 1];
    if (!v || !VIEWS[v.name]) return;
    const keep = keepScroll ? sheet().scrollTop : 0;
    const ae = document.activeElement, hadInput = !!(ae && ae.id === "chatInput");
    const out = VIEWS[v.name](v.args || {});
    $$("proBack").hidden = S.stack.length < 2;
    $$("proTitle").textContent = out.title;
    $$("proLabel").textContent = out.label;
    $$("proBody").replaceChildren(...out.nodes.filter(Boolean));
    sheet().scrollTop = keep;
    if (v.name === "petrovich") {
      const inp = $$("chatInput");
      if (hadInput && inp) { inp.focus({ preventScroll: true }); try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (_) {} }
      if (S.chat.scroll) { S.chat.scroll = false; sheet().scrollTop = sheet().scrollHeight; }
    }
    if (v.name === "awards" && S.progress) markSeen();
  }
  const rerender = () => { if (isOpen()) render(true); };

  /* ---------------- вход, статус подписки ---------------- */
  async function refresh() {
    if (!API) { S.status = "noapi"; updateUi(); return; }
    if (!initData()) { S.status = "notg"; updateUi(); return; }
    try {
      const me = await api("/api/me");
      S.me = me; S.pro = !!me.pro; S.status = "ok";
      if (Array.isArray(me.plans) && me.plans.length) S.plans = me.plans;
    } catch (e) { S.status = e.code === "network" || e.code === "timeout" ? "network" : "error"; }
    updateUi();
    if (S.pro) onPro();
  }
  let proStarted = false;
  function onPro() {
    loadTours(true); loadProgress(); loadSpots();
    if (!proStarted) { proStarted = true; setTimeout(openFromStartParam, 600); }
  }
  function updateUi() {
    const row = $$("proLayerOption");
    const box = row && row.querySelector("input");
    if (row) {
      row.hidden = S.status !== "ok";
      if (box) box.disabled = !S.pro;
      $$("proLayerHint").textContent = S.pro ? "30 мест со свободным доступом" : "🔒 30 мест со свободным доступом — в Pro";
    }
    if (!S.pro && typeof layerGroups !== "undefined") { layerGroups.pro.clearLayers(); S.spotLocs = []; }
    rerender();
  }
  function setBadge(on) {
    const btn = document.querySelector('#bottomNav [data-tab="awards"]');
    if (!btn) return;
    let b = btn.querySelector(".badge");
    if (!b) { b = h("i", { class: "badge", hidden: true }); btn.append(b); }
    b.hidden = !on;
  }

  /* ---------------- данные: туры, прогресс, места ---------------- */
  async function loadTours(force) {
    if (S.loading.tours && !force) return;
    S.loading.tours = true;
    try {
      if (!S.teaser) {
        try { const d = await fetchJsonCached("data/tours-teaser.json"); S.teaser = (d && d.tours) || []; } catch (_) { S.teaser = []; }
        rerender();
      }
      if (API && S.status !== "noapi") {
        const d = await api("/api/tours");
        S.pro = !!d.pro;
        if (d.pro) S.tours = d.tours; else { S.tours = null; if (Array.isArray(d.tours) && d.tours.length) S.teaser = d.tours; }
        S.errors.tours = null;
      }
    } catch (e) { S.errors.tours = e.code; }
    S.loading.tours = false;
    rerender();
  }
  async function loadProgress() {
    if (!S.pro) return;
    try {
      const p = await api("/api/progress");
      applyProgress(p);
    } catch (e) { S.errors.progress = e.code; }
    rerender();
  }
  function applyProgress(p) {
    S.progress = p;
    const fresh = (p.medals || []).filter(m => !S.seen.has(m.id));
    fresh.forEach(m => S.fresh.add(m.id));
    setBadge(fresh.length > 0 && !(isOpen() && tab() === "awards"));
    if (fresh.length && !(isOpen() && tab() === "awards")) toast("Новая медаль: " + M.title(fresh[0]) + ". Загляните в «Награды».", 5500);
  }
  function markSeen() {
    let changed = false;
    (S.progress.medals || []).forEach(m => { if (!S.seen.has(m.id)) { S.seen.add(m.id); changed = true; } });
    if (changed) lsSet("stepMedalsSeen", [...S.seen].slice(-200));
    setBadge(false);
  }
  async function loadSpots() {
    if (!S.pro || S.spots) return;
    try {
      const d = await api("/api/spots");
      if (!d.pro) return;
      S.spots = d.spots; S.spotsMeta = d;
      addSpotsToMap();
      const top = S.stack[S.stack.length - 1];
      if (isOpen() && top && top.name === "tour" && !document.querySelector("#proBody details.stage[open]")) rerender();   // данные для фото видов и неба подоспели
    } catch (e) { S.errors.spots = e.code; }
  }
  function spotToLoc(sp, meta) {
    const near = sp.near || {}, acc = sp.access || {}, water = sp.water || {}, sky = sp.sky || {};
    const details = [
      ["Водоём", [water.name, water.type].filter(Boolean).join(", ")],
      ["Берег", (acc.kind || "") + (acc.toWaterM != null ? ", до воды около " + acc.toWaterM + " м" : "")],
      ["Подъезд", (acc.road || "") + (acc.roadM != null ? ", до дороги около " + acc.roadM + " м" : "")],
      ["Радиус ловли", sp.radiusM + " м от точки (по типу воды)"],
      ["От Астрахани", "около " + Math.round(near.astrakhanKm || 0) + " км по прямой"],
      ["Охраняемые и военные территории", sp.buffers && sp.buffers.protectedOrMilitaryKm != null ? "не ближе " + sp.buffers.protectedOrMilitaryKm + " км" : "по данным не найдены рядом"],
      ["Почему считаем доступ свободным", acc.basis || ""]
    ];
    (sp.notes || []).forEach(n => details.push(["Важно", n]));
    return {
      id: sp.id, type: "fishing", pro: true, lat: sp.lat, lng: sp.lng, verified: false,
      title: sp.name, category: "PRO · " + String(sp.districtName || "").toUpperCase() + " · ОРИЕНТИР",
      description: (water.name ? water.name + " (" + (water.type || "вода") + "), " : "") + "рядом " + (near.place || "посёлок") + ", " + String(near.km != null ? near.km : "").replace(".", ",") + " км. Свободный доступ по данным OpenStreetMap, на месте не проверялось: перед выездом посмотрите спутник и уточните у местных.",
      details,
      fish: sp.fish || [], fishFreq: sp.fishFreq || {}, plants: sp.plants || [], animals: sp.animals || [],
      skyInfo: sky && (sky.text || sky.rating) ? sky : null,
      photos: (meta.districtPhotos && meta.districtPhotos[sp.district]) || [],
      source: "Место Pro подобрано по открытым данным OpenStreetMap. " + (sp.fishBasis || "") + " Фото — района, не самой точки.",
      sources: [
        { title: "OpenStreetMap", url: sp.links && sp.links.osm },
        { title: "Спутник (Яндекс)", url: sp.links && sp.links.satelliteYandex },
        { title: "Спутник (Google)", url: sp.links && sp.links.satelliteGoogle }
      ].filter(x => x.url)
    };
  }
  function addSpotsToMap() {
    if (!S.spots || typeof layerGroups === "undefined") return;
    layerGroups.pro.clearLayers();
    S.spotLocs = S.spots.map(sp => spotToLoc(sp, S.spotsMeta));
    S.spotLocs.forEach(loc => {
      const mk = L.marker([loc.lat, loc.lng], { icon: iconFor("pro"), title: loc.title, alt: loc.title, zIndexOffset: 350 });
      mk.on("click", () => openDetails(loc));
      mk.addTo(layerGroups.pro);
    });
  }
  function openFromStartParam() {
    const id = typeof startParamId === "function" ? startParamId() : "";
    if (!DISTRICT_RE.test(id)) return;
    const loc = S.spotLocs.find(l => l.id === id);
    if (loc) { map.setView([loc.lat, loc.lng], 12); openDetails(loc); }
  }

  /* ---------------- луна и небо (приблизительно, по среднему синодическому месяцу) ---------------- */
  const SYN = 29.530588861, NEW_REF = 2451550.09766;
  function moonAge(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const jd = Date.UTC(y, m - 1, d, 8, 0, 0) / 86400000 + 2440587.5;   // полдень по Астрахани
    return (((jd - NEW_REF) % SYN) + SYN) % SYN;
  }
  function moonText(iso) {
    const age = moonAge(iso);
    const ill = Math.round((1 - Math.cos(2 * Math.PI * age / SYN)) / 2 * 100);
    const names = [[1.85, "новолуние"], [5.5, "растущий серп"], [9.2, "первая четверть"], [12.9, "растущая, почти полная"], [16.6, "полнолуние"], [20.3, "убывающая, почти полная"], [24, "последняя четверть"], [27.7, "убывающий серп"], [99, "новолуние"]];
    const name = names.find(n => age < n[0])[1];
    const toNew = SYN - age;
    const [y, m, d] = iso.split("-").map(Number);
    const nn = new Date(Date.UTC(y, m - 1, d) + Math.round(toNew) * 86400000);
    return name + ", освещено около " + ill + "%. Ближайшее новолуние примерно " + nn.getUTCDate() + " " + MONTHS[nn.getUTCMonth()] + " (расчёт приблизительный, ±1 день).";
  }
  function milkyText(iso) {
    const mon = Number(iso.slice(5, 7));
    const by = S.spotsMeta && S.spotsMeta.sky && S.spotsMeta.sky.milkyWayCore && S.spotsMeta.sky.milkyWayCore.byMonth;
    if (!by) return "";
    const w = by[String(mon)];
    return w ? "Ядро Млечного Пути в " + MONTH_NOM[mon].replace(/ь$/, "е").replace(/й$/, "е").replace(/т$/, "те") + ": примерно с " + w.from + " до " + w.to + " по местному времени, до " + w.maxAlt + "° над горизонтом (лучше в новолуние ±3 дня)." : "В этом месяце ядро Млечного Пути на широте Астрахани не видно, но видны осенние и зимние созвездия.";
  }

  /* ---------------- Млечный Путь и небо: фото и ближайшие даты ---------------- */
  const skyMeta = () => (S.spotsMeta && S.spotsMeta.sky) || null;
  /* Окна для съёмки и просмотра: новолуние ±3 дня в месяцы, когда ядро поднимается до 15° (май – июль) */
  function milkyWindows(max) {
    const meta = skyMeta();
    if (!meta || !Array.isArray(meta.moonCalendar)) return [];
    const by = (meta.milkyWayCore && meta.milkyWayCore.byMonth) || {};
    const today = todayAst(), out = [];
    meta.moonCalendar.forEach(e => {
      if (!e || e.phase !== "new") return;
      const [y, m, d] = String(e.at).slice(0, 10).split("-").map(Number);
      const core = by[String(m)];
      if (!core || core.maxAlt < 15) return;
      const a = new Date(Date.UTC(y, m - 1, d - 3)), b = new Date(Date.UTC(y, m - 1, d + 3));
      if (b.toISOString().slice(0, 10) < today) return;
      out.push({ a, b, core });
    });
    return out.slice(0, max || 3);
  }
  function fmtWindow(w) {
    const da = w.a.getUTCDate(), db = w.b.getUTCDate(), ma = w.a.getUTCMonth(), mb = w.b.getUTCMonth();
    const span = ma === mb ? da + "–" + db + " " + MONTHS[mb] : da + " " + MONTHS[ma] + " – " + db + " " + MONTHS[mb];
    return span + " " + w.b.getUTCFullYear() + ": ядро с " + w.core.from + " до " + w.core.to + " по местному времени, до " + w.core.maxAlt + "° над горизонтом";
  }
  function photoStrip(list, alt) {
    const figs = (list || []).map(p => (typeof photoFigure === "function" ? photoFigure(p, alt) : null)).filter(Boolean);
    return figs.length ? h("div", { class: "fish-gallery sky-gallery" }, figs) : null;
  }
  /* Карточка «Небо и Млечный Путь». opts.sky — оценка неба конкретного места, opts.moon — добавить фото Луны. */
  function skyCard(opts) {
    opts = opts || {};
    const meta = skyMeta();
    if (!meta && !opts.sky) return null;
    const ph = (meta && meta.photos) || {};
    const wins = milkyWindows(3);
    const note = (meta && meta.milkyWayCore && meta.milkyWayCore.note) || "Ядро Млечного Пути над Астраханью невысоко над южным горизонтом. Нужен открытый юг и новолуние ±3 дня.";
    const sky = opts.sky;
    return h("div", { class: "sky-card" },
      h("h4", null, h("span", { class: "sky-star", text: "✦", "aria-hidden": "true" }), "Небо и Млечный Путь"),
      sky && h("p", { class: "sky-rate" }, h("b", { text: (sky.rating || "") + (sky.bortle ? ", Bortle " + sky.bortle : "") + ". " }), sky.text || ""),
      h("p", { class: "sky-best", text: note }),
      wins.length ? h("div", { class: "sky-wins" }, h("b", { text: "Ближайшие окна (новолуние ±3 дня):" }), h("ul", null, wins.map(w => h("li", { text: fmtWindow(w) })))) : null,
      photoStrip(ph.milkyWay, "Млечный Путь"),
      opts.moon ? photoStrip(ph.moon, "Луна") : null,
      h("p", { class: "sky-note", text: "Фото с Wikimedia Commons сделаны не здесь: они показывают, как выглядит Млечный Путь в тёмном небе. Даты приблизительные, облачность и засветку проверяйте перед выездом (lightpollutionmap.info)." }));
  }

  /* ---------------- виды и рыба: те же фото, что в карточках мест ---------------- */
  const spotById = id => (S.spots || []).find(s => s.id === id) || null;
  function speciesFor(st, kind) {                       // kind: plants | animals; в этапе только названия, подробности берём из места
    const own = (spotById(st.spotId) || {})[kind] || [];
    const all = {};
    (S.spots || []).forEach(sp => (sp[kind] || []).forEach(x => { if (x && x.name && !all[x.name]) all[x.name] = x; }));
    return (st[kind] || []).map(name => own.find(x => x.name === name) || all[name] || { name });
  }
  function speciesRow(item, cls) {
    const row = h("div", { class: cls });
    row.append(h("b", { text: item.name }));
    if (item.latin) row.append(" ", h("i", { text: item.latin }));
    if (item.rare) row.append(h("span", { class: "rare", text: "редкий, Красная книга РФ" }));
    if (item.danger) row.append(h("span", { class: "danger", text: "ядовит" }));
    if (item.note) row.append(h("div", { text: item.note }));
    const gal = typeof speciesGallery === "function" ? speciesGallery(item, 0, sheet()) : null;
    if (gal) row.append(gal);
    return row;
  }
  const fishPhotos = id => (typeof fishGallery === "function" ? fishGallery(id, sheet()) : null);

  /* ---------------- карточки и блоки ---------------- */
  function fishIcon(id, ink, eye) {
    const svg = '<svg viewBox="0 0 124 60" aria-hidden="true">' + M.fishShape(id, 62, 30, 112, ink || "#2b4a3f", eye || "#e9efe3") + "</svg>";
    return h("div", { class: "tour-fish", html: svg });
  }

  /* ---------------- витрина Pro: цвета рыб, значки, превью медалей ---------------- */
  const FISHCOL = { pike: ["#2c6552", "#0f352a"], carp: ["#b9771a", "#4d2610"], zander: ["#3b6a8f", "#14283d"], catfish: ["#34408a", "#0d1233"], grasscarp: ["#2d8a4a", "#0f3319"] };
  const ICON = {
    route: '<path d="M6 20a2.2 2.2 0 1 0 0-4.4A2.2 2.2 0 0 0 6 20zM18 8.4a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z"/><path d="M8.2 17.8h5.3a3.4 3.4 0 0 0 0-6.8h-3a3.4 3.4 0 0 1 0-6.8H15.8"/>',
    pin: '<path d="M12 21.2s7-6.1 7-11.6a7 7 0 0 0-14 0c0 5.5 7 11.6 7 11.6z"/><circle cx="12" cy="9.6" r="2.6"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.6l2.9 2.9 5.6-6"/>',
    medal: '<circle cx="12" cy="15.2" r="5.4"/><path d="M8.6 10.6L6.6 3.4h4l1.4 3.9 1.4-3.9h4l-2 7.2"/>',
    users: '<circle cx="9" cy="8.6" r="3.2"/><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6"/><path d="M16 5.6a3 3 0 0 1 0 6M18.2 14.4c2 .7 3 2.6 3 5.2"/>',
    card: '<rect x="4" y="3.5" width="16" height="17" rx="3.2"/><path d="M8 16l2.8-3.2 2.1 2.2 3.1-4.2"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/>',
    chat: '<path d="M4.2 5h15.600a1.700 1.700 0 0 1 1.700 1.700v8.100a1.700 1.700 0 0 1-1.700 1.700h-7.100l-4.200 3.500v-3.500H4.200a1.700 1.700 0 0 1-1.700-1.700V6.700A1.700 1.700 0 0 1 4.200 5z"/><path d="M7.600 11.200c1.600-2.100 4.600-2.100 6.200 0-1.600 2.100-4.600 2.100-6.200 0zM13.800 11.200l2.400-1.600v3.200z"/>',
    star: '<path d="M12 2.8l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.7 6.4 19.8l1.3-6.2L3 9.3l6.3-.7z" fill="currentColor" stroke="none"/>'
  };
  const icon = (name, cls) => h("span", { class: "ico " + (cls || ""), html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + "</svg>" });
  /* пять медалей для витрины: разные рыбы и ступени, платина и «Глас народа» */
  function showcaseMedals() {
    const secs = M.catalog(tourListSource());
    const items = id => ((secs.find(s => s.id === id) || {}).items || []);
    const ti = items("tours"), pl = items("platinum"), fr = items("friends");
    const pick = [ti[0], ti[4] || ti[1], ti[8] || ti[2], pl[3] || pl[0], fr.find(i => i.medal.kind === "voice")];
    return pick.filter(Boolean).map(i => i.medal);
  }
  function medalStrip(list, cls) {
    return h("div", { class: "medal-strip " + (cls || "") }, list.map(m => h("div", { class: "ms" }, h("div", { class: "art", html: M.medalFor(m) }), h("small", { text: m.kind === "tour" || m.kind === "platinum" ? (M.LEVEL_RU[m.level] || "") + " · " + (m.fishName || "") : M.title(m) }))));
  }
  const HERO_ART = '<svg class="hero-art" viewBox="0 0 360 200" preserveAspectRatio="xMaxYMax slice" aria-hidden="true"><g fill="none" stroke="#f3dba0" stroke-linecap="round"><path d="M-10 168c34-12 62 10 96 0s62-14 96-2 62 8 96-4 62-8 98 2" opacity=".22" stroke-width="1.6"/><path d="M-10 182c34-12 62 10 96 0s62-14 96-2 62 8 96-4 62-8 98 2" opacity=".14" stroke-width="1.6"/><path d="M-10 154c34-12 62 10 96 0s62-14 96-2 62 8 96-4 62-8 98 2" opacity=".1" stroke-width="1.6"/><g opacity=".3" stroke-width="1.8"><path d="M300 200c1-40 4-70 12-104"/><path d="M314 200c-1-34 1-62 8-92"/><path d="M328 200c2-30 8-52 18-76"/><path d="M290 200c-2-24-2-44-10-64"/></g></g><g fill="#f3dba0"><ellipse cx="312" cy="94" rx="3.2" ry="10" opacity=".3" transform="rotate(8 312 94)"/><ellipse cx="322" cy="106" rx="3" ry="9" opacity=".26" transform="rotate(10 322 106)"/><ellipse cx="346" cy="122" rx="3" ry="9" opacity=".26" transform="rotate(16 346 122)"/></g><g fill="#f3dba0" opacity=".5"><circle cx="40" cy="34" r="1.3"/><circle cx="96" cy="58" r="1"/><circle cx="188" cy="26" r="1.2"/><circle cx="238" cy="52" r="1"/><circle cx="270" cy="20" r="1.3"/></g></svg>';
  function chips(list, cls) { return h("div", null, list.filter(Boolean).map(t => h("span", { class: "pro-chip " + (cls || ""), text: t }))); }
  function statusBlock() {
    if (S.pro && S.me) {
      const until = S.me.owner ? "владелец, всегда открыт" : S.me.until ? "до " + fmtTs(S.me.until) : "";
      return h("div", { class: "pro-status on" }, h("span", { text: "★" }), h("div", null, h("b", { text: "Pro активен" }), until), !S.me.owner && h("button", { class: "btn", type: "button", onclick: () => push("offer", { reason: "extend" }), text: "Продлить" }));
    }
    const txt = {
      noapi: ["Pro скоро откроется", "Ниже витрина туров. Полные маршруты, 30 мест со свободным доступом, отметки и медали появятся с запуском Pro."],
      notg: ["Откройте атлас в Telegram", "Подписка и награды работают внутри Telegram. Ссылка: t.me/AtlasFishingbot/atlas"],
      network: ["Нет связи с сервером Pro", "Проверьте интернет. Витрина ниже доступна без связи."],
      error: ["Сервер Pro отвечает с ошибкой", "Повторите чуть позже. Витрина ниже доступна."],
      init: ["Проверяем подписку…", ""],
      ok: ["Туры в Pro", "Полные маршруты, этапы по дням, места, отметки и медали."]
    }[S.status] || ["", ""];
    const canBuy = S.status === "ok";
    if (canBuy) return h("div", { class: "pro-banner" }, icon("star", "seal"), h("div", { class: "txt" }, h("b", { text: txt[0] }), h("small", { text: txt[1] })),
      h("button", { class: "btn gold", type: "button", onclick: () => push("offer", {}), text: "Открыть Pro" }));
    return h("div", { class: "pro-status" }, h("span", { text: "🔒" }), h("div", null, h("b", { text: txt[0] }), txt[1]),
      canBuy && h("button", { class: "btn gold", type: "button", onclick: () => push("offer", {}), text: "Открыть Pro" }),
      (S.status === "network" || S.status === "error") && h("button", { class: "btn", type: "button", onclick: () => refresh(), text: "Повторить" }));
  }
  function tourListSource() { return S.pro && S.tours ? S.tours : (S.teaser || []); }
  function activeTour() {
    const a = S.progress && S.progress.active;
    if (!a) return null;
    const t = (S.tours || []).find(x => x.id === a.tourId);
    return t ? { a, t } : null;
  }
  function tourCard(t) {
    const full = !t.locked && S.pro;
    const act = S.progress && S.progress.active && S.progress.active.tourId === t.id;
    const fish = (t.target || [])[0];
    const col = FISHCOL[fish] || ["#2c6552", "#0f352a"];
    const open = () => full ? push("tour", { id: t.id }) : push("offer", { reason: "tour", tourId: t.id });
    const stages = t.stageTitles || (t.stages || []).map(s => ({ day: s.day, title: s.teaserTitle || stripDay(s.title) }));
    const medals = ((M.catalog([t])[0] || {}).items || []).map(i => i.medal);
    const months = t.season ? [].concat((t.season.peakNames || []).map(n => ["gold", n]), (t.season.goodNames || []).map(n => ["green", n])) : [];
    const pitch = h("p", { class: "pitch clamp", text: t.pitch });
    const more = h("button", { class: "linkbtn", type: "button", text: "Читать полностью", onclick: () => { const c = pitch.classList.toggle("clamp"); more.textContent = c ? "Читать полностью" : "Свернуть"; } });
    const days = h("details", { class: "tour-route" }, h("summary", null, h("span", { text: "Маршрут по дням" }), h("b", { text: String(stages.length) })),
      h("ul", { class: "tour-days" }, stages.map(s => h("li", null, h("i", { text: "День " + s.day }), h("span", { text: String(s.title).replace(/^День\s+\d+:\s*/, "") })))));
    return h("article", { class: "tour-card" + (full ? "" : " locked"), style: "--tc1:" + col[0] + ";--tc2:" + col[1] },
      h("header", { class: "tour-head" },
        h("div", { class: "tour-top" },
          h("span", { class: "tour-kicker", text: ((t.targetNames || []).join(", ") + " · тур").toUpperCase() }),
          h("h3", { text: t.title }), h("p", { class: "sub", text: t.subtitle })),
        fishIcon(fish, "#f6e7bd", col[1]),
        !full && h("span", { class: "tour-ribbon" }, icon("lock"), "PRO")),
      h("div", { class: "tour-facts" },
        h("div", null, h("b", { text: String(t.days) }), h("small", { text: plural(t.days, "день", "дня", "дней") })),
        h("div", null, h("b", { text: t.level || "" }), h("small", { text: "сложность" })),
        h("div", null, h("b", { text: t.districtName || "" }), h("small", { text: "район" }))),
      h("div", { class: "tour-body" },
        pitch, t.pitch && t.pitch.length > 170 && more,
        medals.length ? h("div", { class: "tour-medals" }, h("small", { class: "cap", text: "Медали этого тура" }), h("div", { class: "row" }, medals.map(m => h("div", { class: "tm" }, h("div", { class: "art", html: M.medalFor(m) }), h("small", { text: M.LEVEL_RU[m.level] || "" }))))) : null,
        trophyHintOf(t) && h("p", { class: "trophy-note" }, h("b", { text: "🏆 Платина за трофей: " }), trophyHintOf(t) + ". Трофей проверяет модерация по фото, вес должен быть достойным для этого вида."),
        months.length ? h("div", { class: "season" }, h("small", { class: "cap", text: "Лучшее время" }), h("div", null, months.map(m => h("span", { class: "pro-chip " + m[0], text: m[1] })))) : null,
        days,
        !full && h("div", { class: "tour-lock" }, icon("lock"), "Места, маршрут по дням и отметки — в Pro"),
        h("div", { class: "tour-actions" },
          h("button", { class: "btn big " + (full ? "primary" : "gold"), type: "button", onclick: open, text: full ? (act ? "Открыть идущий тур" : "Открыть тур") : "Открыть с Pro" }))));
  }

  /* ---------------- экран: туры ---------------- */
  VIEWS.tours = function () {
    const nodes = [statusBlock()];
    const act = activeTour();
    if (act) {
      const done = Object.keys(act.a.days || {}).length;
      nodes.push(h("div", { class: "pro-status on" }, h("span", { text: "▶" }), h("div", null, h("b", { text: "Идёт тур: " + act.t.title }), "Старт " + fmtDay(act.a.startDate) + ". Засчитано дней: " + done + " из " + act.t.days + "."),
        h("button", { class: "btn", type: "button", onclick: () => push("tour", { id: act.t.id }), text: "Открыть" })));
    }
    const list = tourListSource();
    if (!list.length) nodes.push(h("div", { class: "empty", text: S.loading.tours ? "Загружаем туры…" : "Туры не загрузились. Закройте и откройте раздел снова." }));
    nodes.push(...list.map(tourCard));
    if (S.errors.tours && S.pro) nodes.push(h("p", { class: "pro-note", text: "Полные туры не загрузились (" + errText({ code: S.errors.tours }) + ")." }, h("button", { class: "btn", type: "button", onclick: () => loadTours(true), text: "Повторить" })));
    nodes.push(h("p", { class: "pro-note", text: "Туры — маршруты-подсказки по открытым данным, не проводник и не гарантия улова. Места не проверены на месте, правила и запреты проверяйте в разделе «Запреты». Ловля за пределами правил — на вашей ответственности." }));
    if (!S.teaser && !S.loading.tours) loadTours();
    return { title: "Туры по рыбе", label: "PRO · ТУРЫ", nodes };
  };

  /* ---------------- экран: тур целиком ---------------- */
  function monthsList(arr) { return (arr || []).join(", "); }
  function stageBlock(t, st) {
    const act = S.progress && S.progress.active && S.progress.active.tourId === t.id ? S.progress.active : null;
    const done = act && act.days && act.days[st.day];
    const sat = "https://yandex.ru/maps/?ll=" + st.lng + "%2C" + st.lat + "&z=16&l=sat&pt=" + st.lng + "," + st.lat + ",pm2rdm";
    const body = h("div", { class: "stage-body" });
    if (!(st.plan || []).length) body.append(h("p", { text: st.drive && st.drive.text }));
    if ((st.plan || []).length) body.append(h("h4", { text: "План дня" }), h("ul", null, st.plan.map(x => h("li", { text: x }))));
    if ((st.methods || []).length) body.append(h("h4", { text: "Как ловить" }), h("ul", null, st.methods.map(x => h("li", { text: x }))));
    if (st.fishHere) body.append(chips(["Рыба тура здесь: " + fishName(st.fishHere.target) + ", " + ({ often: "ловится часто", sometimes: "ловится иногда", rare: "ловится редко" }[st.fishHere.freq] || "") + " (по типу воды, на самой точке не проверялось)"], "green"));
    if (st.fishHere) { const fg = fishPhotos(st.fishHere.target); if (fg) body.append(fg); }
    const plants = speciesFor(st, "plants"), animals = speciesFor(st, "animals");
    if (plants.length) body.append(h("h4", { text: "Растения" }), ...plants.map(x => speciesRow(x, "plant")));
    if (animals.length) body.append(h("h4", { text: "Кого можно увидеть" }), ...animals.map(x => speciesRow(x, "animal")));
    if (plants.length || animals.length) body.append(h("p", { class: "pro-note", text: "Виды подобраны по справочникам для этого района. Они обитают рядом, но встретить их именно здесь не гарантировано. Фото с Wikimedia Commons и iNaturalist (лицензии CC), подписи под снимками." }));
    const safety = typeof safetyNode === "function" ? safetyNode(animals) : null;
    if (safety) body.append(safety);
    const sc = st.sky ? skyCard({ sky: st.sky }) : null;
    if (sc) body.append(sc);
    if ((st.nearbyFree || []).length) body.append(h("h4", { text: "Рядом по пути (свободные места атласа)" }), h("ul", null, st.nearbyFree.map(n => h("li", { text: n.title + ", " + n.km + " км" }))));
    if ((st.warnings || []).length) body.append(h("h4", { text: "Предупреждения" }), h("ul", null, st.warnings.map(x => h("li", { text: x }))));
    body.append(h("p", { class: "pro-note", text: "Координаты: " + st.lat.toFixed(5) + ", " + st.lng.toFixed(5) + ". Радиус ловли " + st.radiusM + " м от точки. " + (st.road || "") + "." }));
    const row = h("div", { class: "tour-actions" },
      h("button", { class: "btn primary", type: "button", text: "Маршрут сюда", onclick: () => { closeAll(); setDestination({ lat: st.lat, lng: st.lng, name: st.spotName }); } }),
      h("button", { class: "btn", type: "button", text: "На карте", onclick: () => { closeAll(); map.flyTo([st.lat, st.lng], 13); } }),
      h("button", { class: "btn", type: "button", text: "Спутник ↗", onclick: () => openExternal(sat) }),
      h("button", { class: "btn", type: "button", text: "Скопировать координаты", onclick: () => copyText(st.lat.toFixed(5) + ", " + st.lng.toFixed(5)).then(ok => toast(ok ? "Координаты скопированы" : st.lat.toFixed(5) + ", " + st.lng.toFixed(5), 4000)) }));
    body.append(row);
    if (act) {
      if (done) body.append(h("p", { class: "pro-note", text: "✓ День засчитан " + fmtDay(done.date) + (done.via === "report" ? " (по отчёту)" : " (вы были на месте)") + "." }));
      else {
        const b = h("button", { class: "btn gold", type: "button", text: "Я на месте: отметить день" });
        b.addEventListener("click", () => checkin(t, st, b));
        body.append(h("div", { class: "tour-actions" }, b), h("p", { class: "pro-note", text: "Нужно быть в радиусе " + ((st.checkin && st.checkin.radiusM) || st.radiusM) + " м от точки. Сервер хранит только отметку дня, координаты не сохраняются." }));
      }
    }
    return h("details", { class: "stage" }, h("summary", null, h("span", { class: "day", text: st.day }), h("span", { class: "st", text: stripDay(st.title) }), h("span", { class: "ck", text: done ? "✅" : "" })), body);
  }
  /* Для отметки нужна свежая точка, а не из кэша на 5 минут */
  function freshPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject({ code: 0 });
      navigator.geolocation.getCurrentPosition(p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }), reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
    });
  }
  async function checkin(t, st, btn) {
    btn.disabled = true; const old = btn.textContent; btn.textContent = "Определяем положение…";
    let p = null;
    try { p = await tgLocationOnce(); } catch (_) {}
    if (!p) { try { p = await freshPosition(); } catch (e) { if (e && e.code === 1) { toast("Доступ к геопозиции запрещён. Разрешите его в настройках Telegram или телефона.", 6000); btn.disabled = false; btn.textContent = old; return; } } }
    if (!p) { try { p = await getPosition(); } catch (_) {} }
    if (!p) { toast("Не удалось определить положение. Выйдите на открытое место и повторите.", 5000); btn.disabled = false; btn.textContent = old; return; }
    try {
      const r = await api("/api/checkin", { body: { day: st.day, lat: p.lat, lng: p.lng, acc: p.acc } });
      applyProgress(r.progress); toast("День " + st.day + " засчитан. Так держать!", 4500);
    } catch (e) {
      if (e.code === "too_far" && e.data) toast("До точки " + StepNav.fmtKm(e.data.distM) + ", нужно в пределах " + e.data.needM + " м.", 6000);
      else toast(errText(e), 5000);
    }
    rerender();
  }
  function startBlock(t) {
    const p = S.progress;
    const act = p && p.active;
    if (act && act.tourId === t.id) return activeBlock(t, act);
    if (act) return h("div", { class: "pro-status" }, h("span", { text: "ℹ" }), h("div", null, h("b", { text: "Уже идёт другой тур" }), "Завершите или отмените его, чтобы начать этот."));
    const sug = ((t.sky && t.sky.startSuggestions) || []).find(s => s.start >= todayAst());
    const dateIn = h("input", { type: "date", min: todayAst(), value: sug ? sug.start : todayAst(), id: "tourStart" });
    const moon = h("p", { class: "pro-note" });
    const refresh = () => { const v = dateIn.value; moon.textContent = v ? "Луна в день старта: " + moonText(v) + " " + milkyText(v) : ""; };
    dateIn.addEventListener("input", refresh); refresh();
    const sugs = ((t.sky && t.sky.startSuggestions) || []).filter(s => s.start >= todayAst());
    const cb = h("input", { type: "checkbox", id: "consentBox" });
    const go = h("button", { class: "btn gold big", type: "button", text: "Начать тур", disabled: true });
    cb.addEventListener("change", () => { go.disabled = !cb.checked; });
    go.addEventListener("click", async () => {
      if (!cb.checked) return toast("Отметьте согласие, чтобы начать.");
      if (!dateIn.value || dateIn.value < todayAst()) return toast(ERR.bad_date);
      go.disabled = true; go.textContent = "Запускаем…";
      try {
        const r = await api("/api/tour/start", { body: { tourId: t.id, startDate: dateIn.value, consent: t.consent.text } });
        applyProgress(r); toast("Тур начат. Удачи!", 4000);
      } catch (e) { toast(errText(e), 6000); go.disabled = false; go.textContent = "Начать тур"; return; }
      rerender();
    });
    return h("div", { id: "startBlock" },
      h("h2", { class: "section-h", text: "Начать тур" }),
      h("label", { class: "field" }, "Дата старта (дни считаются по календарю Астрахани)", dateIn),
      sugs.length ? h("div", null, h("p", { class: "pro-note", text: "Подходящие даты по луне (новолуние — тёмное небо, лучше видно Млечный Путь):" }),
        sugs.map(s => h("button", { class: "btn", type: "button", style: "margin:0 6px 6px 0", text: fmtDay(s.start) + " — " + fmtDay(s.end), onclick: () => { dateIn.value = s.start; refresh(); } }))) : null,
      moon,
      h("div", { class: "consent-box" }, h("label", null, cb, h("span", { text: t.consent && t.consent.text }))),
      h("div", { class: "tour-actions" }, go),
      h("p", { class: "pro-note", text: "Условия и возврат оплаты: команды /terms и /paysupport у бота @AtlasFishingbot." }));
  }
  function activeBlock(t, act) {
    const done = Object.keys(act.days || {}).length;
    const need = { bronze: Math.ceil(t.days * .5), silver: Math.ceil(t.days * .75), gold: t.days };
    const finish = h("button", { class: "btn primary", type: "button", text: "Завершить тур и получить медаль" });
    let armed = false;
    finish.addEventListener("click", async () => {
      if (!armed) { armed = true; finish.textContent = "Точно завершить? Нажмите ещё раз"; setTimeout(() => { armed = false; finish.textContent = "Завершить тур и получить медаль"; }, 4000); return; }
      finish.disabled = true;
      try {
        const r = await api("/api/tour/finish", { method: "POST", body: {} });
        applyProgress(r.progress);
        if (r.medal) { S.fresh.add(r.medal.id); replaceTop("medal", { id: r.medal.id, reveal: true }); return; }
        toast(r.note || "Тур завершён. Медаль начисляется от половины засчитанных дней.", 6000);
      } catch (e) { toast(errText(e), 5000); }
      rerender();
    });
    const cancel = h("button", { class: "btn ghost", type: "button", text: "Отменить тур" });
    let armed2 = false;
    cancel.addEventListener("click", async () => {
      if (!armed2) { armed2 = true; cancel.textContent = "Точно отменить? Нажмите ещё раз"; setTimeout(() => { armed2 = false; cancel.textContent = "Отменить тур"; }, 4000); return; }
      try { const r = await api("/api/tour/cancel", { method: "POST", body: {} }); applyProgress(r); toast("Тур отменён."); } catch (e) { toast(errText(e)); }
      rerender();
    });
    return h("div", null,
      h("h2", { class: "section-h", text: "Ваш тур идёт" }),
      h("div", { class: "pro-status on" }, h("span", { text: "▶" }), h("div", null, h("b", { text: "Старт " + fmtDay(act.startDate) }), "Засчитано дней: " + done + " из " + t.days + ". Отчётов: " + (act.reports || 0) + ".")),
      h("div", { class: "prog" }, h("i", { style: "width:" + Math.round(done / t.days * 100) + "%" })),
      h("p", { class: "pro-note", text: "Бронза — от " + need.bronze + " дн., серебро — от " + need.silver + " дн., золото — все " + need.gold + " и хотя бы один отчёт. День засчитывается, когда вы в радиусе точки (кнопка «Я на месте» в дне) или Петрович принял отчёт с фото." }),
      h("div", { class: "tour-actions" },
        h("button", { class: "btn gold", type: "button", text: "Отчёт о поимке", onclick: () => push("report", { tourId: t.id }) }), finish, cancel));
  }
  VIEWS.tour = function (a) {
    const t = (S.tours || []).find(x => x.id === a.id);
    if (!t) return { title: "Тур", label: "PRO · ТУР", nodes: [h("div", { class: "empty", text: "Тур не найден. Вернитесь назад." })] };
    const sr = t.season || {}, rt = t.route || {}, wx = t.weather || {}, sk = t.sky || {}, lg = t.legal || {};
    const nodes = [];
    nodes.push(h("div", { class: "tour-top" }, fishIcon((t.target || [])[0]), h("div", null, h("p", { class: "sub", text: t.subtitle }), chips([t.days + " " + plural(t.days, "день", "дня", "дней"), "сложность " + (t.difficulty ? t.difficulty.score + "/" + t.difficulty.of + ", " + t.level : t.level), t.format]))));
    nodes.push(h("p", { text: t.pitch }));
    nodes.push(h("div", { class: "tour-actions" }, h("button", { class: "btn gold", type: "button", text: "К началу тура ↓", onclick: () => { const b = $$("startBlock") || document.querySelector(".pro-status.on"); if (b) b.scrollIntoView({ behavior: "smooth", block: "start" }); } })));
    nodes.push(h("h2", { class: "section-h", text: "Сезон" }), h("p", { text: "Лучшие месяцы: " + monthsList(sr.peakNames) + (sr.goodNames && sr.goodNames.length ? ". Хорошо: " + monthsList(sr.goodNames) : "") + ". " + (sr.note || "") }), sr.ban && h("p", { class: "pro-note", text: sr.ban }));
    nodes.push(h("h2", { class: "section-h", text: "Дорога" }), h("p", { text: "Всего по маршруту около " + rt.totalKm + " км, в пути около " + fmtMin(rt.totalDriveMin) + " с запасом на остановки. Места: " + (rt.places || []).join(" → ") + "." }), rt.basis && h("p", { class: "pro-note", text: rt.basis }));
    nodes.push(h("h2", { class: "section-h", text: "Дни тура" }), ...(t.stages || []).map(st => stageBlock(t, st)));
    nodes.push(h("h2", { class: "section-h", text: "Снасти" }), h("ul", { class: "perks" }, (t.gear || []).map(x => h("li", { text: x }))));
    nodes.push(h("h2", { class: "section-h", text: "Правила" }), h("p", { text: "Минимальный размер: " + (lg.minSize || "смотрите правила") + ". Норма: " + (lg.norm || "смотрите правила") + "." }), lg.note && h("p", { class: "pro-note", text: lg.note }),
      h("div", { class: "tour-actions" }, h("button", { class: "btn", type: "button", text: "Календарь запретов", onclick: () => { closeAll(); openBans(); } })));
    if ((wx.months || []).length) {
      nodes.push(h("h2", { class: "section-h", text: "Погода (климатическая норма)" }),
        h("table", { class: "wx-table" }, h("thead", null, h("tr", null, ["Месяц", "Ночь", "День", "Осадки", "Ветер"].map(x => h("th", { text: x })))),
          h("tbody", null, wx.months.map(m => h("tr", null, h("td", { text: m.name }), h("td", { text: m.tMin + "°" }), h("td", { text: m.tMax + "°" }), h("td", { text: m.rainMm + " мм, " + m.rainDays + " дн." }), h("td", { text: m.windKph + " км/ч" }))))),
        h("ul", { class: "perks" }, (wx.advice || []).map(x => h("li", { text: x }))),
        wx.source && h("p", { class: "pro-note" }, "Источник: ", h("a", { href: wx.source.url, target: "_blank", rel: "noopener noreferrer", text: wx.source.title })));
    }
    nodes.push(h("h2", { class: "section-h", text: "Луна и Млечный Путь" }), h("p", { text: sk.moonAndFish }), h("p", { text: sk.milkyWay }), sk.note && h("p", { class: "pro-note", text: sk.note }), skyCard({ moon: true }));
    nodes.push(h("h2", { class: "section-h", text: "Безопасность" }), h("ul", { class: "perks" }, (t.safety || []).map(x => h("li", { text: x }))));
    nodes.push(h("h2", { class: "section-h", text: "Ночлег" }), h("p", { text: t.lodging }));
    nodes.push(h("h2", { class: "section-h", text: "Награды за этот тур" }), h("ul", { class: "perks" }, [
      "Бронза: " + (t.medals && t.medals.tourLevels && t.medals.tourLevels.bronze),
      "Серебро: " + (t.medals && t.medals.tourLevels && t.medals.tourLevels.silver),
      "Золото: " + (t.medals && t.medals.tourLevels && t.medals.tourLevels.gold),
      (t.medals && t.medals.platinum && t.medals.platinum.trophyRule) || ("Платина за вид рыбы: проверенный трофей" + (trophyHintOf(t) ? " (" + trophyHintOf(t) + ")" : "") + ". Решение принимает модерация по фото.")
    ].map(x => h("li", { text: x }))));
    nodes.push(startBlock(t));
    return { title: t.title, label: "ТУР · " + t.days + " " + plural(t.days, "ДЕНЬ", "ДНЯ", "ДНЕЙ"), nodes };
  };

  /* ---------------- отчёт о поимке ---------------- */
  async function shrinkPhoto(file, maxSide, q) {
    let bmp = null;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) {}
    if (!bmp) {
      bmp = await new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(file); });
    }
    const w = bmp.width || bmp.naturalWidth, hh = bmp.height || bmp.naturalHeight;
    const k = Math.min(1, maxSide / Math.max(w, hh));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(hh * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(b => res(b), "image/jpeg", q));
  }
  VIEWS.report = function (a) {
    const t = (S.tours || []).find(x => x.id === a.tourId);
    const rep = (t && t.report) || { fields: [] };
    const targets = (t && t.target) || [];
    const allFish = typeof fishById !== "undefined" ? [...fishById.values()] : [];
    const fishSel = h("select", { id: "rpFish" }, [...targets.map(id => fishName(id)).map((n, i) => h("option", { value: targets[i], text: n })), ...allFish.filter(f => !targets.includes(f.id)).map(f => h("option", { value: f.id, text: f.name }))]);
    const placeSel = h("select", { id: "rpPlace" }, h("option", { value: "0", text: "Другое место (напишу в комментарии)" }), ...((t && t.stages) || []).map(s => h("option", { value: String(s.day), text: "День " + s.day + ": " + s.spotName })));
    const act = S.progress && S.progress.active;
    const d = act && act.tourId === (t && t.id) ? Math.min(t.days, Math.max(1, Math.floor((Date.parse(todayAst()) - Date.parse(act.startDate)) / 86400000) + 1)) : 0;
    if (d) placeSel.value = String(d);
    const len = h("input", { id: "rpLen", type: "text", inputmode: "decimal", maxlength: "6", autocomplete: "off", placeholder: "например 78" });
    const wt = h("input", { id: "rpWt", type: "text", inputmode: "decimal", maxlength: "6", autocomplete: "off", placeholder: "например 7,2" });
    const bait = h("input", { id: "rpBait", type: "text", maxlength: "120", placeholder: "воблер, джиг 18 г, кукуруза…" });
    const note = h("textarea", { id: "rpNote", maxlength: "400", placeholder: "Где именно, что заметили, погода…" });
    const rel = h("input", { type: "checkbox", id: "rpRel" });
    const trophy = h("input", { type: "checkbox", id: "rpTrophy" });
    const photo = h("input", { type: "file", id: "rpPhoto", accept: "image/*" });
    const warn = h("p", { class: "trophy-warn", hidden: "" });
    /* Предупреждение, если вес ниже ориентира: отправить можно, но платину, скорее всего, не дадут */
    const checkWeight = () => {
      const w = parseFloat(String(wt.value).replace(",", "."));
      const fishT = (S.tours || []).find(x => (x.target || []).includes(fishSel.value)) || t;
      const min = trophyMinOf(fishT);
      const low = trophy.checked && min && w > 0 && w < min;
      warn.hidden = !low;
      warn.textContent = low ? "Вес " + String(w).replace(".", ",") + " кг ниже ориентира (от " + min + " кг). Модерация проверяет каждый трофей по фото, и такой, скорее всего, не засчитает. Если рыба поменьше, снимите галочку «Это трофей»: отчёт всё равно засчитает день тура." : "";
    };
    [wt, trophy, fishSel].forEach(el => el.addEventListener(el === wt ? "input" : "change", checkWeight));
    const prev = h("div", { class: "empty", style: "padding:6px" });
    photo.addEventListener("change", () => { prev.textContent = photo.files[0] ? "Фото выбрано: " + photo.files[0].name : ""; });
    const send = h("button", { class: "btn gold big", type: "button", text: "Отправить отчёт" });
    send.addEventListener("click", async () => {
      const lengthCm = parseFloat(String(len.value).replace(",", ".")), weightKg = parseFloat(String(wt.value).replace(",", "."));
      if (!(lengthCm > 0) && !(weightKg > 0)) return toast("Укажите вес или длину рыбы.");
      if (trophy.checked && !photo.files[0]) return toast("Для трофея нужно фото: рыба целиком с рулеткой или на весах.", 5000);
      if (trophy.checked && !(weightKg > 0)) return toast("Для трофея укажите вес.");
      send.disabled = true; send.textContent = "Отправляем…";
      try {
        const fd = new FormData();
        fd.append("tourId", (t && t.id) || ""); fd.append("day", placeSel.value); fd.append("fish", fishSel.value);
        if (lengthCm > 0) fd.append("lengthCm", String(lengthCm)); if (weightKg > 0) fd.append("weightKg", String(weightKg));
        fd.append("bait", bait.value.trim()); fd.append("note", note.value.trim());
        fd.append("released", rel.checked ? "1" : "0"); fd.append("trophy", trophy.checked ? "1" : "0");
        if (photo.files[0]) { const blob = await shrinkPhoto(photo.files[0], 1280, 0.82); fd.append("photo", blob, "catch.jpg"); }
        const rr = await api("/api/report", { body: fd, timeout: 40000 });
        toast(rr && rr.belowGuide ? "Отчёт отправлен. Вес ниже ориентира, модерация решит по фото, ответ придёт в чат с ботом." : "Отчёт отправлен. Если это трофей, модерация проверит фото, ответ придёт в чат с ботом.", 7000);
        loadProgress(); back(); return;
      } catch (e) { toast(errText(e), 6000); }
      send.disabled = false; send.textContent = "Отправить отчёт";
    });
    return {
      title: "Отчёт о поимке", label: "ТУР · ОТЧЁТ", nodes: [
        h("div", { class: "bubble", text: "Ну, показывай улов. Скажи, какая рыба, сколько весит, на что взял. Если трофей — фото целиком с рулеткой или на весах, чтобы всё было видно." }),
        h("label", { class: "field" }, "Рыба", fishSel),
        h("div", { class: "field-row" }, h("label", { class: "field" }, "Длина, см", len), h("label", { class: "field" }, "Вес, кг", wt)),
        h("label", { class: "field" }, "Приманка или насадка", bait),
        h("label", { class: "field" }, "Где (этап тура)", placeSel),
        h("label", { class: "field" }, "Комментарий", note),
        h("label", { class: "field" }, "Фото (рыба целиком, видна рулетка или весы)", photo), prev,
        h("div", { class: "consent-box" }, h("label", null, rel, h("span", { text: "Рыба отпущена" }))),
        h("div", { class: "consent-box" }, h("label", null, trophy, h("span", { text: "Это трофей: прошу платиновую медаль" + (trophyHintOf(t) ? " (приличный вес: " + trophyHintOf(t) + ")" : "") + ". Модерация проверяет фото и вес и решает по ним." }))),
        warn,
        h("div", { class: "tour-actions" }, send),
        h("p", { class: "pro-note", text: (rep.photoRule || "") + " Отчёт, принятый с фото, засчитывает день тура. Отправляя, вы разрешаете показать фото модерации атласа; на медали публикуются только рыба, вес, приманка и место." })
      ]
    };
  };

  /* ---------------- награды ---------------- */
  function tile(m, state, sub, onclick, fresh) {
    const art = M.medalFor(m);
    return h("button", { class: "medal-tile " + (state || "") + (fresh ? " fresh" : ""), type: "button", onclick },
      h("div", { class: "art", html: art }), h("b", { text: M.title(m) }), sub && h("small", { text: sub }));
  }
  function refBlock() {
    const refs = (S.progress && S.progress.refs) || { joined: 0, paid: 0 };
    const link = (CFG.BOT_LINK || APP_LINK) + "?startapp=ref_" + (S.me ? S.me.id : "");
    const n = refs.paid;
    const next = n < 1 ? 1 : n < 3 ? 3 : n < 5 ? 5 : n < 20 ? 20 : null;
    const level = n >= 5 ? "золото" : n >= 3 ? "серебро" : n >= 1 ? "бронза" : "пока нет";
    const share = () => {
      const url = "https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent("СТЕПЬ — атлас Астраханского края: места, рыба, туры по дельте Волги. Заходи:");
      const t = tg(); try { if (t && t.openTelegramLink) return t.openTelegramLink(url); } catch (_) {}
      copyText(link).then(ok => toast(ok ? "Ссылка скопирована" : link, 4000));
    };
    return h("div", null,
      h("h2", { class: "section-h", text: "Друзья и медали" }),
      h("div", { class: "ref-box" },
        h("div", { text: "Пригласили: " + refs.joined + ". Купили Pro: " + n + ". Медаль друзей: " + level + "." }),
        next ? h("div", null, h("div", { class: "prog" }, h("i", { style: "width:" + Math.min(100, Math.round(n / next * 100)) + "%" })), h("small", { text: "До следующей награды: ещё " + (next - n) + " " + plural(next - n, "друг", "друга", "друзей") + " с Pro" })) : h("small", { text: "Это высший уровень. «Глас народа» даётся за 20 друзей с Pro и платиновую медаль." }),
        h("span", { class: "ref-link", text: link }),
        h("div", { class: "tour-actions" }, h("button", { class: "btn primary", type: "button", text: "Отправить другу", onclick: share }), h("button", { class: "btn", type: "button", text: "Скопировать ссылку", onclick: () => copyText(link).then(ok => toast(ok ? "Ссылка скопирована" : link, 4000)) })),
        h("small", { text: "Бронза: 1–2 друга купили Pro, серебро: 3–4, золото: 5, «Глас народа»: 20 друзей с Pro и платиновая медаль. Считаются только оплаченные подписки." })));
  }
  /* Какая медаль каталога уже получена. Для туров: высшая ступень закрывает и нижние. */
  const RANK = { bronze: 1, silver: 2, gold: 3, platinum: 4, voice: 5 };
  function earnedFor(item, medals) {
    const k = item.medal;
    if (k.kind === "tour") {
      const mine = medals.filter(x => x.kind === "tour" && x.tourId === k.tourId).sort((x, y) => (RANK[y.level] || 0) - (RANK[x.level] || 0) || (y.ts || 0) - (x.ts || 0));
      const top = mine[0];
      if (!top || (RANK[top.level] || 0) < RANK[k.level]) return null;
      return { medal: top, exact: top.level === k.level };
    }
    const id = k.kind === "platinum" ? "plat-" + k.fish : k.kind === "ref" ? "ref-" + k.level : k.kind === "voice" ? "voice" : "badge-" + k.badge + "-" + k.level;
    const m = medals.find(x => x.id === id);
    return m ? { medal: m, exact: true } : null;
  }
  function awardsHero(total) {
    return h("div", { class: "pro-hero compact" }, h("div", { class: "hero-bg", html: HERO_ART }),
      h("div", { class: "hero-in" },
        h("span", { class: "hero-kicker", text: "СТЕПЬ · НАГРАДЫ" }),
        h("h2", { text: "Соберите все " + total + " медалей" }),
        h("p", { text: "Бронза, серебро и золото за туры, платина за трофей, награды за друзей и за особые дни у воды." }),
        medalStrip(showcaseMedals(), "on-dark")));
  }
  VIEWS.awards = function () {
    const guest = !S.pro;
    const p = (!guest && S.progress) || { medals: [], platinum: {}, reports: [] };
    const medals = p.medals || [];
    const tours = tourListSource();
    const secs = M.catalog(tours);
    const total = secs.reduce((n, sec) => n + sec.items.length, 0);
    let have = 0;
    const tileFor = item => {
      const e = guest ? null : earnedFor(item, medals);
      if (e) {
        have++;
        const m = e.medal;
        const sub = !e.exact ? "ступень пройдена" : m.kind === "platinum" ? (m.weightKg ? String(m.weightKg).replace(".", ",") + " кг" : (m.when || "")) : (m.when || "").split(" — ")[0];
        return tile(e.exact ? m : item.medal, "", sub, () => push("medal", { id: m.id }), e.exact && S.fresh.has(m.id));
      }
      const k = item.medal;
      if (!guest && k.kind === "platinum" && (p.platinum || {})[k.fish] === "pending") return tile(k, "pending", "Фото на модерации, ждём решения", () => toast("Модерация проверяет фото. Ответ придёт в чат с ботом."));
      const sub = k.kind === "platinum" ? "Нужен трофей" : k.kind === "voice" ? "Главная награда" : (M.LEVEL_RU[k.level] || "");
      return tile(k, guest ? "locked preview" : "locked", sub, () => {
        if (guest) return push("offer", { reason: "awards" });
        if (k.kind === "platinum") { const t = (S.tours || []).find(x => (x.target || []).includes(k.fish)); if (t) return push("report", { tourId: t.id }); }
        toast("Как получить: " + item.how + ".", 7000);
      });
    };
    const body = [];
    secs.forEach(sec => {
      body.push(h("h2", { class: "section-h", text: sec.title }));
      if (sec.id === "tours") {
        const ids = [...new Set(sec.items.map(i => i.tourId))];
        if (!ids.length) body.push(h("div", { class: "empty", text: "Туры загружаются…" }));
        ids.forEach(id => {
          const t = tours.find(x => x.id === id) || {};
          body.push(h("div", { class: "medal-tour-h" }, h("b", { text: t.title || "" }), h("small", { text: [(t.targetNames || [])[0], t.days ? t.days + " " + plural(t.days, "день", "дня", "дней") : ""].filter(Boolean).join(" · ") })));
          body.push(h("div", { class: "medal-grid" }, sec.items.filter(i => i.tourId === id).map(tileFor)));
        });
      } else body.push(h("div", { class: "medal-grid" }, sec.items.map(tileFor)));
    });
    const nodes = [];
    if (guest) {
      nodes.push(S.status === "ok" ? awardsHero(total) : statusBlock());
      nodes.push(h("p", { class: "awards-lead", text: "Каждая медаль со своим именем и карточкой: рыба, место и вес, которой можно поделиться. Нажмите на любую, чтобы увидеть, как её получить." }));
      nodes.push(...body);
      if (S.status === "ok") nodes.push(h("div", { class: "pay-bar" }, h("button", { class: "btn gold big", type: "button", text: "Открыть награды с Pro", onclick: () => push("offer", { reason: "awards" }) })));
      return { title: "Награды", label: "PRO · НАГРАДЫ", nodes };
    }
    const act = activeTour();
    if (act) nodes.push(h("div", { class: "pro-status on" }, h("span", { text: "▶" }), h("div", null, h("b", { text: "Идёт тур: " + act.t.title }), "Засчитано: " + Object.keys(act.a.days || {}).length + " из " + act.t.days), h("button", { class: "btn", type: "button", onclick: () => push("tour", { id: act.t.id }), text: "Открыть" })));
    const headNode = h("div", { class: "coll-head" }, h("div", { class: "coll-num" }, h("b", { text: String(have) }), h("span", { text: "из " + total }), h("em", { text: "медалей собрано" })), h("div", { class: "prog" }, h("i", { style: "width:" + Math.round(have / Math.max(1, total) * 100) + "%" })), h("small", { text: have ? "Нажмите на медаль, чтобы посмотреть и поделиться. Серые ещё впереди: нажмите, и увидите, как их получить." : "Нажмите на серую медаль, и увидите, как её получить." }));
    nodes.push(headNode);
    if (!medals.length) nodes.push(h("div", { class: "empty", text: "Пока ни одной медали. Начните тур: бронза — после половины засчитанных дней, золото — за все дни и отчёт." }));
    nodes.push(...body);
    const pend = (p.reports || []).filter(r => r.status === "pending").length;
    if (pend) nodes.push(h("p", { class: "pro-note", text: "Отчётов на проверке: " + pend + "." }));
    nodes.push(refBlock());
    return { title: "Награды", label: "PRO · НАГРАДЫ", nodes };
  };

  /* ---------------- одна медаль ---------------- */
  /* Карточка рисуется в приложении: SVG → canvas → картинка. JPEG уходит в Telegram, PNG нужен только запасному пути. */
  async function cardImage(m, mime, quality) {
    const who = S.me && S.me.firstName ? S.me.firstName : "";
    const svg = M.cardSVG(m, who);
    const img = new Image();
    img.decoding = "async";
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
    const c = document.createElement("canvas");
    c.width = 1080; c.height = 1350;
    const g = c.getContext("2d");
    g.fillStyle = "#0b1f1b"; g.fillRect(0, 0, 1080, 1350);          // у JPEG нет прозрачности
    g.drawImage(img, 0, 0, 1080, 1350);
    return new Promise(res => c.toBlob(b => res(b), mime, quality));
  }
  const medalCaption = m => [M.title(m) + " — СТЕПЬ, атлас Астраханского края."].concat(M.lines(m).filter(r => !(m.kind === "tour" && r[0] === "Тур")).map(r => r[0] + ": " + r[1])).join("\n");
  /* Основной путь: сервер готовит сообщение «картинка + подпись + кнопка», Telegram даёт выбрать чат и отправляет само.
     true — дело сделано или человек передумал; false — этот путь недоступен, нужен запасной. */
  async function shareMedalNative(m, caption) {
    const t = tg();
    if (!S.pro || !initData() || !t || typeof t.shareMessage !== "function") return false;
    try { if (typeof t.isVersionAtLeast === "function" && !t.isVersionAtLeast("8.0")) return false; } catch (_) {}
    let id = "";
    try {
      toast("Готовлю картинку…", 8000);
      const jpg = await cardImage(m, "image/jpeg", 0.88);
      if (!jpg) return false;
      const fd = new FormData();
      fd.append("photo", jpg, "medal.jpg");
      fd.append("caption", caption);
      const d = await api("/api/share/prepare", { method: "POST", body: fd, timeout: 30000 });
      id = (d && d.id) || "";
    } catch (e) {
      if (e && e.code === "rate_limited") { toast(errText(e), 4000); return true; }
      if (e && e.code === "share_unavailable") toast("Картинкой не вышло" + (e.data && e.data.detail ? " (" + e.data.detail + ")" : "") + ". Отправляю ссылкой.", 7000);
      return false;
    }
    if (!id) return false;
    const onFail = ev => { const er = String((ev && ev.error) || ""); if (er && er !== "USER_DECLINED") toast("Telegram не смог отправить картинку (" + er + ").", 5000); };
    try { t.onEvent && t.onEvent("shareMessageFailed", onFail); } catch (_) {}
    const sent = await new Promise(res => {
      let done = false;
      const fin = v => { if (!done) { done = true; res(v); } };
      try { t.shareMessage(id, fin); } catch (_) { fin(null); }
      setTimeout(() => fin(false), 600000);
    });
    try { t.offEvent && t.offEvent("shareMessageFailed", onFail); } catch (_) {}
    if (sent === true) toast("Отправлено", 2500);
    return sent !== null;
  }
  async function shareMedal(m) {
    if (S.sharing) return;
    S.sharing = true;
    try {
      const link = (CFG.BOT_LINK || APP_LINK) + (S.me ? "?startapp=ref_" + S.me.id : "");
      const caption = medalCaption(m);
      if (await shareMedalNative(m, caption)) return;
      /* запасной путь 1: системное меню «Поделиться» с файлом (если телефон его умеет) */
      try {
        const png = await cardImage(m, "image/png");
        const file = png && new File([png], "step-medal.png", { type: "image/png" });
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: caption + "\n" + link }); return; }
      } catch (e) { if (e && e.name === "AbortError") return; }
      /* запасной путь 2: обычная отправка текста со ссылкой */
      const url = "https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent(caption);
      const t = tg();
      try { if (t && t.openTelegramLink) return t.openTelegramLink(url); } catch (_) {}
      copyText(link).then(ok => toast(ok ? "Ссылка скопирована" : link, 4000));
    } finally { S.sharing = false; }
  }
  VIEWS.medal = function (a) {
    const m = ((S.progress && S.progress.medals) || []).find(x => x.id === a.id);
    if (!m) return { title: "Медаль", label: "НАГРАДА", nodes: [h("div", { class: "empty", text: "Медаль не найдена." })] };
    const reveal = a.reveal || S.fresh.has(m.id);
    const dust = h("div", { class: "sparkles" });
    if (reveal) for (let i = 0; i < 14; i++) { const ang = i / 14 * Math.PI * 2, r = 120 + (i % 3) * 30; dust.append(h("i", { style: "left:50%;top:45%;--dx:" + Math.round(Math.cos(ang) * r) + "px;--dy:" + Math.round(Math.sin(ang) * r) + "px;animation-delay:" + (0.5 + (i % 4) * 0.08) + "s" })); }
    const rows = M.lines(m);
    return {
      title: M.title(m), label: "НАГРАДА · " + (M.LEVEL_RU[m.level] || "").toUpperCase(), nodes: [
        h("div", { class: "medal-big" + (reveal ? " reveal" : ""), html: M.medalFor(m) }, dust),
        h("p", { class: "medal-sub", text: M.subtitle(m) }),
        M.verse(m) && h("p", { class: "medal-verse", text: M.verse(m) }),
        h("div", { class: "medal-cap" }, rows.map(r => h("div", null, h("b", { text: r[0] + ": " }), r[1]))),
        h("div", { class: "tour-actions" },
          h("button", { class: "btn gold big", type: "button", text: "Поделиться", onclick: () => shareMedal(m) })),
        h("p", { class: "pro-note", text: "Выберите чат, и медаль уйдёт туда готовой картинкой со всеми данными и кнопкой «Открыть СТЕПЬ». Внизу карточки стоит ваше имя из Telegram." })
      ]
    };
  };

  /* ---------------- Петрович: помощник по рыбалке ---------------- */
  const PETRO_AVATAR = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="31" fill="#1c4a3b"/><circle cx="32" cy="34" r="14" fill="#e9c9a4"/><path d="M18.5 36c0 12 6 19 13.5 19s13.500-7 13.500-19c-3.200 5-8.200 7.500-13.500 7.500S21.700 41 18.500 36z" fill="#ece8df"/><path d="M14.500 29c1-9.500 8.500-15 17.500-15s16.500 5.500 17.500 15z" fill="#d3a23a"/><ellipse cx="32" cy="29" rx="21.500" ry="4.300" fill="#a97a16"/><path d="M17 26.800c9.500 2.600 20.500 2.600 30 0" stroke="#5a3a0c" stroke-width="2" fill="none"/><circle cx="26.500" cy="34.500" r="1.600" fill="#2b1a08"/><circle cx="37.500" cy="34.500" r="1.600" fill="#2b1a08"/><path d="M23.500 31.300l5-1M40.500 31.300l-5-1" stroke="#8a7a68" stroke-width="1.500" stroke-linecap="round"/><path d="M32 35.500v4.500" stroke="#c99a74" stroke-width="2" stroke-linecap="round"/><path d="M28 44.500c2.500 1.600 5.500 1.600 8 0" stroke="#7a6a58" stroke-width="1.600" fill="none" stroke-linecap="round"/></svg>';
  const avatar = cls => h("span", { class: "petro-ava " + (cls || ""), html: PETRO_AVATAR });
  const QUICK = ["На что ловить судака сейчас?", "Когда нерест и что запрещено?", "Какие снасти взять на сома?", "Что делать, если укусила змея?"];
  const GREET = "Здорово, дружище! Я Петрович, полвека на Волге. Спрашивай про снасти, места, сезон и повадки рыбы. А про всё остальное только шучу.";
  const chatPlace = () => (typeof selectedLoc !== "undefined" && selectedLoc && selectedLoc.id) ? selectedLoc : null;
  async function loadChat() {
    const c = S.chat;
    if (c.loaded || c.loading || !S.pro) return;
    c.loading = true;
    try {
      const d = await api("/api/petrovich");
      c.msgs = (d.history || []).map(x => ({ r: x.r, t: x.t }));
      c.on = d.on !== false; c.left = d.left; c.limit = d.limit || 20; c.loaded = true; c.scroll = true;
    } catch (e) { c.err = errText(e); }
    c.loading = false;
    const top = S.stack[S.stack.length - 1];
    if (isOpen() && top && top.name === "petrovich") render();
  }
  async function sendChat(text) {
    const c = S.chat;
    text = String(text || "").replace(/\s+/g, " ").trim();
    if (!text || c.sending) return;
    if (text.length > 500) { c.err = errText({ code: "too_long" }); return rerender(); }
    const place = c.place && chatPlace();
    c.msgs.push({ r: "u", t: text }); c.draft = ""; c.err = ""; c.sending = true; c.scroll = true; render();
    try {
      const d = await api("/api/petrovich", { body: { text, pointId: place ? place.id : undefined }, timeout: 40000 });
      c.msgs.push({ r: "a", t: d.reply }); c.left = d.left; c.limit = d.limit || c.limit;
    } catch (e) {
      c.msgs.pop(); c.draft = text; c.err = errText(e);
      if (e && e.code === "petrovich_limit") c.left = 0;
      if (e && e.code === "petrovich_off") c.on = false;
    }
    c.sending = false; c.scroll = true; render();
  }
  async function clearChat() {
    const c = S.chat;
    try { await api("/api/petrovich/clear", { body: {} }); c.msgs = []; c.err = ""; c.scroll = true; render(); } catch (e) { toast(errText(e)); }
  }
  function bubble(m) {
    return m.r === "u" ? h("div", { class: "pb me" }, h("div", { class: "pb-t", text: m.t }))
      : h("div", { class: "pb them" }, avatar("sm"), h("div", { class: "pb-t", text: m.t }));
  }
  function petroGuest() {
    const demo = [["u", "На что ловить судака в ноябре?"], ["a", "Судак сейчас по ямам стоит, дружище. Бери небольшой джиг, води медленно у бровки на зорьке. Вода холодная, рыба ленивая, не гони."],
      ["u", "Сколько будет два плюс два?"], ["a", "Литр, милок. Дальше в школе не считал. Ты лучше скажи, на что ловить собрался?"]];
    return [
      h("div", { class: "pro-hero compact petro-hero" }, h("div", { class: "hero-bg", html: HERO_ART }),
        h("div", { class: "hero-in" },
          h("div", { class: "petro-head" }, avatar("lg"), h("div", null, h("span", { class: "hero-kicker", text: "СТЕПЬ · ПОМОЩНИК" }), h("h2", { text: "Спроси у Петровича" }))),
          h("p", { text: "Нейросеть в образе рыбака с полувековым стажем на Волге. По рыбалке отвечает всерьёз и по-свойски, на всё остальное только шутит." }))),
      h("h2", { class: "section-h", text: "Так он отвечает" }),
      h("div", { class: "chat demo" }, demo.map(x => bubble({ r: x[0], t: x[1] }))),
      h("p", { class: "pro-note", text: "Это пример. Живые ответы зависят от вопроса и могут быть неточными. Вопросы обрабатывает внешняя нейросеть." }),
      h("div", { class: "perk-grid petro-perks" }, [
        ["card", "Знает сезон и запреты", "опирается на календарь запретов и справку по рыбам приложения"],
        ["pin", "Помнит, где вы", "можно спросить про выбранное на карте место"],
        ["check", "20 вопросов в день", "коротко и по делу, до пяти предложений"],
        ["medal", "Шутит не по теме", "математика, код и политика ему не по душе"]
      ].map(x => h("div", { class: "perk" }, icon(x[0]), h("b", { text: x[1] }), h("small", { text: x[2] })))),
      S.status === "ok" ? h("div", { class: "pay-bar" }, h("button", { class: "btn gold big", type: "button", text: "Открыть Петровича с Pro", onclick: () => push("offer", { reason: "petrovich" }) })) : statusBlock()
    ];
  }
  VIEWS.petrovich = function () {
    if (!S.pro) return { title: "Петрович", label: "ПОМОЩНИК", nodes: petroGuest() };
    const c = S.chat;
    if (!c.loaded && !c.loading) loadChat();
    const place = chatPlace();
    const msgs = h("div", { class: "chat", role: "log", "aria-live": "polite" });
    if (!c.msgs.length) msgs.append(bubble({ r: "a", t: GREET }));
    c.msgs.forEach(m => msgs.append(bubble(m)));
    if (c.sending) msgs.append(h("div", { class: "pb them" }, avatar("sm"), h("div", { class: "pb-t typing", "aria-label": "Петрович печатает" }, h("i"), h("i"), h("i"))));
    const input = h("textarea", { id: "chatInput", rows: "1", maxlength: "500", placeholder: c.on ? "Спросите про рыбалку…" : "Петрович пока не подключён", disabled: !c.on || c.left === 0, "aria-label": "Вопрос Петровичу" });
    input.value = c.draft;
    const fit = () => { input.style.height = "auto"; input.style.height = Math.min(110, input.scrollHeight) + "px"; };
    input.addEventListener("input", () => { c.draft = input.value; fit(); });
    input.addEventListener("keydown", ev => { if (ev.key === "Enter" && !ev.shiftKey && window.matchMedia && matchMedia("(pointer: fine)").matches) { ev.preventDefault(); sendChat(input.value); } });
    setTimeout(fit, 0);
    const send = h("button", { class: "chat-send", type: "button", "aria-label": "Отправить", disabled: !c.on || c.sending || c.left === 0, onclick: () => sendChat(input.value) }, h("span", { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l16-8-6 17-2.5-7z"/><path d="M11.500 14L20 4"/></svg>' }));
    const nodes = [
      h("div", { class: "petro-top" }, avatar("md"),
        h("div", { class: "txt" }, h("b", { text: "Петрович" }), h("small", { text: "Нейросеть в образе рыбака, может ошибаться: запреты смотрите в разделе «Запреты». Вопросы обрабатывает внешний сервис, личные данные в них не пишите." })),
        c.msgs.length ? h("button", { class: "linkbtn", type: "button", text: "Новый разговор", onclick: clearChat }) : null),
      msgs,
      !c.msgs.length && c.on ? h("div", { class: "quick" }, QUICK.map(q => h("button", { class: "chip-q", type: "button", text: q, onclick: () => sendChat(q), disabled: c.sending }))) : null,
      c.err ? h("p", { class: "chat-err", role: "alert", text: c.err }) : null,
      h("div", { class: "chat-bar" },
        place ? h("button", { class: "place-pill" + (c.place ? " on" : ""), type: "button", "aria-pressed": c.place ? "true" : "false", onclick: () => { c.place = !c.place; rerender(); } }, icon("pin"), "Про место: " + String(place.title || "").split(/ — |, /)[0]) : null,
        h("div", { class: "chat-row" }, input, send),
        h("small", { class: "left", text: c.left == null ? "" : c.left === 0 ? "Вопросы на сегодня закончились" : "Осталось вопросов сегодня: " + c.left + " из " + c.limit }))
    ];
    return { title: "Петрович", label: "ПОМОЩНИК · РЫБАЛКА", nodes };
  };

  /* ---------------- покупка Pro ---------------- */
  function planCard(pl) {
    const monthly = (S.plans.find(x => x.months === 1) || {}).stars;
    const pm = S.promo && S.promo.plan === pl.id ? S.promo : null;     // на этот тариф действует введённый скидочный промокод
    const stars = pm ? pm.stars : pl.stars;
    const save = monthly && pl.months > 1 ? Math.round((1 - pl.stars / (monthly * pl.months)) * 100) : 0;
    const short = pl.days > 0 && pl.days < 28;                       // ознакомительный тариф на несколько дней
    const per = short ? "на " + pl.days + " " + plural(pl.days, "день", "дня", "дней") + ", без автопродления" : "≈ " + Math.round(stars / Math.max(1, pl.months)) + " ⭐ / мес";
    const on = pl.id === S.planSel;
    return h("button", { class: "plan" + (on ? " sel" : "") + (pl.id === "12m" ? " best" : "") + (short ? " intro" : "") + (pm ? " promo" : ""), type: "button", "aria-pressed": on ? "true" : "false", onclick: () => { S.planSel = pl.id; rerender(); } },
      h("span", { class: "radio" }),
      h("b", { class: "ttl", text: pl.title }),
      h("b", { class: "price", text: stars + " ⭐" }),
      h("small", { class: "per", text: per }),
      h("em", { text: pm ? "−" + pm.pct + "%" : save > 0 ? "−" + save + "%" : "" }),
      pl.id === "12m" && h("span", { class: "tag", text: "Выгодно" }),
      short && h("span", { class: "tag", text: "Знакомство" }));
  }
  /* ---- промокоды: бесплатный открывает Pro сразу, скидочный меняет цену своего тарифа в счёте ---- */
  async function applyPromo() {
    const code = String(S.promoDraft || "").trim();
    if (!code || S.promoBusy) return;
    if (!API || !initData()) { S.promoErr = "Откройте атлас в Telegram, чтобы применить промокод."; return rerender(); }
    S.promoBusy = true; S.promoErr = ""; rerender();
    try {
      const r = await api("/api/promo", { body: { code } });
      if (r.type === "free") {
        S.promoOpen = false; S.promoDraft = ""; S.promoBusy = false;
        toast("Промокод принят: Pro открыт на " + r.days + " " + plural(r.days, "день", "дня", "дней") + ".", 6000);
        await refresh();
        if (S.pro) { S.stack = []; open("tours"); } else rerender();
        return;
      }
      S.promo = { code: r.code, pct: r.pct, plan: r.plan, stars: r.stars, base: r.base };
      S.planSel = r.plan; S.promoOpen = false; S.promoDraft = "";
      toast("Скидка −" + r.pct + "% применена к тарифу «" + r.planTitle + "».", 5000);
    } catch (e) { S.promoErr = errText(e); }
    S.promoBusy = false; rerender();
  }
  function promoBlock() {
    if (S.status !== "ok") return null;
    if (S.promo) {
      const pl = S.plans.find(x => x.id === S.promo.plan);
      return h("div", { class: "promo-on", role: "status" },
        h("div", null, h("b", { text: S.promo.code }), h("small", { text: "Промокод: −" + S.promo.pct + "% на тариф «" + (pl ? pl.title : S.promo.plan) + "»: " + S.promo.stars + " ⭐ вместо " + S.promo.base + " ⭐" })),
        h("button", { class: "linkbtn", type: "button", text: "Убрать", onclick: () => { S.promo = null; rerender(); } }));
    }
    if (!S.promoOpen) return h("button", { class: "linkbtn promo-link", type: "button", text: "Есть промокод?", onclick: () => { S.promoOpen = true; rerender(); setTimeout(() => { const i = $$("promoInput"); if (i) i.focus({ preventScroll: true }); }, 30); } });
    const input = h("input", { id: "promoInput", class: "promo-input", type: "text", maxlength: "24", placeholder: "STEP-XXXX-XXXX", autocomplete: "off", autocapitalize: "characters", autocorrect: "off", spellcheck: "false", "aria-label": "Промокод", disabled: S.promoBusy });
    input.value = S.promoDraft;
    input.addEventListener("input", () => { S.promoDraft = input.value; });
    input.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); S.promoDraft = input.value; applyPromo(); } });
    return h("div", { class: "promo-form" },
      h("div", { class: "promo-row" }, input, h("button", { class: "btn", type: "button", text: S.promoBusy ? "Проверяю…" : "Применить", disabled: S.promoBusy, onclick: () => { S.promoDraft = input.value; applyPromo(); } })),
      S.promoErr ? h("p", { class: "promo-err", role: "alert", text: S.promoErr }) : null);
  }
  async function buy() {
    if (!API) return toast("Оплата пока не подключена: Pro скоро откроется.", 5000);
    if (!initData()) return toast("Откройте атлас в Telegram, чтобы оплатить.", 5000);
    try {
      const withPromo = S.promo && S.promo.plan === S.planSel ? S.promo.code : "";
      const r = await api("/api/invoice", { body: withPromo ? { plan: S.planSel, promo: withPromo } : { plan: S.planSel } });
      const t = tg();
      if (t && typeof t.openInvoice === "function") {
        t.openInvoice(r.link, async status => {
          if (status === "paid") { S.promo = null; toast("Оплачено. Открываем Pro…", 5000); for (let i = 0; i < 8 && !S.pro; i++) { await pause(1500); await refresh(); } if (S.pro) { S.stack = []; open("tours"); } else toast("Платёж прошёл, Pro включится через минуту. Откройте раздел снова.", 7000); }
          else if (status === "cancelled") toast("Оплата отменена.");
          else if (status === "failed") toast("Оплата не прошла. Повторите или напишите в поддержку: /paysupport у бота.", 6000);
        });
      } else openExternal(r.link);
    } catch (e) {
      if (/^promo_(invalid|used|plan)$/.test(e && e.code)) { S.promo = null; rerender(); }          // код больше не годится: цена вернётся к обычной
      toast(errText(e), 6500);
    }
  }
  VIEWS.offer = function (a) {
    const list = tourListSource();
    const tour = a.tourId ? list.find(x => x.id === a.tourId) : null;
    const why = { tour: "Полный тур с местами, маршрутом по дням и отметками открывается в Pro.", awards: "Награды и медали работают в Pro.", spot: "Это место из подборки Pro.", extend: "Продлите подписку, чтобы не потерять доступ.", petrovich: "Петрович, помощник по рыбалке, отвечает подписчикам Pro." }[a.reason] || "";
    const canBuy = S.status === "ok";
    const medalsTotal = M.catalog(list).reduce((n, sec) => n + sec.items.length, 0);
    const toursN = list.length || 5, spotsN = (S.spotsMeta && S.spotsMeta.count) || 30;
    const nodes = [];
    if (tour) {
      const col = FISHCOL[(tour.target || [])[0]] || ["#2c6552", "#0f352a"];
      nodes.push(h("div", { class: "offer-why", style: "--tc1:" + col[0] + ";--tc2:" + col[1] }, fishIcon((tour.target || [])[0], "#f6e7bd", col[1]), h("div", null, h("b", { text: "Тур «" + tour.title + "»" }), h("small", { text: why }))));
    } else if (why) nodes.push(h("p", { class: "offer-why plain", text: why }));
    nodes.push(h("div", { class: "pro-hero" }, h("div", { class: "hero-bg", html: HERO_ART }),
      h("div", { class: "hero-in" },
        h("div", { class: "hero-top" }, icon("star", "seal"), h("span", { class: "hero-kicker", text: "СТЕПЬ · PRO" })),
        h("h2", { text: "Идите по маршруту, а не наугад" }),
        h("div", { class: "hero-stats" },
          h("div", null, h("b", { text: String(toursN) }), h("small", { text: plural(toursN, "тур", "тура", "туров") })),
          h("div", null, h("b", { text: String(spotsN) }), h("small", { text: plural(spotsN, "место", "места", "мест") })),
          h("div", null, h("b", { text: String(medalsTotal) }), h("small", { text: plural(medalsTotal, "медаль", "медали", "медалей") }))))));
    if (S.plans.length && !S.plans.some(p => p.id === S.planSel)) S.planSel = (S.plans.find(p => p.id === "3m") || S.plans.find(p => (p.days || 30) >= 28) || S.plans[0]).id;   // выбранного тарифа нет в списке
    nodes.push(h("h2", { class: "section-h", text: "Выберите срок" }), h("div", { class: "plans" }, S.plans.map(planCard)), promoBlock());
    nodes.push(h("h2", { class: "section-h", text: "Награды, которые можно собрать" }), medalStrip(showcaseMedals()));
    nodes.push(h("h2", { class: "section-h", text: "Что входит" }));
    nodes.push(h("div", { class: "perk-grid" }, [
      ["route", toursN + " " + plural(toursN, "тур", "тура", "туров") + " по рыбе", "щука, сазан, судак, сом и белый амур: по дням, с дорогой, снастями, погодой и луной"],
      ["pin", spotsN + " мест на карте", "свободный доступ, рыба, растения, птицы, небо и ссылки на спутник"],
      ["check", "Отметки и отчёты", "день засчитывается, когда вы на месте; отчёты и трофеи проверяет модерация"],
      ["medal", "Медали", "бронза, серебро и золото за туры, платина за проверенный трофей"],
      ["users", "Друзья", "приглашайте друзей, получайте награды и «Глас народа»"],
      ["card", "Карточка медали", "рыба, вес, место и время: можно отправить другу"],
      ["chat", "Петрович", "нейросеть-рыбак отвечает на вопросы про снасти, сезон и запреты, а про остальное шутит"]
    ].map(x => h("div", { class: "perk" }, icon(x[0]), h("b", { text: x[1] }), h("small", { text: x[2] })))));
    const pay = h("button", { class: "btn gold big", type: "button", disabled: !canBuy, text: canBuy ? "Оплатить " + ((S.promo && S.promo.plan === S.planSel ? S.promo.stars : (S.plans.find(p => p.id === S.planSel) || {}).stars) || "") + " ⭐" : S.status === "noapi" ? "Скоро" : S.status === "notg" ? "Откройте в Telegram" : "Нет связи с сервером", onclick: buy });
    nodes.push(h("p", { class: "pro-note", text: S.status === "noapi" ? "Оплата Telegram Stars подключается. Цены ориентировочные и могут измениться до запуска." : "Условия и возврат — команды /terms и /paysupport у бота @AtlasFishingbot. Прогноз клёва, туры и места — подсказки по открытым данным, не гарантия улова и не проверка законности ловли." }));
    nodes.push(h("div", { class: "pay-bar" }, pay, canBuy && h("small", { text: "Оплата в Telegram Stars, подписка не продлевается сама" })));
    return { title: "СТЕПЬ Pro", label: "ПОДПИСКА", nodes };
  };

  /* ---------------- подключение ---------------- */
  function init() {
    $$("closePro").addEventListener("click", closeAll);
    $$("proBack").addEventListener("click", back);
    sheet().inert = true;
    const row = $$("proLayerOption");
    if (row) {
      row.addEventListener("click", ev => {
        if (S.pro) return;
        ev.preventDefault();
        if (typeof setLayerPanel === "function") setLayerPanel(false);
        open("offer", { reason: "spot" });
      });
    }
    loadTours();
    refresh();
    // чтобы после загрузки точек реферальная ссылка и ссылки на места Pro сработали
    if (API) setTimeout(() => {
      const id = typeof startParamId === "function" ? startParamId() : "";
      if (DISTRICT_RE.test(id) && !S.pro && S.status === "ok") open("offer", { reason: "spot" });
    }, 1800);
  }
  window.StepPro = { open, closeAll, back, isOpen, tab, skyCard, state: S, _api: api, _refresh: refresh, _reload: loadProgress };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
