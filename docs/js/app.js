// ★あなたの exec URL に置き換え
const API = "https://script.google.com/macros/s/AKfycbx3ii3Xp2gIlWa5iakG2a4fifVaXt9mOrPhtqVMCLCk3twNgGE4_mRNd5SGs_W52ap3/exec
";

async function fetchProblems({ pool="all", order="seq", limit=50, textno="" } = {}) {
  const qs = new URLSearchParams({ pool, order, limit, textno });
  const r = await fetch(`${API}?${qs.toString()}`);
  return await r.json();
}

async function saveResult({ id, passed, scorePct }) {
  await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "text/plain" }, // ←プリフライト回避
    body: JSON.stringify({ id, passed, scorePct })
  });
}
