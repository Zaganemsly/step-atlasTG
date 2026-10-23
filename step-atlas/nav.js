/* СТЕПЬ — навигация внутри приложения.
   Чистые функции без DOM (проверяются в Node): разбор маршрута OSRM, привязка позиции к линии,
   подсказки по-русски, запасной режим «по азимуту» там, где дорог нет (дельта, степь). */
(function (root) {
  "use strict";
  const R = 6371000, RAD = Math.PI / 180;

  function dist(a, b) {
    const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b) {
    const y = Math.sin((b.lng - a.lng) * RAD) * Math.cos(b.lat * RAD);
    const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lng - a.lng) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }
  const COMPASS = ["север", "северо-восток", "восток", "юго-восток", "юг", "юго-запад", "запад", "северо-запад"];
  function compass(deg) { return COMPASS[Math.round(deg / 45) % 8]; }

  /* Расстояние от точки до отрезка (локальная плоская проекция, метры) и доля t вдоль отрезка. */
  function projectOnSegment(p, a, b) {
    const k = Math.cos(p.lat * RAD) * RAD * R, m = RAD * R;
    const ax = (a.lng - p.lng) * k, ay = (a.lat - p.lat) * m;
    const bx = (b.lng - p.lng) * k, by = (b.lat - p.lat) * m;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx, py = ay + t * dy;
    return { t, off: Math.hypot(px, py) };
  }

  /* Разбор ответа OSRM (route с geometries=geojson и steps=true). */
  function parseRoute(osrmRoute) {
    const coords = osrmRoute.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + dist(coords[i - 1], coords[i]));
    const total = cum[cum.length - 1];
    const maneuvers = [];
    let at = 0;
    (osrmRoute.legs || []).forEach(leg => {
      (leg.steps || []).forEach(st => {
        const m = st.maneuver || {};
        maneuvers.push({
          type: m.type || "turn", modifier: m.modifier || "", exit: m.exit || null,
          name: st.name || "", ref: st.ref || "",
          at, distance: st.distance || 0,
          location: m.location ? { lat: m.location[1], lng: m.location[0] } : null
        });
        at += st.distance || 0;
      });
    });
    // Метры по линии могут слегка отличаться от суммы шагов: приводим к одной шкале.
    const scale = at > 0 && total > 0 ? total / at : 1;
    maneuvers.forEach(m => { m.at *= scale; });
    return { coords, cum, total, maneuvers, distance: osrmRoute.distance, duration: osrmRoute.duration };
  }

  /* Где мы на маршруте: проезжено метров и отклонение от линии. */
  function locate(route, pos, hintIdx) {
    const n = route.coords.length;
    let best = { off: Infinity, along: 0, idx: 0 };
    const from = hintIdx !== undefined ? Math.max(0, hintIdx - 40) : 0;
    const to = hintIdx !== undefined ? Math.min(n - 1, hintIdx + 400) : n - 1;
    const scan = (lo, hi) => {
      for (let i = lo; i < hi; i++) {
        const pr = projectOnSegment(pos, route.coords[i], route.coords[i + 1]);
        if (pr.off < best.off) best = { off: pr.off, along: route.cum[i] + pr.t * (route.cum[i + 1] - route.cum[i]), idx: i };
      }
    };
    scan(from, to);
    if (best.off > 150 && (from > 0 || to < n - 1)) scan(0, n - 1); // потеряли — ищем по всей линии
    return best;
  }

  /* Следующий манёвр после проезженных метров. */
  function nextManeuver(route, along) {
    for (let i = 0; i < route.maneuvers.length; i++) {
      const m = route.maneuvers[i];
      if (m.type === "depart") continue;
      if (m.type === "arrive" || m.at > along - 12) return { index: i, m, dist: Math.max(0, m.at - along) };
    }
    return null;
  }

  const MOD = {
    "left": ["Поверните налево", "←"], "right": ["Поверните направо", "→"],
    "slight left": ["Держитесь левее", "↖"], "slight right": ["Держитесь правее", "↗"],
    "sharp left": ["Резко налево", "↰"], "sharp right": ["Резко направо", "↱"],
    "straight": ["Продолжайте прямо", "↑"], "uturn": ["Развернитесь", "↶"]
  };
  const ORD = ["", "первом", "втором", "третьем", "четвёртом", "пятом", "шестом", "седьмом", "восьмом"];

  /* Подсказка по манёвру: { text, glyph, street }. */
  function phrase(m) {
    const street = [m.name, m.ref].filter(Boolean).join(", ");
    const mod = MOD[m.modifier] || null;
    let text, glyph = mod ? mod[1] : "↑";
    switch (m.type) {
      case "depart": text = "Начните движение"; glyph = "↑"; break;
      case "arrive":
        text = m.modifier === "left" ? "Вы приехали, пункт слева" : m.modifier === "right" ? "Вы приехали, пункт справа" : "Вы приехали";
        glyph = "⚑"; break;
      case "roundabout": case "rotary":
        text = m.exit ? "На кольце съезжайте на " + ORD[Math.min(m.exit, 8)] + " съезде" : "На кольце следуйте по маршруту";
        glyph = "⟳"; break;
      case "roundabout turn": text = mod ? mod[0] + " на кольце" : "Поверните на кольце"; break;
      case "fork": text = m.modifier.includes("left") ? "На развилке держитесь левее" : m.modifier.includes("right") ? "На развилке держитесь правее" : "На развилке следуйте по маршруту"; break;
      case "end of road": text = m.modifier.includes("left") ? "В конце дороги поверните налево" : m.modifier.includes("right") ? "В конце дороги поверните направо" : "В конце дороги следуйте по маршруту"; break;
      case "merge": text = "Перестройтесь" + (m.modifier.includes("left") ? " влево" : m.modifier.includes("right") ? " вправо" : ""); break;
      case "on ramp": text = "Съезжайте на въезд" + (m.modifier.includes("left") ? " слева" : m.modifier.includes("right") ? " справа" : ""); break;
      case "off ramp": text = "Съезжайте с дороги" + (m.modifier.includes("left") ? " влево" : m.modifier.includes("right") ? " вправо" : ""); break;
      case "continue": case "new name": text = mod && m.modifier !== "straight" ? mod[0] : "Продолжайте прямо"; break;
      default: text = mod ? mod[0] : "Следуйте по маршруту";
    }
    return { text, glyph, street };
  }

  function fmtDist(m) {
    if (m < 30) return "сейчас";
    if (m < 100) return "через " + Math.round(m / 10) * 10 + " м";
    if (m < 1000) return "через " + Math.round(m / 50) * 50 + " м";
    if (m < 10000) return "через " + (m / 1000).toFixed(1).replace(".", ",") + " км";
    return "через " + Math.round(m / 1000) + " км";
  }
  function fmtKm(m) { return m < 950 ? Math.round(m / 10) * 10 + " м" : (m / 1000).toFixed(m < 10000 ? 1 : 0).replace(".", ",") + " км"; }
  function fmtEta(sec) {
    const min = Math.max(1, Math.round(sec / 60));
    return min >= 60 ? Math.floor(min / 60) + " ч " + (min % 60) + " мин" : min + " мин";
  }

  /* Оставшееся время пропорционально оставшемуся пути. */
  function remaining(route, along) {
    const left = Math.max(0, route.total - along);
    return { meters: left, seconds: route.total > 0 ? route.duration * (left / route.total) : 0 };
  }

  /* Что произнести: пороги 400 м и 60 м для каждого манёвра, по одному разу. */
  function voiceCue(next, spoken) {
    if (!next) return null;
    const p = phrase(next.m);
    const key = next.index;
    const s = spoken[key] || (spoken[key] = {});
    if (next.m.type === "arrive") {
      if (next.dist < 60 && !s.near) { s.near = true; s.far = true; return p.text; }
      if (next.dist < 400 && !s.far) { s.far = true; return fmtDist(next.dist) + " " + p.text.toLowerCase(); }
      return null;
    }
    const tail = p.street ? ", " + p.street : "";
    if (next.dist < 60 && !s.near) { s.near = true; s.far = true; return p.text + tail; }
    if (next.dist < 400 && next.dist >= 90 && !s.far) { s.far = true; return fmtDist(next.dist) + " " + p.text.toLowerCase() + tail; }
    return null;
  }

  /* Режим «по азимуту»: когда дорожного маршрута нет (дельта, степь, лодка). */
  function straightGuide(pos, dest) {
    const d = dist(pos, dest), b = bearing(pos, dest);
    return { meters: d, bearing: b, compass: compass(b) };
  }

  const api = { dist, bearing, compass, projectOnSegment, parseRoute, locate, nextManeuver, phrase, fmtDist, fmtKm, fmtEta, remaining, voiceCue, straightGuide };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StepNav = api;
})(typeof window !== "undefined" ? window : globalThis);
