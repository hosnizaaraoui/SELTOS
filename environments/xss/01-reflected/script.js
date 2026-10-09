/* ---------- data: fetched from shared mock JSON (see ../../mock/) ----------
   Each table can be re-pointed with a query parameter named after the file's
   basename, e.g. ?products=../../mock/products-admin.json  (relative or absolute URL). */
const MOCK = {
  products: "../../mock/products.json"
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

// Inert analysis: DOMParser never executes scripts or handlers.
function analyse(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const found = [];
  const all = doc.body.querySelectorAll("*");
  all.forEach(el => {
    if (el.tagName === "SCRIPT") found.push("<script> element");
    for (const a of el.attributes) {
      if (/^on/i.test(a.name)) found.push("event handler « " + a.name + " » on <" + el.tagName.toLowerCase() + ">");
      if (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) found.push("javascript: URL in " + a.name);
    }
  });
  return { found, injected: all.length > 2 }; // template itself has h2 + p
}

/* ---------- search: the server-side "query" ----------
   In the real lab this would be a request to /search?q=...
   Here we simulate that request locally, then echo the term back into the
   results page — which is what makes the reflection exploitable. */
function search(q) {
  const needle = q.toLowerCase();
  return DB.products.filter(p =>
    !needle ||
    p.name.toLowerCase().includes(needle) ||
    (p.description || "").toLowerCase().includes(needle)
  );
}

document.getElementById("search").onclick = async () => {
  if (!(await ready("output"))) return;

  const v = document.getElementById("q").value;
  const enc = document.getElementById("enc").checked;
  const out = enc ? esc(v) : v;

  const hits = search(v);
  const resultsHtml = hits.length
    ? "<ul>" + hits.map(p => "<li>" + esc(p.name) + " — $" + esc(String(p.price)) + "</li>").join("") + "</ul>"
    : "<p>No products found.</p>";

  const page = "<h2>Results for: " + out + "</h2>" + resultsHtml;
  const a = analyse(page);

  let html = '<div class="query-box">' +
    esc("<h2>Results for: ") +
    '<span class="inj">' + esc(out) + "</span>" +
    esc("</h2>" + resultsHtml) +
    "</div>";

  if (a.found.length)
    html += '<p class="result-bad"><b>Script would execute:</b> ' + a.found.map(esc).join("; ") + "</p>";
  else if (a.injected)
    html += '<p class="result-bad"><b>HTML injected</b>, but no script execution vector found.</p>';
  else
    html += "<p><b>No injection:</b> the input is rendered as text.</p>";

  html += '<p class="muted">Inert preview (sandboxed, scripts disabled):</p>' +
    '<iframe sandbox="" style="width:100%;height:120px;border:1px solid #444;background:#fff;color:#000" srcdoc="' +
    esc(page) + '"></iframe>';

  document.getElementById("output").innerHTML = html;
};

document.getElementById("reset").onclick = () => {
  document.getElementById("q").value = "keyboard";
  document.getElementById("enc").checked = false;
  document.getElementById("output").innerHTML = "";
};

/* ---------- open this lab in a full browser tab (keeps ?theme= and any overrides) ---------- */
document.getElementById("open-browser").onclick = () => {
  const url = new URL(location.href);
  url.searchParams.set("theme", document.documentElement.dataset.theme || "dracula");
  window.open(url.toString(), "_blank", "noopener");
};