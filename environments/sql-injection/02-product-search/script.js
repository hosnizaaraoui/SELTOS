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

function renderTable(r) {
  return '<div class="tw"><table class="lab-table"><tr>' +
    r.head.map(h => "<th>" + esc(h) + "</th>").join("") +
    "</tr>" +
    r.rows.map(row =>
      "<tr>" + row.map(cell => "<td>" + esc(cell) + "</td>").join("") + "</tr>"
    ).join("") +
    "</table></div>";
}

document.getElementById("search").onclick = async () => {
  if (!(await ready("output"))) return;
  const v = document.getElementById("q").value;
  if (!v) {
    document.getElementById("output").innerHTML =
      '<p class="result-bad">Enter a search term.</p>';
    return;
  }
  const b = build([
    "SELECT name, price, public FROM products WHERE name LIKE '%", { v: v },
    "%' AND public = 1"
  ]);
  const r = exec(b.sql);

  let html = '<div class="query-box">' + b.html + "</div>";
  if (!r.ok) {
    html += '<p class="result-bad"><b>SQL error:</b> ' + esc(r.e) + "</p>";
  } else if (r.rows.length) {
    const r2 = {
      head: r.head,
      rows: r.rows.map(row => row.map((c, i) =>
        r.head[i] === "public" ? (c ? "public" : "hidden") : c
      ))
    };
    html += renderTable(r2);
  } else {
    html += '<p class="result-bad">No products found.</p>';
  }
  document.getElementById("output").innerHTML = html;
};

document.getElementById("reset").onclick = () => {
  document.getElementById("q").value = "keyboard";
  document.getElementById("output").innerHTML = "";
};

/* ---------- open this lab in a full browser tab (keeps ?theme= and any overrides) ---------- */
document.getElementById("open-browser").onclick = () => {
  const url = new URL(location.href);
  url.searchParams.set("theme", document.documentElement.dataset.theme || "dracula");
  window.open(url.toString(), "_blank", "noopener");
};
