/* shared engine — same shape as Lab 07, plus a live state panel */

const INITIAL_DB = {
    users: [
        { id: 1, name: "admin", password: "S3cret!Adm", role: "admin" },
        { id: 2, name: "alice", password: "alice123", role: "user" },
        { id: 3, name: "bob", password: "bob2024", role: "user" }
    ],
    subscribers: [
        { id: 1, email: "alice@corp.com" },
        { id: 2, email: "bob@corp.com" },
        { id: 3, email: "carol@corp.com" }
    ],
    audit_log: [
        { id: 1, event: "login", who: "admin" },
        { id: 2, event: "reset", who: "alice" }
    ]
};
let DB = structuredClone(INITIAL_DB);

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

function runOne(sql, params, db) {
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
    function orE() { let a = andE(); while (isW("or")) { p++; const b = andE(), x = a; a = r => x(r) || b(r); } return a; }

    const verb = nx();
    if (!verb || verb.k !== "w") throw new Error("syntax: expected statement keyword" + near());

    if (verb.v === "select") {
        const cols = [nx()];
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
                names.push(c.v); fns.push(r => { if (!(c.v in r)) throw new Error("unknown column « " + c.v + " »"); return r[c.v]; });
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
            const v = val(); assigns.push({ col: col.v, v });
            if (isP(",")) { p++; continue; }
            break;
        }
        let where = null;
        if (isW("where")) { p++; where = orE(); }
        if (p < T.length) throw new Error("syntax" + near());
        let n = 0;
        for (const row of db[tbl.v]) { if (where && !where(row)) continue; for (const a of assigns) row[a.col] = a.v(row); n++; }
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
        for (; ;) { const v = val(); vals.push(v); if (isP(",")) { p++; continue; } break; }
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

    if (verb.v === "drop") {
        exp("table");
        const tbl = nx();
        if (!tbl || tbl.k !== "w" || !db[tbl.v]) throw new Error("unknown table « " + (tbl ? tbl.v : "") + " »");
        if (p < T.length) throw new Error("syntax" + near());
        delete db[tbl.v];
        return { kind: "drop", affected: 1 };
    }

    throw new Error("unsupported statement « " + verb.v + " »");
}

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
    } catch (e) { return { ok: 0, e: e.message }; }
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

function renderState() {
    $("state").textContent = JSON.stringify(DB, null, 2);
}

$("run").onclick = () => {
    const v = $("email").value;
    const b = build([
        "DELETE FROM subscribers WHERE email = '", { v: v }, "'"
    ]);
    const r = exec(b.sql, [], DB);

    let html = '<div class="query-box">' + b.html + "</div>";
    if (!r.ok) {
        html += '<p class="result-bad"><b>SQL error:</b> ' + esc(r.e) + "</p>";
    } else {
        const lines = r.results.map((x, i) => {
            const n = x.affected != null ? x.affected : (x.rows ? x.rows.length : 0);
            return "Statement " + (i + 1) + ": " + x.kind + " → " + n + " row(s) affected";
        });
        html += '<p class="result-ok">' + lines.map(esc).join("<br>") + "</p>";
    }
    $("output").innerHTML = html;
    renderState();
};

$("reset").onclick = () => {
    DB = structuredClone(INITIAL_DB);
    $("email").value = "alice@corp.com";
    $("output").innerHTML = "";
    renderState();
};

renderState();