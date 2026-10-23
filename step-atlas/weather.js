/* СТЕПЬ — погода и советы рыбаку.
   Чистые функции без DOM: их можно тестировать в Node.
   Источник погоды: Open-Meteo (без ключа). Оценка клёва — эвристика, не прогноз. */
(function (root) {
  "use strict";

  // Нерестовый запрет в Астрахани по публикации «Вокруг света»: 16 мая — 20 июня.
  // Правила могут меняться, поэтому приложение всегда просит сверить их с Росрыболовством.
  const SPAWN_BAN = { from: [5, 16], to: [6, 20] };

  const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

  const WMO = {
    0: "ясно", 1: "в основном ясно", 2: "переменная облачность", 3: "пасмурно",
    45: "туман", 48: "изморозь и туман",
    51: "слабая морось", 53: "морось", 55: "сильная морось", 56: "ледяная морось", 57: "сильная ледяная морось",
    61: "слабый дождь", 63: "дождь", 65: "сильный дождь", 66: "ледяной дождь", 67: "сильный ледяной дождь",
    71: "слабый снег", 73: "снег", 75: "сильный снег", 77: "снежные зёрна",
    80: "ливень слабый", 81: "ливень", 82: "сильный ливень", 85: "снегопад слабый", 86: "сильный снегопад",
    95: "гроза", 96: "гроза с градом", 99: "сильная гроза с градом"
  };

  function weatherUrl(lat, lng) {
    const q = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      current: "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,surface_pressure,is_day",
      hourly: "surface_pressure",
      past_hours: "6",
      forecast_hours: "1",
      wind_speed_unit: "ms",
      timezone: "auto"
    });
    return "https://api.open-meteo.com/v1/forecast?" + q.toString();
  }

  function num(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }

  function parseWeather(json) {
    const c = json && json.current;
    if (!c || typeof c.time !== "string") return null;
    const w = {
      time: c.time,
      month: Number(c.time.slice(5, 7)),
      day: Number(c.time.slice(8, 10)),
      hour: Number(c.time.slice(11, 13)),
      tempC: num(c.temperature_2m),
      feelsC: num(c.apparent_temperature),
      precipMm: num(c.precipitation) || 0,
      code: num(c.weather_code),
      windMs: num(c.wind_speed_10m),
      gustMs: num(c.wind_gusts_10m),
      pressureHpa: num(c.surface_pressure),
      isDay: c.is_day === 1,
      pressureTrend3h: null
    };
    if (w.tempC === null) return null;
    if (w.feelsC === null) w.feelsC = w.tempC;
    if (w.windMs === null) w.windMs = 0;
    if (w.gustMs === null) w.gustMs = w.windMs;
    w.pressureMmHg = w.pressureHpa === null ? null : Math.round(w.pressureHpa * 0.750062);

    const h = json.hourly;
    if (h && Array.isArray(h.time) && Array.isArray(h.surface_pressure) && w.pressureHpa !== null) {
      const key = c.time.slice(0, 13);
      const i = h.time.findIndex(t => typeof t === "string" && t.slice(0, 13) === key);
      if (i >= 3 && num(h.surface_pressure[i - 3]) !== null) {
        w.pressureTrend3h = Math.round((w.pressureHpa - h.surface_pressure[i - 3]) * 10) / 10;
      }
    }
    w.description = WMO[w.code] || "";
    return w;
  }

  function inSpawnBan(w) {
    const v = w.month * 100 + w.day;
    return v >= SPAWN_BAN.from[0] * 100 + SPAWN_BAN.from[1] && v <= SPAWN_BAN.to[0] * 100 + SPAWN_BAN.to[1];
  }

  function formatMonths(list) {
    const s = [...new Set(list)].sort((a, b) => a - b);
    if (!s.length) return "";
    // Если ряд пересекает границу года (например, 11, 12, 1, 2), склеиваем его.
    const ranges = [];
    let start = s[0], prev = s[0];
    for (let k = 1; k <= s.length; k++) {
      if (k < s.length && s[k] === prev + 1) { prev = s[k]; continue; }
      ranges.push([start, prev]);
      start = s[k]; prev = s[k];
    }
    if (ranges.length > 1 && ranges[0][0] === 1 && ranges[ranges.length - 1][1] === 12) {
      const last = ranges.pop();
      ranges[0] = [last[0], ranges[0][1] + 12];
    }
    return ranges.map(([a, b]) => {
      const an = MONTHS[(a - 1) % 12], bn = MONTHS[(b - 1) % 12];
      return a === b ? an : an + " — " + bn;
    }).join(", ");
  }

  function isMorningOrEvening(h) { return (h >= 4 && h <= 8) || (h >= 18 && h <= 22); }
  function isNight(h) { return h >= 21 || h <= 4; }

  /* Оценка 0–100. Каждое слагаемое объясняется строкой в reasons. */
  function scoreFish(fish, w) {
    let score = 30;
    const reasons = [];
    const m = w.month;

    if (fish.peakMonths.includes(m)) { score += 22; reasons.push("сейчас пик сезона этого вида"); }
    else if (fish.goodMonths.includes(m)) { score += 8; reasons.push("рыба берёт, но не на пике"); }
    else { score -= 18; reasons.push("не её сезон"); }

    const lo = fish.airTempC[0], hi = fish.airTempC[1];
    if (w.tempC >= lo && w.tempC <= hi) {
      score += 14; reasons.push("температура воздуха в комфортном для вида диапазоне");
    } else if (w.tempC < lo) {
      score -= Math.min(20, Math.round((lo - w.tempC) * 1.5));
      reasons.push("холоднее комфортного: рыба вялая");
    } else {
      score -= Math.min(20, Math.round((w.tempC - hi) * 1.5));
      reasons.push("жарче комфортного: рыба уходит на глубину");
    }

    if (w.pressureTrend3h !== null) {
      const d = w.pressureTrend3h;
      if (Math.abs(d) <= 1) { score += 10; reasons.push("давление стабильное"); }
      else if (d <= -3) { score -= 12; reasons.push("давление быстро падает"); }
      else if (d >= 3) { score -= 6; reasons.push("давление резко растёт"); }
    }

    if (w.gustMs >= 14) { score -= 15; reasons.push("сильные порывы ветра"); }
    else if (w.windMs >= 10) { score -= 8; reasons.push("сильный ветер"); }
    else if (w.windMs <= 7) { score += 3; }

    if (isMorningOrEvening(w.hour)) {
      if (fish.activity !== "day") { score += 8; reasons.push("утренняя или вечерняя зорька"); }
    } else if (fish.activity !== "day" && !isNight(w.hour)) {
      score -= 6; reasons.push("сейчас не зорька: днём вид стоит на глубине");
    }
    if (fish.activity === "night" && isNight(w.hour)) { score += 10; reasons.push("ночь — время этого вида"); }
    if (w.feelsC >= 30 && w.hour >= 11 && w.hour <= 17) { score -= 12; reasons.push("дневная жара"); }

    if (w.precipMm >= 2) { score -= 8; reasons.push("сильные осадки"); }
    if (w.code !== null && w.code >= 95) { score = Math.min(score, 10); reasons.push("гроза"); }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const ch = chance(score);
    return { fishId: fish.id, score, label: ch.label, chance: ch, reasons, window: bestWindow(fish), nextPeak: nextPeak(fish, w.month) };
  }

  /* Забота о рыбаке: холод, жара, ветер, гроза, туман, лёд. level: info | warn | danger */
  function careTips(w) {
    const tips = [];
    const f = w.feelsC;

    if (w.code !== null && w.code >= 95) {
      tips.push({ level: "danger", text: "Гроза. Уйдите от воды, не стойте с удилищем и под одиноким деревом. Рыбалку лучше отложить." });
    }
    if (f <= -15) {
      tips.push({ level: "danger", text: "Сильный мороз. Рыбачьте недолго и не в одиночку: тёплые слои, сухие варежки, термос. Белеют нос и щёки — сразу в тепло." });
    } else if (f <= -5) {
      tips.push({ level: "warn", text: "Холодно. Оденьтесь слоями, возьмите запасные сухие носки и горячий чай. Не пейте алкоголь «для согрева»: он увеличивает потерю тепла." });
    } else if (f <= 5 && w.precipMm > 0) {
      tips.push({ level: "warn", text: "Сыро и прохладно. Возьмите непромокаемую куртку и сменную одежду, мокрая одежда быстро выстужает." });
    }
    if (w.tempC <= 0 && [12, 1, 2, 3].includes(w.month)) {
      tips.push({ level: "warn", text: "Лёд ненадёжен. Проверяйте толщину при каждом шаге, не ходите по льду в одиночку, не выходите на устья проток и места с течением." });
    }
    if (f >= 36) {
      tips.push({ level: "danger", text: "Сильная жара. Рыбачьте только на рассвете и после заката. Пейте воду, держите голову прикрытой, сидите в тени. Головокружение, тошнота, сухая кожа — в тень и охладиться." });
    } else if (f >= 30) {
      tips.push({ level: "warn", text: "Жарко. Возьмите воды больше, чем кажется нужным, головной убор и солнцезащитный крем. В полдень рыба уходит на глубину — лучше утро и вечер." });
    }
    if (w.gustMs >= 15) {
      tips.push({ level: "danger", text: "Штормовые порывы. На воду с лодки не выходить. На берегу держитесь подальше от кромки." });
    } else if (w.gustMs >= 10) {
      tips.push({ level: "warn", text: "Порывистый ветер. На лодке — спасжилет обязателен, не отплывайте далеко от берега." });
    }
    if (w.code === 45 || w.code === 48) {
      tips.push({ level: "warn", text: "Туман. На воде легко потерять ориентир: возьмите навигатор и заряженный телефон, сообщите близким, где вы." });
    }
    if (inSpawnBan(w)) {
      tips.push({ level: "warn", text: "Идёт нерестовый запрет (по публикациям — 16 мая — 20 июня). Сверьте действующие правила и разрешённые участки на сайте Волго-Каспийского территориального управления Росрыболовства." });
    }
    return tips;
  }

  /* Шанс поймать сейчас: словами, без ложной точности. */
  function chance(score) {
    if (score < 12) return { label: "минимальный", level: 0 };
    if (score < 28) return { label: "низкий", level: 1 };
    if (score < 45) return { label: "ниже среднего", level: 2 };
    if (score < 60) return { label: "средний", level: 3 };
    if (score < 75) return { label: "хороший", level: 4 };
    return { label: "высокий", level: 5 };
  }
  function bestWindow(fish) {
    switch (fish.activity) {
      case "night": return "ночью и в сумерки (21:00–04:00)";
      case "dusk": return "вечерняя зорька 18:00–22:00 и утро 04:00–08:00";
      case "dawn": return "утренняя зорька 04:00–09:00 и вечер 18:00–21:00";
      default: return "днём 10:00–17:00, лучше в пасмурную прохладную погоду";
    }
  }
  function nextPeak(fish, month) {
    if (fish.peakMonths.includes(month)) return { months: 0, name: MONTHS[month - 1] };
    for (let k = 1; k <= 12; k++) {
      const m = ((month - 1 + k) % 12) + 1;
      if (fish.peakMonths.includes(m)) return { months: k, name: MONTHS[m - 1] };
    }
    return null;
  }

  /* 20 пожеланий: рыбалка, виды, отдых, путешествия. */
  const WISHES = {
    fishing: [
      "Тихой воды и звонких поклёвок. Пусть каждая заря приносит трофей.",
      "Пусть леска натянется так, что сердце замрёт, а удилище согнётся дугой.",
      "Хорошего клёва и лёгкого ветра в спину!",
      "Дельта щедра к тем, кто умеет ждать. Удачной охоты на сома.",
      "Лови момент, а рыба сама придёт. Ровных вам течений.",
      "Пусть щука будет с вас ростом, а байка о ней — ещё длиннее."
    ],
    views: [
      "Встретьте рассвет над водой, когда небо цвета абрикоса.",
      "Пусть лотосы раскроются именно там, где вы остановитесь.",
      "Поймайте золотой час: степь в закатном свете стоит каждого километра.",
      "Пусть горизонт будет широким, а кадры такими, что их захочется распечатать."
    ],
    rest: [
      "Остановитесь, выдохните и послушайте степь.",
      "Чай на костре и ни одного дедлайна: это и есть настоящий отпуск.",
      "Пусть вечер будет тёплым, а в тишине слышен только камыш.",
      "Отдыхайте так, будто спешить некуда. Здесь это правда."
    ],
    travel: [
      "Лёгкой дороги и интересных поворотов, даже если они не по маршруту.",
      "Пусть навигатор молчит, а любопытство ведёт вперёд.",
      "Заправьтесь, запаситесь водой и поезжайте туда, где нет связи.",
      "Пусть в дельте вам встретится то, чего нет ни в одном путеводителе.",
      "Дорога длинная, а впечатления ещё длиннее. В путь!",
      "Возвращайтесь с песком в ботинках и новыми историями."
    ],
    slowBite: [
      "Клёв сегодня вялый, но вода, воздух и тишина всё равно ваши. Приезжайте на зорьку.",
      "Рыба не торопится, и вам не стоит. Хороший термос тоже трофей."
    ]
  };
  const lastWish = {};
  function pickWish(type, tips, ranked) {
    if (tips.some(t => t.level === "danger")) return "Сегодня главное — вернуться целым и невредимым. Рыба и виды подождут, хороший день ещё будет.";
    const best = ranked[0];
    let pool;
    if (type === "fishing") {
      pool = WISHES.fishing.slice();
      if (best && best.score < 28) pool = pool.concat(WISHES.slowBite, WISHES.slowBite);
      else if (best && best.score >= 70) pool.push("Условия отличные. Желаю крупного улова, пусть клюёт то, ради чего вы приехали!");
    } else if (type === "nature") pool = WISHES.views.concat(WISHES.rest);
    else pool = WISHES.travel.concat(WISHES.views);
    let i = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && lastWish[type] === pool[i]) i = (i + 1) % pool.length;
    lastWish[type] = pool[i];
    return pool[i];
  }

  function analyze(w, fishList, type) {
    const ranked = fishList.map(f => scoreFish(f, w)).sort((a, b) => b.score - a.score);
    const care = careTips(w);
    return { ranked, care, wish: pickWish(type || "fishing", care, ranked), spawnBan: inSpawnBan(w) };
  }

  const api = { chance, bestWindow, nextPeak, WISHES, weatherUrl, parseWeather, scoreFish, careTips, analyze, formatMonths, inSpawnBan, WMO, SPAWN_BAN };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StepWeather = api;
})(typeof window !== "undefined" ? window : globalThis);
