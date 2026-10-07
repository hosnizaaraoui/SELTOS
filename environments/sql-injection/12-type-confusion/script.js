const DB = {
    articles: [
        { id: 1, title: "Intro to Home Repair", min_age: 0, body: "Hammer safety tips." },
        { id: 2, title: "Advanced Power Tools", min_age: 18, body: "The really dangerous stuff." },
        { id: 3, title: "Industrial Welding", min_age: 21, body: "For trained professionals." },
        { id: 4, title: "Dangerous Chemistry", min_age: 25, body: "Never try this at home." }
    ]
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- MySQL-style implicit coercion ---------- */
function coerceNumber(v) {
    if (typeof v === "number") return v;
    const s = String(v).trim();
    /* Hex literal (MySQL: 0x… → integer value) */
    const hex = s.match(/^0x([0-9a-fA-F]+)$/);
    if (hex) return parseInt(hex[1], 16);
    /* Scientific notation */
    const sci = s.match(/^-?\d+(\.\d+)?e[+-]?\d+$/i);
    if (sci) return Number(s);
    /* Leading numeric prefix, MySQL-like */
    const pre = s.match(/^-?\d+(\.\d+)?/);
    if (pre) return Number(pre[0]);
    /* Anything else becomes 0 */
    return 0;
}

function tok(s) {
    const t = []; let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) { i++; continue; }
        if (s.startsWith("--", i) || c === "#") break;
        if (s.startsWith("/*", i)) { const j = s.indexOf("*/", i + 2); if (j < 0) throw new Error("unterminated comment"); i = j + 2; continue; }
        if (c === "'") {
            const j = s.indexOf("'", i + 1);
            if (j < 0) throw new Error("unterminated quote");
            t.push({ k: "s", v: s.slice(i + 1, j) }); i = j + 1; continue;
        }
        const r = s.slice(i); let m;
        if ((m = r.match(/^0x[0-9a-fA-F]+/))) { t.push({ k: "hx", v: parseInt(m[0].slice(2), 16) }); i += m[0].length; continue; }
        if ((m = r.match(/^-?\d+(\.\d+)?e[+-]?\d+/i))) { t.push({ k: "n", v: Number(m[0]) }); i += m[0].length; continue; }
        if ((m = r.match(/^\d+(\.\d+)?/))) { t.push({ k: "n", v: +m[0] }); i += m[0].length; continue; }
        if ((m = r.match(/^[A-Za-z_][A-Za-z0-9_]*/))) { t.push({ k: "w", v: m[0].toLowerCase() }); i += m[0].length; continue; }
        if ((m = r.match(/^(!=|<>|<=|>=|[=<>(),*;?])/))) { t.push({ k: "p", v: m[0] }); i += m[0].length; continue; }
        throw new Error("unexpected character « " + c + " »");
    }
    return t;
}

function run(sql, params) {
    const T = tok(sql);
    let p = 0, pi = 0; params = params || [];

    const nx = () => T[p++];
    const isP = v => T[p] && T[p].k === "p" && T[p].v === v;
    const isW = v => T[p] && T[p].k === "w" && T[p].v === v;
    const near = () => T[p] ? " near « " + T[p].v + " »" : " at end of query";
    const exp = v => { if (!isW(v)) throw new Error("syntax: " + v.toUpperCase() + " expected" + near()); p++; };

    function val() {
        const t = nx();
        if (!t) throw new Error("syntax: value expected at end of query");
        if (t.k === "s" || t.k === "n" || t.k === "hx") return () => t.v;
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
            /* implicit coercion: any comparison between a number-like column and
               a string gets coerced, exactly as MySQL does. */
            let a = l(row), b = r(row);
            if (typeof a === "number" || typeof b === "number") {
                a = coerceNumber(a); b = coerceNumber(b);
            }
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

    exp("select");
    const cols = [nx()];
    while (isP(",")) { p++; cols.push(nx()); }
    exp("from");
    const t = nx();
    if (!t || t.k !== "w" || !DB[t.v]) throw new Error("unknown table « " + (t ? t.v : "") + " »");
    let where = null;
    if (isW("where")) { p++; where = orE(); }
    if (p < T.length) throw new Error("syntax" + near());

    const names = [], fns = [];
    for (const c of cols) {
        if (c.k === "p" && c.v === "*") {
            for (const k of Object.keys(DB[t.v][0])) { names.push(k); fns.push(r => r[k]); }
        } else if (c.k === "w") {
            names.push(c.v); fns.push(r => { if (!(c.v in r)) throw new Error("unknown column « " + c.v + " »"); return r[c.v]; });
        } else if (c.k === "s" || c.k === "n" || c.k === "hx") {
            names.push(String(c.v)); fns.push(() => c.v);
        } else throw new Error("syntax near « " + c.v + " »");
    }
    const rows = DB[t.v].filter(where || (() => true)).map(r => fns.map(f => f(r)));
    return { head: names, rows };
}

function exec(sql, params) {
    try { const r = run(sql, params); return { ok: 1, head: r.head, rows: r.rows }; }
    catch (e) { return { ok: 0, e: e.message }; }
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

const $ = id => document.getElementById(id);

$("run").onclick = () => {
    const v = $("age").value;
    const b = build([
        "SELECT title, min_age FROM articles WHERE min_age <= ", { v: v }
    ]);
    const r = exec(b.sql);

    let html = '<div class="query-box">' + b.html + "</div>";
    /* Coercion preview so users can see the surprise */
    const coerced = coerceNumber(v);
    if (String(coerced) !== String(v).trim()) {
        html += '<p class="muted" style="font-size:12px;margin:4px 0 0">implicit cast: <code>' +
            esc(JSON.stringify(v)) + "</code> → <code>" + esc(coerced) + "</code></p>";
    }
    if (!r.ok) html += '<p class="result-bad"><b>SQL error:</b> ' + esc(r.e) + "</p>";
    else if (r.rows.length) html += renderTable(r);
    else html += '<p class="result-bad">No articles available.</p>';
    $("output").innerHTML = html;
};

$("reset").onclick = () => {
    $("age").value = "17";
    $("output").innerHTML = "";
};