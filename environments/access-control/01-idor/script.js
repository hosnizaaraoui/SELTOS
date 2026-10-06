const ME = "alice";
const INVOICES = [
  { id: 101, owner: "alice", item: "Laptop stand", total: 49 },
  { id: 102, owner: "alice", item: "USB hub", total: 32 },
  { id: 103, owner: "bob", item: "Mechanical keyboard", total: 129, card_last4: "4417" },
  { id: 104, owner: "admin", item: "Server rack license", total: 8400, note: "FLAG{idor_invoice_104}" }
];

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function api(id, check) {
  const inv = INVOICES.find(i => i.id === Number(id));
  if (!inv) return { status: 404, body: { error: "invoice not found" } };
  if (check && inv.owner !== ME) return { status: 403, body: { error: "forbidden" } };
  return { status: 200, body: inv };
}

document.getElementById("fetch").onclick = () => {
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
