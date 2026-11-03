/* СТЕПЬ: рисование медалей. Эмаль, металл, лавр, лента своего цвета у каждого тура, подпись по кругу и карточка для публикации.
   Чистые функции: возвращают строки SVG. Никаких запросов, никаких секретов. Тексты экранируются.
   Названия и подписи медалей собраны здесь же (NAMES, VERSE, HOW), чтобы приложение и карточка для публикации говорили одинаково. */
(function (root) {
  "use strict";

  const LEVEL_RU = { bronze: "Бронза", silver: "Серебро", gold: "Золото", platinum: "Платина", voice: "Глас народа" };
  const LEVEL_ADJ = { bronze: "Бронзовая", silver: "Серебряная", gold: "Золотая", platinum: "Платиновая", voice: "Главная" };

  /* Цвета металлов: светлый, средний, тёмный, цвет рисунка на медали */
  const METAL = {
    bronze:   { hi: "#f6c597", mid: "#b87333", lo: "#6a3d15", ink: "#2b1404", rim: "#7d4a1f", glow: "#ffd9b0" },
    silver:   { hi: "#ffffff", mid: "#c3c9cf", lo: "#6f7983", ink: "#232d35", rim: "#8a939b", glow: "#ffffff" },
    gold:     { hi: "#fff3b8", mid: "#e0b13e", lo: "#8d5f0b", ink: "#3b2703", rim: "#a97a16", glow: "#fff1a8" },
    platinum: { hi: "#ffffff", mid: "#cfe0ea", lo: "#5f819a", ink: "#14293a", rim: "#86a3b8", glow: "#e8f6ff" },
    voice:    { hi: "#fff3b8", mid: "#e0b13e", lo: "#8d5f0b", ink: "#4a3306", rim: "#a97a16", glow: "#fff1a8" }
  };

  /* Ленты и эмаль по видам рыбы и сериям: a, b — цвета двух полос ленты, s — полоска; face — эмаль в центре (тёмный, светлый) */
  const THEME = {
    pike:      { a: "#2c6552", b: "#c2462d", s: "#f1e3b0", face: ["#2f7a60", "#123d30"], tint: "#bfe7cf" },
    carp:      { a: "#b9771a", b: "#5a2d12", s: "#f6dc8c", face: ["#cf8a25", "#6b3a0e"], tint: "#ffe6a8" },
    zander:    { a: "#3b6a8f", b: "#1d3550", s: "#dbe8f2", face: ["#4a7ea6", "#173049"], tint: "#d3e6f5" },
    catfish:   { a: "#2f3a6b", b: "#136b6b", s: "#cfe6e6", face: ["#34408a", "#10163a"], tint: "#c4cdf2" },
    grasscarp: { a: "#1f8a4c", b: "#6a8f1a", s: "#e6f2b8", face: ["#3c9a52", "#133f20"], tint: "#d4efc2" },
    ref:       { a: "#2c6552", b: "#c2462d", s: "#f3dba0", face: ["#2f7a60", "#123d30"], tint: "#d8efe2" },
    voice:     { a: "#12382d", b: "#c2462d", s: "#f3dba0", face: ["#1f5444", "#0c241d"], tint: "#f6dd8b" },
    first:     { a: "#2b6f8f", b: "#12384d", s: "#cfeaf6", face: ["#3b8db3", "#0f3a52"], tint: "#d6f0fb" },
    delta:     { a: "#2f6b4a", b: "#2b6f8f", s: "#e4f1c9", face: ["#3f8a5e", "#143a28"], tint: "#dcf1e3" },
    night:     { a: "#101a3c", b: "#4a2b78", s: "#e9e1ff", face: ["#1d2b66", "#070d24"], tint: "#e6ecff" },
    released:  { a: "#1f6a6f", b: "#2b4a8f", s: "#d3f0ee", face: ["#2b8a8f", "#0e3a3d"], tint: "#d6f4f2" },
    scribe:    { a: "#6d2b2b", b: "#2c3a52", s: "#f1dfb0", face: ["#8d3a38", "#3d1414"], tint: "#f6e6c4" },
    platinum:  { a: "#9fb8c9", b: "#2c4a63", s: "#ffffff", face: ["#45708f", "#14293a"], tint: "#e4f4ff" }
  };

  /* Силуэты рыб (смотрят вправо), viewBox 0 0 124 60. Рисунок собственный, не копия чужого. */
  const FISH = {
    pike: {
      body: "M118 31C114 27 107 25 99 24C85 21 67 20 49 22C39 23 31 25 23 28L6 17L11 31L6 45L23 35C31 38 39 40 49 41C67 42 87 40 99 37C107 36 114 35 118 31Z",
      fins: ["M41 22C35 12 29 10 22 12L27 26Z", "M37 40C33 48 27 50 22 50L27 36Z", "M84 38L78 47L92 39Z"],
      eye: [104, 28.2], extra: []
    },
    carp: {
      body: "M114 32C110 23 99 17 87 15C75 13 59 13 45 18C37 21 31 25 25 28L8 16L13 30L8 44L25 34C31 39 39 47 51 50C67 54 89 51 101 43C107 39 111 36 114 32Z",
      fins: ["M84 15C76 3 56 3 44 18C57 14 71 14 84 15Z", "M62 51L53 59L72 53Z", "M92 45L88 54L100 47Z"],
      eye: [101, 28], extra: ["M107 36C109 38 109 40 107 41"]
    },
    zander: {
      body: "M118 32C112 26 102 22 92 21C76 20 59 21 45 24C37 26 29 28 23 30L6 18L11 31L6 44L23 33C29 36 37 38 47 40C63 43 85 42 99 39C109 37 114 35 118 32Z",
      fins: ["M92 21L88 8L82 12L77 6L71 12L66 7L61 21Z", "M55 22C51 14 41 12 35 14L33 26Z", "M49 40C47 47 39 50 33 50L35 38Z", "M86 41L80 49L94 42Z"],
      eye: [105, 28.5], extra: []
    },
    catfish: {
      body: "M118 32C118 26 109 21 99 21C85 20 70 22 56 24C40 26 26 28 14 30C7 31 4 33 7 35C13 37 24 38 34 40C46 46 66 49 80 45C94 42 108 41 115 38C117 36 118 34 118 32Z",
      fins: ["M73 22C71 16 67 15 62 17L62 24Z"],
      eye: [108, 27], extra: [],
      lines: ["M115 33C122 40 120 50 109 55", "M111 38C114 46 108 52 101 53", "M117 30C124 27 125 20 120 15"]
    },
    grasscarp: {
      body: "M114 31C112 24 104 20 94 19C80 17 62 18 46 21C38 23 30 26 22 29L6 18L11 31L6 44L22 34C30 38 38 41 48 43C64 46 86 44 98 40C108 37 113 35 114 31Z",
      fins: ["M77 18C73 10 63 8 54 10L56 20Z", "M60 44L54 53L71 45Z", "M36 41L30 49L43 42Z"],
      eye: [102, 27.5], extra: [],
      scales: ["M80 26q4 4 0 8", "M70 26q4 4 0 9", "M60 26q4 4 0 9", "M50 27q4 4 0 8"]
    }
  };

  /* ---------------- названия, строки из стихов и «как получить» ---------------- */
  const NAMES = {
    pike:      { bronze: "Всплеск у камыша", silver: "Тень в зелёной воде", gold: "Королева затонов", platinum: "Владычица плёса" },
    carp:      { bronze: "Рассвет на протоке", silver: "Солнце в чешуе", gold: "Богатырь дельты", platinum: "Царь-сазан" },
    zander:    { bronze: "Холодный блеск", silver: "Ночь над стрежнем", gold: "Клык Волги", platinum: "Призрак стрежня" },
    catfish:   { bronze: "Эхо из омута", silver: "Тяжёлая вода", gold: "Хозяин глубин", platinum: "Владыка омута" },
    grasscarp: { bronze: "Шорох тростника", silver: "Зелёная тишина", gold: "Исполин затонов", platinum: "Изумрудный исполин" },
    ref:       { bronze: "Попутный ветер", silver: "Дружная ватага", gold: "Артель Волги" },
    voice:     { voice: "Глас народа" },
    first:     { bronze: "Первая вода" },
    delta:     { bronze: "Две протоки", silver: "Три рукава", gold: "Хозяин дельты" },
    night:     { silver: "Млечная тропа", gold: "Хранитель звёздных ночей" },
    released:  { bronze: "Тихая вода", silver: "Рука, что отпускает", gold: "Хранитель плёса" },
    scribe:    { bronze: "Первая запись", silver: "Дневник дельты", gold: "Летописец Волги" }
  };
  const VERSE = {
    pike: {
      bronze: "Тихий всплеск у камыша: дельта впервые кивнула вам.",
      silver: "Тень скользит в зелёной воде, а вы уже знаете её повадки.",
      gold: "Вся дельта знает, кто здесь хозяйка. И кто её дождался.",
      platinum: "Плёс затих, когда она вышла из тени. Трофей, о котором будут рассказывать."
    },
    carp: {
      bronze: "Солнце вставало над протокой, и вы встретили его первым.",
      silver: "Золото рассвета осело на чешуе. Дельта делится щедро.",
      gold: "Богатырь дельты взял поклон. Семь дней пути стоят этой медали.",
      platinum: "Царский сазан на вашей руке. Такие бывают раз в жизни."
    },
    zander: {
      bronze: "Холодный блеск на глубине: первый шаг к ночной рыбалке.",
      silver: "Ночь над стрежнем всё расскажет тому, кто умеет слушать воду.",
      gold: "У Волги есть клык, и вы его не побоялись. Серебро стало золотом.",
      platinum: "Призрак стрежня вышел к свету. Вы удержали его."
    },
    catfish: {
      bronze: "Из омута пришло эхо. Глубина заметила, что вы здесь.",
      silver: "Вода стала тяжёлой, а терпение вы не потеряли.",
      gold: "Десять дней, и хозяин глубин признал в вас равного.",
      platinum: "Владыка омута поднялся на свет. История, что переживёт сезон."
    },
    grasscarp: {
      bronze: "Шорох тростника: исполин рядом, и он вас слышит.",
      silver: "В зелёной тишине затонов не торопятся. Вы научились ждать.",
      gold: "Двенадцать дней затонов позади. Исполин признан, путь пройден.",
      platinum: "Изумрудный исполин в ваших руках. Тишина, которая стоила того."
    },
    ref: {
      bronze: "Один друг, и ветер сменился на попутный.",
      silver: "Компания собралась. Вместе дельта кажется ближе.",
      gold: "Целая артель на воде: так начинаются настоящие рыбацкие истории."
    },
    voice: { voice: "Вас слышит вся Волга. Двадцать друзей, платина в кармане, ваше слово весомо." },
    first: { bronze: "Капля упала, круги пошли. Первая отметка на этапе тура." },
    delta: {
      bronze: "Две протоки пройдены: дельта открывается тому, кто идёт дальше.",
      silver: "Три рукава Волги позади. Карта дельты уже в голове.",
      gold: "Все пять туров пройдены. Хозяин дельты не теряется ни в одной протоке."
    },
    night: {
      silver: "Вы вышли в окно Млечного Пути. Над степью развернулась река звёзд.",
      gold: "Три звёздные ночи на воде. Небо над дельтой знает вас в лицо."
    },
    released: {
      bronze: "Трофей ушёл обратно в воду. Тихая вода запомнит этот жест.",
      silver: "Три рыбы вернулись в реку из ваших рук. Это дорогого стоит.",
      gold: "Пять вернувшихся трофеев. Плёс будет жив и для тех, кто придёт потом."
    },
    scribe: {
      bronze: "Первая строка в дневнике дельты. Дальше пойдёт легче.",
      silver: "Пять дней с записями: у реки появилась своя летопись.",
      gold: "Пятнадцать дней записаны в отчётах. Вы летописец этой воды."
    }
  };
  /* Условия: что нужно сделать, чтобы получить медаль */
  const HOW = {
    tour: {
      bronze: "засчитать половину дней тура",
      silver: "засчитать три четверти дней тура",
      gold: "засчитать все дни и отправить хотя бы один отчёт о поимке"
    },
    platinum: "проверенный трофей с достойным для вида весом: фото рыбы целиком и вес, проверяет модерация",
    ref: { bronze: "1–2 друга оформили Pro", silver: "3–4 друга оформили Pro", gold: "5 друзей оформили Pro" },
    voice: "20 друзей с Pro и хотя бы одна платиновая медаль",
    first: { bronze: "отметиться на любом этапе любого тура" },
    delta: { bronze: "получить медали в 2 разных турах", silver: "получить медали в 3 разных турах", gold: "получить медали во всех 5 турах" },
    night: { silver: "отметиться на этапе в окно Млечного Пути (новолуние ±3 дня, май – июль)", gold: "отметиться в окно Млечного Пути в 3 разных дня" },
    released: { bronze: "трофей, который вы отпустили, подтверждён", silver: "3 подтверждённых трофея отпущены", gold: "5 подтверждённых трофеев отпущены" },
    scribe: { bronze: "отправить отчёт о поимке", silver: "отчёты в 5 разных дней", gold: "отчёты в 15 разных дней" }
  };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  const f1 = n => (Math.round(n * 100) / 100).toString();

  /* Серия медали: по ней берутся тема, название, стих */
  function seriesOf(m) {
    if (m.kind === "tour" || m.kind === "platinum") return FISH[m.fish] ? m.fish : "carp";
    if (m.kind === "badge") return NAMES[m.badge] ? m.badge : "first";
    return m.kind === "voice" ? "voice" : "ref";
  }
  function nameOf(m) {
    const s = seriesOf(m), n = NAMES[s] || {};
    return n[m.kind === "voice" ? "voice" : m.level] || n.gold || n.bronze || "Медаль";
  }
  function verseOf(m) {
    const s = seriesOf(m), v = VERSE[s] || {};
    return v[m.kind === "voice" ? "voice" : m.level] || "";
  }
  function howOf(m) {
    if (m.kind === "tour") return HOW.tour[m.level] || "";
    if (m.kind === "platinum") return HOW.platinum;
    if (m.kind === "voice") return HOW.voice;
    const h = HOW[m.kind === "badge" ? m.badge : m.kind];
    return (h && h[m.level]) || "";
  }

  /* ---------------- силуэты и значки ---------------- */
  /* Силуэт рыбы. x, y — центр, w — ширина. Рельеф: тень, градиент металла, светлая кромка. */
  function fishShape(id, cx, cy, w, ink, eyeFill, opt) {
    const f = FISH[id] || FISH.carp;
    opt = opt || {};
    const k = w / 124;
    const fill = opt.fill || ink;
    const g = [];
    const draw = (extra) => {
      const parts = [];
      parts.push(`<path d="${f.body}"/>`);
      f.fins.forEach(d => parts.push(`<path d="${d}"/>`));
      (f.lines || []).forEach(d => parts.push(`<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`));
      return parts.join("");
    };
    const rot = opt.rot ? ` rotate(${opt.rot} 62 30)` : "";
    g.push(`<g transform="translate(${f1(cx - 62 * k)} ${f1(cy - 30 * k)}) scale(${k.toFixed(4)})${rot}">`);
    if (opt.relief) {
      g.push(`<g fill="#000" color="#000" opacity=".38" transform="translate(2.2 3)">${draw()}</g>`);
    }
    g.push(`<g fill="${fill}" color="${opt.line || ink}" stroke="${opt.edge || "none"}" stroke-width="${opt.edge ? 1.1 : 0}" stroke-linejoin="round">${draw()}</g>`);
    (f.scales || []).forEach(d => g.push(`<path d="${d}" fill="none" stroke="${eyeFill}" stroke-opacity=".55" stroke-width="1.2" stroke-linecap="round"/>`));
    (f.extra || []).forEach(d => g.push(`<path d="${d}" fill="none" stroke="${eyeFill}" stroke-opacity=".7" stroke-width="1.3" stroke-linecap="round"/>`));
    g.push(`<circle cx="${f.eye[0]}" cy="${f.eye[1]}" r="2.8" fill="${eyeFill}"/><circle cx="${f.eye[0] - .7}" cy="${f.eye[1] - .8}" r=".9" fill="#fff" opacity=".85"/>`);
    g.push("</g>");
    return g.join("");
  }

  const star = (x, y, r, fill, op) => {
    const pts = [];
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, rr = i % 2 ? r * 0.28 : r; pts.push(f1(x + rr * Math.cos(a)) + " " + f1(y + rr * Math.sin(a))); }
    return `<path d="M${pts.join("L")}Z" fill="${fill || "#fff"}"${op != null ? ` opacity="${op}"` : ""}/>`;
  };
  const star5 = (x, y, r, fill) => {
    const pts = [];
    for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; pts.push(f1(x + rr * Math.cos(a)) + " " + f1(y + rr * Math.sin(a))); }
    return `<path d="M${pts.join("L")}Z" fill="${fill}"/>`;
  };

  /* Значки для медалей без рыбы */
  function peopleShape(cx, cy, s, ink) {
    return `<g transform="translate(${cx} ${cy}) scale(${s})" fill="${ink}"><circle cx="-20" cy="-16" r="9"/><path d="M-37 18C-37 3 -30 -3 -20 -3C-10 -3 -3 3 -3 18Z"/><circle cx="20" cy="-16" r="9"/><path d="M3 18C3 3 10 -3 20 -3C30 -3 37 3 37 18Z"/><circle cx="0" cy="-24" r="11"/><path d="M-19 20C-19 3 -11 -6 0 -6C11 -6 19 3 19 20Z"/></g>`;
  }
  function megaphoneShape(cx, cy, s, ink) {
    return `<g transform="translate(${cx} ${cy}) scale(${s})" fill="${ink}"><path d="M-30 -10L10 -30V30L-30 10Z"/><rect x="-42" y="-12" width="14" height="24" rx="4"/><path d="M-26 12L-18 36H-6L-12 17Z"/><path d="M22 -14Q36 0 22 14" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/><path d="M30 -26Q54 0 30 26" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/></g>`;
  }
  function dropShape(cx, cy, s, ink, hi) {
    return `<g transform="translate(${cx} ${cy}) scale(${s})"><path d="M0 -34C8 -20 16 -10 16 0C16 9 9 16 0 16C-9 16 -16 9 -16 0C-16 -10 -8 -20 0 -34Z" fill="${ink}"/><path d="M-6 -4C-8 4 -4 10 2 11" fill="none" stroke="${hi}" stroke-width="3" stroke-linecap="round" opacity=".7"/></g>
      <g fill="none" stroke="${ink}" stroke-linecap="round"><ellipse cx="${cx}" cy="${cy + 26 * s}" rx="${26 * s}" ry="${7 * s}" stroke-width="3"/><ellipse cx="${cx}" cy="${cy + 26 * s}" rx="${42 * s}" ry="${12 * s}" stroke-width="2.4" opacity=".8"/><ellipse cx="${cx}" cy="${cy + 26 * s}" rx="${58 * s}" ry="${17 * s}" stroke-width="2" opacity=".55"/></g>`;
  }
  function deltaShape(cx, cy, s, ink) {
    /* ствол реки делится на рукава и впадает в море */
    return `<g transform="translate(${cx} ${cy}) scale(${s})" fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M0 -40C0 -26 -2 -18 -6 -8" stroke-width="7"/>
      <path d="M-6 -8C-14 2 -26 8 -38 24" stroke-width="5"/><path d="M-6 -8C-8 6 -12 16 -18 30" stroke-width="4.4"/>
      <path d="M-6 -8C-2 6 2 18 4 32" stroke-width="4.6"/><path d="M-6 -8C4 0 16 10 24 28" stroke-width="4.2"/><path d="M-6 -8C8 -6 24 -2 40 14" stroke-width="3.6"/>
      <path d="M-46 34Q-34 28 -22 34T2 34T26 34T48 32" stroke-width="2.6" opacity=".8"/><path d="M-40 42Q-28 37 -16 42T8 42T32 40" stroke-width="2.2" opacity=".6"/></g>
      <g fill="${ink}" opacity=".75"><ellipse cx="${cx - 18 * s}" cy="${cy + 6 * s}" rx="${5 * s}" ry="${2.6 * s}"/><ellipse cx="${cx + 14 * s}" cy="${cy + 12 * s}" rx="${6 * s}" ry="${2.8 * s}"/></g>`;
  }
  function nightShape(cx, cy, s, ink, tint) {
    const dots = [[-34, -20, 1.5], [-22, 8, 1.1], [-8, -34, 1.4], [14, -26, 1.2], [30, -4, 1.5], [36, 22, 1.1], [-30, 26, 1.3], [4, 22, 1], [-14, -8, 1], [22, 12, 1.1], [-2, 2, 1.2], [26, -34, 1]];
    return `<g transform="translate(${cx} ${cy}) scale(${s})">
      <g transform="rotate(-32)"><rect x="-62" y="-11" width="124" height="22" rx="11" fill="url(#__NIGHT__)" opacity=".7"/><g fill="#fff" opacity=".8">${[-50,-40,-33,-26,-18,-11,-3,5,12,20,28,36,44,52].map((x,i)=>`<circle cx="${x}" cy="${(i%3-1)*4.2}" r="${i%4===0?1.3:.8}"/>`).join("")}</g></g>
      <g fill="${ink}">${dots.map(d => `<circle cx="${d[0]}" cy="${d[1]}" r="${d[2]}"/>`).join("")}</g>
      <path d="M-18 -24a16 16 0 1 0 18 26a13 13 0 1 1 -18 -26z" fill="${ink}" transform="translate(-4 -10) scale(.9)"/>
      ${star(26, -24, 7, ink)}${star(-34, 14, 5, ink)}${star(34, 24, 4, ink)}${star(-6, 30, 4, ink)}</g>`;
  }
  function releasedShape(cx, cy, s, ink, edge) {
    return `<g fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M${cx - 44 * s} ${cy + 22 * s}C${cx - 28 * s} ${cy - 30 * s} ${cx + 16 * s} ${cy - 40 * s} ${cx + 30 * s} ${cy - 18 * s}" stroke-width="2.6" stroke-dasharray="1 6"/>
      <path d="M${cx - 50 * s} ${cy + 34 * s}Q${cx - 38 * s} ${cy + 28 * s} ${cx - 26 * s} ${cy + 34 * s}T${cx - 2 * s} ${cy + 34 * s}T${cx + 22 * s} ${cy + 34 * s}T${cx + 48 * s} ${cy + 34 * s}" stroke-width="3"/>
      <path d="M${cx - 44 * s} ${cy + 44 * s}Q${cx - 32 * s} ${cy + 39 * s} ${cx - 20 * s} ${cy + 44 * s}T${cx + 4 * s} ${cy + 44 * s}T${cx + 28 * s} ${cy + 44 * s}" stroke-width="2.4" opacity=".6"/></g>
      <g fill="${ink}"><circle cx="${cx + 38 * s}" cy="${cy - 8 * s}" r="${2.6 * s}"/><circle cx="${cx + 44 * s}" cy="${cy + 4 * s}" r="${2 * s}"/><circle cx="${cx - 12 * s}" cy="${cy - 32 * s}" r="${2 * s}"/></g>
      ${fishShape("carp", cx + 8 * s, cy - 6 * s, 66 * s, ink, edge, { rot: -26 })}`;
  }
  function scribeShape(cx, cy, s, ink, hi) {
    return `<g transform="translate(${cx} ${cy}) scale(${s})">
      <rect x="-40" y="2" width="62" height="34" rx="4" fill="${ink}" opacity=".92"/><g stroke="${hi}" stroke-width="2.4" stroke-linecap="round" opacity=".75"><path d="M-32 12H14"/><path d="M-32 20H8"/><path d="M-32 28H16"/></g>
      <path d="M-30 30C-24 -14 12 -44 44 -46C42 -12 14 22 -30 30Z" fill="${ink}"/>
      <path d="M-30 30C-6 4 18 -18 40 -42" fill="none" stroke="${hi}" stroke-width="2.2" stroke-linecap="round" opacity=".85"/>
      <g stroke="${hi}" stroke-width="1.4" stroke-linecap="round" opacity=".6"><path d="M-14 12L-6 18"/><path d="M-2 0L8 6"/><path d="M10 -14L20 -8"/><path d="M-6 -2L-12 6"/><path d="M8 -18L2 -8"/></g></g>`;
  }

  /* ---------------- сцены на эмали: вода, камыш, солнце, луна ---------------- */
  function wavePath(y, x0, x1, amp, len) {
    let d = `M${x0} ${y}`;
    for (let x = x0; x < x1; x += len) d += `q${f1(len / 4)} ${-amp} ${f1(len / 2)} 0t${f1(len / 2)} 0`;
    return d;
  }
  function reeds(cx, cy, side, tint, dark) {
    const g = [`<g stroke="${tint}" stroke-width="1.5" stroke-linecap="round" fill="none" opacity=".75">`];
    const x0 = cx + side * 50;
    [[0, 0, -4], [6, 8, -3], [-6, -6, -5]].forEach(([dx, dh, lean], i) => {
      const bx = x0 + side * dx, top = cy - 34 + dh * 1.4 + i * 2;
      g.push(`<path d="M${f1(bx)} ${cy + 34}C${f1(bx + side * lean)} ${cy}, ${f1(bx + side * lean * 1.8)} ${cy - 14}, ${f1(bx + side * lean * 2.4)} ${f1(top)}"/>`);
    });
    g.push("</g>");
    [[0, -34], [6, -26], [-6, -30]].forEach(([dx, ty], i) => {
      const bx = x0 + side * dx + side * [-9.6, -7.2, -12][i] * 0.9;
      g.push(`<ellipse cx="${f1(bx)}" cy="${cy + ty + [0, 8, 3][i] * 1.4}" rx="2.1" ry="6.2" fill="${dark}" opacity=".9" transform="rotate(${side * 6} ${f1(bx)} ${cy + ty})"/>`);
    });
    return g.join("");
  }
  function scene(fish, cx, cy, th) {
    const t = th.tint, d = th.face[1];
    const g = [];
    const water = (y) => `<path d="${wavePath(y, cx - 66, cx + 66, 2.2, 22)}" fill="none" stroke="${t}" stroke-width="1.5" opacity=".5"/>`;
    if (fish === "pike") {
      g.push(`<circle cx="${cx + 26}" cy="${cy - 30}" r="12" fill="${t}" opacity=".5"/><circle cx="${cx + 26}" cy="${cy - 30}" r="17" fill="none" stroke="${t}" stroke-opacity=".28" stroke-width="2"/>`);
      g.push(reeds(cx, cy, -1, t, d), reeds(cx, cy, 1, t, d));
      g.push(water(cy + 30), water(cy + 40), water(cy + 50));
    } else if (fish === "carp") {
      g.push(`<g stroke="${t}" stroke-width="2" stroke-linecap="round" opacity=".55">${Array.from({ length: 13 }, (_, i) => { const a = (-90 + (i - 6) * 13) * Math.PI / 180; return `<path d="M${f1(cx + Math.cos(a) * 24)} ${f1(cy + 8 + Math.sin(a) * 24)}L${f1(cx + Math.cos(a) * 54)} ${f1(cy + 8 + Math.sin(a) * 54)}"/>`; }).join("")}</g>`);
      g.push(`<circle cx="${cx}" cy="${cy + 8}" r="19" fill="${t}" opacity=".78"/>`);
      g.push(`<rect x="${cx - 70}" y="${cy + 26}" width="140" height="50" fill="${d}" opacity=".45"/>`, water(cy + 28), water(cy + 38), water(cy + 48));
    } else if (fish === "zander") {
      g.push(`<path d="M${cx + 30} ${cy - 44}a15 15 0 1 0 14 22a12 12 0 1 1 -14 -22z" fill="${t}" opacity=".88"/>`);
      [[-40, -34, 2], [-22, -44, 1.5], [-10, -26, 1.4], [8, -48, 1.4], [-48, -12, 1.6], [46, -10, 1.3]].forEach(a => g.push(star(cx + a[0], cy + a[1], a[2] * 2.2, t, .8)));
      g.push(`<rect x="${cx - 70}" y="${cy + 26}" width="140" height="50" fill="${d}" opacity=".45"/>`, water(cy + 28), water(cy + 38), water(cy + 48));
    } else if (fish === "catfish") {
      g.push(`<g fill="${t}" opacity=".14"><path d="M${cx - 30} ${cy - 66}L${cx - 6} ${cy - 66}L${cx + 22} ${cy + 66}L${cx - 46} ${cy + 66}Z"/><path d="M${cx + 8} ${cy - 66}L${cx + 26} ${cy - 66}L${cx + 58} ${cy + 66}L${cx + 20} ${cy + 66}Z"/></g>`);
      [[-36, 22, 4], [-30, 8, 2.6], [-40, -6, 1.8], [38, -20, 3.4], [44, -34, 2], [32, 6, 2.2], [-12, -40, 2.4]].forEach(b => g.push(`<circle cx="${cx + b[0]}" cy="${cy + b[1]}" r="${b[2]}" fill="none" stroke="${t}" stroke-width="1.3" opacity=".7"/>`));
      g.push(`<path d="M${cx - 66} ${cy + 44}Q${cx - 40} ${cy + 30} ${cx - 14} ${cy + 46}T${cx + 40} ${cy + 44}T${cx + 66} ${cy + 46}V${cy + 70}H${cx - 66}Z" fill="${d}" opacity=".5"/>`);
    } else {      // grasscarp
      g.push(reeds(cx, cy, -1, t, d), reeds(cx, cy, 1, t, d));
      g.push(`<g fill="${t}" opacity=".5"><ellipse cx="${cx - 34}" cy="${cy + 36}" rx="16" ry="4.6"/><ellipse cx="${cx + 30}" cy="${cy + 40}" rx="19" ry="5"/><ellipse cx="${cx + 2}" cy="${cy + 48}" rx="14" ry="3.6"/></g>`);
      g.push(`<g fill="${t}" opacity=".85"><circle cx="${cx - 34}" cy="${cy + 33}" r="3"/><circle cx="${cx + 30}" cy="${cy + 36.5}" r="3.4"/></g>`);
      g.push(water(cy + 30));
    }
    return g.join("");
  }

  /* Лавр: листья по дуге вокруг центра (сторона = ±1), n листьев на ветвь */
  function laurel(cx, cy, R, n, fillA, fillB, edge) {
    const out = [];
    [-1, 1].forEach(side => {
      for (let k = 0; k < n; k++) {
        const t = k / Math.max(1, n - 1);
        const ang = (90 - side * (14 + t * 150)) * Math.PI / 180;      // от низа вверх по обеим сторонам
        const px = cx + R * Math.cos(ang), py = cy + R * Math.sin(ang);
        const dir = ang - side * Math.PI / 2;                          // направление роста ветви
        [[1, fillA, 34], [-1, fillB, 34]].forEach(([io, fill, tilt]) => {
          const rot = (dir * 180 / Math.PI) + io * side * tilt;
          const ox = px + Math.cos(ang) * io * 3.2, oy = py + Math.sin(ang) * io * 3.2;
          out.push(`<ellipse cx="${f1(ox)}" cy="${f1(oy)}" rx="${f1(8.2 - t * 1.6)}" ry="${f1(3.5 - t * 0.5)}" transform="rotate(${f1(rot)} ${f1(ox)} ${f1(oy)})" fill="${fill}" stroke="${edge}" stroke-width=".6" stroke-opacity=".7"/>`);
        });
      }
    });
    return out.join("");
  }

  /* Многоугольник или звезда-солнце вокруг медали */
  function poly(n, r, cx, cy, rot) {
    const pts = [];
    for (let i = 0; i < n; i++) { const a = (rot || 0) + i * 2 * Math.PI / n; pts.push(f1(cx + r * Math.cos(a)) + " " + f1(cy + r * Math.sin(a))); }
    return "M" + pts.join("L") + "Z";
  }
  function burst(n, r1, r2, cx, cy) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? r2 : r1; pts.push(f1(cx + r * Math.cos(a)) + " " + f1(cy + r * Math.sin(a))); }
    return "M" + pts.join("L") + "Z";
  }

  let uid = 0;
  /* Медаль. m = { kind, level, fish, badge, ringTop, ringBottom }. Размер 240×300. */
  function medalSVG(m, opt) {
    opt = opt || {};
    const n = ++uid, pre = "mdl" + n;
    const level = METAL[m.level] ? m.level : "gold";
    const c = METAL[level];
    const series = seriesOf(m);
    const th = THEME[m.kind === "platinum" ? (FISH[m.fish] ? m.fish : "platinum") : series] || THEME.ref;
    const CX = 120, CY = 176;
    const isPlat = level === "platinum", isVoice = m.kind === "voice";
    const top = esc(m.ringTop || ""), bot = esc(m.ringBottom || "");

    /* лента */
    const ra = isPlat ? THEME.platinum : th;
    const ribbon = `
      <path d="M62 0H108L146 122H100Z" fill="${ra.a}"/><path d="M62 0H80L118 122H100Z" fill="#000" opacity=".22"/>
      <path d="M81 0H89L127 122H119Z" fill="${ra.s}" opacity=".92"/><path d="M62 0H108M146 122H100" stroke="#000" stroke-opacity=".25" stroke-width="1"/>
      <path d="M178 0H132L94 122H140Z" fill="${ra.b}"/><path d="M178 0H160L122 122H140Z" fill="#000" opacity=".25"/>
      <path d="M151 0H159L121 122H113Z" fill="${ra.s}" opacity=".92"/><path d="M132 0H178" stroke="#000" stroke-opacity=".25" stroke-width="1"/>`;

    /* серединная эмаль и рисунок */
    let art;
    const fishFill = `url(#${pre}m)`;
    const fishInk = c.ink;
    if (m.kind === "tour" || m.kind === "platinum") {
      art = scene(series, CX, CY, th) + fishShape(m.fish, CX, CY - 2, 84, fishInk, th.face[1], { fill: fishFill, relief: true, edge: c.lo, line: c.mid });
    } else if (m.kind === "ref") art = `<g opacity=".9">${star5(CX, CY - 40, 6, c.hi)}</g>` + peopleShape(CX, CY + 6, 1.05, fishFill).replace(/<g /, `<g stroke="${c.lo}" stroke-width=".9" `);
    else if (isVoice) art = `<g stroke="${c.hi}" stroke-width="2" stroke-linecap="round" opacity=".5">${Array.from({ length: 16 }, (_, i) => { const a = i * Math.PI / 8; return `<path d="M${f1(CX + Math.cos(a) * 30)} ${f1(CY + Math.sin(a) * 30)}L${f1(CX + Math.cos(a) * 58)} ${f1(CY + Math.sin(a) * 58)}"/>`; }).join("")}</g>` + megaphoneShape(CX, CY + 2, 1.05, fishFill);
    else if (series === "first") art = dropShape(CX, CY - 8, 1.15, fishFill, th.tint);
    else if (series === "delta") art = deltaShape(CX, CY - 2, 1.12, fishFill);
    else if (series === "night") art = nightShape(CX, CY, 1.05, c.hi, th.tint).replace("__NIGHT__", pre + "n");
    else if (series === "released") art = releasedShape(CX, CY - 2, 1.0, fishFill, th.face[1]);
    else art = scribeShape(CX, CY - 2, 1.12, fishFill, th.face[1]);

    /* форма рамки */
    let frame;
    const frameFill = `url(#${pre}g)`;
    if (isPlat || isVoice) frame = `<path d="${burst(24, 98, 89, CX, CY)}" fill="${frameFill}" stroke="${c.rim}" stroke-width="1.4" stroke-linejoin="round"/>`;
    else if (series === "delta") frame = `<path d="${poly(6, 90, CX, CY, Math.PI / 6)}" fill="${frameFill}" stroke="${c.rim}" stroke-width="7" stroke-linejoin="round" paint-order="stroke"/>`;
    else if (series === "scribe") frame = `<path d="${poly(8, 90, CX, CY, Math.PI / 8)}" fill="${frameFill}" stroke="${c.rim}" stroke-width="6" stroke-linejoin="round" paint-order="stroke"/>`;
    else frame = `<circle cx="${CX}" cy="${CY}" r="90" fill="${frameFill}" stroke="${c.rim}" stroke-width="2"/>`;

    const laurelN = level === "bronze" ? 0 : level === "silver" ? 6 : 9;
    const wreath = (laurelN && (m.kind === "tour" || m.kind === "platinum" || series === "delta" || series === "scribe" || series === "released" || series === "ref" || series === "first" || series === "night"))
      ? laurel(CX, CY, 51, laurelN, `url(#${pre}h)`, `url(#${pre}g)`, c.lo) : "";
    const crown = (level === "gold" || isPlat) ? star5(CX, CY - 55, 5.4, `url(#${pre}h)`) + `<circle cx="${CX}" cy="${CY - 55}" r="6.4" fill="none" stroke="${c.lo}" stroke-opacity=".5" stroke-width=".8"/>` : "";

    const sparkles = isPlat || isVoice || series === "night" || level === "gold"
      ? `<g fill="#fff" opacity=".92">${star(32, 118, 7)}${star(208, 232, 6)}${star(206, 108, 5)}${isPlat || isVoice ? star(34, 240, 4.4) : ""}</g>` : "";
    const fsz = s => Math.max(6.4, Math.min(11.5, 150 / Math.max(6, String(s).length)));
    const topS = fsz(m.ringTop || ""), botS = Math.min(10.5, fsz(m.ringBottom || "") * 0.95);
    const faceG = `<radialGradient id="${pre}f" cx=".38" cy=".3" r=".95"><stop offset="0" stop-color="${th.face[0]}"/><stop offset="1" stop-color="${th.face[1]}"/></radialGradient>`;
    const txt = (path, size, ls, label) => `
      <text font-family="Georgia, 'Times New Roman', serif" font-size="${f1(size)}" font-weight="700" letter-spacing="${f1(ls)}" fill="#fff" fill-opacity=".55" text-anchor="middle" transform="translate(.5 .7)"><textPath href="#${path}" xlink:href="#${path}" startOffset="50%">${label}</textPath></text>
      <text font-family="Georgia, 'Times New Roman', serif" font-size="${f1(size)}" font-weight="700" letter-spacing="${f1(ls)}" fill="${c.ink}" text-anchor="middle"><textPath href="#${path}" xlink:href="#${path}" startOffset="50%">${label}</textPath></text>`;
    const isRound = !(series === "delta" || series === "scribe" || isPlat || isVoice);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 300" role="img" aria-label="${esc(opt.label || "Медаль")}">
  <defs>
    <linearGradient id="${pre}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.hi}"/><stop offset=".28" stop-color="${c.mid}"/><stop offset=".55" stop-color="${c.lo}"/><stop offset=".78" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.hi}" stop-opacity=".95"/></linearGradient>
    <linearGradient id="${pre}h" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c.hi}"/><stop offset=".5" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.lo}"/></linearGradient>
    <linearGradient id="${pre}m" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="124" y2="60"><stop offset="0" stop-color="${c.hi}"/><stop offset=".45" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.lo}"/></linearGradient>
    <linearGradient id="${pre}n" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <radialGradient id="${pre}s" cx=".3" cy=".22" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".5" stop-color="#fff" stop-opacity=".03"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></radialGradient>
    ${faceG}
    <clipPath id="${pre}c"><circle cx="${CX}" cy="${CY}" r="62"/></clipPath>
    <clipPath id="${pre}k"><circle cx="${CX}" cy="${CY}" r="90"/></clipPath>
    <filter id="${pre}b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.2"/></filter>
    <path id="${pre}t" d="M${CX - 67} ${CY}A67 67 0 0 1 ${CX + 67} ${CY}"/>
    <path id="${pre}d" d="M${CX - 77} ${CY}A77 77 0 0 0 ${CX + 77} ${CY}"/>
  </defs>
  ${ribbon}
  <g><circle cx="${CX}" cy="84" r="9.5" fill="none" stroke="${c.rim}" stroke-width="4.4"/><circle cx="${CX}" cy="84" r="9.5" fill="none" stroke="url(#${pre}g)" stroke-width="2.6"/></g>
  <ellipse cx="${CX}" cy="${CY + 12}" rx="86" ry="84" fill="#000" opacity=".34" filter="url(#${pre}b)"/>
  ${frame}
  ${isRound ? `<circle cx="${CX}" cy="${CY}" r="86.2" fill="none" stroke="${c.hi}" stroke-opacity=".7" stroke-width="3.6" stroke-dasharray="0.1 6.1" stroke-linecap="round"/>` : `<circle cx="${CX}" cy="${CY}" r="85" fill="none" stroke="${c.lo}" stroke-opacity=".35" stroke-width="1.4"/>`}
  <circle cx="${CX}" cy="${CY}" r="82" fill="url(#${pre}h)" stroke="${c.rim}" stroke-width="1.2"/>
  <circle cx="${CX}" cy="${CY}" r="62.8" fill="none" stroke="${c.hi}" stroke-opacity=".8" stroke-width="1.6"/>
  <circle cx="${CX}" cy="${CY}" r="62" fill="url(#${pre}f)" stroke="${c.lo}" stroke-width="1.6"/>
  <g clip-path="url(#${pre}c)">
    ${art}
    ${wreath ? "" : ""}
  </g>
  ${wreath}
  ${crown}
  ${star(CX - 74.5, CY, 4.6, c.ink)}${star(CX + 74.5, CY, 4.6, c.ink)}
  ${txt(pre + "t", topS, topS * 0.2, top)}
  ${txt(pre + "d", botS, botS * 0.18, bot)}
  <circle cx="${CX}" cy="${CY}" r="90" fill="url(#${pre}s)" clip-path="url(#${pre}k)" pointer-events="none"/>
  <g clip-path="url(#${pre}k)"><g class="shine" opacity=".22"><path d="M${CX - 96} ${CY + 84}L${CX - 50} ${CY - 96}L${CX - 38} ${CY - 96}L${CX - 84} ${CY + 84}Z" fill="#fff"/></g></g>
  ${sparkles}
</svg>`.replace("<svg ", '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ');
  }

  /* Подписи под медалью */
  function lines(m) {
    const L = [];
    const add = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== "") L.push([k, String(v)]); };
    if (m.kind === "tour") {
      add("Тур", m.tourTitle);
      add("Рыба", m.fishName);
      add("Где", [m.district, m.places].filter(Boolean).join(": "));
      add("Когда", m.when);
      add("Засчитано дней", m.daysDone != null ? m.daysDone + " из " + m.days : "");
      add("Сложность", m.difficulty);
    } else if (m.kind === "platinum") {
      add("Рыба", m.fishName);
      add("Вес", m.weightKg != null ? String(m.weightKg).replace(".", ",") + " кг" : "");
      add("Длина", m.lengthCm != null ? m.lengthCm + " см" : "");
      add("Приманка", m.bait);
      add("Где", m.place);
      add("Когда", m.when);
      add("Тур", m.tourTitle);
      add("Отпущена", m.released === true ? "да" : m.released === false ? "нет" : "");
    } else if (m.kind === "ref") {
      add("Друзей с Pro", m.friends);
      add("Когда", m.when);
    } else if (m.kind === "voice") {
      add("Друзей с Pro", m.friends);
      add("Платиновых медалей", m.platinum);
      add("Когда", m.when);
    } else if (m.kind === "badge") {
      add("За что", howOf(m));
      if (m.badge === "delta") add("Туров с медалью", m.count);
      if (m.badge === "night") add("Дней в окне", m.count);
      if (m.badge === "released") add("Отпущено трофеев", m.count);
      if (m.badge === "scribe") add("Дней с отчётом", m.count);
      add("Когда", m.when);
    }
    return L;
  }
  /* Главное имя медали: поэтичное; рядом всегда есть подпись с уровнем */
  function title(m) { return nameOf(m); }
  function subtitle(m) {
    if (m.kind === "voice") return "Главная награда СТЕПИ";
    const lvl = LEVEL_ADJ[m.level] || "";
    if (m.kind === "tour") return lvl + " медаль · тур «" + String(m.tourTitle || "").split(":")[0] + "»";
    if (m.kind === "platinum") return "Платиновая медаль · " + (m.fishName || "трофей");
    if (m.kind === "ref") return lvl + " медаль друзей";
    return lvl + " медаль";
  }
  function dayWord(n) { n = Math.abs(n) % 100; const d = n % 10; return n > 10 && n < 20 ? "ДНЕЙ" : d === 1 ? "ДЕНЬ" : d >= 2 && d <= 4 ? "ДНЯ" : "ДНЕЙ"; }
  function ringTexts(m) {
    const name = nameOf(m).toUpperCase();
    if (m.kind === "tour") return { ringTop: name, ringBottom: (LEVEL_RU[m.level] || "").toUpperCase() + (m.days ? " · " + m.days + " " + dayWord(m.days) : "") };
    if (m.kind === "platinum") return { ringTop: name, ringBottom: m.weightKg != null ? (String(m.weightKg).replace(".", ",") + " КГ") : "ПЛАТИНА" };
    if (m.kind === "ref") return { ringTop: name, ringBottom: m.friends != null ? "ДРУЗЕЙ С PRO: " + m.friends : "ДРУЗЬЯ В АТЛАСЕ" };
    if (m.kind === "voice") return { ringTop: name, ringBottom: "СТЕПЬ" };
    const bot = { first: "ПЕРВАЯ ОТМЕТКА", delta: m.count != null ? "ТУРОВ С МЕДАЛЬЮ: " + m.count : "ДЕЛЬТА ВОЛГИ", night: "ОКНО МЛЕЧНОГО ПУТИ", released: m.count != null ? "ОТПУЩЕНО: " + m.count : "ОТПУЩЕННЫЙ ТРОФЕЙ", scribe: m.count != null ? "ДНЕЙ С ОТЧЁТОМ: " + m.count : "ДНЕВНИК ДЕЛЬТЫ" }[m.badge] || "СТЕПЬ";
    return { ringTop: name, ringBottom: bot };
  }

  function medalFor(m, opt) {
    return medalSVG(Object.assign({}, m, ringTexts(m)), Object.assign({ label: title(m) }, opt || {}));
  }

  /* Вся коллекция: список разделов с медалями (в том числе ещё не полученных).
     tours — туры приложения ([{id, title, target:[рыба], targetNames, days}]).
     Результат: [{ id, title, items:[{ key, medal:{kind, level, ...}, how, name }] }] */
  function catalog(tours) {
    const secs = [];
    const tourList = (tours || []).filter(t => t && t.id && FISH[(t.target || [])[0]]);
    secs.push({
      id: "tours", title: "Туры", items: [].concat(...tourList.map(t => ["bronze", "silver", "gold"].map(level => {
        const fish = t.target[0];
        const med = { kind: "tour", level, fish, fishName: (t.targetNames || [])[0] || "", tourId: t.id, tourTitle: t.title, days: t.days };
        return { key: "tour:" + t.id + ":" + level, medal: med, how: HOW.tour[level], name: nameOf(med), tourId: t.id };
      })))
    });
    secs.push({
      id: "platinum", title: "Платина по рыбе", items: Object.keys(FISH).map(fish => {
        const med = { kind: "platinum", level: "platinum", fish, fishName: ({ pike: "Щука", carp: "Сазан", zander: "Судак", catfish: "Сом", grasscarp: "Белый амур" })[fish] };
        const tour = (tours || []).find(t => t && (t.target || []).includes(fish));
        const hint = tour && ((tour.medals && tour.medals.platinum && tour.medals.platinum.trophyHint) || tour.trophyHint);
        return { key: "plat:" + fish, medal: med, how: hint ? "трофей " + hint + "; фото рыбы целиком, проверяет модерация" : HOW.platinum, name: nameOf(med), fish };
      })
    });
    secs.push({
      id: "friends", title: "Друзья", items: ["bronze", "silver", "gold"].map(level => { const med = { kind: "ref", level }; return { key: "ref:" + level, medal: med, how: HOW.ref[level], name: nameOf(med) }; })
        .concat([{ key: "voice", medal: { kind: "voice", level: "voice" }, how: HOW.voice, name: NAMES.voice.voice }])
    });
    const special = [];
    [["first", ["bronze"]], ["delta", ["bronze", "silver", "gold"]], ["night", ["silver", "gold"]], ["released", ["bronze", "silver", "gold"]], ["scribe", ["bronze", "silver", "gold"]]].forEach(([badge, lv]) => {
      lv.forEach(level => { const med = { kind: "badge", badge, level }; special.push({ key: "badge:" + badge + ":" + level, medal: med, how: HOW[badge][level], name: nameOf(med), badge }); });
    });
    secs.push({ id: "special", title: "Особые награды", items: special });
    return secs;
  }

  /* Карточка для публикации 1080×1350 (SVG-строка). Рисуется крупно и читаемо. */
  function wrap(text, max) {
    const words = String(text).split(/\s+/), out = [];
    let cur = "";
    words.forEach(w => { if ((cur + " " + w).trim().length > max) { if (cur) out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); });
    if (cur) out.push(cur);
    return out;
  }
  function cardSVG(m, who) {
    const ttl = wrap(title(m), 26).slice(0, 2);
    const medal = medalFor(m).replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    const rows = lines(m);
    const verse = wrap(verseOf(m), 50).slice(0, 2);
    const off = ttl.length > 1 ? 52 : 0;
    const subY = 914 + off;
    const verseY = subY + 52;
    const lineY = verseY + (verse.length ? (verse.length - 1) * 34 + 34 : -10);
    let y = lineY + 46, body = "";
    for (const [k, v] of rows) {
      if (m.kind === "tour" && k === "Тур") continue;                 // название тура уже в подписи под именем
      let t = wrap(v, 38)[0] || "";
      if (wrap(v, 38).length > 1) t = t.replace(/[,;:\s]+$/, "") + "…";
      if (y > 1262) break;
      body += `<text x="120" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="25" fill="#9db3a6">${esc(k)}</text>`;
      body += `<text x="400" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="700" fill="#f4f0e4">${esc(t)}</text>`;
      y += 40;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1350" viewBox="0 0 1080 1350">
  <defs><linearGradient id="cardbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c4037"/><stop offset="1" stop-color="#0b1f1b"/></linearGradient>
  <radialGradient id="cardglow" cx=".5" cy=".4" r=".55"><stop offset="0" stop-color="#f3dba0" stop-opacity=".22"/><stop offset="1" stop-color="#f3dba0" stop-opacity="0"/></radialGradient></defs>
  <rect width="1080" height="1350" fill="url(#cardbg)"/><rect width="1080" height="1350" fill="url(#cardglow)"/>
  <text x="540" y="86" text-anchor="middle" font-family="Georgia, serif" font-size="40" letter-spacing="10" fill="#f3dba0">СТЕПЬ</text>
  <text x="540" y="124" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="21" letter-spacing="4" fill="#9db3a6">АТЛАС АСТРАХАНСКОГО КРАЯ</text>
  <g transform="translate(240 142) scale(2.5)">${medal}</g>
  ${ttl.map((t, i) => `<text x="540" y="${862 + i * 52}" text-anchor="middle" font-family="Georgia, serif" font-size="50" fill="#f3dba0">${esc(t)}</text>`).join("")}
  <text x="540" y="${subY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="25" letter-spacing="1" fill="#9db3a6">${esc(subtitle(m))}</text>
  ${verse.map((t, i) => `<text x="540" y="${verseY + i * 34}" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="27" fill="#d9e3d3">${esc(t)}</text>`).join("")}
  <line x1="120" y1="${lineY}" x2="960" y2="${lineY}" stroke="#f3dba0" stroke-opacity=".3"/>
  ${body}
  <text x="540" y="1306" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#9db3a6">${esc(who ? who + " · " : "")}t.me/AtlasFishingbot/atlas</text>
</svg>`;
  }

  root.StepMedals = { medalSVG, medalFor, cardSVG, fishShape, lines, title, subtitle, verse: verseOf, how: howOf, catalog, ringTexts, LEVEL_RU, LEVEL_ADJ, NAMES, FISH_IDS: Object.keys(FISH), esc };
})(typeof window !== "undefined" ? window : globalThis);
