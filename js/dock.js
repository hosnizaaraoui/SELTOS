window.Dock = (() => {
    const DOCK = document.getElementById("dock");
    const ITEMS = document.getElementById("dockItems");
    const DYNAMIC = document.getElementById("dockDynamic");
    if (!DOCK || !ITEMS || typeof apps === "undefined") {
        return { render: () => { }, refresh: () => { }, set: () => { }, get: () => ({}) };
    }

    const KEY = "dock-settings";
    const defaults = {
        position: "bottom",
        align: "center",
        size: "auto",
        overflow: "fit"
    };

    let settings = { ...defaults };
    try {
        Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || "{}"));
    } catch { }

    function save() {
        localStorage.setItem(KEY, JSON.stringify(settings));
    }

    function apply() {
        DOCK.dataset.position = settings.position;
        DOCK.dataset.align = settings.align;
        DOCK.dataset.size = settings.size;
        DOCK.dataset.overflow = settings.overflow;
    }

    /* ---------- window lookup + focus/restore ---------- */

    function findWin(key) {
        return document.querySelector(`.app-window[data-key="${key}"]`);
    }

    function focusWin(w) {
        if (!w) return;
        if (window.AppWM && typeof AppWM.focus === "function") {
            AppWM.focus(w);
            return;
        }
        document.querySelectorAll(".app-window.active").forEach(x => x.classList.remove("active"));
        w.classList.add("active");
        w.style.zIndex = String((window.__winZ = (window.__winZ || 100) + 1));
    }

    function restoreWin(w) {
        if (!w) return;
        if (window.AppWM && typeof AppWM.restore === "function") {
            AppWM.restore(w);
            return;
        }
        w.classList.remove("minimized");
        focusWin(w);
    }

    function bringToCurrentWs(win) {
        if (!win) return;
        const curWs = String(window.Workspaces ? Workspaces.current() : 1);
        if (win.dataset.workspace !== curWs) win.dataset.workspace = curWs;
        win.classList.remove("hidden");
    }

    function activateWindow(win) {
        if (!win) return;
        bringToCurrentWs(win);
        if (win.classList.contains("minimized")) restoreWin(win);
        else focusWin(win);
    }

    /* ---------- action → window key mapping ---------- */

    function keyForAction(action) {
        switch (action) {
            case "environments": return "environments";
            case "settings": return "settings";
            case "about": return "about";
            case "terminal": return "terminal";
            default: return null;
        }
    }

    function handleAction(action) {
        // The "apps" action is special: it toggles the launcher overlay.
        if (action === "apps") {
            const launcher = document.getElementById("launcher");
            if (launcher && !launcher.classList.contains("hidden")) {
                launcher.classList.add("hidden");
            } else if (typeof window.openLauncher === "function") {
                window.openLauncher();
            }
            return;
        }

        const key = keyForAction(action);
        if (key) {
            const win = findWin(key);
            if (win) {
                activateWindow(win);
                return;
            }
        }
        if (typeof launchAction === "function") launchAction(action);
    }

    /* ---------- rendering ---------- */

    function render() {
        ITEMS.innerHTML = apps.map(a => `
      <button class="dock-item" data-action="${a.action}" data-tooltip="${a.name}">
        <span class="dock-icon">${a.icon}</span>
      </button>
    `).join("");
    }

    function refresh() {
        const ws = String(window.Workspaces ? Workspaces.current() : 1);

        ITEMS.querySelectorAll(".dock-item").forEach(btn => {
            const key = keyForAction(btn.dataset.action);
            const win = key ? findWin(key) : null;

            const onThisWs = !!(win && win.dataset.workspace === ws && !win.classList.contains("hidden"));
            const minimized = !!(win && win.classList.contains("minimized"));
            const focused = !!(onThisWs && !minimized && win.classList.contains("active"));

            btn.classList.toggle("running", onThisWs);
            btn.classList.toggle("minimized", onThisWs && minimized);
            btn.classList.toggle("focused", focused);
        });

        renderDynamic();
    }

    function renderDynamic() {
        if (!DYNAMIC) return;
        const ws = String(window.Workspaces ? Workspaces.current() : 1);

        const staticKeys = ["environments", "settings", "about", "terminal"];
        const wins = [...document.querySelectorAll(".app-window")]
            .filter(w => w.dataset.workspace === ws && !w.classList.contains("hidden"))
            .filter(w => !staticKeys.includes(w.dataset.key || ""));

        const sep = document.getElementById("dockSepDynamic");
        if (sep) sep.style.display = wins.length ? "block" : "none";

        DYNAMIC.innerHTML = wins.map(w => {
            const minimized = w.classList.contains("minimized");
            const focused = !minimized && w.classList.contains("active");
            const title = w.dataset.title || "Window";
            const icon = w.dataset.icon || "◈";
            const cls = [
                "dock-item",
                "dock-dynamic",
                minimized ? "minimized" : "running",
                focused ? "focused" : ""
            ].filter(Boolean).join(" ");

            return `
        <button class="${cls}"
                data-dynkey="${w.dataset.key || ""}"
                data-tooltip="${title}">
          <span class="dock-icon">${icon}</span>
        </button>`;
        }).join("");

        DYNAMIC.style.display = wins.length ? "flex" : "none";
    }

    /* ---------- delegation: one listener for everything ---------- */

    DOCK.addEventListener("click", e => {
        const dyn = e.target.closest("[data-dynkey]");
        if (dyn) {
            const win = findWin(dyn.dataset.dynkey);
            if (win) activateWindow(win);
            return;
        }

        const btn = e.target.closest("[data-action]");
        if (btn) handleAction(btn.dataset.action);
    });

    /* ---------- observers ---------- */

    const layer = document.getElementById("windowLayer");
    if (layer) {
        const mo = new MutationObserver(() => {
            refresh();
            observeWindows();
        });
        mo.observe(layer, { childList: true });
    }

    function observeWindows() {
        document.querySelectorAll(".app-window").forEach(w => {
            if (w._dockObserved) return;
            w._dockObserved = true;
            new MutationObserver(refresh).observe(w, {
                attributes: true,
                attributeFilter: ["class"]
            });
        });
    }

    document.querySelectorAll(".workspace").forEach(b => {
        b.addEventListener("click", () => setTimeout(refresh, 0));
    });

    const overlayObserver = new MutationObserver(() => {
        const open = [...document.querySelectorAll(".overlay-panel")]
            .some(el => !el.classList.contains("hidden"));
        document.body.classList.toggle("overlay-open", open);
    });
    document.querySelectorAll(".overlay-panel").forEach(el => {
        overlayObserver.observe(el, { attributes: true, attributeFilter: ["class"] });
    });

    /* ---------- init ---------- */

    render();
    observeWindows();
    refresh();
    apply();

    /* ---------- public API ---------- */

    function set(patch) {
        Object.assign(settings, patch);
        save();
        apply();
    }

    function get() {
        return { ...settings };
    }

    return { render, refresh, set, get, defaults };
})();