const USERS = { alice: ["alice", "dev"], bob: ["bob", "ops"], www: ["www"] };
const INIT = [
  { path: "/home/alice/notes.txt", owner: "alice", group: "alice", mode: "640" },
  { path: "/srv/app/config.env", owner: "root", group: "dev", mode: "666" },
  { path: "/usr/local/bin/backup.sh", owner: "root", group: "ops", mode: "750" },
  { path: "/opt/tools/deploy.sh", owner: "alice", group: "dev", mode: "070" },
  { path: "/etc/shadow", owner: "root", group: "shadow", mode: "640" }
];
let FILES = INIT.map(f => ({ ...f }));
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rwx = d => (d & 4 ? "r" : "-") + (d & 2 ? "w" : "-") + (d & 1 ? "x" : "-");
const ls = m => [...m].map(d => rwx(+d)).join("");

function render() {
  $("fs").innerHTML = '<div class="tw"><table class="lab-table"><tr><th>path</th><th>owner:group</th><th>mode</th><th>ls -l</th></tr>' +
    FILES.map(f => "<tr><td>" + esc(f.path) + "</td><td>" + f.owner + ":" + f.group + "</td><td>" + f.mode + "</td><td>-" + ls(f.mode) + "</td></tr>").join("") + "</table></div>";
  const sel = $("file").value;
  $("file").innerHTML = FILES.map(f => "<option>" + esc(f.path) + "</option>").join("");
  if (sel) $("file").value = sel;
}

$("check").onclick = () => {
  const u = $("user").value, f = FILES.find(x => x.path === $("file").value), a = $("act").value;
  const cls = f.owner === u ? 0 : USERS[u].includes(f.group) ? 1 : 2;
  const name = ["owner", "group", "other"][cls];
  const digit = +f.mode[cls];
  const ok = (digit & { r: 4, w: 2, x: 1 }[a]) !== 0;
  $("output").innerHTML = '<div class="query-box">' + u + ' → class <span class="inj">' + name + "</span> → digit " + digit + " (" + rwx(digit) + ")</div>" +
    '<p class="' + (ok ? "" : "result-bad") + '"><b>' + (ok ? "ALLOW" : "DENY") + "</b> — " + u + (ok ? " can " : " cannot ") + $("act").selectedOptions[0].text + " " + esc(f.path) + "</p>";
};

$("chmod").onclick = () => {
  const m = $("mode").value.trim();
  if (!/^[0-7]{3}$/.test(m)) { $("chout").innerHTML = '<p class="result-bad">Invalid mode: use 3 octal digits.</p>'; return; }
  const f = FILES.find(x => x.path === $("file").value);
  f.mode = m;
  $("chout").innerHTML = "<p>chmod " + m + " " + esc(f.path) + "</p>";
  render();
};

$("reset").onclick = () => {
  FILES = INIT.map(f => ({ ...f }));
  $("output").innerHTML = ""; $("chout").innerHTML = ""; $("mode").value = "640";
  render();
};
render();
