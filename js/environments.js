window.ENVIRONMENTS = [
  {
    category: "Cybersecurity",
    name: "SQL Injection",
    icon: "⌁",
    description: "Browser-only SQL injection simulations.",
    labs: [
      { name: "Authentication Bypass", description: "Explore how input can alter a login query.", path: "environments/sql-injection/01-authentication/index.html" },
      { name: "Product Search", description: "Explore boolean logic and data exposure.", path: "environments/sql-injection/02-product-search/index.html" },
      { name: "Data Exfiltration", description: "Leak hidden columns using UNION SELECT.", path: "environments/sql-injection/03-data-exfiltration/index.html" },
      { name: "Order By Injection", description: "Abuse an unquoted ORDER BY clause to leak and sort hidden data.", path: "environments/sql-injection/04-order-by-injection/index.html" },
      { name: "Blind Boolean-Based Injection", description: "Extract data one yes/no question at a time from a response with no visible output.", path: "environments/sql-injection/05-blind-boolean/index.html" },
      { name: "Numeric Injection (No Quotes)", description: "Exploit a numeric parameter where quote-escaping defenses don't apply.", path: "environments/sql-injection/06-numeric-no-quotes/index.html" },
      { name: "Second-Order Injection", description: "Store a payload now, detonate it in a different query later.", path: "environments/sql-injection/07-second-order/index.html" },
      { name: "Stacked Queries", description: "Turn a read-only injection into writes, updates, and drops.", path: "environments/sql-injection/08-stacked-queries/index.html" },
      { name: "Out-of-Band Exfiltration", description: "Leak secrets through a simulated DNS channel when no response signal exists.", path: "environments/sql-injection/09-out-of-band/index.html" },
      { name: "ORDER BY Expression", description: "Blind-extract data using only the observable sort order.", path: "environments/sql-injection/10-order-by-expression/index.html" },
      { name: "WAF Bypass", description: "Defeat a naive blacklist filter using comments, case, and alternate operators.", path: "environments/sql-injection/11-waf-bypass/index.html" },
      { name: "Type Confusion", description: "Bypass numeric validation using strings, hex literals, and scientific notation.", path: "environments/sql-injection/12-type-confusion/index.html" }

    ]
  },
  // {
  //   category: "Cybersecurity",
  //   name: "Access Control",
  //   icon: "⛨",
  //   description: "Broken authorization and object-level access flaws.",
  //   labs: [
  //     { name: "Invoice Portal (IDOR)", description: "Enumerate object IDs the server forgot to authorize.", path: "environments/access-control/01-idor/index.html" }
  //   ]
  // },
  // {
  //   category: "Cybersecurity",
  //   name: "Cross-Site Scripting",
  //   icon: "‹/›",
  //   description: "Injection into the browser: markup, handlers and encoding.",
  //   labs: [
  //     { name: "Reflected Search", description: "Turn a reflected search term into script execution, then fix it.", path: "environments/xss/01-reflected/index.html" }
  //   ]
  // },

];

window.openEnvironments = function () {
  const content = `
    <div class="env-app">
      <div class="env-head">
        <div><div class="eyebrow">ENVIRONMENT MANAGER</div><h2>Learning environments</h2><p>Self-contained labs running locally in your browser.</p></div>
        <input class="env-filter" id="envFilter" placeholder="Filter labs..." autocomplete="off">
      </div>
      <div id="envList"></div>
    </div>`;
  AppWM.createWindow({
    key: "environments",
    title: "Environments",
    icon: "⌂",
    content,
    width: 820,
    height: 540,
    onOpen: mountEnvironments
  });
};

function mountEnvironments(root) {
  const list = root.querySelector("#envList"), filter = root.querySelector("#envFilter");
  function render() {
    const q = filter.value.toLowerCase().trim();
    list.innerHTML = ENVIRONMENTS.map(env => {
      const labs = env.labs.filter(l => !q || (env.name + " " + l.name + " " + l.description).toLowerCase().includes(q));
      if (!labs.length) return "";
      return `<section class="env-section">
        <div class="env-section-title">${env.category.toUpperCase()}</div>
        <div class="env-grid">
          ${labs.map(l => `<article class="env-card" data-path="${l.path}">
            <div class="env-card-icon">${env.icon}</div>
            <h3>${l.name}</h3><p>${l.description}</p>
            <div class="env-card-footer"><span class="pill">${env.name}</span><span>OPEN →</span></div>
          </article>`).join("")}
        </div>
      </section>`;
    }).join("") || `<p class="muted">No matching labs.</p>`;
    list.querySelectorAll(".env-card").forEach(card => {
      card.onclick = () => openLab(card.dataset.path, card.querySelector("h3").textContent);
    });
  }
  filter.oninput = render; render();
}

function openLab(path, title) {
  const theme = document.documentElement.dataset.theme || "dracula";
  const src = path + (path.includes("?") ? "&" : "?") + "theme=" + encodeURIComponent(theme);
  AppWM.createWindow({
    key: "lab:" + path,
    title: title,
    icon: "⌁",
    width: 820,
    height: 590,
    content: `<iframe src="${src}" title="${title}"></iframe>`
  });
}

window.openLab = openLab;