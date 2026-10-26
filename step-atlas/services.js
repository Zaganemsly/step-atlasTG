/* СТЕПЬ — рыболовные и продуктовые магазины на карте.
   Все данные лежат готовым файлом data/services.json (выгрузка OpenStreetMap), внешние серверы не нужны.
   Заправки и базы отдыха намеренно не показываются. Загружается после app.js. */
(function () {
  "use strict";
  if (typeof L === "undefined" || typeof map === "undefined") return;
  const layer = L.layerGroup();
  const KIND = {
    fishing: { glyph: "🎣", label: "Рыболовный магазин", minZoom: 8 },
    shop: { glyph: "🛒", label: "Продуктовый магазин", minZoom: 11 }
  };
  const items = [];
  let enabled = true;
  try { enabled = localStorage.getItem("stepServices") !== "0"; } catch (_) {}

  function popupFor(it) {
    const k = KIND[it.kind];
    const box = document.createElement("div");
    box.className = "svc-pop";
    const name = it.name || k.label;
    box.append(el("b", name));
    if (name !== k.label) box.append(el("div", k.label, "svc-sub"));
    if (it.addr) box.append(el("div", it.addr, "svc-line"));
    box.append(
      button("Проложить маршрут сюда", "primary", () => { map.closePopup(); setDestination({ lat: it.lat, lng: it.lng, name: name }); }),
      el("div", "© участники OpenStreetMap (ODbL). Данные могут быть неполными или устаревшими, часы работы уточняйте.", "svc-src")
    );
    return box;
  }

  function redraw() {
    layer.clearLayers();
    if (!enabled) return;
    const z = map.getZoom(), b = map.getBounds().pad(0.2);
    // На средних масштабах продуктовые магазины не показываем гроздьями: по одному на клетку ~30 пикселей.
    const cell = z < 14 ? (360 / (256 * Math.pow(2, z))) * 30 : 0;
    const taken = new Set();
    let n = 0;
    for (const it of items) {
      if (z < KIND[it.kind].minZoom) continue;
      if (!b.contains([it.lat, it.lng])) continue;
      if (cell && it.kind !== "fishing") {
        const key = Math.floor(it.lat / cell) + ":" + Math.floor(it.lng / cell);
        if (taken.has(key)) continue;
        taken.add(key);
      }
      if (++n > 300) break;
      const icon = L.divIcon({ className: "", html: '<div class="svc svc-' + it.kind + '">' + KIND[it.kind].glyph + "</div>", iconSize: [22, 22], iconAnchor: [11, 11] });
      const m = L.marker([it.lat, it.lng], { icon, title: it.name || KIND[it.kind].label, zIndexOffset: 100 });
      m.bindPopup(popupFor(it));
      m.addTo(layer);
    }
  }

  async function load() {
    try {
      const r = await fetch("data/services.json", { cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      (j.items || []).forEach(x => {
        // k: "r" — рыболовный магазин, "g" — продуктовый; n — название, a — адрес
        if (x.k !== "r" && x.k !== "g") return;
        items.push({ kind: x.k === "r" ? "fishing" : "shop", lat: x.la, lng: x.lo, name: x.n || "", addr: x.a || "" });
      });
      // рыболовные в списке первыми, чтобы они не пропадали из-за лимита маркеров
      items.sort((a, b) => (a.kind === "fishing" ? 0 : 1) - (b.kind === "fishing" ? 0 : 1));
      redraw();
    } catch (e) { console.warn("services.json:", e); }
  }

  function setEnabled(on) {
    enabled = on;
    try { localStorage.setItem("stepServices", on ? "1" : "0"); } catch (_) {}
    if (on) { layer.addTo(map); redraw(); } else { map.removeLayer(layer); layer.clearLayers(); }
  }

  const box = document.querySelector("[data-services]");
  if (box) { box.checked = enabled; box.addEventListener("change", () => setEnabled(box.checked)); }
  if (enabled) layer.addTo(map);
  map.on("moveend", redraw);
  load();
})();
