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

/* ---------- search: the server-side "query" ---------- */
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

  // This is the page the "server" would return. When encoding is off, the raw
  // user input is concatenated in — the classic reflected-XSS sink.
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

  /* ---------- live target ----------
     WARNING: this iframe is intentionally same-origin with the lab (no sandbox).
     Payloads you type run for real, with this page's origin, and can touch the
     parent lab DOM and its cookies. That is the point of the lab — do not add
     this pattern to any page that accepts input from someone else. */
  html += '<p class="muted">Live target (payloads execute here):</p>' +
    '<iframe id="target" style="width:100%;height:200px;border:1px solid #444;background:#fff;color:#000"></iframe>';

  document.getElementById("output").innerHTML = html;

  // Write the reflected page into the target iframe so <script> tags run.
  const target = document.getElementById("target");
  const doc = target.contentDocument;
  doc.open();
  doc.write(page);
  doc.close();
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