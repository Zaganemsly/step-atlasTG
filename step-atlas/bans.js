/* СТЕПЬ — запреты и правила рыбалки.
   Чистые функции без DOM (проверяются в Node). Данные лежат в data/bans.json и вручную сверяются с источниками. */
(function (root) {
  "use strict";
  const MONTH_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

  function utcDay(d) { return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); }
  function daysBetween(a, b) { return Math.round((utcDay(b) - utcDay(a)) / 86400000); }
  function fmtDM(a) { return a[1] + " " + MONTH_GEN[a[0] - 1]; }
  function fmtDate(d) { return d.getDate() + " " + MONTH_GEN[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""); }
  function parseISO(s) { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); }
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  function daysText(n) { return n + " " + plural(n, "день", "дня", "дней"); }

  /* Ближайшее (или текущее) вхождение сезонного правила. */
  function occurrence(rule, today) {
    const y = today.getFullYear();
    const wrap = rule.from[0] * 100 + rule.from[1] > rule.to[0] * 100 + rule.to[1];
    for (let k = -1; k <= 1; k++) {
      const start = new Date(y + k, rule.from[0] - 1, rule.from[1]);
      const end = new Date(y + k + (wrap ? 1 : 0), rule.to[0] - 1, rule.to[1]);
      if (daysBetween(today, end) >= 0) return { start, end };
    }
    return null;
  }

  function statusOf(rule, today) {
    today = today || new Date();
    if (rule.kind === "permanent") return { state: "always" };
    if (rule.kind === "seasonal") {
      const o = occurrence(rule, today);
      if (daysBetween(o.start, today) >= 0) return { state: "active", start: o.start, end: o.end, daysLeft: daysBetween(today, o.end) };
      return { state: "upcoming", start: o.start, end: o.end, daysToStart: daysBetween(today, o.start) };
    }
    if (rule.kind === "dated") {
      const start = parseISO(rule.start), end = parseISO(rule.end);
      if (daysBetween(today, start) > 0) return { state: "upcoming", start, end, daysToStart: daysBetween(today, start) };
      if (daysBetween(today, end) >= 0) return { state: "active", start, end, daysLeft: daysBetween(today, end) };
      return { state: "expired", start, end, daysSinceEnd: -daysBetween(today, end) };
    }
    return { state: "always" };
  }

  /* Сводка на дату: что действует, что скоро начнётся, что постоянно, что закончилось. */
  function snapshot(data, today) {
    today = today || new Date();
    const out = { today, active: [], upcoming: [], always: [], expired: [] };
    (data.rules || []).forEach(rule => {
      const st = statusOf(rule, today);
      const item = { rule, status: st };
      if (st.state === "active") out.active.push(item);
      else if (st.state === "upcoming") out.upcoming.push(item);
      else if (st.state === "expired") out.expired.push(item);
      else out.always.push(item);
    });
    out.upcoming.sort((a, b) => a.status.daysToStart - b.status.daysToStart);
    const rank = { danger: 0, warn: 1, info: 2 };
    out.active.sort((a, b) => rank[a.rule.level] - rank[b.rule.level]);
    return out;
  }

  /* Одна фраза про статус правила: «действует до 20 июня (ещё 28 дней)» и т. п. */
  function statusLine(item) {
    const st = item.status;
    if (st.state === "always") return "Действует круглый год";
    if (st.state === "active") {
      if (st.daysLeft === 0) return "Действует, сегодня последний день";
      return "Действует до " + fmtDate(st.end) + " (ещё " + daysText(st.daysLeft) + ")";
    }
    if (st.state === "upcoming") return "Начнётся " + fmtDate(st.start) + " (через " + daysText(st.daysToStart) + "), до " + fmtDate(st.end);
    if (st.state === "expired") return "Срок действия закончился " + fmtDate(st.end) + ". Продлён ли запрет, уточняйте";
    return "";
  }

  /* Для годовой шкалы: доли года (0..1) по сезонным правилам. */
  function dayOfYear(m, d) {
    const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    return cum[m - 1] + d - 1;
  }
  function timeline(data) {
    return (data.rules || []).filter(r => r.kind === "seasonal").map(r => {
      const a = dayOfYear(r.from[0], r.from[1]), b = dayOfYear(r.to[0], r.to[1]) + 1;
      const seg = a <= b ? [[a / 365, b / 365]] : [[a / 365, 1], [0, b / 365]];
      return { id: r.id, level: r.level, title: r.title, segments: seg };
    });
  }
  function todayFraction(today) { return dayOfYear(today.getMonth() + 1, today.getDate()) / 365; }

  const api = { statusOf, snapshot, statusLine, timeline, todayFraction, fmtDM, fmtDate, daysText, daysBetween, MONTH_SHORT, MONTH_GEN };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StepBans = api;
})(typeof window !== "undefined" ? window : globalThis);
