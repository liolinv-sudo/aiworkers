const { nanoid } = require("nanoid");

// En "Agent" representerar en självständig arbetsprocess.
// Den kör med jämna mellanrum och producerar innehåll (text/idéer/bildprompts).
// Riktig bildgenerering kopplas in i generateContent() nedan när du har en API-nyckel.

const NAME_POOL = [
  "Aurora", "Nova", "Pixel", "Echo", "Sol", "Vega", "Lumen", "Astra",
  "Cobalt", "Ember", "Flux", "Iris", "Juno", "Koda", "Lyra", "Mica",
];

class Agent {
  constructor({ parentId = null, manager, kind = "text" }) {
    this.id = nanoid(8);
    this.parentId = parentId;
    this.manager = manager;
    this.kind = kind; // "text" | "image"
    this.name =
      NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)] +
      "-" +
      this.id.slice(0, 4);
    this.status = "idle"; // idle | working | error | stopped
    this.createdAt = new Date().toISOString();
    this.outputs = []; // { id, title, preview, createdAt }
    this.earningsCents = 0; // manuellt loggad försäljning (öre)
    this.cyclesRun = 0;
    this.timer = null;
  }

  toJSON() {
    return {
      id: this.id,
      parentId: this.parentId,
      kind: this.kind,
      name: this.name,
      status: this.status,
      createdAt: this.createdAt,
      outputs: this.outputs.slice(-10), // senaste 10 för dashboard
      outputCount: this.outputs.length,
      earningsCents: this.earningsCents,
      cyclesRun: this.cyclesRun,
    };
  }

  start(intervalMs = 90000) {
    if (this.timer) return;
    this.status = "working";
    // Kör direkt en gång, sedan periodiskt
    this.runCycle();
    this.timer = setInterval(() => this.runCycle(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status = "stopped";
    this.manager.broadcastAgentUpdate(this);
  }

  async runCycle() {
    this.status = "working";
    this.manager.broadcastAgentUpdate(this);
    try {
      const output = await this.generateContent();
      this.outputs.push(output);
      this.cyclesRun += 1;
      this.status = "idle";
      this.manager.log(`${this.name} producerade: "${output.title}"`);
    } catch (err) {
      this.status = "error";
      this.manager.log(`${this.name} fick ett fel: ${err.message}`);
    }
    this.manager.broadcastAgentUpdate(this);
    this.manager.persist();
  }

  // Här sker själva "arbetet". I demo-läge (utan API-nyckel) skapas
  // platshållarinnehåll. Sätt GEMINI_API_KEY i miljövariabler för
  // riktig textgenerering (gratis nyckel på aistudio.google.com, inget
  // kreditkort krävs). Bildgenerering kräver en separat tjänst - se
  // kommentaren nedan.
  async generateContent() {
    const geminiKey = process.env.GEMINI_API_KEY;

    if (this.kind === "text") {
      if (geminiKey) {
        const prompt =
          "Ge mig en kort, säljbar produktidé (t.ex. en novell-pitch, " +
          "ett blogginlägg, eller copywriting-exempel) som skulle kunna " +
          "säljas online. Svara med en titel på första raden och en kort " +
          "beskrivning (max 3 meningar) på raderna efter.";

        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
            }),
          }
        );

        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`Gemini ${resp.status}: ${errText.slice(0, 200)}`);
        }

        const data = await resp.json();
        const text = (
          data.candidates?.[0]?.content?.parts?.[0]?.text || ""
        ).trim();
        const [firstLine, ...rest] = text.split("\n").filter(Boolean);
        return {
          id: nanoid(6),
          title: firstLine || "Namnlöst verk",
          preview: rest.join(" ").slice(0, 280),
          createdAt: new Date().toISOString(),
        };
      }

      // Demo-läge utan API-nyckel
      return {
        id: nanoid(6),
        title: `Demo-idé #${this.cyclesRun + 1} av ${this.name}`,
        preview:
          "(Demo-läge: sätt GEMINI_API_KEY i miljövariablerna på Render " +
          "för att låta agenten skapa riktigt innehåll med Gemini.)",
        createdAt: new Date().toISOString(),
      };
    }

    if (this.kind === "image") {
      // TODO: koppla in en bildgenereringstjänst här, t.ex. Stability AI
      // eller annan leverantör. Returnera en URL eller base64-bild i preview.
      return {
        id: nanoid(6),
        title: `Bildidé #${this.cyclesRun + 1} av ${this.name}`,
        preview:
          "(Demo-läge: ingen bild-API kopplad än. Lägg till din leverantör " +
          "i agents/agent.js -> generateContent().)",
        createdAt: new Date().toISOString(),
      };
    }

    throw new Error(`Okänd agenttyp: ${this.kind}`);
  }
}

module.exports = Agent;
