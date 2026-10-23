/* СТЕПЬ — заправки и магазины на карте.
   Данные берутся из OpenStreetMap через Overpass API по той части карты, которую вы сейчас смотрите.
   Базы отдыха намеренно не показываются. Загружается после app.js. */
(function () {
  "use strict";
  if (typeof L === "undefined" || typeof map === "undefined") return;
  const layer = L.layerGroup();
  const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  const GROUPS = [
    { id: "core", size: 0.5, minZoom: 9, body: b => 'nwr["amenity"="fuel"](' + b + ');nwr["shop"="fishing"](' + b + ');' },
    { id: "shops", size: 0.1, minZoom: 12, body: b => 'nwr["shop"~"^(convenience|supermarket|general|variety_store)$"](' + b + ');' }
  ];
  const KIND = {
    fuel: { glyph: "⛽", label: "Заправка" },
    fishing: { glyph: "🎣", label: "Рыболовный магазин" },
    shop: { glyph: "🛒", label: "Магазин" }
  };
  const items = new Map();   // "n123" -> { id, kind, lat, lng, tags }
  const done = new Set();    // "core:12:34"
  let enabled = true;
  try { enabled = localStorage.getItem("stepServices") !== "0"; } catch (_) {}
  let timer = null, busy = false, warned = false;

  function kindOf(tags) {
    if (tags.amenity === "fuel") return "fuel";
    if (tags.shop === "fishing") return "fishing";
    return "shop";
  }
  async function overpass(query) {
    let lastErr;
    for (const url of ENDPOINTS) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25000);
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query), signal: ctrl.signal });
        if (!res.ok) throw new Error("HTTP " + res.status);
        return await res.json();
      } catch (e) { lastErr = e; } finally { clearTimeout(t); }
    }
    throw lastErr;
  }

  async function ensure() {
    if (!enabled || busy) return;
    const z = map.getZoom();
    const b = map.getBounds();
    const s = b.getSouth(), w = b.getWest(), n = b.getNorth(), e = b.getEast();
    for (const g of GROUPS) {
      if (z < g.minZoom) continue;
      const ix0 = Math.floor(w / g.size), ix1 = Math.floor(e / g.size), iy0 = Math.floor(s / g.size), iy1 = Math.floor(n / g.size);
      if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) > 9) continue; // слишком большая область
      for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) {
        const key = g.id + ":" + ix + ":" + iy;
        if (done.has(key)) continue;
        busy = true;
        try {
          const bbox = [iy * g.size, ix * g.size, (iy + 1) * g.size, (ix + 1) * g.size].map(x => x.toFixed(4)).join(",");
          const j = await overpass("[out:json][timeout:25];(" + g.body(bbox) + ");out center tags 400;");
          (j.elements || []).forEach(el => {
            const lat = el.lat !== undefined ? el.lat : el.center && el.center.lat;
            const lng = el.lon !== undefined ? el.lon : el.center && el.center.lon;
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || !el.tags) return;
            items.set(el.type[0] + el.id, { id: el.type[0] + el.id, kind: kindOf(el.tags), lat, lng, tags: el.tags });
          });
          done.add(key);
        } catch (err) {
          if (!warned) { warned = true; toast("Заправки и магазины сейчас не загрузились. Попробуйте позже."); }
        } finally { busy = false; }
        redraw();
      }
    }
    redraw();
  }

  function popupFor(it) {
    const t = it.tags, k = KIND[it.kind];
    const box = document.createElement("div");
    box.className = "svc-pop";
    const name = t.name || t.brand || t.operator || k.label;
    box.append(el("b", name), el("div", k.label + (t.brand && t.brand !== name ? " · " + t.brand : ""), "svc-sub"));
    const addr = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(", ") || t["addr:place"] || t["addr:city"] || "";
    if (addr) box.append(el("div", addr, "svc-line"));
    if (t.opening_hours) box.append(el("div", "Часы: " + t.opening_hours, "svc-line"));
    if (t.phone || t["contact:phone"]) box.append(el("div", "Тел.: " + (t.phone || t["contact:phone"]), "svc-line"));
    const b = button("Проложить маршрут сюда", "primary", () => { map.closePopup(); setDestination({ lat: it.lat, lng: it.lng, name: name }); });
    box.append(b, el("div", "Данные OpenStreetMap: могут быть неполными или устаревшими.", "svc-src"));
    return box;
  }

  function redraw() {
    layer.clearLayers();
    if (!enabled) return;
    const z = map.getZoom(), b = map.getBounds().pad(0.2);
    let n = 0;
    for (const it of items.values()) {
      if (it.kind === "shop" && z < 12) continue;
      if (z < 9) continue;
      if (!b.contains([it.lat, it.lng])) continue;
      if (++n > 300) break;
      const icon = L.divIcon({ className: "", html: '<div class="svc svc-' + it.kind + '">' + KIND[it.kind].glyph + "</div>", iconSize: [26, 26], iconAnchor: [13, 13] });
      const m = L.marker([it.lat, it.lng], { icon, title: (it.tags.name || KIND[it.kind].label), zIndexOffset: 100 });
      m.bindPopup(popupFor(it));
      m.addTo(layer);
    }
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(ensure, 700); }
  function setEnabled(on) {
    enabled = on;
    try { localStorage.setItem("stepServices", on ? "1" : "0"); } catch (_) {}
    if (on) { layer.addTo(map); ensure(); } else { map.removeLayer(layer); layer.clearLayers(); }
  }

  const box = document.querySelector("[data-services]");
  if (box) { box.checked = enabled; box.addEventListener("change", () => setEnabled(box.checked)); }
  if (enabled) layer.addTo(map);
  map.on("moveend", schedule);
  schedule();
})();
