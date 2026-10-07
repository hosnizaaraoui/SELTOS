const DB = {
    users: [
        { id: 1, name: "admin", password: "S3cret!Adm", role: "admin" },
        { id: 2, name: "alice", password: "alice123", role: "user" },
        { id: 3, name: "bob", password: "bob2024", role: "user" }
    ]
};

const attackerLog = [];

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
        if ((m = r.match(/^(!=|<>|<=|>=|[=<>(),*;?|])/))) { t.push({ k: "p", v: m[0] }); i += m[0].length; continue; }
        throw new Error("unexpected character « " + c + " »");
    }
    return t;
}

/* ---------- engine with EXFIL, SUBSTR, CONCAT, || ---------- */
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
        if (t.k === "p" && t.v === "(") {
            // parenthesised scalar subquery or expression
            const inner = val();
            if (!isP(")")) throw new Error("syntax: « ) » expected" + near());
            p++;
            return inner;
        }
        if (t.k === "w") {
            const fn = t.v;
            // function call?
            if (isP("(")) {
                p++;
                const args = [];
                if (!isP(")")) {
                    for (; ;) { args.push(val()); if (isP(",")) { p++; continue; } break; }
                }
                if (!isP(")")) throw new Error("syntax: « ) » expected" + near());
                p++;
                if (fn === "exfil") {
                    const host = args[0] ? args[0] : (() => "");
                    const value = args[1] ? args[1] : (() => "");
                    return () => {
                        const h = host({}), v = value({});
                        attackerLog.push({ host: String(h), value: String(v), t: new Date().toISOString() });
                        return 1;
                    };
                }
                if (fn === "substr" || fn === "substring") {
                    const src = args[0], start = args[1], len = args[2];
                    return row => {
                        const s = String(src(row));
                        const i = Math.max(0, Number(start(row)) - 1);
                        const n = len ? Number(len(row)) : undefined;
                        return n != null ? s.substr(i, n) : s.substr(i);
                    };
                }
                if (fn === "concat") {
                    return row => args.map(a => String(a(row))).join("");
                }
                if (fn === "length") {
                    const a = args[0];
                    return row => String(a(row)).length;
                }
                if (fn === "ascii") {
                    const a = args[0];
                    return row => String(a(row)).charCodeAt(0);
                }
                // unknown function — treat as column name to keep the error honest
                return row => {
                    if (!(fn in row)) throw new Error("unknown function « " + fn + " »");
                    return row[fn];
                };
            }
            return r => {
                if (!(t.v in r)) throw new Error("unknown column « " + t.v + " »");
                return r[t.v];
            };
        }
        throw new Error("syntax near « " + t.v + " »");
    }

    /* `||` string concatenation is handled at the comparison layer so that
       "a || b" on either side of an operator works. */
    function scalar() {
        let left = val();
        while (isP("|")) {
            if (!(T[p + 1] && T[p + 1].k === "p" && T[p + 1].v === "|")) break;
            p += 2;
            const right = val(), l = left;
            left = row => String(l(row)) + String(right(row));
        }
        return left;
    }

    function cond() {
        if (isP("(")) {
            // could be a subquery ( SELECT ... ) or a parenthesised condition
            const save = p;
            p++;
            if (isW("select")) {
                p = save;
                const sub = subquery();
                // allow "= (subquery)" style by returning a value wrapper — not used here
                return () => true;
            }
            p = save + 1;
            const e = orE();
            if (!isP(")")) throw new Error("syntax: « ) » expected" + near());
            p++;
            return e;
        }
        const l = scalar();
        const o = nx();
        if (!o) throw new Error("syntax: operator expected at end of query");
        const ops = ["=", "!=", "<>", "<", ">", "<=", ">="];
        const like = o.k === "w" && o.v === "like";
        if (!like && !(o.k === "p" && ops.includes(o.v))) throw new Error("syntax near « " + o.v + " »");
        const r = scalar();
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

    /* subquery producing a single scalar — supports (SELECT password FROM users WHERE name='admin') */
    function subquery() {
        exp("select");
        const colTok = nx();
        if (!colTok || colTok.k !== "w") throw new Error("syntax: column expected");
        exp("from");
        const t = nx();
        if (!t || t.k !== "w" || !DB[t.v]) throw new Error("unknown table « " + (t ? t.v : "") + " »");
        let where = null;
        if (isW("where")) { p++; where = orE(); }
        let limit = null;
        if (isW("limit")) { p++; const n = nx(); if (!n || n.k !== "n") throw new Error("syntax: LIMIT expects a number"); limit = n.v; }
        if (!isP(")")) throw new Error("syntax: « ) » expected" + near());
        p++; // consume )
        const rows = DB[t.v].filter(where || (() => true));
        const slice = limit ? rows.slice(0, limit) : rows;
        return () => {
            if (!slice.length) return null;
            const row = slice[0];
            if (!(colTok.v in row)) throw new Error("unknown column « " + colTok.v + " »");
            return row[colTok.v];
        };
    }

    /* Primary expression: parenthesised subquery OR scalar */
    function expr() {
        if (isP("(") && T[p + 1] && T[p + 1].k === "w" && T[p + 1].v === "select") {
            p++; // consume (
            return subquery();
        }
        return scalar();
    }

    /* override val() usage in cond() so (SELECT ...) can appear on either side */
    const _val = val;
    // (kept as-is; cond() uses scalar() which uses val())

    const verb = nx();
    if (!verb || verb.k !== "w") throw new Error("syntax: expected statement keyword" + near());

    if (verb.v !== "select") throw new Error("only SELECT is allowed in this lab");

    const cols = [];
    for (; ;) {
        if (isP("(") && T[p + 1] && T[p + 1].k === "w" && T[p + 1].v === "select") {
            cols.push({ sub: true });
            p++;
            // capture subquery by running it once for projection
            // (we inline the subquery into a column below)
            p--; // rewind so subquery parser can consume '(' itself? simpler: parse here
            p++; // consume '(' again
            const sq = subquery();
            cols[cols.length - 1].fn = sq;
            cols[cols.length - 1].name = "sub";
        } else {
            const c = nx();
            if (!c) throw new Error("syntax: column expected");
            cols.push(c);
        }
        if (isP(",")) { p++; continue; }
        break;
    }
    exp("from");
    const t = nx();
    if (!t || t.k !== "w" || !DB[t.v]) throw new Error("unknown table « " + (t ? t.v : "") + " »");
    let where = null;
    if (isW("where")) { p++; where = orE(); }
    if (p < T.length) throw new Error("syntax" + near());

    const names = [], fns = [];
    for (const c of cols) {
        if (c.sub) { names.push(c.name); fns.push(() => c.fn({})); continue; }
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

const $ = id => document.getElementById(id);

function renderLog() {
    $("log").textContent = attackerLog.length
        ? attackerLog.map(e => "[" + e.t + "] " + e.host + "  <-  " + e.value).join("\n")
        : "(no exfiltration yet)";
}

$("check").onclick = () => {
    const v = $("email").value;
    const b = build([
        "SELECT id FROM users WHERE name = '", { v: v }, "'"
    ]);
    const r = exec(b.sql);

    let html = '<div class="query-box">' + b.html + "</div>";
    if (!r.ok) {
        html += '<p class="result-bad"><b>SQL error:</b> ' + esc(r.e) + "</p>";
    } else if (r.rows.length) {
        html += '<p class="result-ok">registered</p>';
    } else {
        html += '<p class="result-bad">not registered</p>';
    }
    $("output").innerHTML = html;
    renderLog();
};

$("reset").onclick = () => {
    attackerLog.length = 0;
    $("email").value = "alice@corp.com";
    $("output").innerHTML = "";
    renderLog();
};

renderLog();