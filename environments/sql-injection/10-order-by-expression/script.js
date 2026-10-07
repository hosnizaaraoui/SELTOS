const DB = {
    products: [
        { id: 1, name: "Hammer", category: "tools", cost: 12 },
        { id: 2, name: "Wrench", category: "tools", cost: 18 },
        { id: 3, name: "Drill", category: "tools", cost: 95 },
        { id: 4, name: "Apple", category: "food", cost: 1 },
        { id: 5, name: "Bread", category: "food", cost: 3 }
    ],
    users: [
        { id: 1, name: "admin", password: "S3cret!Adm", role: "admin" },
        { id: 2, name: "alice", password: "alice123", role: "user" },
        { id: 3, name: "bob", password: "bob2024", role: "user" }
    ]
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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

/* Parser for the ORDER BY expression grammar: scalar / function / CASE /
   (subquery) / comparison — enough for the challenges. */
function run(sql, params) {
    const T = tok(sql);
    let p = 0, pi = 0; params = params || [];

    const nx = () => T[p++];
    const peek = () => T[p];
    const isP = v => T[p] && T[p].k === "p" && T[p].v === v;
    const isW = v => T[p] && T[p].k === "w" && T[p].v === v;
    const near = () => T[p] ? " near « " + T[p].v + " »" : " at end of query";
    const exp = v => { if (!isW(v)) throw new Error("syntax: " + v.toUpperCase() + " expected" + near()); p++; };

    function subquery() {
        exp("select");
        const col = nx();
        if (!col || (col.k !== "w" && !(col.k === "p" && col.v === "*"))) throw new Error("syntax: column expected");
        exp("from");
        const t = nx();
        if (!t || t.k !== "w" || !DB[t.v]) throw new Error("unknown table « " + (t ? t.v : "") + " »");
        let where = null;
        if (isW("where")) { p++; where = orE(); }
        if (!isP(")")) throw new Error("syntax: « ) » expected" + near());
        p++;
        return () => {
            const rows = DB[t.v].filter(where || (() => true));
            if (!rows.length) return null;
            const r = rows[0];
            if (col.v === "*") return 1;
            if (!(col.v in r)) throw new Error("unknown column « " + col.v + " »");
            return r[col.v];
        };
    }

    function val() {
        if (isP("(") && T[p + 1] && T[p + 1].k === "w" && T[p + 1].v === "select") {
            p++;
            return subquery();
        }
        if (isP("(")) {
            p++;
            const e = orE();
            if (!isP(")")) throw new Error("syntax: « ) » expected" + near());
            p++;
            return e;
        }
        const t = nx();
        if (!t) throw new Error("syntax: value expected at end of query");
        if (t.k === "s" || t.k === "n") return () => t.v;
        if (t.k === "p" && t.v === "?") { const v = params[pi++]; return () => v; }
        if (t.k === "w") {
            const fn = t.v;
            if (isP("(")) {
                p++;
                const args = [];
                if (!isP(")")) {
                    for (; ;) { args.push(val()); if (isP(",")) { p++; continue; } break; }
                }
                if (!isP(")")) throw new Error("syntax: « ) » expected" + near());
                p++;
                if (fn === "length") { const a = args[0]; return row => a(row) == null ? null : String(a(row)).length; }
                if (fn === "substr" || fn === "substring") {
                    const a = args[0], s = args[1], n = args[2];
                    return row => {
                        const str = String(a(row));
                        const i = Math.max(0, Number(s(row)) - 1);
                        return n ? str.substr(i, Number(n(row))) : str.substr(i);
                    };
                }
                if (fn === "concat") { return row => args.map(a => String(a(row))).join(""); }
                throw new Error("unknown function « " + fn + " »");
            }
            if (fn === "case") {
                p--; // rewind so case parser runs cleanly
                return caseExpr();
            }
            if (fn === "true") return () => 1;
            if (fn === "false") return () => 0;
            if (fn === "null") return () => null;
            return r => {
                if (!(fn in r)) throw new Error("unknown column « " + fn + " »");
                return r[fn];
            };
        }
        throw new Error("syntax near « " + t.v + " »");
    }

    /* CASE WHEN <cond> THEN <val> [WHEN ...] [ELSE <val>] END */
    function caseExpr() {
        exp("case");
        const branches = [];
        let elseFn = null;
        while (isW("when")) {
            p++;
            const c = orE();
            exp("then");
            const v = val();
            branches.push({ c, v });
        }
        if (isW("else")) { p++; elseFn = val(); }
        exp("end");
        return row => {
            for (const b of branches) if (b.c(row)) return b.v(row);
            return elseFn ? elseFn(row) : null;
        };
    }

    function cond() {
        const l = val();
        if (isW("is")) {
            p++;
            const neg = isW("not"); if (neg) p++;
            if (isW("null")) { p++; return row => (neg ? l(row) != null : l(row) == null); }
            throw new Error("syntax: NULL expected" + near());
        }
        const o = nx();
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

    /* ---------- main statement: SELECT name, cost FROM products WHERE category='...' ORDER BY <expr> ---------- */
    exp("select");
    const outCols = [nx()];
    while (isP(",")) { p++; outCols.push(nx()); }
    exp("from");
    const tbl = nx();
    if (!tbl || tbl.k !== "w" || !DB[tbl.v]) throw new Error("unknown table « " + (tbl ? tbl.v : "") + " »");
    let where = null;
    if (isW("where")) { p++; where = orE(); }
    exp("order");
    exp("by");
    const orderFn = val();      // accepts CASE, functions, columns, subqueries
    const dir = isW("asc") || isW("desc") ? nx() : null;

    const names = outCols.map(c => c.v);
    const fns = outCols.map(c => r => r[c.v]);
    let rows = DB[tbl.v].filter(where || (() => true)).map(r => fns.map(f => f(r)));
    const keyed = rows.map((r, i) => ({ r, k: orderFn(DB[tbl.v].filter(where || (() => true))[i]), i }));
    keyed.sort((a, b) => {
        const av = a.k, bv = b.k;
        if (av == null && bv == null) return a.i - b.i;
        if (av == null) return -1;
        if (bv == null) return 1;
        if (av < bv) return dir && dir.v === "desc" ? 1 : -1;
        if (av > bv) return dir && dir.v === "desc" ? -1 : 1;
        return a.i - b.i;
    });
    rows = keyed.map(k => k.r);
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
    const cat = $("cat").value;
    const sort = $("sort").value;
    const b = build([
        "SELECT name, cost FROM products WHERE category = '", { v: cat },
        "' ORDER BY ", { v: sort }
    ]);
    const r = exec(b.sql);

    let html = '<div class="query-box">' + b.html + "</div>";
    if (!r.ok) html += '<p class="result-bad"><b>SQL error:</b> ' + esc(r.e) + "</p>";
    else if (r.rows.length) html += renderTable(r);
    else html += '<p class="result-bad">No products found.</p>';
    $("output").innerHTML = html;
};

$("reset").onclick = () => {
    $("cat").value = "tools";
    $("sort").value = "name";
    $("output").innerHTML = "";
};