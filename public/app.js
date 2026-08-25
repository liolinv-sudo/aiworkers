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
    if (cfg.substackUrl) {
      const link = document.getElementById("subscribe-link");
      link.href = cfg.substackUrl;
      link.style.display = "inline-block";
      document.getElementById("subscribe-fallback").style.display = "none";
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

// Pollinations gratisnivå tillåter bara ett anonymt bildanrop var 15:e
// sekund. Om flera bilder visas i samma vy måste de laddas EN I TAGET med
// paus emellan, annars nekas de flesta och visas som trasiga ikoner.
const POLLINATIONS_STAGGER_MS = 6000;
let pollinationsQueue = [];
let pollinationsQueueRunning = false;

function queuePollinationsImages(container) {
  const imgs = container.querySelectorAll("img.lazy-poll-img:not([data-queued])");
  imgs.forEach((img) => {
    img.dataset.queued = "1";
    img.classList.add("img-pending");
    pollinationsQueue.push(img);
  });
  runPollinationsQueue();
}

function runPollinationsQueue() {
  if (pollinationsQueueRunning) return;
  pollinationsQueueRunning = true;
  processNextPollinationsImage();
}

function processNextPollinationsImage() {
  const img = pollinationsQueue.shift();
  if (!img) {
    pollinationsQueueRunning = false;
    return;
  }
  // Hoppa över om bilden inte längre finns i dokumentet (t.ex. stängd dialog)
  if (!document.body.contains(img)) {
    processNextPollinationsImage();
    return;
  }
  img.src = img.dataset.src;
  const proceed = () => {
    img.classList.remove("img-pending");
    setTimeout(processNextPollinationsImage, POLLINATIONS_STAGGER_MS);
  };
  img.addEventListener("load", proceed, { once: true });
  img.addEventListener("error", proceed, { once: true });
}

// Visar en liten "nytt innehåll"-banner högst upp i en behållare istället
// för att skriva över det användaren just nu läser. Klick på banner-knappen
// kör den angivna uppdateringsfunktionen och tar bort bannern.
function showUpdateBanner(container, onRefresh) {
  if (container.querySelector(".update-banner")) return; // redan visad
  const banner = document.createElement("div");
  banner.className = "update-banner";
  banner.innerHTML = `🔄 Nytt innehåll har tillkommit — <button type="button">visa</button>`;
  banner.querySelector("button").addEventListener("click", () => {
    onRefresh();
  });
  container.prepend(banner);
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
    card.querySelector(".btn-info").addEventListener("click", () => openBioDialog(agent.id));
    grid.appendChild(card);
    cardEls.set(agent.id, card);
  }

  card.dataset.status = agent.status;
  card.querySelector(".agent-name").textContent = agent.name;
  card.querySelector(".agent-name").onclick = () => openOutputsDialog(agent.id);
  const genreLabel = agent.genre
    ? ` · ${agent.genre.category}${agent.genre.subgenre ? " (" + agent.genre.subgenre + ")" : ""}`
    : "";
  card.querySelector(".agent-status").textContent = statusLabel(agent.status) + genreLabel;
  card.querySelector(".agent-latest").onclick = () => openOutputsDialog(agent.id);

  // Stopp/starta om-knappen växlar text och funktion beroende på status.
  const stopBtn = card.querySelector(".btn-stop");
  if (agent.status === "stopped") {
    stopBtn.textContent = "▶ Starta om";
    stopBtn.onclick = () => resumeAgent(agent.id);
  } else {
    stopBtn.textContent = "Stoppa";
    stopBtn.onclick = () => stopAgent(agent.id);
  }

  const latest = agent.outputs[agent.outputs.length - 1];
  card.querySelector(".latest-title").innerHTML = latest ? renderMarkdownLite(latest.title) : "Väntar på första alstret…";
  card.querySelector(".latest-preview").innerHTML = latest ? renderMarkdownLite(latest.preview) : "";

  card.querySelector(".output-count").textContent = agent.outputCount ?? agent.outputs.length;
  card.querySelector(".earnings").textContent = krFromCents(agent.earningsCents) + " kr";

  // Om historikvyn/biblioteket är öppna, skriv INTE över det man läser -
  // visa istället en liten banner man själv klickar på när man är redo.
  // UNDANTAG: om personen just klickat på en knapp (skriv bok, översätt,
  // Notes-utkast) och väntar på resultatet, uppdatera direkt istället för
  // att gömma det bakom bannern - annars ser man aldrig svaret.
  if (isModalOpen("outputs-dialog") && outputsTargetId === agent.id) {
    if (awaitingActionRefresh) {
      renderOutputsList(agent);
    } else {
      showUpdateBanner(outputsList, () => {
        const a = agents.get(outputsTargetId);
        if (a) renderOutputsList(a);
      });
    }
  }
  if (isModalOpen("library-dialog")) {
    if (awaitingActionRefresh) {
      renderLibrary();
    } else {
      showUpdateBanner(libraryList, renderLibrary);
    }
  }

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

async function spawnAgent(kind, genre = null) {
  const res = await fetch("/api/agents/spawn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, genre }),
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

async function resumeAgent(agentId) {
  const res = await fetch(`/api/agents/${agentId}/resume`, { method: "POST" });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    alert(error || "Kunde inte starta om agenten.");
  }
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
  outputsList.innerHTML = items.map((o) => renderOutputItem(o, agent.id)).join("");
  bindOutputActions(outputsList);
  queuePollinationsImages(outputsList);
}

// Sann medan en självinitierad åtgärd (bokskrivning, översättning,
// Notes-utkast) pågår - gör att renderAgent uppdaterar öppna vyer direkt
// istället för att gömma resultatet bakom "lugn läsning"-bannern. En
// säkerhetstimer nollställer flaggan om inget mer hörs av.
let awaitingActionRefresh = false;
let awaitingActionTimer = null;

function beginAwaitingAction(maxMs) {
  awaitingActionRefresh = true;
  clearTimeout(awaitingActionTimer);
  awaitingActionTimer = setTimeout(() => {
    awaitingActionRefresh = false;
  }, maxMs);
}

function endAwaitingAction() {
  awaitingActionRefresh = false;
  clearTimeout(awaitingActionTimer);
}

async function translateOutput(agentId, outputId, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = "Översätter…";
  beginAwaitingAction(30000);
  try {
    const res = await fetch(`/api/agents/${agentId}/outputs/${outputId}/translate`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Kunde inte översätta just nu.");
      btnEl.disabled = false;
      btnEl.textContent = "🇬🇧 Översätt till engelska";
      endAwaitingAction();
    }
    // Resultatet strömmar in via socket ("agent:update") när det är klart.
  } catch (err) {
    alert("Nätverksfel: " + err.message);
    btnEl.disabled = false;
    btnEl.textContent = "🇬🇧 Översätt till engelska";
    endAwaitingAction();
  }
}

async function generateNotesDraft(agentId, outputId, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = "Skapar utkast…";
  beginAwaitingAction(20000);
  try {
    const res = await fetch(`/api/agents/${agentId}/outputs/${outputId}/notes-draft`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Kunde inte skapa Notes-utkast just nu.");
      btnEl.disabled = false;
      btnEl.textContent = "📝 Skapa Notes-utkast";
      endAwaitingAction();
    }
    // Resultatet strömmar in via socket ("agent:update") när det är klart.
  } catch (err) {
    alert("Nätverksfel: " + err.message);
    btnEl.disabled = false;
    btnEl.textContent = "📝 Skapa Notes-utkast";
    endAwaitingAction();
  }
}

function copyToClipboard(text, btnEl) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      const original = btnEl.textContent;
      btnEl.textContent = "✓ Kopierat!";
      setTimeout(() => (btnEl.textContent = original), 1800);
    })
    .catch(() => alert("Kunde inte kopiera automatiskt - markera texten manuellt istället."));
}

// Binder klick-händelser för alla knappar i en behållare (agent-historik
// ELLER det globala biblioteket) genom att slå upp agent/alster via
// data-agent-id / data-output-id på varje knapp.
function bindOutputActions(container) {
  container.querySelectorAll("[data-agent-id][data-output-id]").forEach((btn) => {
    const agentId = btn.dataset.agentId;
    const outputId = btn.dataset.outputId;
    const agent = agents.get(agentId);
    if (!agent) return;
    const output = agent.outputs.find((o) => o.id === outputId);

    if (btn.classList.contains("btn-download")) {
      btn.addEventListener("click", () => output && downloadOutput(agent, output));
    } else if (btn.classList.contains("btn-download-en-txt")) {
      btn.addEventListener("click", () => output && downloadOutputEn(agent, output));
    } else if (btn.classList.contains("btn-expand")) {
      btn.addEventListener("click", () => expandToBook(agentId, outputId, btn));
    } else if (btn.classList.contains("btn-translate")) {
      btn.addEventListener("click", () => translateOutput(agentId, outputId, btn));
    } else if (btn.classList.contains("btn-notes-draft")) {
      btn.addEventListener("click", () => generateNotesDraft(agentId, outputId, btn));
    } else if (btn.classList.contains("btn-copy-notes")) {
      btn.addEventListener("click", () => {
        if (output?.notesDraft) copyToClipboard(output.notesDraft, btn);
      });
    } else if (btn.classList.contains("btn-copy-text")) {
      btn.addEventListener("click", () => {
        if (!output) return;
        const full = `${output.title}\n\n${outputFullText(output)}`;
        copyToClipboard(full, btn);
      });
    } else if (btn.classList.contains("btn-open-agent")) {
      btn.addEventListener("click", () => {
        closeModal("library-dialog");
        openOutputsDialog(agentId);
      });
    }
  });
}

function renderTags(tags) {
  if (!tags || !tags.length) return "";
  return `<div class="tag-row">${tags.map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`).join("")}</div>`;
}

function renderGenreBadge(o) {
  if (!o.genre) return "";
  const label = o.genre.subgenre ? `${o.genre.category} — ${o.genre.subgenre}` : o.genre.category;
  return `<span class="genre-badge">${escapeHtml(label)}</span>`;
}

function renderNotesSection(o, agentId) {
  if (o.notesDraft) {
    return `
      <div class="notes-draft-box">
        <span class="notes-draft-label">📝 Notes-utkast (redo att klistra in i Substack)</span>
        <p class="notes-draft-text">${escapeHtml(o.notesDraft)}</p>
        <button type="button" class="btn btn-tiny btn-copy-notes" data-agent-id="${agentId}" data-output-id="${o.id}">📋 Kopiera</button>
      </div>
    `;
  }
  return `<button type="button" class="btn btn-tiny btn-notes-draft" data-agent-id="${agentId}" data-output-id="${o.id}">📝 Skapa Notes-utkast</button>`;
}

function renderOutputItem(o, agentId, showAgentName) {
  const time = new Date(o.createdAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
  const hasEn = !!o.translations?.en;
  const agentName = showAgentName ? agents.get(agentId)?.name : null;
  const agentLabel = agentName
    ? `<button type="button" class="btn-open-agent" data-agent-id="${agentId}" data-output-id="${o.id}">${escapeHtml(agentName)} →</button>`
    : "";

  const translateBtn = hasEn
    ? `<a class="btn btn-tiny btn-download" href="/api/agents/${agentId}/outputs/${o.id}/pdf?lang=en">⬇ .pdf (EN)</a>
       <button type="button" class="btn btn-tiny btn-download-en-txt" data-agent-id="${agentId}" data-output-id="${o.id}">⬇ .txt (EN)</button>`
    : `<button type="button" class="btn btn-tiny btn-translate" data-agent-id="${agentId}" data-output-id="${o.id}">🇬🇧 Översätt till engelska</button>`;

  if (o.isBook) {
    const chapters = (o.chapters || [])
      .map(
        (ch, i) => `
        <div class="chapter-block">
          <h5>${i + 1}. ${renderMarkdownLite(ch.title)}</h5>
          ${
            ch.illustrationUrl
              ? `<img class="chapter-illustration lazy-poll-img" data-src="${ch.illustrationUrl}" alt="${escapeHtml(ch.illustrationIdea || "")}" />`
              : ch.illustrationIdea
                ? `<div class="illustration-placeholder">🖼 Illustrationsidé: ${escapeHtml(ch.illustrationIdea)}</div>`
                : ""
          }
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
          <span class="output-time">${time} ${agentLabel}</span>
        </div>
        ${o.subtitle ? `<p class="output-subtitle">${renderMarkdownLite(o.subtitle)}</p>` : ""}
        ${renderGenreBadge(o)}
        ${o.coverImageUrl ? `<img class="book-cover lazy-poll-img" data-src="${o.coverImageUrl}" alt="Omslag: ${escapeHtml(o.title)}" />` : ""}
        <div class="book-meta">
          <span class="book-meta-chip">${o.pages || "?"} sidor</span>
          <span class="book-meta-chip book-price">Föreslaget pris: ${o.suggestedPriceKr ?? "?"} kr</span>
          ${hasEn ? `<span class="book-meta-chip">🇬🇧 Engelsk version klar</span>` : ""}
        </div>
        ${renderTags(o.tags)}
        <details class="chapters-toggle">
          <summary>Visa alla ${o.chapters?.length || 0} kapitel</summary>
          ${chapters}
        </details>
        <div class="marketplace-row">
          <span class="marketplace-label">Lämpliga marknader:</span>
          ${marketplaceLinks || "<span class='bio-note'>Inga förslag</span>"}
        </div>
        <div class="output-item-actions">
          <button type="button" class="btn btn-tiny btn-copy-text" data-agent-id="${agentId}" data-output-id="${o.id}">📋 Kopiera text</button>
          <button type="button" class="btn btn-tiny btn-download" data-agent-id="${agentId}" data-output-id="${o.id}">⬇ .txt</button>
          <a class="btn btn-tiny btn-download" href="/api/agents/${agentId}/outputs/${o.id}/pdf">⬇ .pdf</a>
          ${translateBtn}
          ${paymentConfig.paymentLink ? `<a class="btn btn-tiny btn-buy" href="${paymentConfig.paymentLink}" target="_blank" rel="noopener">💳 Sälj/Köp</a>` : ""}
        </div>
        ${renderNotesSection(o, agentId)}
      </article>
    `;
  }

  if (o.isArticle) {
    const marketplaceLinks = (o.marketplaces || [])
      .map((m) => `<a href="${m.url}" target="_blank" rel="noopener" class="marketplace-chip">${escapeHtml(m.name)}</a>`)
      .join("");

    return `
      <article class="output-item output-item-article">
        <div class="output-item-head">
          <h4>📰 ${renderMarkdownLite(o.title)}</h4>
          <span class="output-time">${time} ${agentLabel}</span>
        </div>
        ${o.subtitle ? `<p class="output-subtitle">${renderMarkdownLite(o.subtitle)}</p>` : ""}
        <div class="book-meta">
          ${o.articleType ? `<span class="book-meta-chip">${escapeHtml(o.articleType)}</span>` : ""}
          ${o.suggestedPriceKr ? `<span class="book-meta-chip book-price">Föreslaget arvode: ${o.suggestedPriceKr} kr</span>` : ""}
        </div>
        ${o.sourceRef ? `<div class="source-ref">📰 Baserad på verklig nyhet: <a href="${o.sourceRef.url}" target="_blank" rel="noopener">${escapeHtml(o.sourceRef.title)}</a> (${escapeHtml(o.sourceRef.source)})</div>` : `<div class="source-ref source-ref-none">💡 Generellt/tidlöst tema, inte kopplat till en specifik nyhetshändelse</div>`}
        ${renderTags(o.tags)}
        <p>${renderMarkdownLite(o.body || o.preview)}</p>
        ${hasEn ? `<p class="translated-en"><strong>EN:</strong> ${renderMarkdownLite(o.translations.en.body)}</p>` : ""}
        <div class="marketplace-row">
          <span class="marketplace-label">Lämpliga marknader:</span>
          ${marketplaceLinks || "<span class='bio-note'>Inga förslag</span>"}
        </div>
        <div class="output-item-actions">
          <button type="button" class="btn btn-tiny btn-copy-text" data-agent-id="${agentId}" data-output-id="${o.id}">📋 Kopiera text</button>
          <button type="button" class="btn btn-tiny btn-download" data-agent-id="${agentId}" data-output-id="${o.id}">⬇ .txt</button>
          ${translateBtn}
          ${paymentConfig.paymentLink ? `<a class="btn btn-tiny btn-buy" href="${paymentConfig.paymentLink}" target="_blank" rel="noopener">💳 Köp</a>` : ""}
        </div>
        ${renderNotesSection(o, agentId)}
      </article>
    `;
  }

  if (o.isImage) {
    const marketplaceLinks = (o.marketplaces || [])
      .map((m) => `<a href="${m.url}" target="_blank" rel="noopener" class="marketplace-chip">${escapeHtml(m.name)}</a>`)
      .join("");

    return `
      <article class="output-item output-item-image">
        <div class="output-item-head">
          <h4>🎨 ${renderMarkdownLite(o.title)}</h4>
          <span class="output-time">${time} ${agentLabel}</span>
        </div>
        ${o.subtitle ? `<p class="output-subtitle">${renderMarkdownLite(o.subtitle)}</p>` : ""}
        <img class="generated-image lazy-poll-img" data-src="${o.imageUrl}" alt="${escapeHtml(o.title)}" />
        <div class="book-meta">
          ${o.suggestedPriceKr ? `<span class="book-meta-chip book-price">Föreslaget pris: ${o.suggestedPriceKr} kr</span>` : ""}
        </div>
        <p>${renderMarkdownLite(o.body || o.preview)}</p>
        ${renderTags(o.tags)}
        <div class="marketplace-row">
          <span class="marketplace-label">Lämpliga marknader:</span>
          ${marketplaceLinks || "<span class='bio-note'>Inga förslag</span>"}
        </div>
        <div class="output-item-actions">
          <a class="btn btn-tiny btn-download" href="${o.imageUrl}" target="_blank" rel="noopener">⬇ Öppna bild</a>
          <a class="btn btn-tiny btn-download" href="/api/agents/${agentId}/outputs/${o.id}/pdf">⬇ .pdf</a>
          ${paymentConfig.paymentLink ? `<a class="btn btn-tiny btn-buy" href="${paymentConfig.paymentLink}" target="_blank" rel="noopener">💳 Köp</a>` : ""}
        </div>
      </article>
    `;
  }

  return `
    <article class="output-item">
      <div class="output-item-head">
        <h4>${renderMarkdownLite(o.title)}</h4>
        <span class="output-time">${time} ${agentLabel}</span>
      </div>
      ${o.subtitle ? `<p class="output-subtitle">${renderMarkdownLite(o.subtitle)}</p>` : ""}
      ${renderGenreBadge(o)}
      <p>${renderMarkdownLite(o.body || o.preview)}</p>
      ${renderTags(o.tags)}
      ${hasEn ? `<p class="translated-en"><strong>EN:</strong> ${renderMarkdownLite(o.translations.en.body)}</p>` : ""}
      <div class="output-item-actions">
        <button type="button" class="btn btn-tiny btn-copy-text" data-agent-id="${agentId}" data-output-id="${o.id}">📋 Kopiera text</button>
        <button type="button" class="btn btn-tiny btn-download" data-agent-id="${agentId}" data-output-id="${o.id}">⬇ .txt</button>
        <button type="button" class="btn btn-tiny btn-expand" data-agent-id="${agentId}" data-output-id="${o.id}">📖 Skriv fullständig bok (~30 sidor)</button>
        ${translateBtn}
        ${paymentConfig.paymentLink ? `<a class="btn btn-tiny btn-buy" href="${paymentConfig.paymentLink}" target="_blank" rel="noopener">💳 Köp</a>` : ""}
      </div>
      ${renderNotesSection(o, agentId)}
    </article>
  `;
}

async function expandToBook(agentId, outputId, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = "Skriver bok… (tar en stund)";
  beginAwaitingAction(300000); // upp till 5 minuter för en hel bok med bilder
  try {
    const res = await fetch(`/api/agents/${agentId}/outputs/${outputId}/expand`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Kunde inte skapa boken just nu.");
      btnEl.disabled = false;
      btnEl.textContent = "📖 Skriv fullständig bok (~30 sidor)";
      endAwaitingAction();
    }
    // Resultatet strömmar in via socket ("agent:update") när det är klart -
    // renderOutputsList ritas om automatiskt (se awaitingActionRefresh).
  } catch (err) {
    alert("Nätverksfel: " + err.message);
    btnEl.disabled = false;
    btnEl.textContent = "📖 Skriv fullständig bok (~30 sidor)";
    endAwaitingAction();
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

function outputFullTextEn(o) {
  const en = o.translations?.en;
  if (!en) return "";
  if (o.isBook && en.chapters) {
    return en.chapters.map((ch, i) => `${i + 1}. ${ch.title}\n\n${ch.text}`).join("\n\n\n");
  }
  return en.body || "";
}

function downloadOutputEn(agent, output) {
  const en = output.translations?.en;
  if (!en) return;
  const time = new Date(output.createdAt).toLocaleString("sv-SE");
  const content = `${en.title}\n${"=".repeat(en.title.length)}\n\nBy: ${agent.name}\nDate: ${time}\n\n${outputFullTextEn(output)}\n`;
  downloadTextFile(`${slugify(en.title)}_en.txt`, content);
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
      ${agent.genre ? `<dt>Specialisering</dt><dd>${escapeHtml(agent.genre.category)}${agent.genre.subgenre ? " — " + escapeHtml(agent.genre.subgenre) : ""}${agent.genre.illustrated ? " (illustrerad)" : ""}</dd>` : ""}
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

// ---- Genre-väljare för nya textagenter ----

let genreTaxonomy = {};

fetch("/api/genres")
  .then((r) => r.json())
  .then((data) => {
    genreTaxonomy = data;
    const categorySelect = document.getElementById("genre-category");
    Object.keys(genreTaxonomy).forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      categorySelect.appendChild(opt);
    });
  })
  .catch(() => {});

const genreCategorySelect = document.getElementById("genre-category");
const genreSubgenreSelect = document.getElementById("genre-subgenre");
const genreIllustratedWrap = document.getElementById("genre-illustrated-wrap");
const genreIllustratedCheckbox = document.getElementById("genre-illustrated");

genreCategorySelect.addEventListener("change", () => {
  const category = genreCategorySelect.value;
  genreSubgenreSelect.innerHTML = "";
  genreIllustratedCheckbox.checked = false;

  if (!category) {
    genreSubgenreSelect.disabled = true;
    genreSubgenreSelect.innerHTML = `<option value="">— Välj kategori först —</option>`;
    genreIllustratedWrap.style.display = "none";
    return;
  }

  const config = genreTaxonomy[category];
  genreSubgenreSelect.disabled = false;
  genreSubgenreSelect.innerHTML =
    `<option value="">— Valfri (ingen specifik) —</option>` +
    config.subgenres.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  genreIllustratedWrap.style.display = config.illustratable ? "flex" : "none";
});

document.getElementById("spawn-text").addEventListener("click", () => {
  genreCategorySelect.value = "";
  genreCategorySelect.dispatchEvent(new Event("change"));
  openModal("genre-dialog");
});

document.getElementById("genre-confirm").addEventListener("click", () => {
  const category = genreCategorySelect.value;
  const genre = category
    ? {
        category,
        subgenre: genreSubgenreSelect.value || null,
        illustrated: genreIllustratedCheckbox.checked,
      }
    : null;
  spawnAgent("text", genre);
  closeModal("genre-dialog");
});

document.getElementById("spawn-image").addEventListener("click", () => spawnAgent("image"));
document.getElementById("spawn-journalist-feature").addEventListener("click", () => spawnAgent("journalist_feature"));
document.getElementById("spawn-journalist-column").addEventListener("click", () => spawnAgent("journalist_column"));

// ---- Globalt bibliotek: sammanställning av ALLA agenters arbete ----

const libraryList = document.getElementById("library-list");
let libraryFilter = "all";

function classifyOutput(o) {
  if (o.isBook) return "book";
  if (o.isArticle) return "article";
  if (o.isImage) return "image";
  return "idea";
}

function openLibraryDialog() {
  renderLibrary();
  openModal("library-dialog");
}

let libraryGenreFilter = "";
let libraryGroupBy = "agent";
let librarySort = "new";
const libraryGenreSelect = document.getElementById("library-genre-filter");
const libraryGroupBySelect = document.getElementById("library-group-by");
const librarySortSelect = document.getElementById("library-sort");

function renderLibrary() {
  // Fyll genre-dropdownen med de kategorier som faktiskt förekommer bland
  // alla agenters alster just nu.
  const seenGenres = new Set();
  const flatItems = [];
  for (const agent of agents.values()) {
    for (const o of agent.outputs) {
      if (o.genre?.category) seenGenres.add(o.genre.category);
      flatItems.push({ agent, output: o });
    }
  }
  const currentGenreValue = libraryGenreSelect.value;
  libraryGenreSelect.innerHTML =
    `<option value="">Alla genrer</option>` +
    [...seenGenres].sort().map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  libraryGenreSelect.value = seenGenres.has(currentGenreValue) ? currentGenreValue : "";
  libraryGenreFilter = libraryGenreSelect.value;

  // Filtrera på typ och genre
  let filtered = flatItems.filter(({ output }) => {
    if (libraryFilter !== "all" && classifyOutput(output) !== libraryFilter) return false;
    if (libraryGenreFilter && output.genre?.category !== libraryGenreFilter) return false;
    return true;
  });

  if (!filtered.length) {
    libraryList.innerHTML = `<p class="outputs-empty">Inget att visa i den här kategorin ännu.</p>`;
    return;
  }

  // Sortera (inom varje grupp sorteras det också, men detta avgör ordningen totalt)
  filtered.sort((a, b) => {
    const diff = new Date(a.output.createdAt) - new Date(b.output.createdAt);
    return librarySort === "new" ? -diff : diff;
  });

  // Gruppera antingen per agent eller per kategori
  const groups = new Map(); // groupLabel -> items[]
  for (const item of filtered) {
    const label =
      libraryGroupBy === "category"
        ? item.output.genre?.category || "Utan kategori"
        : item.agent.name;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  }

  const sortedLabels = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  libraryList.innerHTML = sortedLabels
    .map((label) => {
      const items = groups.get(label);
      return `
        <details class="library-agent-section" open>
          <summary>
            <span class="lib-agent-name">${escapeHtml(label)}</span>
            <span class="lib-agent-count">${items.length} alster</span>
          </summary>
          <div class="library-agent-items library-grid">
            ${items.map(({ agent, output }) => renderOutputItem(output, agent.id, libraryGroupBy === "category")).join("")}
          </div>
        </details>
      `;
    })
    .join("");
  bindOutputActions(libraryList);
  queuePollinationsImages(libraryList);
}

libraryGenreSelect.addEventListener("change", () => {
  libraryGenreFilter = libraryGenreSelect.value;
  renderLibrary();
});

libraryGroupBySelect.addEventListener("change", () => {
  libraryGroupBy = libraryGroupBySelect.value;
  renderLibrary();
});

librarySortSelect.addEventListener("change", () => {
  librarySort = librarySortSelect.value;
  renderLibrary();
});

document.getElementById("open-library").addEventListener("click", openLibraryDialog);
document.getElementById("open-subscribe").addEventListener("click", () => openModal("subscribe-dialog"));
document.getElementById("open-market").addEventListener("click", () => openModal("market-dialog"));

document.querySelectorAll(".lib-filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    libraryFilter = btn.dataset.filter;
    document.querySelectorAll(".lib-filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderLibrary();
  });
});

// ---- Socket events ----

socket.on("agents:init", (list) => list.forEach(renderAgent));
socket.on("agent:update", renderAgent);
socket.on("stats:update", renderStats);
socket.on("logs:init", (list) => list.forEach(appendLog));
socket.on("log", appendLog);

window.addEventListener("resize", drawLineage);
