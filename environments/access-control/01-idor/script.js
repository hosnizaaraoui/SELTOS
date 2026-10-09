/* ---------- data: fetched from shared mock JSON (see ../../mock/) ----------
   Each table can be re-pointed with a query parameter named after the file's
   basename, e.g. ?invoices=../../mock/invoices-admin.json  (relative or absolute URL). */
const MOCK = {
  invoices: "../../mock/invoices.json"
};

const ME = "alice";

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

/* ---------- server-side API simulation ----------
   In the real lab this is GET /api/invoices/<id>.
   Here the same logic runs locally against the fetched table. */
function api(id, check) {
  const inv = DB.invoices.find(i => i.id === Number(id));
  if (!inv) return { status: 404, body: { error: "invoice not found" } };
  if (check && inv.owner !== ME) return { status: 403, body: { error: "forbidden" } };
  return { status: 200, body: inv };
}

document.getElementById("fetch").onclick = async () => {
  if (!(await ready("output"))) return;

  const id = document.getElementById("id").value.trim();
  const check = document.getElementById("fix").checked;
  const r = api(id, check);
  const bad = r.status !== 200;

  let html = '<div class="query-box">GET /api/invoices/<span class="inj">' + esc(id) + "</span><br>Session: user=" + ME + "</div>";
  html += '<p class="' + (bad ? "result-bad" : "") + '"><b>HTTP ' + r.status + "</b></p>";
  html += "<pre><code>" + esc(JSON.stringify(r.body, null, 2)) + "</code></pre>";
  if (!bad && r.body.owner !== ME)
    html += '<p class="result-bad"><b>IDOR:</b> you just read data owned by « ' + esc(r.body.owner) + " ».</p>";

  document.getElementById("output").innerHTML = html;
};

document.getElementById("reset").onclick = () => {
  document.getElementById("id").value = "101";
  document.getElementById("fix").checked = false;
  document.getElementById("output").innerHTML = "";
};

/* ---------- open this lab in a full browser tab (keeps ?theme= and any overrides) ---------- */
document.getElementById("open-browser").onclick = () => {
  const url = new URL(location.href);
  url.searchParams.set("theme", document.documentElement.dataset.theme || "dracula");
  window.open(url.toString(), "_blank", "noopener");
};