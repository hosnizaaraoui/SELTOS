const apps = [
  { name: "Environments", icon: "⌂", description: "Browse and launch labs", action: "environments" },
  { name: "Terminal", icon: "❯_", description: "Run commands", action: "terminal" },
  { name: "Settings", icon: "⚙", description: "Desktop preferences", action: "settings" },
  { name: "About", icon: "◈", description: "About SELT.OS", action: "about" }
];

window.Workspaces = (() => {
  let current = 1;
  return {
    current: () => current,
    set(n) { current = Number(n); }
  };
})();

function openLauncher() {
  const launcher = document.getElementById("launcher");
  launcher.classList.remove("hidden");
  const search = document.getElementById("launcherSearch");
  renderApps("");
  search.value = "";
  setTimeout(() => search.focus(), 30);
  search.oninput = () => renderApps(search.value);
}
window.openLauncher = openLauncher;

function renderApps(q) {
  const grid = document.getElementById("appGrid");
  const needle = q.toLowerCase();
  grid.innerHTML = apps
    .filter(a => (a.name + " " + a.description).toLowerCase().includes(needle))
    .map(a => `
      <button class="app-tile" data-action="${a.action}">
        <span class="tile-icon">${a.icon}</span>
        <strong>${a.name}</strong>
        <small>${a.description}</small>
      </button>`).join("") ||
    `<div class="muted">No applications found.</div>`;
  grid.querySelectorAll("[data-action]").forEach(b => {
    b.onclick = () => launchAction(b.dataset.action);
  });
}

function launchAction(action) {
  if (action === "apps") { openLauncher(); return; }
  document.getElementById("launcher").classList.add("hidden");
  const handlers = {
    environments: () => openEnvironments(),
    terminal: () => openTerminal(),
    settings: () => openSettings(),
    about: () => openAbout()
  };
  const fn = handlers[action];
  if (!fn) console.warn("Unknown action:", action);
  else fn();
}

document.getElementById("desktop").addEventListener("click", e => {
  const btn = e.target.closest("[data-action]");
  if (btn) launchAction(btn.dataset.action);
});
document.querySelector('[data-close="launcher"]').onclick =
  () => document.getElementById("launcher").classList.add("hidden");

window.openSettings = function () {
  const dock = window.Dock?.get?.() || { position: "bottom", align: "center", size: "auto", overflow: "fit" };
  AppWM.createWindow({
    key: "settings",
    title: "Settings", icon: "⚙", width: 620, height: 520, content: `
    <div class="settings-app">
      <div class="eyebrow">DESKTOP</div><h2>Settings</h2>
      <p class="muted">Preferences for the shell. Changes apply instantly.</p>

      <div class="eyebrow" style="margin-top:18px">DOCK</div>

      <div class="setting-row">
        <span>Position</span>
        <select class="dock-select" data-dock="position">
          <option value="bottom">Bottom</option>
          <option value="top">Top</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </div>

      <div class="setting-row">
        <span>Alignment</span>
        <select class="dock-select" data-dock="align">
          <option value="center">Center</option>
          <option value="start">Start</option>
          <option value="end">End</option>
        </select>
      </div>

      <div class="setting-row">
        <span>Size</span>
        <select class="dock-select" data-dock="size">
          <option value="auto">Auto</option>
          <option value="compact">Compact</option>
          <option value="wide">Wide</option>
        </select>
      </div>

      <div class="setting-row">
        <span>Overflow</span>
        <select class="dock-select" data-dock="overflow">
          <option value="fit">Shrink to fit</option>
          <option value="scroll">Scroll</option>
        </select>
      </div>

      <div class="eyebrow" style="margin-top:18px">BEHAVIOR</div>
      <div class="setting-row"><span>Reduce animations</span><input class="toggle" type="checkbox" id="reduceMotion"></div>
      <div class="setting-row"><span>Show welcome panel</span><input class="toggle" type="checkbox" checked id="showWelcome"></div>
      <div class="setting-row"><span>Keyboard mirror shortcuts</span><span class="pill">Ctrl + Alt</span></div>

      <div style="margin-top:18px" class="muted">Primary shortcuts use the Super/Meta key. Ctrl+Alt is provided as a browser-friendly testing fallback.</div>
    </div>`,
    onOpen: (root) => {
      // pre-fill current values
      root.querySelectorAll("[data-dock]").forEach(sel => {
        const k = sel.dataset.dock;
        if (dock[k] != null) sel.value = dock[k];
        sel.onchange = () => {
          window.Dock?.set?.({ [k]: sel.value });
        };
      });
    }
  });
};

window.openAbout = function () {
  AppWM.createWindow({
    key: "about",
    title: "About", icon: "◈", width: 580, height: 400, content: `
    <div class="about-app">
      <div class="eyebrow">V1</div><h2>SELT.OS</h2>
      <p class="muted">A local, browser-based desktop for self-contained technical learning environments.</p>
      <div class="lab-card">
        <strong>Current environments</strong>
        <p class="muted">SQL Injection · 4 labs</p>
        <p class="muted">Access Control · 1 lab</p>
        <p class="muted">Cross-Site Scripting · 1 lab</p>
        <p class="muted">Linux · 1 lab</p>
      </div>
      <p class="muted">No backend. No database. No API. The desktop is a shell; each environment owns its simulation.</p>
    </div>`});
};

function updateClock() {
  document.getElementById("clock").textContent =
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
setInterval(updateClock, 1000);
updateClock();

function showToast(message) {
  const t = document.getElementById("toast");
  t.textContent = message;
  t.classList.remove("hidden");
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => t.classList.add("hidden"), 1400);
}
window.showToast = showToast;

function switchWorkspace(n) {
  Workspaces.set(n);
  document.querySelectorAll(".workspace").forEach(b =>
    b.classList.toggle("active", b.dataset.workspace === String(n))
  );
  AppWM.applyWorkspaceFilter(n);
  showToast("Workspace " + n);
}
window.switchWorkspace = switchWorkspace;

document.querySelectorAll(".workspace").forEach(b => {
  b.onclick = () => switchWorkspace(b.dataset.workspace);
});

(function initHud() {
  const el = {
    status: document.getElementById("hudStatus"),
    ws: document.getElementById("hudWs"),
    wins: document.getElementById("hudWins"),
    theme: document.getElementById("hudTheme")
  };
  if (!el.status) return;

  function themeName() {
    const t = document.documentElement.dataset.theme || "dracula";
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function update() {
    const ws = window.Workspaces ? Workspaces.current() : 1;
    el.ws.textContent = ws + " / 4";

    const wins = document.querySelectorAll(".app-window").length;
    el.wins.textContent = String(wins);

    el.theme.textContent = themeName();

    // Status line
    const active = document.querySelector(".app-window.active:not(.hidden):not(.minimized)");
    if (active) {
      const title = active.dataset.title || "Window";
      el.status.textContent = "Focused · " + title;
    } else if (wins > 0) {
      el.status.textContent = wins + " window" + (wins === 1 ? "" : "s") + " open";
    } else {
      el.status.textContent = "Ready · no windows open";
    }
  }

  // Re-run whenever the window layer changes
  const layer = document.getElementById("windowLayer");
  if (layer) {
    new MutationObserver(update).observe(layer, { childList: true });
    layer.querySelectorAll(".app-window").forEach(w => {
      new MutationObserver(update).observe(w, {
        attributes: true,
        attributeFilter: ["class"]
      });
    });
    // attach on new windows too
    new MutationObserver(() => {
      layer.querySelectorAll(".app-window").forEach(w => {
        if (w._hudObserved) return;
        w._hudObserved = true;
        new MutationObserver(update).observe(w, {
          attributes: true,
          attributeFilter: ["class"]
        });
      });
      update();
    }).observe(layer, { childList: true });
  }

  // theme changes
  new MutationObserver(update).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"]
  });

  // workspace buttons
  document.querySelectorAll(".workspace").forEach(b => {
    b.addEventListener("click", () => setTimeout(update, 0));
  });

  update();
})();