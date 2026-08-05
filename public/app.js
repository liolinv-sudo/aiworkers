const socket = io();

const grid = document.getElementById("agent-grid");
const template = document.getElementById("agent-card-template");
const logFeed = document.getElementById("log-feed");
const agentCountEl = document.getElementById("agent-count");
const goalAmountEl = document.getElementById("goal-amount");
const goalFillEl = document.getElementById("goal-fill");
const lineageSvg = document.getElementById("lineage-lines");

const agents = new Map(); // id -> agent data
const cardEls = new Map(); // id -> DOM element

// ---- Rendering ----

function krFromCents(cents) {
  return (cents / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderAgent(agent) {
  agents.set(agent.id, agent);

  let card = cardEls.get(agent.id);
  if (!card) {
    card = template.content.firstElementChild.cloneNode(true);
    card.dataset.id = agent.id;
    card.querySelector(".btn-reproduce").addEventListener("click", () => reproduce(agent.id));
    card.querySelector(".btn-sale").addEventListener("click", () => openSaleDialog(agent.id));
    card.querySelector(".btn-stop").addEventListener("click", () => stopAgent(agent.id));
    grid.appendChild(card);
    cardEls.set(agent.id, card);
  }

  card.dataset.status = agent.status;
  card.querySelector(".agent-name").textContent = agent.name;
  card.querySelector(".agent-status").textContent = statusLabel(agent.status);

  const latest = agent.outputs[agent.outputs.length - 1];
  card.querySelector(".latest-title").textContent = latest ? latest.title : "Väntar på första alstret…";
  card.querySelector(".latest-preview").textContent = latest ? latest.preview : "";

  card.querySelector(".output-count").textContent = agent.outputCount ?? agent.outputs.length;
  card.querySelector(".earnings").textContent = krFromCents(agent.earningsCents) + " kr";

  drawLineage();
}

function statusLabel(status) {
  switch (status) {
    case "working": return "Arbetar";
    case "idle": return "Vilar";
    case "error": return "Fel";
    case "stopped": return "Stoppad";
    default: return status;
  }
}

function drawLineage() {
  // Rita tunna linjer mellan förälder- och barn-agenter för att visa "förökning".
  lineageSvg.innerHTML = "";
  const gridRect = grid.getBoundingClientRect();

  for (const agent of agents.values()) {
    if (!agent.parentId) continue;
    const childEl = cardEls.get(agent.id);
    const parentEl = cardEls.get(agent.parentId);
    if (!childEl || !parentEl) continue;

    const c = childEl.getBoundingClientRect();
    const p = parentEl.getBoundingClientRect();

    const x1 = p.left - gridRect.left + p.width / 2;
    const y1 = p.top - gridRect.top + p.height / 2;
    const x2 = c.left - gridRect.left + c.width / 2;
    const y2 = c.top - gridRect.top + c.height / 2;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("stroke", "#6ee7b7");
    line.setAttribute("stroke-opacity", "0.25");
    line.setAttribute("stroke-width", "1.5");
    line.setAttribute("stroke-dasharray", "4 4");
    lineageSvg.appendChild(line);
  }
}

function renderStats(stats) {
  agentCountEl.textContent = `${stats.agentCount} / ${stats.maxAgents}`;
  goalAmountEl.textContent = `${krFromCents(stats.totalEarningsCents)} kr / ${krFromCents(stats.dailyGoalCents)} kr`;
  goalFillEl.style.width = `${stats.goalProgressPct}%`;
}

function appendLog(entry) {
  const div = document.createElement("div");
  div.className = "log-entry";
  const time = new Date(entry.ts).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  div.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(entry.text)}`;
  logFeed.prepend(div);
  while (logFeed.children.length > 100) logFeed.removeChild(logFeed.lastChild);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- Actions ----

async function spawnAgent(kind) {
  const res = await fetch("/api/agents/spawn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
  });
  if (!res.ok) {
    const { error } = await res.json();
    alert(error || "Kunde inte skapa agent.");
  }
}

async function reproduce(agentId) {
  const res = await fetch(`/api/agents/${agentId}/reproduce`, { method: "POST" });
  if (!res.ok) {
    const { error } = await res.json();
    alert(error || "Kunde inte föröka agenten.");
  }
}

async function stopAgent(agentId) {
  await fetch(`/api/agents/${agentId}/stop`, { method: "POST" });
  const card = cardEls.get(agentId);
  if (card) card.dataset.status = "stopped";
}

let saleTargetId = null;
const saleDialog = document.getElementById("sale-dialog");

function openSaleDialog(agentId) {
  saleTargetId = agentId;
  document.getElementById("sale-amount").value = "";
  document.getElementById("sale-description").value = "";
  saleDialog.showModal();
}

document.getElementById("sale-cancel").addEventListener("click", () => saleDialog.close());

document.getElementById("sale-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amountKr = document.getElementById("sale-amount").value;
  const description = document.getElementById("sale-description").value;
  await fetch("/api/sales", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId: saleTargetId, amountKr, description }),
  });
  saleDialog.close();
});

document.getElementById("spawn-text").addEventListener("click", () => spawnAgent("text"));
document.getElementById("spawn-image").addEventListener("click", () => spawnAgent("image"));

// ---- Socket events ----

socket.on("agents:init", (list) => list.forEach(renderAgent));
socket.on("agent:update", renderAgent);
socket.on("stats:update", renderStats);
socket.on("logs:init", (list) => list.forEach(appendLog));
socket.on("log", appendLog);

window.addEventListener("resize", drawLineage);
