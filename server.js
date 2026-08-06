require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const PDFDocument = require("pdfkit");
const { AgentManager } = require("./agents/manager");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const manager = new AgentManager(io);

// ---- REST API ----

app.get("/api/agents", (req, res) => {
  res.json(manager.getAllAgentsJSON());
});

app.get("/api/stats", (req, res) => {
  res.json(manager.getStats());
});

// Betalningslänk (PayPal.me, Swish-nummer, eller annat). Sätts via
// miljövariabel så du styr själv vart pengarna går. Detta är BARA en
// länk till ditt eget konto - ingen automatisk checkout eller
// beloppshantering sker i appen.
app.get("/api/config", (req, res) => {
  res.json({
    paymentLabel: process.env.PAYMENT_LABEL || null,
    paymentLink: process.env.PAYMENT_LINK || null,
  });
});

app.post("/api/agents/spawn", (req, res) => {
  try {
    const kind = req.body.kind === "image" ? "image" : "text";
    const agent = manager.spawnAgent({ kind });
    res.json(agent.toJSON());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/agents/:id/reproduce", (req, res) => {
  try {
    const child = manager.reproduce(req.params.id);
    res.json(child.toJSON());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/agents/:id/stop", (req, res) => {
  try {
    manager.stopAgent(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/agents/:id", (req, res) => {
  manager.removeAgent(req.params.id);
  res.json({ ok: true });
});

// Manuell försäljningslogg. Detta ersätter ett automatiskt betalflöde
// tills du kopplar in en riktig betaltjänst (t.ex. Stripe) och en
// marknadsplats/butik med korrekt registrering.
app.post("/api/sales", (req, res) => {
  try {
    const { agentId, amountKr, description } = req.body;
    manager.logSale({
      agentId,
      amountCents: Math.round(Number(amountKr) * 100),
      description,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Expandera en kort idé till en fullständig ~30-sidig bok med kapitel,
// illustrationsidéer, föreslaget pris och marknadsplatsförslag.
// Detta görs på begäran (inte automatiskt) eftersom det kostar ~11
// API-anrop och skulle äta upp gratiskvoten om det körde per cykel.
app.post("/api/agents/:id/outputs/:outputId/expand", (req, res) => {
  const agent = manager.getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent hittades inte." });

  const output = agent.outputs.find((o) => o.id === req.params.outputId);
  if (!output) return res.status(404).json({ error: "Alster hittades inte." });
  if (output.isBook) return res.status(400).json({ error: "Redan expanderad till en bok." });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(400).json({ error: "Ingen GEMINI_API_KEY satt - kan inte skriva en fullständig bok." });
  }

  // Svara direkt - resultatet strömmar till klienten via socket.io när det är klart.
  res.json({ ok: true, started: true });

  agent.expandToBook(output.id).catch((err) => {
    manager.log(`${agent.name} fick ett fel vid bokskrivning: ${err.message}`);
    manager.broadcastAgentUpdate(agent);
  });
});

// Översätt ett alster till engelska (på begäran, kostar 1-11 API-anrop
// beroende på om det är en kort idé eller en fullständig bok).
app.post("/api/agents/:id/outputs/:outputId/translate", (req, res) => {
  const agent = manager.getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent hittades inte." });

  const output = agent.outputs.find((o) => o.id === req.params.outputId);
  if (!output) return res.status(404).json({ error: "Alster hittades inte." });
  if (output.translations?.en) return res.status(400).json({ error: "Redan översatt." });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(400).json({ error: "Ingen GEMINI_API_KEY satt - kan inte översätta." });
  }

  res.json({ ok: true, started: true });

  agent.translateToEnglish(output.id).catch((err) => {
    manager.log(`${agent.name} fick ett fel vid översättning: ${err.message}`);
    manager.broadcastAgentUpdate(agent);
  });
});

// Ladda ner ett alster som PDF. Om det är en fullständig bok inkluderas
// alla kapitel, illustrationsidéer (textbeskrivningar) och en sista sida
// med föreslagna marknadsplatser.
app.get("/api/agents/:id/outputs/:outputId/pdf", (req, res) => {
  const agent = manager.getAgent(req.params.id);
  if (!agent) return res.status(404).send("Agent hittades inte.");

  const output = agent.outputs.find((o) => o.id === req.params.outputId);
  if (!output) return res.status(404).send("Alster hittades inte.");

  const lang = req.query.lang === "en" ? "en" : "sv";
  const useEn = lang === "en" && output.translations?.en;

  const title = useEn ? output.translations.en.title || output.title : output.title;
  const chapters = useEn && output.isBook ? output.translations.en.chapters || output.chapters : output.chapters;
  const bodyText = useEn && !output.isBook ? output.translations.en.body || output.body : output.body || output.preview;

  const filename =
    (title || "alster").replace(/[^a-z0-9åäöÅÄÖ]+/gi, "_").slice(0, 60) +
    (useEn ? "_en" : "") +
    ".pdf";

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ margin: 56 });
  doc.pipe(res);

  // Omslagssida
  doc.fontSize(24).text(title, { align: "center" });
  doc.moveDown();
  doc.fontSize(11).fillColor("#555").text(`Skapad av ${agent.name}`, { align: "center" });
  if (output.isBook) {
    doc.moveDown(2);
    doc
      .fontSize(11)
      .text(`${output.pages} sidor  ·  Föreslaget pris: ${output.suggestedPriceKr} kr`, {
        align: "center",
      });
  }
  doc.fillColor("black");

  if (output.isBook && chapters?.length) {
    chapters.forEach((ch, i) => {
      doc.addPage();
      doc.fontSize(17).text(`${i + 1}. ${ch.title}`);
      doc.moveDown();
      if (ch.illustrationIdea) {
        doc
          .fontSize(9)
          .fillColor("#888")
          .text(`[Illustration: ${ch.illustrationIdea}]`);
        doc.fillColor("black");
        doc.moveDown();
      }
      doc.fontSize(11).text(ch.text, { align: "left", lineGap: 3 });
    });

    doc.addPage();
    doc.fontSize(15).text(useEn ? "Suggested marketplaces" : "Föreslagna marknadsplatser");
    doc.moveDown();
    (output.marketplaces || []).forEach((m) => {
      doc.fontSize(11).fillColor("#2a6fdb").text(m.name, { link: m.url, underline: true });
      doc.moveDown(0.3);
    });
    doc.fillColor("black");
  } else {
    doc.addPage();
    doc.fontSize(11).text(bodyText, { lineGap: 3 });
  }

  doc.end();
});

// ---- Socket.io ----

io.on("connection", (socket) => {
  socket.emit("agents:init", manager.getAllAgentsJSON());
  socket.emit("stats:update", manager.getStats());
  socket.emit("logs:init", manager.logs.slice(-50));
});

// Starta med en agent igång som standard
manager.spawnAgent({ kind: "text" });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`AI Agent Farm körs på port ${PORT}`);
});
