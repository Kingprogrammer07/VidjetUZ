// A widget of one's own: what git says about a repository, through widget.shell.exec.
const $ = (id) => document.getElementById(id);
async function refresh() {
  const repo = widget.settings.get().repo;
  const r = await widget.shell.exec("git", ["-C", repo, "status", "--short", "--branch"]);
  const [head, ...lines] = r.stdout.trim().split("\n");
  const m = head.match(/^## (\S+?)(?:\.\.\.\S+)?(?: \[(.+)\])?$/) || [];
  $("repo").textContent = repo.split("\\").pop();
  $("branch").textContent = m[1] || "–";
  $("files").innerHTML = lines.map((l) => {
    const k = l.slice(0, 2).trim() || "?";
    return `<li><i class="k-${k === "??" ? "new" : k[0]}">${k}</i><span>${l.slice(3)}</span></li>`;
  }).join("");
  $("foot").textContent = `${lines.length} 个改动${m[2] ? " · " + m[2].replace("ahead", "领先") : ""}`;
}
refresh();
setInterval(refresh, 30000);
