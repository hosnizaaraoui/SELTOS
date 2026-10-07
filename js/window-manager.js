window.AppWM = (() => {
  const layer = document.getElementById("windowLayer");
  let z = 20, seq = 0, active = null;
  let tileMode = false;
  let previewEl = null;

  const EDGE = 24;
  const TOP_BAR = 44;
  const GAP = 12;

  function createWindow({ key, title, icon = "◈", content = "", width = 720, height = 480, onOpen }) {
    if (key) {
      const existing = document.querySelector(`.app-window[data-key="${key}"]`);
      if (existing) {
        const curWs = String(window.Workspaces ? Workspaces.current() : 1);
        if (existing.dataset.workspace !== curWs) {
          existing.dataset.workspace = curWs;
        }
        if (existing.classList.contains("minimized")) restore(existing);
        existing.classList.remove("hidden");
        focus(existing);
        return existing;
      }
    }

    const id = "win-" + (++seq);
    const w = document.createElement("section");
    w.className = "app-window";
    w.dataset.id = id;
    if (key) w.dataset.key = key;
    w.dataset.workspace = String(window.Workspaces ? Workspaces.current() : 1);
    w.dataset.title = title;
    w.dataset.icon = icon;

    w.style.width = Math.min(width, innerWidth - GAP * 2) + "px";
    w.style.height = Math.min(height, innerHeight - TOP_BAR - GAP * 2) + "px";
    const offset = Math.min(seq * 24, 120);
    w.style.left = Math.max(GAP, (innerWidth - parseInt(w.style.width)) / 2 + offset - 60) + "px";
    w.style.top = Math.max(TOP_BAR + GAP, (innerHeight - parseInt(w.style.height)) / 2 + offset - 60) + "px";
    w.style.zIndex = ++z;

    w.innerHTML = `
      <div class="window-bar">
        <div class="window-title"><span class="window-icon">${icon}</span><span>${title}</span></div>
        <div class="window-actions">
          <button data-window="tile" title="Toggle tiling">▦</button>
          <button data-window="min" title="Minimize">–</button>
          <button data-window="max" title="Maximize">▢</button>
          <button data-window="close" class="close" title="Close">✕</button>
        </div>
      </div>
      <div class="window-content">${content}</div>
      <div class="rs rs-n"  data-rs="n"></div>
      <div class="rs rs-s"  data-rs="s"></div>
      <div class="rs rs-e"  data-rs="e"></div>
      <div class="rs rs-w"  data-rs="w"></div>
      <div class="rs rs-ne" data-rs="ne"></div>
      <div class="rs rs-nw" data-rs="nw"></div>
      <div class="rs rs-se" data-rs="se"></div>
      <div class="rs rs-sw" data-rs="sw"></div>
    `;
    layer.appendChild(w);

    makeDraggable(w);
    makeResizable(w);

    w.addEventListener("pointerdown", () => focus(w));

    w.querySelector('[data-window="close"]').onclick = (e) => {
      e.stopPropagation();
      w.remove();
      if (active === w) active = null;
      if (tileMode) retile();
    };
    w.querySelector('[data-window="min"]').onclick = (e) => {
      e.stopPropagation();
      minimize(w);
    };
    w.querySelector('[data-window="max"]').onclick = (e) => {
      e.stopPropagation();
      toggleMaximize(w);
    };
    w.querySelector('[data-window="tile"]').onclick = (e) => {
      e.stopPropagation();
      setTileMode(!tileMode);
    };

    focus(w);
    onOpen?.(w.querySelector(".window-content"), w);
    if (tileMode) retile();
    return w;
  }

  function focus(w) {
    if (!w || w.classList.contains("hidden") || w.classList.contains("minimized")) return;
    w.style.zIndex = ++z;
    if (active && active !== w) active.classList.remove("active");
    w.classList.add("active");
    active = w;
  }

  function focusByKey(key) {
    const w = document.querySelector(`.app-window[data-key="${key}"]`);
    if (!w) return null;
    const curWs = String(window.Workspaces ? Workspaces.current() : 1);
    if (w.dataset.workspace !== curWs) {
      w.dataset.workspace = curWs;
    }
    w.classList.remove("hidden");
    if (w.classList.contains("minimized")) restore(w);
    focus(w);
    return w;
  }

  function findWindowByKey(key) {
    return document.querySelector(`.app-window[data-key="${key}"]`);
  }

  function closeActive() {
    const w = document.querySelector(".app-window.active:not(.hidden):not(.minimized)") || active;
    if (w && !w.classList.contains("hidden")) {
      w.remove();
      if (active === w) active = null;
      if (tileMode) retile();
    }
  }

  function applyWorkspaceFilter(n) {
    document.querySelectorAll(".app-window").forEach(w => {
      const ws = w.dataset.workspace || "1";
      const hide = ws !== String(n);
      w.classList.toggle("hidden", hide);
      if (hide) w.classList.remove("active");
    });
    if (active && active.classList.contains("hidden")) active = null;
    if (tileMode) retile();
  }

  function minimize(w) {
    if (!w || w.classList.contains("minimized")) return;
    w.classList.add("minimized");
    w.classList.remove("active");
    w.dataset.prevZ = w.style.zIndex;
    w.style.zIndex = 1;
    if (active === w) active = null;
    if (tileMode) retile();
  }

  function restore(w) {
    if (!w || !w.classList.contains("minimized")) return;
    w.classList.remove("minimized");
    if (w.dataset.prevZ) w.style.zIndex = w.dataset.prevZ;
    focus(w);
    if (tileMode) retile();
  }

  function makeDraggable(w) {
    const bar = w.querySelector(".window-bar");
    let drag = false, sx = 0, sy = 0, sl = 0, st = 0;

    bar.addEventListener("pointerdown", e => {
      if (e.target.closest("button") ||
        w.classList.contains("maximized") ||
        w.classList.contains("minimized")) return;
      drag = true;
      focus(w);
      sx = e.clientX; sy = e.clientY;
      sl = w.offsetLeft; st = w.offsetTop;
      bar.setPointerCapture(e.pointerId);
      w.classList.add("dragging");
    });

    bar.addEventListener("pointermove", e => {
      if (!drag) return;
      w.style.left = Math.max(8, Math.min(innerWidth - w.offsetWidth - 8, sl + e.clientX - sx)) + "px";
      w.style.top = Math.max(TOP_BAR, Math.min(innerHeight - w.offsetHeight - 8, st + e.clientY - sy)) + "px";
      showSnapPreview(e.clientX, e.clientY);
    });

    bar.addEventListener("pointerup", e => {
      if (!drag) return;
      drag = false;
      w.classList.remove("dragging");
      const zone = detectSnapZone(e.clientX, e.clientY);
      hideSnapPreview();
      if (zone) snapWindow(w, zone);
    });

    bar.addEventListener("pointercancel", () => {
      if (!drag) return;
      drag = false;
      w.classList.remove("dragging");
      hideSnapPreview();
    });
  }

  function makeResizable(w) {
    const MIN_W = 320, MIN_H = 220;

    w.querySelectorAll(".rs").forEach(handle => {
      handle.addEventListener("pointerdown", e => {
        if (w.classList.contains("maximized") ||
          w.classList.contains("minimized")) return;
        e.stopPropagation();
        focus(w);

        const dir = handle.dataset.rs;
        const startX = e.clientX, startY = e.clientY;
        const startW = w.offsetWidth, startH = w.offsetHeight;
        const startL = w.offsetLeft, startT = w.offsetTop;

        handle.setPointerCapture(e.pointerId);
        w.classList.add("resizing");
        w._snapZone = null;

        const onMove = ev => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;

          let newW = startW, newH = startH, newL = startL, newT = startT;

          if (dir.includes("e")) newW = Math.max(MIN_W, startW + dx);
          if (dir.includes("s")) newH = Math.max(MIN_H, startH + dy);
          if (dir.includes("w")) {
            newW = Math.max(MIN_W, startW - dx);
            newL = startL + (startW - newW);
          }
          if (dir.includes("n")) {
            newH = Math.max(MIN_H, startH - dy);
            newT = startT + (startH - newH);
          }

          newL = Math.max(0, newL);
          newT = Math.max(TOP_BAR, newT);
          if (newL + newW > innerWidth) newW = innerWidth - newL;
          if (newT + newH > innerHeight) newH = innerHeight - newT;

          w.style.width = newW + "px";
          w.style.height = newH + "px";
          w.style.left = newL + "px";
          w.style.top = newT + "px";
        };

        const onUp = () => {
          handle.removeEventListener("pointermove", onMove);
          handle.removeEventListener("pointerup", onUp);
          w.classList.remove("resizing");
        };

        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp);
      });
    });
  }

  function toggleMaximize(w) {
    if (w.classList.contains("minimized")) {
      restore(w);
      return;
    }
    if (w.classList.contains("maximized")) {
      const r = w._restore || {};
      if (r.left) w.style.left = r.left;
      if (r.top) w.style.top = r.top;
      if (r.width) w.style.width = r.width;
      if (r.height) w.style.height = r.height;
      w.classList.remove("maximized");
    } else {
      w._restore = {
        left: w.style.left, top: w.style.top,
        width: w.style.width, height: w.style.height
      };
      w.classList.add("maximized");
      w.style.left = GAP + "px";
      w.style.top = (TOP_BAR + GAP) + "px";
      w.style.width = (innerWidth - GAP * 2) + "px";
      w.style.height = (innerHeight - TOP_BAR - GAP * 2) + "px";
    }
    w._snapZone = null;
  }

  function detectSnapZone(x, y) {
    const nearLeft = x <= EDGE;
    const nearRight = x >= innerWidth - EDGE;
    const nearTop = y <= TOP_BAR + EDGE;
    const nearBottom = y >= innerHeight - EDGE;

    if (nearTop && nearLeft) return "tl";
    if (nearTop && nearRight) return "tr";
    if (nearBottom && nearLeft) return "bl";
    if (nearBottom && nearRight) return "br";
    if (nearTop) return "max";
    if (nearLeft) return "left";
    if (nearRight) return "right";
    return null;
  }

  function zoneRect(zone) {
    const top = TOP_BAR;
    const W = innerWidth, H = innerHeight - top;
    switch (zone) {
      case "max": return { x: 0, y: top, w: W, h: H };
      case "left": return { x: 0, y: top, w: W / 2, h: H };
      case "right": return { x: W / 2, y: top, w: W / 2, h: H };
      case "tl": return { x: 0, y: top, w: W / 2, h: H / 2 };
      case "tr": return { x: W / 2, y: top, w: W / 2, h: H / 2 };
      case "bl": return { x: 0, y: top + H / 2, w: W / 2, h: H / 2 };
      case "br": return { x: W / 2, y: top + H / 2, w: W / 2, h: H / 2 };
      default: return null;
    }
  }

  function showSnapPreview(x, y) {
    const zone = detectSnapZone(x, y);
    if (!zone) { hideSnapPreview(); return; }
    const r = zoneRect(zone);
    if (!r) { hideSnapPreview(); return; }
    if (!previewEl) {
      previewEl = document.createElement("div");
      previewEl.className = "snap-preview";
      document.body.appendChild(previewEl);
    }
    previewEl.style.left = r.x + "px";
    previewEl.style.top = r.y + "px";
    previewEl.style.width = r.w + "px";
    previewEl.style.height = r.h + "px";
    previewEl.style.display = "block";
  }

  function hideSnapPreview() {
    if (previewEl) previewEl.style.display = "none";
  }

  function snapWindow(w, zone) {
    if (w.classList.contains("minimized")) restore(w);
    w.classList.remove("maximized");
    w._snapZone = zone;

    const r = zoneRect(zone);
    if (!r) return;

    w.style.left = r.x + "px";
    w.style.top = r.y + "px";
    w.style.width = r.w + "px";
    w.style.height = r.h + "px";
  }

  function setTileMode(on) {
    tileMode = !!on;
    if (tileMode) retile();
  }

  function retile() {
    if (!tileMode) return;
    const ws = String(window.Workspaces ? Workspaces.current() : 1);
    const wins = [...document.querySelectorAll(".app-window")]
      .filter(w =>
        w.dataset.workspace === ws &&
        !w.classList.contains("hidden") &&
        !w.classList.contains("minimized")
      );
    if (!wins.length) return;

    const top = TOP_BAR;
    const W = innerWidth;
    const H = innerHeight - top;
    const n = wins.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cw = Math.floor(W / cols);
    const ch = Math.floor(H / rows);

    wins.forEach((w, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      w.classList.remove("maximized");
      w._snapZone = "tile";
      w.style.left = (c * cw) + "px";
      w.style.top = (top + r * ch) + "px";
      w.style.width = cw + "px";
      w.style.height = ch + "px";
    });
  }

  window.addEventListener("resize", () => {
    if (tileMode) { retile(); return; }
    document.querySelectorAll(".app-window").forEach(w => {
      if (w.classList.contains("minimized") || w.classList.contains("hidden")) return;
      if (w.classList.contains("maximized")) {
        w.style.left = GAP + "px";
        w.style.top = (TOP_BAR + GAP) + "px";
        w.style.width = (innerWidth - GAP * 2) + "px";
        w.style.height = (innerHeight - TOP_BAR - GAP * 2) + "px";
      } else if (w._snapZone && w._snapZone !== "tile") {
        snapWindow(w, w._snapZone);
      }
    });
  });

  return {
    createWindow,
    closeActive,
    applyWorkspaceFilter,
    minimize,
    restore,
    retile,
    setTileMode,
    isTileMode: () => tileMode,
    snapWindow,
    focus,
    focusByKey,
    findWindowByKey
  };
})();