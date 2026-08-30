require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const PDFDocument = require("pdfkit");
const { AgentManager } = require("./agents/manager");
const { GENRE_TAXONOMY } = require("./agents/agent");

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

// Lista kategorier/genrer en textagent kan specialisera sig inom, för att
// fylla i väljaren när man skapar en ny textagent i gränssnittet.
app.get("/api/genres", (req, res) => {
  res.json(GENRE_TAXONOMY);
});

// Betalningslänk (PayPal.me, Swish-nummer, eller annat). Sätts via
// miljövariabel så du styr själv vart pengarna går. Detta är BARA en
// länk till ditt eget konto - ingen automatisk checkout eller
// beloppshantering sker i appen.
app.get("/api/config", (req, res) => {
  res.json({
    paymentLabel: process.env.PAYMENT_LABEL || null,
    paymentLink: process.env.PAYMENT_LINK || null,
    substackUrl: process.env.SUBSTACK_URL || null,
  });
});

app.post("/api/agents/spawn", (req, res) => {
  try {
    const allowedKinds = ["text", "image", "journalist_feature", "journalist_column", "video"];
    const kind = allowedKinds.includes(req.body.kind) ? req.body.kind : "text";

    // Genre är bara relevant (och valideras) för textagenter.
    let genre = null;
    if (kind === "text" && req.body.genre?.category) {
      const categoryConfig = GENRE_TAXONOMY[req.body.genre.category];
      if (categoryConfig) {
        const subgenre = categoryConfig.subgenres.includes(req.body.genre.subgenre)
          ? req.body.genre.subgenre
          : null;
        genre = {
          category: req.body.genre.category,
          subgenre,
          illustrated: categoryConfig.illustratable ? !!req.body.genre.illustrated : false,
        };
      }
    }

    // imageStyle är bara relevant för bildagenter.
    const imageStyle =
      kind === "image" && ["photo", "illustration"].includes(req.body.imageStyle)
        ? req.body.imageStyle
        : null;

    const agent = manager.spawnAgent({ kind, genre, imageStyle });
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

app.post("/api/agents/:id/resume", (req, res) => {
  try {
    manager.resumeAgent(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/agents/:id", (req, res) => {
  manager.removeAgent(req.params.id);
  res.json({ ok: true });
});

// Döljer en agent från huvudsidan utan att radera historiken (den syns
// fortfarande i biblioteket). Skiljer sig från DELETE ovan.
app.post("/api/agents/:id/archive", (req, res) => {
  try {
    manager.archiveAgent(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/agents/:id/unarchive", (req, res) => {
  try {
    manager.unarchiveAgent(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

  // Valfritt: låt användaren välja antal kapitel/sidor och hur ofta bilder
  // ska genereras, istället för de formatspecifika standardvärdena.
  const chapterCount = Number.isInteger(req.body?.chapterCount)
    ? Math.min(20, Math.max(3, req.body.chapterCount))
    : null;
  const imageFrequency = Number.isInteger(req.body?.imageFrequency)
    ? Math.min(10, Math.max(1, req.body.imageFrequency))
    : null;
  const imageStyle = ["photo", "illustration"].includes(req.body?.imageStyle) ? req.body.imageStyle : null;

  // Svara direkt - resultatet strömmar till klienten via socket.io när det är klart.
  res.json({ ok: true, started: true });

  agent.expandToBook(output.id, { chapterCount, imageFrequency, imageStyle }).catch((err) => {
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

// Generera ett kort "Notes"-utkast (Substacks kortformatsflöde) för ett
// alster. Inget automatisk publicering sker - Substack har ingen öppen
// API för det. Detta ger bara ett kopierbart textutkast.
app.post("/api/agents/:id/outputs/:outputId/notes-draft", (req, res) => {
  const agent = manager.getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent hittades inte." });

  const output = agent.outputs.find((o) => o.id === req.params.outputId);
  if (!output) return res.status(404).json({ error: "Alster hittades inte." });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(400).json({ error: "Ingen GEMINI_API_KEY satt - kan inte skapa ett Notes-utkast." });
  }

  res.json({ ok: true, started: true });

  agent.generateNotesDraft(output.id).catch((err) => {
    manager.log(`${agent.name} fick ett fel vid Notes-utkast: ${err.message}`);
    manager.broadcastAgentUpdate(agent);
  });
});

// Skapar en riktig videofil (bilder + uppläst text + undertexter via
// JSON2Video) av en videoidé. Tar en stund - körs i bakgrunden, resultatet
// strömmar till klienten via socket.io.
app.post("/api/agents/:id/outputs/:outputId/render-video", (req, res) => {
  const agent = manager.getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent hittades inte." });

  const output = agent.outputs.find((o) => o.id === req.params.outputId);
  if (!output) return res.status(404).json({ error: "Alster hittades inte." });
  if (output.isVideo) return res.status(400).json({ error: "Videon är redan skapad." });
  if (!process.env.JSON2VIDEO_API_KEY) {
    return res.status(400).json({ error: "Ingen JSON2VIDEO_API_KEY satt - kan inte skapa video." });
  }

  res.json({ ok: true, started: true });

  agent.createVideo(output.id).catch((err) => {
    manager.log(`${agent.name} fick ett fel vid videoskapande: ${err.message}`);
    manager.broadcastAgentUpdate(agent);
  });
});

// Slår upp en bild för ett objekt. Nya alster har redan bilden cachad
// som base64 (snabbt, pålitligt, ingen nätverksanrop behövs). ÄLDRE
// alster (skapade innan cachningen infördes) har bara en URL sparad -
// för dem försöker vi INTE längre hämta live vid PDF-nedladdning, då det
// gjorde nedladdningen långsam och opålitlig (Pollinations hastighetsgräns
// + faktisk gentetid per bild kunde göra att hela förfrågan tog för lång
// tid och avbröts). Sådana äldre alster visar istället illustrationsidén
// som text i PDF:en - skapa gärna om boken för att få riktiga bilder.
function resolveImageBuffer(base64) {
  if (base64) return Buffer.from(base64, "base64");
  return null;
}

// PDFKit skapar INTE automatiskt en ny sida om en bild inte får plats i
// resterande utrymme - då kan bilden hamna utanför sidan eller texten
// därefter börja skriva över den. Den här hjälparen kollar hur mycket
// utrymme som är kvar och lägger till en ny sida i förväg om det behövs.
function ensureSpace(doc, neededHeight) {
  const remaining = doc.page.height - doc.page.margins.bottom - doc.y;
  if (remaining < neededHeight) {
    doc.addPage();
  }
}

// Ladda ner ett alster som PDF. Om det är en fullständig bok inkluderas
// alla kapitel, riktiga illustrationer (där de finns) och en sista sida
// med föreslagna marknadsplatser. Bilder hämtas från cachad base64-data
// (sparad när alstret skapades), så nedladdningen är omedelbar.
app.get("/api/agents/:id/outputs/:outputId/pdf", async (req, res) => {
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

  // Omslagssida - HELT EGEN sida, så bilden aldrig kan skymma titeltexten.
  if (output.isBook && (output.coverImageBase64 || output.coverImageUrl)) {
    const coverBuffer = resolveImageBuffer(output.coverImageBase64);
    if (coverBuffer) {
      try {
        doc.image(coverBuffer, 56, 56, { fit: [483, 680], align: "center", valign: "center" });
      } catch (err) {
        // Ogiltig bilddata - hoppa bara över omslagssidan
      }
    }
  }

  // Titelsida - alltid en egen sida, aldrig delad med omslagsbilden.
  doc.addPage();
  doc.fontSize(24).text(title, { align: "center" });
  if (output.subtitle) {
    doc.moveDown(0.3);
    doc.fontSize(13).fillColor("#555").text(output.subtitle, { align: "center" });
    doc.fillColor("black");
  }
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

  // Karaktärssida - en egen sida med referensbild + beskrivning, om boken
  // har en huvudkaraktär (används annars i varje kapitels bildprompt för
  // visuell konsekvens, men visas här så läsaren/köparen ser den också).
  if (output.characterDescription || output.characterImageBase64) {
    doc.addPage();
    doc.fontSize(15).text(useEn ? "Main character" : "Huvudkaraktär");
    doc.moveDown();
    const charBuffer = resolveImageBuffer(output.characterImageBase64);
    if (charBuffer) {
      try {
        doc.image(charBuffer, { fit: [300, 380], align: "center" });
      } catch (err) {
        // Hoppa över om bilddatan var ogiltig
      }
    }
    if (output.characterDescription) {
      // Egen sida för beskrivningstexten - annars kan den hamna ovanpå
      // bilden om pdfkit inte räknar ut bildens höjd exakt rätt.
      doc.addPage();
      doc.fontSize(10).fillColor("#666").text(output.characterDescription, { align: "center" });
      doc.fillColor("black");
    }
  }

  if (output.isBook && chapters?.length) {
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      doc.addPage();
      doc.fontSize(17).text(`${i + 1}. ${ch.title}`);

      if (ch.illustrationBase64 || ch.illustrationUrl) {
        const illBuffer = resolveImageBuffer(ch.illustrationBase64);
        if (illBuffer) {
          try {
            // Bilden får en helt egen, tom sida - texten fortsätter sedan
            // på ÄNNU en ny sida. Det garanterar att bild och text aldrig
            // kan hamna på samma sida och skymma varandra.
            doc.addPage();
            doc.image(illBuffer, { fit: [480, 620], align: "center" });
            doc.addPage();
          } catch (err) {
            // Hoppa över om bilddatan var ogiltig
          }
        } else if (ch.illustrationIdea) {
          doc.moveDown();
          doc
            .fontSize(9)
            .fillColor("#888")
            .text(`[Illustration: ${ch.illustrationIdea}]`);
          doc.fillColor("black");
        }
      } else if (ch.illustrationIdea) {
        doc.moveDown();
        doc
          .fontSize(9)
          .fillColor("#888")
          .text(`[Illustration: ${ch.illustrationIdea}]`);
        doc.fillColor("black");
      }
      doc.moveDown();
      doc.fontSize(11).text(ch.text, { align: "left", lineGap: 3 });
    }

    doc.addPage();
    doc.fontSize(15).text(useEn ? "Suggested marketplaces" : "Föreslagna marknadsplatser");
    doc.moveDown();
    (output.marketplaces || []).forEach((m) => {
      doc.fontSize(11).fillColor("#2a6fdb").text(m.name, { link: m.url, underline: true });
      doc.moveDown(0.3);
    });
    doc.fillColor("black");
  } else if (output.isImage && (output.imageBase64 || output.imageUrl)) {
    const imgBuffer = resolveImageBuffer(output.imageBase64);
    doc.addPage();
    if (imgBuffer) {
      try {
        doc.image(imgBuffer, { fit: [480, 620], align: "center" });
        doc.addPage(); // beskrivningstexten får en egen, ren sida efter bilden
      } catch (err) {
        // Hoppa över om bilddatan var ogiltig
      }
    }
    doc.fontSize(11).text(bodyText, { lineGap: 3 });
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

const PORT = process.env.PORT || 3000;

// Försök återställa tidigare agenter och deras alster (från Upstash om
// konfigurerat, annars lokal fil) INNAN servern börjar ta emot trafik.
// Skapa bara en ny standardagent om inget fanns att återställa.
(async () => {
  const restored = await manager.loadState();
  if (!restored) {
    manager.spawnAgent({ kind: "text" });
  }

  server.listen(PORT, () => {
    console.log(`AI Agent Farm körs på port ${PORT}`);
  });
})();
