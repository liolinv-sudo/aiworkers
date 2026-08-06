const socket = io();

let paymentConfig = { paymentLabel: null, paymentLink: null };

fetch("/api/config")
  .then((r) => r.json())
  .then((cfg) => {
    paymentConfig = cfg;
    const btn = document.getElementById("payment-link");
    if (cfg.paymentLink) {
      btn.href = cfg.paymentLink;
      btn.textContent = "💳 " + (cfg.paymentLabel || "Betala");
      btn.style.display = "inline-flex";
    }
  })
  .catch(() => {});

const grid = document.getElementById("agent-grid");
const template = document.getElementById("agent-card-template");
const logFeed = document.getElementById("log-feed");
const agentCountEl = document.getElementById("agent-count");
const goalAmountEl = document.getElementById("goal-amount");
const goalFillEl = document.getElementById("goal-fill");
const lineageSvg = document.getElementById("lineage-lines");

const agents = new Map(); // id -> agent data
const cardEls = new Map(); // id -> DOM element

// ---- Modal-hantering (vanliga divs, inte <dialog> — mer pålitligt på mobil) ----

function openModal(id) {
  document.getElementById(id).classList.add("open");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

function isModalOpen(id) {
  return document.getElementById(id).classList.contains("open");
}

// Alla stäng-knappar (✕ och "Avbryt") hanteras generiskt via data-close-modal
document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
});

// Klick på den mörka bakgrunden stänger också
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// Escape-tangenten stänger öppen modal
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  document.querySelectorAll(".modal-overlay.open").forEach((overlay) => closeModal(overlay.id));
});

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
  if (isModalOpen("outputs-dialog") && outputsTargetId === agent.id) renderOutputsList(agent);

  drawLineage();
}

// Enkel, säker markdown-lite: escapar HTML, tolkar bara **fetstil** och radbrytningar.
function renderMarkdownLite(str) {
  const escaped = escapeHtml(str || "");
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
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

function openSaleDialog(agentId) {
  saleTargetId = agentId;
  document.getElementById("sale-amount").value = "";
  document.getElementById("sale-description").value = "";
  openModal("sale-dialog");
}

document.getElementById("sale-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amountKr = document.getElementById("sale-amount").value;
  const description = document.getElementById("sale-description").value;
  await fetch("/api/sales", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId: saleTargetId, amountKr, description }),
  });
  closeModal("sale-dialog");
});

// ---- Alster-historik ----

let outputsTargetId = null;
const outputsList = document.getElementById("outputs-list");
const outputsTitle = document.getElementById("outputs-dialog-title");

function openOutputsDialog(agentId) {
  outputsTargetId = agentId;
  const agent = agents.get(agentId);
  if (!agent) return;
  outputsTitle.textContent = `${agent.name} — alla alster`;
  renderOutputsList(agent);
  openModal("outputs-dialog");
}

function renderOutputsList(agent) {
  if (!agent.outputs.length) {
    outputsList.innerHTML = `<p class="outputs-empty">Inga alster ännu.</p>`;
    return;
  }
  const items = [...agent.outputs].reverse();
  outputsList.innerHTML = items.map((o) => renderOutputItem(o)).join("");

  outputsList.querySelectorAll(".btn-download").forEach((btn) => {
    btn.addEventListener("click", () => {
      const output = agent.outputs.find((o) => o.id === btn.dataset.outputId);
      if (output) downloadOutput(agent, output);
    });
  });

  outputsList.querySelectorAll(".btn-download-pdf").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.href = `/api/agents/${agent.id}/outputs/${btn.dataset.outputId}/pdf`;
    });
  });

  outputsList.querySelectorAll(".btn-expand").forEach((btn) => {
    btn.addEventListener("click", () => expandToBook(agent.id, btn.dataset.outputId, btn));
  });
}

function renderOutputItem(o) {
  const time = new Date(o.createdAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

  if (o.isBook) {
    const chapters = (o.chapters || [])
      .map(
        (ch, i) => `
        <div class="chapter-block">
          <h5>${i + 1}. ${renderMarkdownLite(ch.title)}</h5>
          ${ch.illustrationIdea ? `<div class="illustration-placeholder">🖼 Illustrationsidé: ${escapeHtml(ch.illustrationIdea)}</div>` : ""}
          <p>${renderMarkdownLite(ch.text)}</p>
        </div>`
      )
      .join("");

    const marketplaceLinks = (o.marketplaces || [])
      .map((m) => `<a href="${m.url}" target="_blank" rel="noopener" class="marketplace-chip">${escapeHtml(m.name)}</a>`)
      .join("");

    return `
      <article class="output-item output-item-book">
        <div class="output-item-head">
          <h4>📖 ${renderMarkdownLite(o.title)}</h4>
          <span class="output-time">${time}</span>
        </div>
        <div class="book-meta">
          <span class="book-meta-chip">${o.pages || "?"} sidor</span>
          <span class="book-meta-chip book-price">Föreslaget pris: ${o.suggestedPriceKr ?? "?"} kr</span>
        </div>
        <details class="chapters-toggle">
          <summary>Visa alla ${o.chapters?.length || 0} kapitel</summary>
          ${chapters}
        </details>
        <div class="marketplace-row">
          <span class="marketplace-label">Lämpliga marknader:</span>
          ${marketplaceLinks || "<span class='bio-note'>Inga förslag</span>"}
        </div>
        <div class="output-item-actions">
          <button type="button" class="btn btn-tiny btn-download" data-output-id="${o.id}">⬇ .txt</button>
          <button type="button" class="btn btn-tiny btn-download-pdf" data-output-id="${o.id}">⬇ .pdf</button>
          ${paymentConfig.paymentLink ? `<a class="btn btn-tiny btn-buy" href="${paymentConfig.paymentLink}" target="_blank" rel="noopener">💳 Sälj/Köp</a>` : ""}
        </div>
      </article>
    `;
  }

  return `
    <article class="output-item">
      <div class="output-item-head">
        <h4>${renderMarkdownLite(o.title)}</h4>
        <span class="output-time">${time}</span>
      </div>
      <p>${renderMarkdownLite(o.body || o.preview)}</p>
      <div class="output-item-actions">
        <button type="button" class="btn btn-tiny btn-download" data-output-id="${o.id}">⬇ .txt</button>
        <button type="button" class="btn btn-tiny btn-expand" data-output-id="${o.id}">📖 Skriv fullständig bok (~30 sidor)</button>
        ${paymentConfig.paymentLink ? `<a class="btn btn-tiny btn-buy" href="${paymentConfig.paymentLink}" target="_blank" rel="noopener">💳 Köp</a>` : ""}
      </div>
    </article>
  `;
}

async function expandToBook(agentId, outputId, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = "Skriver bok… (tar en stund)";
  try {
    const res = await fetch(`/api/agents/${agentId}/outputs/${outputId}/expand`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Kunde inte skapa boken just nu.");
      btnEl.disabled = false;
      btnEl.textContent = "📖 Skriv fullständig bok (~30 sidor)";
    }
    // Resultatet strömmar in via socket ("agent:update") när det är klart -
    // renderOutputsList ritas om automatiskt.
  } catch (err) {
    alert("Nätverksfel: " + err.message);
    btnEl.disabled = false;
    btnEl.textContent = "📖 Skriv fullständig bok (~30 sidor)";
  }
}

function slugify(str) {
  return (str || "alster")
    .toLowerCase()
    .replace(/[^a-z0-9åäö]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "alster";
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function outputFullText(o) {
  if (o.isBook) {
    return (o.chapters || [])
      .map((ch, i) => `${i + 1}. ${ch.title}\n\n${ch.text}`)
      .join("\n\n\n");
  }
  return o.body || o.preview;
}

function downloadOutput(agent, output) {
  const time = new Date(output.createdAt).toLocaleString("sv-SE");
  const content = `${output.title}\n${"=".repeat(output.title.length)}\n\nSkapad av: ${agent.name}\nDatum: ${time}\n\n${outputFullText(output)}\n`;
  downloadTextFile(`${slugify(output.title)}.txt`, content);
}

function downloadAllOutputs(agent) {
  if (!agent.outputs.length) return;
  const parts = [...agent.outputs].reverse().map((o) => {
    const time = new Date(o.createdAt).toLocaleString("sv-SE");
    return `${o.title}\n${"-".repeat(o.title.length)}\nDatum: ${time}\n\n${outputFullText(o)}`;
  });
  const content = `Alla alster från ${agent.name}\n\n${parts.join("\n\n\n")}\n`;
  downloadTextFile(`${slugify(agent.name)}-alla-alster.txt`, content);
}

document.getElementById("outputs-download-all").addEventListener("click", () => {
  const agent = agents.get(outputsTargetId);
  if (agent) downloadAllOutputs(agent);
});

// ---- Agentens bakgrund/persona ----

const bioTitle = document.getElementById("bio-dialog-title");
const bioContent = document.getElementById("bio-content");

function openBioDialog(agentId) {
  const agent = agents.get(agentId);
  if (!agent || !agent.bio) return;
  bioTitle.textContent = `Om ${agent.name}`;
  const b = agent.bio;
  const activated = new Date(agent.createdAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

  bioContent.innerHTML = `
    <dl class="bio-list">
      <dt>Ålder</dt><dd>${escapeHtml(String(b.age))} år <span class="bio-note">(helt påhittat, förstås)</span></dd>
      <dt>Född</dt><dd>${escapeHtml(String(b.birthYear))}</dd>
      <dt>Aktiverad</dt><dd>${escapeHtml(activated)}</dd>
      <dt>Utbildning</dt><dd>${escapeHtml(b.education)}</dd>
      <dt>Intressen</dt><dd>${b.interests.map(escapeHtml).join(", ")}</dd>
      <dt>Familj</dt><dd>${escapeHtml(b.family)}</dd>
      <dt>Litet särdrag</dt><dd>${escapeHtml(b.quirk)}</dd>
      ${agent.parentId ? `<dt>Ursprung</dt><dd>Föddes ur agent <code>${escapeHtml(agent.parentId)}</code></dd>` : ""}
    </dl>
  `;
  openModal("bio-dialog");
}

document.getElementById("spawn-text").addEventListener("click", () => spawnAgent("text"));
document.getElementById("spawn-image").addEventListener("click", () => spawnAgent("image"));

// ---- Socket events ----

socket.on("agents:init", (list) => list.forEach(renderAgent));
socket.on("agent:update", renderAgent);
socket.on("stats:update", renderStats);
socket.on("logs:init", (list) => list.forEach(appendLog));
socket.on("log", appendLog);

window.addEventListener("resize", drawLineage);
