/* ---------- data: fetched from shared mock JSON (see ../../mock/) ----------
   Each table can be re-pointed with a query parameter named after the file's
   basename, e.g. ?users-profiles=../../mock/users-profiles.json  (relative or absolute URL). */
const MOCK = {
  users: "../../mock/users-profiles.json"
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

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- tokenizer ---------- */
function tok(s) {
    const t = []; let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) { i++; continue; }
        if (s.startsWith("--", i) || c === "#") break;
        if (c === "'") {
            const j = s.indexOf("'", i + 1);
            if (j < 0) throw new Error("unterminated quote");
            t.push({ k: "s", v: s.slice(i + 1, j) }); i = j + 1; continue;
        }
        const r = s.slice(i); let m;
        if ((m = r.match(/^\d+(\.\d+)?/))) { t.push({ k: "n", v: +m[0] }); i += m[0].length; continue; }
        if ((m = r.match(/^[A-Za-z_][A-Za-z0-9_]*/))) { t.push({ k: "w", v: m[0].toLowerCase() }); i += m[0].length; continue; }
        if ((m = r.match(/^(!=|<>|<=|>=|[=<>(),*;?])/))) { t.push({ k: "p", v: m[0] }); i += m[0].length; continue; }
        throw new Error("unexpected character « " + c + " »");
    }
    return t;
}

/* ---------- single-statement parser + evaluator ---------- */
function runOne(sql, params, db) {
    const T = tok(sql);
    let p = 0, pi = 0;
    params = params || [];

    const nx = () => T[p++];
    const isP = v => T[p] && T[p].k === "p" && T[p].v === v;
    const isW = v => T[p] && T[p].k === "w" && T[p].v === v;
    const near = () => T[p] ? " near « " + T[p].v + " »" : " at end of query";
    const exp = v => { if (!isW(v)) throw new Error("syntax: " + v.toUpperCase() + " expected" + near()); p++; };

    function val() {
        const t = nx();
        if (!t) throw new Error("syntax: value expected at end of query");
        if (t.k === "s" || t.k === "n") return () => t.v;
        if (t.k === "p" && t.v === "?") { const v = params[pi++]; return () => v; }
        if (t.k === "w") return r => {
            if (!(t.v in r)) throw new Error("unknown column « " + t.v + " »");
            return r[t.v];
        };
        throw new Error("syntax near « " + t.v + " »");
    }

    function cond() {
        if (isP("(")) { p++; const e = orE(); if (!isP(")")) throw new Error("syntax: « ) » expected" + near()); p++; return e; }
        const l = val(); const o = nx();
        if (!o) throw new Error("syntax: operator expected at end of query");
        const ops = ["=", "!=", "<>", "<", ">", "<=", ">="];
        const like = o.k === "w" && o.v === "like";
        if (!like && !(o.k === "p" && ops.includes(o.v))) throw new Error("syntax near « " + o.v + " »");
        const r = val();
        return row => {
            const a = l(row), b = r(row);
            if (like) {
                const re = new RegExp("^" + String(b).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", "i");
                return re.test(String(a));
            }
            switch (o.v) {
                case "=": return a == b;
                case "!=": case "<>": return a != b;
                case "<": return a < b;
                case ">": return a > b;
                case "<=": return a <= b;
                default: return a >= b;
            }
        };
    }
    function andE() { let a = cond(); while (isW("and")) { p++; const b = cond(), x = a; a = r => x(r) && b(r); } return a; }
    function orE() { let a = andE(); while (isW("or")) { p++; const b = andE(), x = a; a = r => x(r) || b(r); } return a; }

    const verb = nx();
    if (!verb || verb.k !== "w") throw new Error("syntax: expected statement keyword" + near());

    if (verb.v === "select") {
        const cols = [nx()];
        if (!cols[0]) throw new Error("syntax: column expected");
        while (isP(",")) { p++; const c = nx(); if (!c) throw new Error("syntax: column expected"); cols.push(c); }
        exp("from");
        const t = nx();
        if (!t || t.k !== "w" || !db[t.v]) throw new Error("unknown table « " + (t ? t.v : "") + " »");
        let where = null;
        if (isW("where")) { p++; where = orE(); }
        if (p < T.length) throw new Error("syntax" + near());

        const names = [], fns = [];
        for (const c of cols) {
            if (c.k === "p" && c.v === "*") {
                for (const k of Object.keys(db[t.v][0])) { names.push(k); fns.push(r => r[k]); }
            } else if (c.k === "w") {
                names.push(c.v);
                fns.push(r => { if (!(c.v in r)) throw new Error("unknown column « " + c.v + " »"); return r[c.v]; });
            } else if (c.k === "s" || c.k === "n") {
                names.push(String(c.v)); fns.push(() => c.v);
            } else throw new Error("syntax near « " + c.v + " »");
        }
        const rows = db[t.v].filter(where || (() => true)).map(r => fns.map(f => f(r)));
        return { kind: "select", head: names, rows };
    }

    if (verb.v === "update") {
        const tbl = nx();
        if (!tbl || tbl.k !== "w" || !db[tbl.v]) throw new Error("unknown table « " + (tbl ? tbl.v : "") + " »");
        exp("set");
        const assigns = [];
        for (; ;) {
            const col = nx();
            if (!col || col.k !== "w") throw new Error("syntax: column expected");
            if (!isP("=")) throw new Error("syntax: « = » expected" + near());
            p++;
            const v = val();
            assigns.push({ col: col.v, v });
            if (isP(",")) { p++; continue; }
            break;
        }
        let where = null;
        if (isW("where")) { p++; where = orE(); }
        if (p < T.length) throw new Error("syntax" + near());
        let n = 0;
        for (const row of db[tbl.v]) {
            if (where && !where(row)) continue;
            for (const a of assigns) row[a.col] = a.v(row);
            n++;
        }
        return { kind: "update", affected: n };
    }

    if (verb.v === "delete") {
        exp("from");
        const tbl = nx();
        if (!tbl || tbl.k !== "w" || !db[tbl.v]) throw new Error("unknown table « " + (tbl ? tbl.v : "") + " »");
        let where = null;
        if (isW("where")) { p++; where = orE(); }
        if (p < T.length) throw new Error("syntax" + near());
        const before = db[tbl.v].length;
        db[tbl.v] = db[tbl.v].filter(r => where && !where(r));
        return { kind: "delete", affected: before - db[tbl.v].length };
    }

    if (verb.v === "insert") {
        exp("into");
        const tbl = nx();
        if (!tbl || tbl.k !== "w" || !db[tbl.v]) throw new Error("unknown table « " + (tbl ? tbl.v : "") + " »");
        if (!isP("(")) throw new Error("syntax: « ( » expected" + near());
        p++;
        const cols = [];
        for (; ;) {
            const c = nx();
            if (!c || c.k !== "w") throw new Error("syntax: column expected");
            cols.push(c.v);
            if (isP(",")) { p++; continue; }
            break;
        }
        if (!isP(")")) throw new Error("syntax: « ) » expected" + near());
        p++;
        exp("values");
        if (!isP("(")) throw new Error("syntax: « ( » expected" + near());
        p++;
        const vals = [];
        for (; ;) {
            const v = val();
            vals.push(v);
            if (isP(",")) { p++; continue; }
            break;
        }
        if (!isP(")")) throw new Error("syntax: « ) » expected" + near());
        p++;
        if (p < T.length) throw new Error("syntax" + near());
        const row = {};
        cols.forEach((c, i) => { row[c] = vals[i]({}); });
        const id = Math.max(0, ...db[tbl.v].map(r => r.id || 0)) + 1;
        if (!row.id) row.id = id;
        db[tbl.v].push(row);
        return { kind: "insert", affected: 1 };
    }

    throw new Error("unsupported statement « " + verb.v + " »");
}

/* ---------- multi-statement support (stacked queries) ---------- */
function splitStatements(sql) {
    const parts = []; let cur = ""; let i = 0;
    while (i < sql.length) {
        const c = sql[i];
        if (c === "'") {
            const j = sql.indexOf("'", i + 1);
            if (j < 0) { cur += sql.slice(i); break; }
            cur += sql.slice(i, j + 1); i = j + 1; continue;
        }
        if (c === ";") { parts.push(cur); cur = ""; i++; continue; }
        cur += c; i++;
    }
    if (cur.trim()) parts.push(cur);
    return parts.map(s => s.trim()).filter(Boolean);
}

function exec(sql, params, db) {
    try {
        const stmts = splitStatements(sql);
        const results = [];
        for (const s of stmts) results.push(runOne(s, params, db));
        return { ok: 1, results, last: results[results.length - 1] };
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
        r.head.map(h => "<th>" + esc(h) + "</th>").join("") + "</tr>" +
        r.rows.map(row => "<tr>" + row.map(c => "<td>" + esc(c) + "</td>").join("") + "</tr>").join("") +
        "</table></div>";
}

/* ---------- UI ---------- */
const $ = id => document.getElementById(id);

$("save").onclick = async () => {
    if (!(await ready("save-output"))) return;
    const v = $("name").value;
    const b = build([
        "UPDATE users SET display_name='", { v: v }, "' WHERE name='alice'"
    ]);
    const r = exec(b.sql, [], DB);

    let html = '<div class="query-box">' + b.html + "</div>";
    if (!r.ok) {
        html += '<p class="result-bad"><b>SQL error:</b> ' + esc(r.e) + "</p>";
    } else {
        const last = r.last;
        html += '<p class="result-ok">Saved. ' + (last.kind === "update" ? last.affected + " row(s) updated." : "") + "</p>";
    }
    $("save-output").innerHTML = html;
};

$("view").onclick = async () => {
    if (!(await ready("output"))) return;
    const id = $("vid").value;
    /* The stored display_name is fetched first, then dropped into a
       second query with no escaping. That's the second-order bug. */
    const stored = (DB.users.find(u => String(u.id) === String(id)) || {}).display_name || "";
    const b = build([
        "SELECT id, name, display_name, role FROM users WHERE name = '", { v: stored }, "'"
    ]);
    const r = exec(b.sql, [], DB);

    let html = '<div class="query-box">' + b.html + "</div>";
    if (!r.ok) {
        html += '<p class="result-bad"><b>SQL error:</b> ' + esc(r.e) + "</p>";
    } else {
        const last = r.last;
        if (last.kind === "select" && last.rows.length) html += renderTable(last);
        else html += '<p class="result-bad">No user found.</p>';
    }
    $("output").innerHTML = html;
};

$("reset").onclick = async () => {
    if (!(await ready("output"))) return;
    DB.users[1].display_name = "alice";
    DB.users[1].role = "user";
    $("name").value = "alice";
    $("vid").value = "2";
    $("save-output").innerHTML = "";
    $("output").innerHTML = "";
};

/* ---------- open this lab in a full browser tab (keeps ?theme= and any overrides) ---------- */
document.getElementById("open-browser").onclick = () => {
  const url = new URL(location.href);
  url.searchParams.set("theme", document.documentElement.dataset.theme || "dracula");
  window.open(url.toString(), "_blank", "noopener");
};
