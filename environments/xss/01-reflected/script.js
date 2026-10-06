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

document.getElementById("search").onclick = () => {
  const v = document.getElementById("q").value;
  const enc = document.getElementById("enc").checked;
  const out = enc ? esc(v) : v;
  const page = "<h2>Results for: " + out + "</h2><p>No products found.</p>";
  const a = analyse(page);

  let html = '<div class="query-box">' + esc("<h2>Results for: ") + '<span class="inj">' + esc(out) + "</span>" + esc("</h2><p>No products found.</p>") + "</div>";
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
