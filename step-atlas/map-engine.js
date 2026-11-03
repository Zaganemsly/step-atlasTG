/* СТЕПЬ — слой карты на OpenLayers.
   Даёт приложению тот же небольшой набор функций карты (маркеры, всплывающие подсказки, линии маршрута,
   границы, переходы), поэтому остальной код приложения не зависит от конкретной библиотеки.
   Загружается после ol.js и до app.js. */
(function (root) {
  "use strict";
  const ol = root.ol;
  if (!ol) return;
  const SRC = "EPSG:4326", DST = "EPSG:3857";
  const toXY = (lat, lng) => ol.proj.fromLonLat([lng, lat]);
  const ll = a => (Array.isArray(a) ? { lat: +a[0], lng: +a[1] } : { lat: +a.lat, lng: +(a.lng !== undefined ? a.lng : a.lon) });
  const rgba = (hex, a) => {
    const h = String(hex || "#3388ff").replace("#", "");
    const f = h.length === 3 ? h.split("").map(c => c + c).join("") : h.slice(0, 6);
    const n = parseInt(f, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + (a === undefined ? 1 : a) + ")";
  };

  /* ---------- события ---------- */
  const Evented = {
    on(type, fn) { (this._h || (this._h = {}))[type] = (this._h[type] || []).concat(fn); return this; },
    off(type, fn) { if (this._h && this._h[type]) this._h[type] = fn ? this._h[type].filter(f => f !== fn) : []; return this; },
    fire(type, data) {
      const list = (this._h && this._h[type]) || [];
      const e = Object.assign({ type, target: this }, data || {});
      list.forEach(fn => { try { fn.call(this, e); } catch (err) { console.error(err); } });
      return this;
    }
  };

  /* ---------- границы ---------- */
  class LatLngBounds {
    constructor(points) {
      this._s = Infinity; this._w = Infinity; this._n = -Infinity; this._e = -Infinity;
      (points || []).forEach(p => this.extend(p));
    }
    extend(p) {
      const q = ll(p);
      this._s = Math.min(this._s, q.lat); this._n = Math.max(this._n, q.lat);
      this._w = Math.min(this._w, q.lng); this._e = Math.max(this._e, q.lng);
      return this;
    }
    isValid() { return this._s <= this._n && this._w <= this._e; }
    getSouth() { return this._s; } getNorth() { return this._n; }
    getWest() { return this._w; } getEast() { return this._e; }
    pad(r) {
      const dh = (this._n - this._s) * r, dw = (this._e - this._w) * r;
      return new LatLngBounds([[this._s - dh, this._w - dw], [this._n + dh, this._e + dw]]);
    }
    contains(p) {
      const q = ll(p);
      return q.lat >= this._s && q.lat <= this._n && q.lng >= this._w && q.lng <= this._e;
    }
  }

  /* ---------- слои ---------- */
  class Layer {
    addTo(target) { target.addLayer(this); return this; }
    remove() { if (this._map) this._map.removeLayer(this); return this; }
  }

  class LayerGroup extends Layer {
    constructor() { super(); this._items = new Set(); this._map = null; }
    addLayer(l) { this._items.add(l); if (this._map) l._attach(this._map); return this; }
    removeLayer(l) { if (this._items.delete(l) && this._map) l._detach(this._map); return this; }
    clearLayers() { if (this._map) this._items.forEach(l => l._detach(this._map)); this._items.clear(); return this; }
    _attach(map) { this._map = map; this._items.forEach(l => l._attach(map)); }
    _detach(map) { this._items.forEach(l => l._detach(map)); this._map = null; }
  }

  class TileLayer extends Layer {
    constructor(url, opts) { super(); this._url = url; this.options = opts || {}; }
    _attach(map) {
      this._map = map;
      const o = this.options;
      this._lyr = new ol.layer.Tile({
        source: new ol.source.XYZ({
          url: this._url.replace("{s}", "{a-c}"),
          maxZoom: o.maxZoom || 19,
          attributions: o.attribution ? [o.attribution] : undefined,
          crossOrigin: "anonymous"
        })
      });
      map._ol.getLayers().insertAt(0, this._lyr);
    }
    _detach(map) { if (this._lyr) map._ol.removeLayer(this._lyr); this._lyr = null; this._map = null; }
  }

  class Shape extends Layer {
    constructor(geomFn, opts) { super(); this._geomFn = geomFn; this.options = opts || {}; }
    _attach(map) {
      this._map = map;
      const o = this.options;
      const dash = o.dashArray ? String(o.dashArray).split(/[ ,]+/).map(Number).filter(Number.isFinite) : undefined;
      const style = new ol.style.Style({
        stroke: new ol.style.Stroke({ color: rgba(o.color, o.opacity), width: o.weight === undefined ? 3 : o.weight, lineDash: dash, lineCap: "round", lineJoin: "round" }),
        fill: o.fillOpacity ? new ol.style.Fill({ color: rgba(o.fillColor || o.color, o.fillOpacity) }) : undefined
      });
      this._lyr = new ol.layer.Vector({ source: new ol.source.Vector({ features: [new ol.Feature(this._geomFn())] }), style, zIndex: 10 });
      map._ol.addLayer(this._lyr);
    }
    _detach(map) { if (this._lyr) map._ol.removeLayer(this._lyr); this._lyr = null; this._map = null; }
  }

  /* ---------- маркеры ---------- */
  class Marker extends Layer {
    constructor(latlng, opts) {
      super();
      this._ll = ll(latlng);
      this.options = opts || {};
      this._map = null;
      const icon = this.options.icon || divIcon({ className: "", html: '<div class="svc"></div>', iconSize: [20, 20] });
      const io = icon.options;
      const size = io.iconSize || [25, 41];
      this._anchor = io.iconAnchor || [size[0] / 2, size[1]];
      this._popupAnchor = io.popupAnchor || [0, -this._anchor[1] - 2];
      const el = document.createElement("div");
      el.className = "step-marker " + (io.className || "");
      el.style.width = size[0] + "px";
      el.style.height = size[1] + "px";
      el.innerHTML = io.html || "";
      const title = this.options.title || this.options.alt;
      if (title) { el.title = title; el.setAttribute("aria-label", title); }
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      let down = null;
      el.addEventListener("pointerdown", ev => { down = [ev.clientX, ev.clientY]; });
      el.addEventListener("click", ev => {
        if (down && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 8) return; // это было перетаскивание карты
        this.fire("click", { originalEvent: ev, latlng: this._ll });
        if (this._popup) this.openPopup();
      });
      el.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); el.click(); } });
      this._el = el;
    }
    getElement() { return this._el; }
    getLatLng() { return { lat: this._ll.lat, lng: this._ll.lng }; }
    setLatLng(p) {
      this._ll = ll(p);
      if (this._ov) this._ov.setPosition(toXY(this._ll.lat, this._ll.lng));
      return this;
    }
    bindPopup(content) { this._popup = content; return this; }
    openPopup() { if (this._map && this._popup) this._map._openPopup(this); return this; }
    closePopup() { if (this._map) this._map.closePopup(); return this; }
    _attach(map) {
      this._map = map;
      this._ov = new ol.Overlay({
        element: this._el,
        position: toXY(this._ll.lat, this._ll.lng),
        positioning: "top-left",
        offset: [-this._anchor[0], -this._anchor[1]],
        stopEvent: false
      });
      map._ol.addOverlay(this._ov);
      const z = this.options.zIndexOffset;
      if (z && this._el.parentNode) this._el.parentNode.style.zIndex = String(z);
    }
    _detach(map) {
      if (map._popupOwner === this) map.closePopup();
      if (this._ov) map._ol.removeOverlay(this._ov);
      this._ov = null; this._map = null;
    }
  }
  Object.assign(Marker.prototype, Evented);

  function divIcon(options) { return { options: options || {} }; }

  /* ---------- карта ---------- */
  class MapView {
    constructor(target, opts) {
      opts = opts || {};
      const el = typeof target === "string" ? document.getElementById(target) : target;
      this._el = el;
      this._layers = new Set();
      this._popup = null; this._popupOwner = null;
      this._ready = false;
      const view = new ol.View({ center: toXY(46.35, 48.03), zoom: 8, minZoom: 3, maxZoom: 19, constrainResolution: true, enableRotation: false });
      this._ol = new ol.Map({
        target: el,
        view,
        controls: ol.control.defaults.defaults({ zoom: false, rotate: false, attribution: false }),
        interactions: ol.interaction.defaults.defaults({ altShiftDragRotate: false, pinchRotate: false })
      });
      if (opts.attributionControl !== false) controlAttribution().addTo(this);
      this._ol.once("rendercomplete", () => { this._ready = true; });
      this._ol.on("moveend", () => {
        const z = view.getZoom();
        if (this._lastZoom !== z) { this._lastZoom = z; this.fire("zoomend"); }
        this.fire("moveend");
      });
      this._ol.on("click", evt => {
        const t = evt.originalEvent && evt.originalEvent.target;
        if (t && t.closest && t.closest(".step-marker, .step-popup")) return;
        this.closePopup();
        const c = ol.proj.toLonLat(evt.coordinate);
        this.fire("click", { latlng: { lat: c[1], lng: c[0] }, originalEvent: evt.originalEvent });
      });
      // «dragstart»: человек сам двинул карту пальцем или мышью (не программный переход)
      const vp = this._ol.getViewport();
      let pd = null;
      vp.addEventListener("pointerdown", ev => { pd = { x: ev.clientX, y: ev.clientY, fired: false }; });
      vp.addEventListener("pointermove", ev => {
        if (!pd || pd.fired) return;
        if (Math.hypot(ev.clientX - pd.x, ev.clientY - pd.y) > 6) { pd.fired = true; this.fire("dragstart"); }
      });
      const end = () => { pd = null; };
      vp.addEventListener("pointerup", end); vp.addEventListener("pointercancel", end);
    }
    /* вид */
    setView(center, zoom, opts) {
      const c = ll(center);
      const view = this._ol.getView();
      const z = zoom === undefined ? view.getZoom() : zoom;
      if (!this._ready || (opts && opts.animate === false)) { view.setCenter(toXY(c.lat, c.lng)); view.setZoom(z); }
      else view.animate({ center: toXY(c.lat, c.lng), zoom: z, duration: 250 });
      return this;
    }
    flyTo(center, zoom) {
      const c = ll(center);
      const view = this._ol.getView();
      view.animate({ center: toXY(c.lat, c.lng), zoom: zoom === undefined ? view.getZoom() : zoom, duration: 700 });
      return this;
    }
    fitBounds(b, opts) {
      if (!b || !b.isValid()) return this;
      opts = opts || {};
      const pad = opts.padding || [0, 0];
      const ext = ol.proj.transformExtent([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], SRC, DST);
      this._ol.getView().fit(ext, { size: this._size(), padding: [pad[1], pad[0], pad[1], pad[0]], maxZoom: opts.maxZoom || 19, duration: 350 });
      return this;
    }
    getZoom() { return this._ol.getView().getZoom(); }
    _size() { return this._ol.getSize() || [this._el.clientWidth || 800, this._el.clientHeight || 600]; }
    getBounds() {
      const ext = ol.proj.transformExtent(this._ol.getView().calculateExtent(this._size()), DST, SRC);
      return new LatLngBounds([[ext[1], ext[0]], [ext[3], ext[2]]]);
    }
    _zoomBy(d) {
      const view = this._ol.getView();
      const base = this._tz !== undefined && view.getAnimating() ? this._tz : view.getZoom();
      this._tz = Math.max(view.getMinZoom(), Math.min(view.getMaxZoom(), base + d));
      view.animate({ zoom: this._tz, duration: 250 });
      return this;
    }
    zoomIn() { return this._zoomBy(1); }
    zoomOut() { return this._zoomBy(-1); }
    invalidateSize() { this._ol.updateSize(); return this; }
    /* слои */
    addLayer(l) { if (!this._layers.has(l)) { this._layers.add(l); l._attach(this); } return this; }
    removeLayer(l) { if (this._layers.delete(l)) l._detach(this); return this; }
    hasLayer(l) { return this._layers.has(l); }
    /* всплывающая подсказка */
    _openPopup(owner) {
      this.closePopup();
      const box = document.createElement("div");
      box.className = "step-popup";
      const x = document.createElement("button");
      x.type = "button"; x.className = "step-popup-x"; x.textContent = "×"; x.setAttribute("aria-label", "Закрыть");
      x.addEventListener("click", () => this.closePopup());
      const body = document.createElement("div");
      body.className = "step-popup-body";
      const c = owner._popup;
      if (c instanceof Node) body.append(c); else body.innerHTML = String(c);
      box.append(x, body);
      const pa = owner._popupAnchor;
      const ov = new ol.Overlay({
        element: box,
        position: toXY(owner._ll.lat, owner._ll.lng),
        positioning: "bottom-center",
        offset: [pa[0], pa[1] - 10],
        stopEvent: true,
        autoPan: { animation: { duration: 200 }, margin: 24 }
      });
      this._ol.addOverlay(ov);
      if (box.parentNode) box.parentNode.style.zIndex = "2000";
      this._popup = ov; this._popupOwner = owner;
    }
    closePopup() {
      if (this._popup) { this._ol.removeOverlay(this._popup); this._popup = null; this._popupOwner = null; }
      return this;
    }
  }
  Object.assign(MapView.prototype, Evented);

  function controlAttribution() {
    return { addTo(map) { map._ol.addControl(new ol.control.Attribution({ collapsible: false, collapsed: false })); return this; } };
  }

  /* ---------- публичный объект ---------- */
  root.L = {
    map: (target, opts) => new MapView(target, opts),
    tileLayer: (url, opts) => new TileLayer(url, opts),
    layerGroup: () => new LayerGroup(),
    marker: (latlng, opts) => new Marker(latlng, opts),
    divIcon,
    latLngBounds: pts => new LatLngBounds(pts),
    polyline: (pts, opts) => new Shape(() => new ol.geom.LineString(pts.map(p => { const q = ll(p); return toXY(q.lat, q.lng); })), opts),
    circle: (center, opts) => {
      const c = ll(center);
      return new Shape(() => ol.geom.Polygon.circular([c.lng, c.lat], (opts && opts.radius) || 10, 64).transform(SRC, DST), opts);
    },
    geoJSON: (geometry, opts) => new Shape(() => new ol.format.GeoJSON().readGeometry(geometry, { dataProjection: SRC, featureProjection: DST }), (opts && opts.style) || {}),
    control: { attribution: () => controlAttribution() },
    DomEvent: { stopPropagation: e => { const o = e && (e.originalEvent || e); if (o && o.stopPropagation) o.stopPropagation(); } }
  };
})(window);
