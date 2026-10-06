window.Terminal = (() => {
    /* ============================================================
       REGISTRY — add a command here once, it's wired + listed in `help`.
       ============================================================ */
    const registry = [
        { name: "settings", desc: "Open settings", run: () => window.openSettings() },
        { name: "env", desc: "Open environments", alt: ["environments"], run: () => window.openEnvironments() },
        { name: "about", desc: "Show about", run: () => window.openAbout() },
        { name: "apps", desc: "Open app launcher", run: () => window.openLauncher() },
        { name: "help", desc: "List available commands", run: () => printHelp() }
    ];

    /* Build lookup, including aliases. */
    const map = new Map();
    for (const c of registry) {
        map.set(c.name, c);
        for (const a of c.alt || []) map.set(a, c);
    }

    const history = [];
    let historyIndex = -1;

    function printHelp() {
        const width = Math.max(...registry.map(c => c.name.length)) + 2;
        return registry.map(c => c.name.padEnd(width) + c.desc).join("\n");
    }

    /* Run one line. Returns text to print (may be ""), never throws. */
    function run(raw) {
        const line = raw.trim();
        if (!line) return "";
        const [name, ...args] = line.split(/\s+/);
        const cmd = map.get(name.toLowerCase());
        if (!cmd) return `command not found: ${name}  (try "help")`;
        try {
            const result = cmd.run(args);
            return typeof result === "string" ? result : "";
        } catch (e) {
            return "error: " + e.message;
        }
    }

    /* ---------- DOM wiring ----------
       Terminal windows are created on demand by AppWM.createWindow (see
       window.openTerminal below), so there's no fixed #terminal panel to
       bind to at load time the way #shortcuts has. Instead, wireAll()
       scans for any not-yet-wired ".terminal-input" and binds it —
       call it right after creating/showing a terminal window. */

    function print(out, text, cls) {
        const line = document.createElement("div");
        line.className = "terminal-line" + (cls ? " " + cls : "");
        line.textContent = text;
        out.appendChild(line);
        out.scrollTop = out.scrollHeight;
    }

    function wireAll() {
        document.querySelectorAll(".terminal-input").forEach(input => {
            if (input.dataset.wired) { input.focus(); return; }
            input.dataset.wired = "1";

            const out = input.closest(".terminal-app")?.querySelector(".terminal-output");
            if (!out) return;

            input.addEventListener("keydown", e => {
                if (e.key === "Enter") {
                    const raw = input.value;
                    print(out, "$ " + raw, "terminal-echo");
                    if (raw.trim()) { history.push(raw); historyIndex = history.length; }
                    const res = run(raw);
                    if (res) res.split("\n").forEach(l => print(out, l));
                    input.value = "";
                } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    if (historyIndex > 0) {
                        historyIndex--;
                        input.value = history[historyIndex] || "";
                    }
                } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    if (historyIndex < history.length) {
                        historyIndex++;
                        input.value = history[historyIndex] || "";
                    } else {
                        input.value = "";
                    }
                }
            });

            input.focus();
        });
    }

    return { registry, run, printHelp, wireAll };
})();

/* ---------- open as an AppWM window, same pattern as Settings/About ---------- */

window.openTerminal = function () {
    AppWM.createWindow({
        key: "terminal",
        title: "Terminal", icon: "❯_", width: 560, height: 380, content: `
    <div class="terminal-app">
      <div class="terminal-output"><div class="terminal-line muted">Type "help" to list commands.</div></div>
      <div class="terminal-prompt">
        <span class="prompt-sigil">$</span>
        <input class="terminal-input" autocomplete="off" spellcheck="false" />
      </div>
    </div>`});
    // content above is injected by AppWM after this call returns, so wire on next tick.
    setTimeout(() => window.Terminal.wireAll(), 0);
};