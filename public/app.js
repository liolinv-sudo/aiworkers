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
    card.querySelector(".btn-info").addEventListener("click", () => openBioDialog(agent.id));
    grid.appendChild(card);
    cardEls.set(agent.id, card);
  }

  card.dataset.status = agent.status;
  card.querySelector(".agent-name").textContent = agent.name;
  card.querySelector(".agent-status").textContent = statusLabel(agent.status);
  card.querySelector(".agent-latest").onclick = () => openOutputsDialog(agent.id);

  const latest = agent.outputs[agent.outputs.length - 1];
  card.querySelector(".latest-title").innerHTML = latest ? renderMarkdownLite(latest.title) : "Väntar på första alstret…";
  card.querySelector(".latest-preview").innerHTML = latest ? renderMarkdownLite(latest.preview) : "";

  card.querySelector(".output-count").textContent = agent.outputCount ?? agent.outputs.length;
  card.querySelector(".earnings").textContent = krFromCents(agent.earningsCents) + " kr";

  // Om historikvyn är öppen för just denna agent, håll den uppdaterad live
  if (outputsDialog.open && outputsTargetId === agent.id) renderOutputsList(agent);

  drawLineage();
}

// Enkel, säker markdown-lite: escapar HTML, tolkar bara **fetstil**.
function renderMarkdownLite(str) {
  const escaped = escapeHtml(str || "");
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
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

// ---- Alster-historik ----

let outputsTargetId = null;
const outputsDialog = document.getElementById("outputs-dialog");
const outputsList = document.getElementById("outputs-list");
const outputsTitle = document.getElementById("outputs-dialog-title");

function openOutputsDialog(agentId) {
  outputsTargetId = agentId;
  const agent = agents.get(agentId);
  if (!agent) return;
  outputsTitle.textContent = `${agent.name} — alla alster`;
  renderOutputsList(agent);
  outputsDialog.showModal();
}

function renderOutputsList(agent) {
  if (!agent.outputs.length) {
    outputsList.innerHTML = `<p class="outputs-empty">Inga alster ännu.</p>`;
    return;
  }
  // Nyaste först
  const items = [...agent.outputs].reverse();
  outputsList.innerHTML = items
    .map((o) => {
      const time = new Date(o.createdAt).toLocaleString("sv-SE", {
        dateStyle: "short",
        timeStyle: "short",
      });
      return `
        <article class="output-item">
          <div class="output-item-head">
            <h4>${renderMarkdownLite(o.title)}</h4>
            <span class="output-time">${time}</span>
          </div>
          <p>${renderMarkdownLite(o.body || o.preview)}</p>
        </article>
      `;
    })
    .join("");
}

document.getElementById("outputs-close").addEventListener("click", () => outputsDialog.close());
outputsDialog.addEventListener("click", (e) => {
  // Stäng om man klickar på bakgrunden (::backdrop räknas som klick på dialog-elementet självt)
  if (e.target === outputsDialog) outputsDialog.close();
});

// ---- Agentens bakgrund/persona ----

const bioDialog = document.getElementById("bio-dialog");
const bioTitle = document.getElementById("bio-dialog-title");
const bioContent = document.getElementById("bio-content");

function openBioDialog(agentId) {
  const agent = agents.get(agentId);
  if (!agent || !agent.bio) return;
  bioTitle.textContent = `Om ${agent.name}`;
  const b = agent.bio;
  const born = new Date(agent.createdAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

  bioContent.innerHTML = `
    <dl class="bio-list">
      <dt>Ålder</dt><dd>${escapeHtml(String(b.age))} år <span class="bio-note">(helt påhittat, förstås)</span></dd>
      <dt>Född</dt><dd>${escapeHtml(born)}</dd>
      <dt>Utbildning</dt><dd>${escapeHtml(b.education)}</dd>
      <dt>Intressen</dt><dd>${b.interests.map(escapeHtml).join(", ")}</dd>
      <dt>Familj</dt><dd>${escapeHtml(b.family)}</dd>
      <dt>Litet särdrag</dt><dd>${escapeHtml(b.quirk)}</dd>
      ${agent.parentId ? `<dt>Ursprung</dt><dd>Föddes ur agent <code>${escapeHtml(agent.parentId)}</code></dd>` : ""}
    </dl>
  `;
  bioDialog.showModal();
}

document.getElementById("bio-close").addEventListener("click", () => bioDialog.close());
bioDialog.addEventListener("click", (e) => {
  if (e.target === bioDialog) bioDialog.close();
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
