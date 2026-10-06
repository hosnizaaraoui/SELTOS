window.Shortcuts = (() => {
  /* ============================================================
     REGISTRY — add a shortcut here once, it's wired + displayed.
     ============================================================ */
  const registry = [
    { group: "Desktop", keys: ["Super", "D"], alt: ["Ctrl", "Alt", "D"], desc: "App launcher", run: () => window.openLauncher() },
    { group: "Desktop", keys: ["Super", "N"], alt: ["Ctrl", "Alt", "N"], desc: "Environments", run: () => window.openEnvironments() },
    { group: "Desktop", keys: ["Super", "K"], alt: ["Ctrl", "Alt", "K"], desc: "Terminal", run: () => window.openTerminal() },
    { group: "Desktop", keys: ["Super", "H"], alt: ["Ctrl", "Alt", "H"], desc: "Shortcut cheat-sheet", run: () => window.openShortcuts() },
    { group: "Desktop", keys: ["Super", "S"], alt: ["Ctrl", "Alt", "S"], desc: "Settings", run: () => window.openSettings() },
    { group: "Desktop", keys: ["Super", "Q"], alt: ["Ctrl", "Alt", "Q"], desc: "Close active window", run: () => AppWM.closeActive() },

    { group: "Workspaces", keys: ["Super", "1"], alt: ["Ctrl", "Alt", "1"], desc: "Workspace 1", run: () => switchWorkspace(1) },
    { group: "Workspaces", keys: ["Super", "2"], alt: ["Ctrl", "Alt", "2"], desc: "Workspace 2", run: () => switchWorkspace(2) },
    { group: "Workspaces", keys: ["Super", "3"], alt: ["Ctrl", "Alt", "3"], desc: "Workspace 3", run: () => switchWorkspace(3) },
    { group: "Workspaces", keys: ["Super", "4"], alt: ["Ctrl", "Alt", "4"], desc: "Workspace 4", run: () => switchWorkspace(4) },

    { group: "Windows", keys: ["Drag bar"], desc: "Move window" },
    { group: "Windows", keys: ["Drag edge"], desc: "Resize window" },
    { group: "Overlays", keys: ["Esc"], desc: "Close overlay", run: closeOverlays }
  ];

  /* Build lookup for the keyboard handler. */
  const map = new Map();
  for (const s of registry) {
    if (!s.run) continue;
    const key = s.keys[s.keys.length - 1].toLowerCase();
    if (key.length === 1) map.set(key, s.run);
  }

  /* ---------- keyboard handling ---------- */
  let superDown = false;

  document.addEventListener("keydown", e => {
    if (e.key === "Meta" || e.key === "OS") { superDown = true; return; }
    if (e.key === "Escape") { closeOverlays(); return; }

    const k = e.key.toLowerCase();

    // Super + key  (works when the OS passes it through — e.g. inside a kiosk,
    // fullscreen webview, or Wayland VM). The OS may pre-empt this on Windows/
    // macOS/GNOME for several combos; the Ctrl+Alt mirror below is the reliable
    // fallback on a normal desktop browser.
    if (superDown && map.has(k)) {
      e.preventDefault();
      map.get(k)();
      return;
    }

    // Ctrl+Alt + key — reliable mirror the browser always sees.
    if (e.ctrlKey && e.altKey && !e.metaKey && map.has(k)) {
      e.preventDefault();
      map.get(k)();
      return;
    }

    if (e.key === "Enter" && document.activeElement?.id === "launcherSearch") {
      document.querySelector(".app-tile:not([style*='display: none'])")?.click();
    }
  });

  document.addEventListener("keyup", e => {
    if (e.key === "Meta" || e.key === "OS") superDown = false;
  });

  /* ---------- render the cheat-sheet ---------- */
  function renderCheatSheet() {
    const box = document.querySelector("#shortcuts .shortcut-groups");
    if (!box) return;

    const groups = [];
    const index = new Map();
    for (const s of registry) {
      if (!index.has(s.group)) {
        index.set(s.group, []);
        groups.push(s.group);
      }
      index.get(s.group).push(s);
    }

    box.innerHTML = groups.map(g => `
      <div class="shortcut-group">
        <h4>${g}</h4>
        ${index.get(g).map(s => `
          <div class="shortcut">
            ${s.keys.map(k => `<kbd>${k}</kbd>`).join("")}
            <span>${s.desc}</span>
          </div>
          ${s.alt ? `
          <div class="shortcut shortcut-alt">
            ${s.alt.map(k => `<kbd>${k}</kbd>`).join("")}
            <span class="muted">fallback</span>
          </div>` : ""}
        `).join("")}
      </div>
    `).join("");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderCheatSheet);
  } else {
    renderCheatSheet();
  }

  return { registry, map, renderCheatSheet };
})();

/* ---------- overlay + workspace helpers (global) ---------- */

window.openShortcuts = function () {
  document.querySelectorAll(".overlay-panel").forEach(el => el.classList.add("hidden"));
  const panel = document.getElementById("shortcuts");
  if (!panel) return;
  window.Shortcuts.renderCheatSheet();
  panel.classList.remove("hidden");
};

/* Only define switchWorkspace if desktop.js hasn't already.
   desktop.js owns the WM-aware version (it calls AppWM.applyWorkspaceFilter). */
if (typeof window.switchWorkspace !== "function") {
  window.switchWorkspace = function (n) {
    document.querySelectorAll(".workspace").forEach(b =>
      b.classList.toggle("active", b.dataset.workspace === String(n))
    );
    if (window.Workspaces) Workspaces.set(n);
    if (window.AppWM) AppWM.applyWorkspaceFilter(n);
    if (window.showToast) showToast("Workspace " + n);
  };
}

function closeOverlays() {
  document.querySelectorAll(".overlay-panel").forEach(el =>
    el.classList.add("hidden")
  );
}