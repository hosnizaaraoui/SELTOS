/* ---------- data: fetched from shared mock JSON (see ../../mock/) ----------
   Each table can be re-pointed with a query parameter named after the file's
   basename, e.g. ?products=../../mock/products.json  (relative or absolute URL). */
const MOCK = {
  products: "../../mock/products.json",
  users: "../../mock/users.json"
};

let DB = null;
let DB_LOADING = null;

async function fetchTable(defaultPath) {
  const key = defaultPath.split("/").pop().replace(/\.json$/i, "").toLowerCase();
  const override = new URLSearchParams(location.search).get(key);
  const src = new URL(override || defaultPath, location.href).toString();
  const res = await fetch(src, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error("expected a JSON array");
  return rows;
}

function getDB() {
  if (DB) return Promise.resolve(DB);
  if (!DB_LOADING) {
    DB_LOADING = Promise.all(Object.values(MOCK).map(fetchTable)).then(all => {
      const db = {};
      Object.keys(MOCK).forEach((t, i) => { db[t] = all[i]; });
      DB = db;
      return DB;
    }, err => { DB_LOADING = null; throw err; });
  }
  return DB_LOADING;
}

async function ready(outId) {
  try { await getDB(); return true; }
  catch (e) {
    document.getElementById(outId).innerHTML = '<p class="result-bad">Failed to load data</p>';
    return false;
  }
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
}[c]));

function tok(s) {
  const t = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (s.startsWith("--", i) || c === "#") break;

    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) throw new Error("unterminated quote");
      t.push({ k: "s", v: s.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    const r = s.slice(i);
    let m;
    if ((m = r.match(/^\d+(\.\d+)?/))) {
      t.push({ k: "n", v: +m[0] }); i += m[0].length; continue;
    }
    if ((m = r.match(/^[A-Za-z_][A-Za-z0-9_]*/))) {
      t.push({ k: "w", v: m[0].toLowerCase() }); i += m[0].length; continue;
    }
    if ((m = r.match(/^(!=|<>|<=|>=|[=<>(),*;?])/))) {
      t.push({ k: "p", v: m[0] }); i += m[0].length; continue;
    }
    throw new Error("unexpected character « " + c + " »");
  }
  return t;
}

function run(sql, params) {
  const T = tok(sql);
  let p = 0, pi = 0;
  params = params || [];

  const nx = () => T[p++];
  const isP = v => T[p] && T[p].k === "p" && T[p].v === v;
  const isW = v => T[p] && T[p].k === "w" && T[p].v === v;
  const near = () => T[p] ? " near « " + T[p].v + " »" : " at end of query";
  const exp = v => {
    if (!isW(v)) throw new Error("syntax: " + v.toUpperCase() + " expected" + near());
    p++;
  };

  function val() {
    const t = nx();
    if (!t) throw new Error("syntax: value expected at end of query");
    if (t.k === "s" || t.k === "n") return () => t.v;
    if (t.k === "p" && t.v === "?") {
      const v = params[pi++];
      return () => v;
    }
    if (t.k === "w") return r => {
      if (!(t.v in r)) throw new Error("unknown column « " + t.v + " »");
      return r[t.v];
    };
    throw new Error("syntax near « " + t.v + " »");
  }

  function cond() {
    if (isP("(")) {
      p++;
      const e = orE();
      if (!isP(")")) throw new Error("syntax: « ) » expected" + near());
      p++;
      return e;
    }
    const l = val();
    const o = nx();
    if (!o) throw new Error("syntax: operator expected at end of query");
    const ops = ["=", "!=", "<>", "<", ">", "<=", ">="];
    const like = o.k === "w" && o.v === "like";
    if (!like && !(o.k === "p" && ops.includes(o.v)))
      throw new Error("syntax near « " + o.v + " »");

    const r = val();
    return row => {
      const a = l(row), b = r(row);
      if (like) {
        const re = new RegExp(
          "^" + String(b)
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            .replace(/%/g, ".*").replace(/_/g, ".") + "$",
          "i"
        );
        return re.test(String(a));
      }
      switch (o.v) {
        case "=": return a == b;
        case "!=":
        case "<>": return a != b;
        case "<": return a < b;
        case ">": return a > b;
        case "<=": return a <= b;
        default: return a >= b;
      }
    };
  }

  function andE() {
    let a = cond();
    while (isW("and")) {
      p++;
      const b = cond(), x = a;
      a = r => x(r) && b(r);
    }
    return a;
  }
  function orE() {
    let a = andE();
    while (isW("or")) {
      p++;
      const b = andE(), x = a;
      a = r => x(r) || b(r);
    }
    return a;
  }

  function select() {
    exp("select");
    const cols = [nx()];
    if (!cols[0]) throw new Error("syntax: column expected");
    while (isP(",")) { p++; const c = nx(); if (!c) throw new Error("syntax: column expected"); cols.push(c); }
    exp("from");
    const t = nx();
    if (!t || t.k !== "w" || !DB[t.v]) throw new Error("unknown table « " + (t ? t.v : "") + " »");
    let where = null;
    if (isW("where")) { p++; where = orE(); }
    return { cols, table: t.v, where };
  }

  function proj(s) {
    const names = [], fns = [];
    for (const c of s.cols) {
      if (c.k === "p" && c.v === "*") {
        for (const k of Object.keys(DB[s.table][0])) { names.push(k); fns.push(r => r[k]); }
      } else if (c.k === "w") {
        names.push(c.v);
        fns.push(r => { if (!(c.v in r)) throw new Error("unknown column « " + c.v + " »"); return r[c.v]; });
      } else if (c.k === "s" || c.k === "n") {
        names.push(String(c.v)); fns.push(() => c.v);
      } else {
        throw new Error("syntax near « " + c.v + " »");
      }
    }
    return { names, fns };
  }

  const sels = [select()];
  while (isW("union")) { p++; if (isW("all")) p++; sels.push(select()); }
  if (isP(";")) {
    p++;
    if (p < T.length)
      throw new Error("multiple statements (« ; ») disabled in this simulator, as in many real drivers");
  }
  if (p < T.length) throw new Error("syntax" + near());

  let head = null, rows = [];
  for (const s of sels) {
    const { names, fns } = proj(s);
    if (head && head.length !== names.length)
      throw new Error("UNION SELECTs must have the same number of columns");
    if (!head) head = names;
    rows = rows.concat(
      DB[s.table].filter(s.where || (() => true)).map(r => fns.map(f => f(r)))
    );
  }
  return { head, rows };
}

function exec(sql, params) {
  try {
    const r = run(sql, params);
    return { ok: 1, head: r.head, rows: r.rows };
  } catch (e) {
    return { ok: 0, e: e.message };
  }
}

function build(parts) {
  return {
    sql: parts.map(x => (typeof x === "string" ? x : x.v)).join(""),
    html: parts.map(x => (typeof x === "string" ? esc(x) : '<span class="inj">' + esc(x.v) + "</span>")).join("")
  };
}

/* ---------- UI ---------- */
const $ = id => document.getElementById(id);

/* ---------- TABS ---------- */
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tabId = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    document.getElementById("tab-" + tabId).classList.add("active");
  });
});

/* ---------- SQL LOG CAROUSEL ---------- */
const sqlLog = [];
let currentSlide = 0;

function renderCarousel() {
  const track = $("carouselTrack");
  const dotsContainer = $("carouselDots");
  if (!track) return;

  if (sqlLog.length === 0) {
    track.innerHTML = `<div class="carousel-slide"><div class="sql-entry empty-log">No queries executed yet. Try a search.</div></div>`;
    dotsContainer.innerHTML = "";
    return;
  }

  track.innerHTML = sqlLog.map(entry => {
    const ts = entry.timestamp.toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    return `<div class="carousel-slide">
      <div class="sql-entry">${entry.html}</div>
      <div class="timestamp"><i class="far fa-clock"></i> ${ts}</div>
    </div>`;
  }).join("");

  dotsContainer.innerHTML = sqlLog.map((_, idx) =>
    `<span class="dot ${idx === currentSlide ? "active" : ""}" data-index="${idx}"></span>`
  ).join("");

  if (currentSlide >= sqlLog.length) currentSlide = sqlLog.length - 1;
  if (currentSlide < 0) currentSlide = 0;
  updateCarouselPosition();

  dotsContainer.querySelectorAll(".dot").forEach(dot => {
    dot.addEventListener("click", e => {
      const idx = parseInt(e.target.dataset.index, 10);
      if (!isNaN(idx)) {
        currentSlide = idx;
        updateCarouselPosition();
        updateDots();
      }
    });
  });
}

function updateCarouselPosition() {
  const track = $("carouselTrack");
  if (!track) return;
  track.style.transform = `translateX(-${currentSlide * 100}%)`;
}

function updateDots() {
  document.querySelectorAll(".dot").forEach((dot, idx) => {
    dot.classList.toggle("active", idx === currentSlide);
  });
}

function addQueryToLog(html) {
  sqlLog.push({ html, timestamp: new Date() });
  const wasAtEnd = currentSlide === sqlLog.length - 2;
  if (sqlLog.length === 1 || wasAtEnd) {
    currentSlide = sqlLog.length - 1;
  }
  renderCarousel();
  updateDots();
}

document.addEventListener("DOMContentLoaded", () => {
  const prev = $("prevSlide");
  const next = $("nextSlide");
  if (prev) prev.addEventListener("click", () => {
    if (sqlLog.length === 0) return;
    currentSlide = (currentSlide - 1 + sqlLog.length) % sqlLog.length;
    updateCarouselPosition();
    updateDots();
  });
  if (next) next.addEventListener("click", () => {
    if (sqlLog.length === 0) return;
    currentSlide = (currentSlide + 1) % sqlLog.length;
    updateCarouselPosition();
    updateDots();
  });
  renderCarousel();
});

/* ---------- PRODUCT RENDERING ---------- */
function renderProducts(r) {
  if (!r.rows.length) {
    return '<div class="store-empty">No products found.</div>';
  }
  // Column order expected: name, price, public
  const nameIdx = r.head.indexOf("name");
  const priceIdx = r.head.indexOf("price");
  const publicIdx = r.head.indexOf("public");

  return '<div class="product-grid">' + r.rows.map(row => {
    const name = nameIdx >= 0 ? row[nameIdx] : row[0];
    const price = priceIdx >= 0 ? row[priceIdx] : row[1];
    const isPublic = publicIdx >= 0 ? !!row[publicIdx] : true;
    const badgeClass = isPublic ? "public" : "hidden";
    const badgeText = isPublic ? "public" : "hidden";
    return `<div class="product-card">
      <div class="p-name">${esc(name)}</div>
      <div class="p-price">$${esc(price)}</div>
      <div class="p-badge ${badgeClass}">${badgeText}</div>
    </div>`;
  }).join("") + "</div>";
}

/* ---------- SEARCH ---------- */
$("search").onclick = async () => {
  if (!(await ready("output"))) return;
  const v = $("q").value;
  if (!v) {
    $("output").innerHTML =
      '<p class="result-bad">Enter a search term.</p>';
    return;
  }

  const b = build([
    "SELECT name, price, public FROM products WHERE name LIKE '%", { v: v },
    "%' AND public = 1"
  ]);
  const r = exec(b.sql);

  let html = "";
  if (!r.ok) {
    html += '<p class="result-bad"><b>SQL error:</b> ' + esc(r.e) + "</p>";
  } else if (r.rows.length) {
    html += renderProducts(r);
  } else {
    html += '<div class="store-empty">No products found.</div>';
  }
  $("output").innerHTML = html;

  /* push to SQL log carousel */
  addQueryToLog(b.html);
};

/* ---------- RESET (assignment tab) ---------- */
const resetTop = $("reset");
if (resetTop) {
  resetTop.onclick = () => {
    $("q").value = "keyboard";
    $("output").innerHTML = "";
  };
}

/* ---------- RESET (store tab) ---------- */
const resetStore = $("reset-store");
if (resetStore) {
  resetStore.onclick = () => {
    $("q").value = "keyboard";
    $("output").innerHTML = "";
  };
}

/* ---------- open this lab in a full browser tab ---------- */
document.getElementById("open-browser").onclick = () => {
  const url = new URL(location.href);
  url.searchParams.set("theme", document.documentElement.dataset.theme || "dracula");
  window.open(url.toString(), "_blank", "noopener");
};