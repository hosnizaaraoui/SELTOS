const DB = {
    products: [
        { id: 1, name: "Keyboard", price: 25, public: 1 },
        { id: 2, name: "Mouse", price: 12, public: 1 },
        { id: 3, name: "Monitor", price: 140, public: 1 },
        { id: 4, name: "USB Cable", price: 5, public: 1 },
        { id: 5, name: "Prototype Secret", price: 9999, public: 0 }
    ],
    users: [
        { id: 1, name: "admin", password: "S3cret!Adm", role: "admin" },
        { id: 2, name: "alice", password: "alice123", role: "user" },
        { id: 3, name: "bob", password: "bob2024", role: "user" }
    ]
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- the naive WAF ---------- */
function wafFilter(s) {
    return s
        .replace(/UNION/gi, "")
        .replace(/SELECT/gi, "")
        .replace(/OR\s/gi, "")
        .replace(/--/g, "");
}

function tok(s) {
    const t = []; let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) { i++; continue; }
        if (s.startsWith("--", i) || c === "#") break;
        if (s.startsWith("/*", i)) {
            const j = s.indexOf("*/", i + 2);
            if (j < 0) throw new Error("unterminated block comment");
            i = j + 2; continue;
        }
        if (c === "'") {
            const j = s.indexOf("'", i + 1);
            if (j < 0) throw new Error("unterminated quote");
            t.push({ k: "s", v: s.slice(i + 1, j) }); i = j + 1; continue;
        }
        const r = s.slice(i); let m;
        if ((m = r.match(/^\d+(\.\d+)?/))) { t.push({ k: "n", v: +m[0] }); i += m[0].length; continue; }
        if ((m = r.match(/^[A-Za-z_][A-Za-z0-9_]*/))) { t.push({ k: "w", v: m[0].toLowerCase() }); i += m[0].length; continue; }
        if ((m = r.match(/^(!=|<>|<=|>=|\|\||[=<>(),*;?|])/))) { t.push({ k: "p", v: m[0] }); i += m[0].length; continue; }
        throw new Error("unexpected character « " + c + " »");
    }
    return t;
}

/* ---------- engine: `||` is a logical OR here (MySQL reads it as OR too) ---------- */
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

    /* OR and || both mean logical OR here */
    function orE() {
        let a = andE();
        for (; ;) {
            if (isW("or")) { p++; }
            else if (isP("|") && T[p + 1] && T[p + 1].k === "p" && T[p + 1].v === "|") { p += 2; }
            else break;
            const b = andE(), x = a;
            a = r => x(r) || b(r);
        }
        return a;
    }

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
        } else if (c.k === "s" || c.k === "n") {
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

$("go").onclick = () => {
    const raw = $("q").value;
    const filtered = wafFilter(raw);

    $("filtered").innerHTML =
        '<div class="query-box"><b>WAF output:</b> ' + esc(filtered || "(empty)") + "</div>";

    const b = build([
        "SELECT name, price FROM products WHERE name LIKE '%", { v: filtered },
        "%' AND public = 1"
    ]);
    const r = exec(b.sql);

    let html = '<div class="query-box">' + b.html + "</div>";
    if (!r.ok) html += '<p class="result-bad"><b>SQL error:</b> ' + esc(r.e) + "</p>";
    else if (r.rows.length) html += renderTable(r);
    else html += '<p class="result-bad">No products found.</p>';
    $("output").innerHTML = html;
};

$("reset").onclick = () => {
    $("q").value = "keyboard";
    $("filtered").innerHTML = "";
    $("output").innerHTML = "";
};