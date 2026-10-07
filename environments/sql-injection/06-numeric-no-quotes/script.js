const DB = {
    invoices: [
        { id: 101, invoice_no: "INV-1001", amount: 240, customer: "Globex" },
        { id: 102, invoice_no: "INV-1002", amount: 95, customer: "Initech" },
        { id: 103, invoice_no: "INV-1003", amount: 1800, customer: "Umbrella Corp" }
    ],
    payment_methods: [
        { id: 1, card_number: "4111 1111 1111 1111", cvv: "123", owner: "Globex Finance" },
        { id: 2, card_number: "5500 0000 0000 0004", cvv: "456", owner: "Initech AP" }
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

function renderRows(r) {
    return '<div class="tw"><table class="lab-table"><tr>' +
        r.head.map(h => "<th>" + esc(h) + "</th>").join("") +
        "</tr>" +
        r.rows.map(row =>
            "<tr>" + row.map(cell => "<td>" + esc(cell) + "</td>").join("") + "</tr>"
        ).join("") +
        "</table></div>";
}

/* ---------- breach-impact panel ----------
   Classifies leaked columns by sensitivity and summarizes the real-world
   stakes of what just got exposed. Self-contained: no shared file, same
   philosophy as the rest of the engine in this lab. */
const SENSITIVE = {
    card_number: { label: "Full payment card number", severity: 4 },
    cvv: { label: "Card verification code (CVV)", severity: 4 },
    password: { label: "Plaintext password", severity: 4 },
    ssn: { label: "Government ID number", severity: 4 },
    mfa_secret: { label: "Multi-factor auth secret", severity: 3 },
    salary: { label: "Compensation data", severity: 3 },
    owner: { label: "Account holder name", severity: 2 }
};
const SEV_LABEL = ["", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

function renderImpact(head, rows) {
    const hits = head
        .map((h, i) => ({ h: String(h).toLowerCase(), i }))
        .filter(x => SENSITIVE[x.h]);
    if (!hits.length || !rows.length) return "";
    const sev = Math.max(...hits.map(x => SENSITIVE[x.h].severity));
    const lines = hits.map(x =>
        "• " + esc(SENSITIVE[x.h].label) + " — " + rows.length + " record" + (rows.length === 1 ? "" : "s") + " exposed"
    );
    return (
        '<div class="result-bad" style="margin-top:10px;border:1px dashed currentColor;padding:10px;border-radius:6px">' +
        "<b>IMPACT — " + SEV_LABEL[sev] + "</b><br>" +
        lines.join("<br>") +
        "</div>"
    );
}

document.getElementById("lookup").onclick = () => {
    const v = document.getElementById("iid").value;
    const b = build([
        "SELECT invoice_no, amount, customer FROM invoices WHERE id = ", { v: v }
    ]);
    const r = exec(b.sql);

    let html = '<div class="query-box">' + b.html + "</div>";
    if (!r.ok) {
        html += '<p class="result-bad"><b>SQL error:</b> ' + esc(r.e) + "</p>";
    } else if (r.rows.length) {
        html += renderRows(r);
        html += renderImpact(r.head, r.rows);
    } else {
        html += '<p class="result-bad">No invoice found.</p>';
    }
    document.getElementById("output").innerHTML = html;
};

document.getElementById("reset").onclick = () => {
    document.getElementById("iid").value = "101";
    document.getElementById("output").innerHTML = "";
};