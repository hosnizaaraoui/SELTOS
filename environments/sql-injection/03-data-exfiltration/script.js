const DB = {
    users: [
        { id: 1, name: "admin", password: "S3cret!Adm", role: "admin" },
        { id: 2, name: "alice", password: "alice123", role: "user" },
        { id: 3, name: "bob", password: "bob2024", role: "user" }
    ]
};

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
        if ((m = r.match(/^(!=|<>|<=|>=|[=<>(),*;?|])/))) {
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

function renderRows(r) {
    return '<div class="tw"><table class="lab-table"><tr>' +
        r.head.map(h => "<th>" + esc(h) + "</th>").join("") +
        "</tr>" +
        r.rows.map(row =>
            "<tr>" + row.map(cell => "<td>" + esc(cell) + "</td>").join("") + "</tr>"
        ).join("") +
        "</table></div>";
}

document.getElementById("lookup").onclick = () => {
    const v = document.getElementById("uid").value;

    const b = build([
        "SELECT name FROM users WHERE id = '", { v: v }, "'"
    ]);
    const r = exec(b.sql);

    let html = '<div class="query-box">' + b.html + "</div>";
    if (!r.ok) {
        html += '<p class="result-bad"><b>SQL error:</b> ' + esc(r.e) + "</p>";
    } else if (r.rows.length) {
        html += renderRows(r);
    } else {
        html += '<p class="result-bad">No user found.</p>';
    }
    document.getElementById("output").innerHTML = html;
};

document.getElementById("reset").onclick = () => {
    document.getElementById("uid").value = "2";
    document.getElementById("output").innerHTML = "";
};