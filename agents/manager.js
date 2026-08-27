const fs = require("fs");
const path = require("path");
const Agent = require("./agent");

const STATE_FILE = path.join(__dirname, "..", "data", "state.json");
const MAX_AGENTS = 20; // skydd mot skenande kostnader/oändlig förökning
const DAILY_GOAL_CENTS = 20000; // 200 kr i öre

// Render "free"-tjänster har ett "ephemeral filesystem" - lokala filer
// försvinner vid varje omstart, deploy, ELLER efter 15 minuters inaktivitet
// (då tjänsten "spinner ner"). En lokal state.json överlever därför aldrig
// där. Upstash Redis (gratis, inget kreditkort) används istället när den
// är konfigurerad - lokal fil används bara som fallback för lokal utveckling.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_KEY = "agentkolonin:state";

class AgentManager {
  constructor(io) {
    this.io = io;
    this.agents = new Map();
    this.logs = []; // { text, ts }
    this.dayStartedAt = new Date().toISOString();
  }

  // ---- Agentlivscykel ----

  spawnAgent({ parentId = null, kind = "text", genre = null, imageStyle = null } = {}) {
    if (this.agents.size >= MAX_AGENTS) {
      throw new Error(`Max antal agenter (${MAX_AGENTS}) uppnått.`);
    }
    const agent = new Agent({ parentId, manager: this, kind, genre, imageStyle });
    this.agents.set(agent.id, agent);
    agent.start();
    this.log(
      parentId
        ? `${agent.name} föddes ur agent ${parentId}.`
        : `${agent.name} startades.`
    );
    this.broadcastAgentUpdate(agent);
    this.broadcastStats();
    this.persist();
    return agent;
  }

  // "Förökning": en agent startar en ny syskonagent för att öka takten.
  // Ärver samma genre/specialisering som föräldern.
  reproduce(agentId) {
    const parent = this.agents.get(agentId);
    if (!parent) throw new Error("Agent hittades inte.");
    return this.spawnAgent({ parentId: agentId, kind: parent.kind, genre: parent.genre, imageStyle: parent.imageStyle });
  }

  stopAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent hittades inte.");
    agent.stop();
    this.persist();
  }

  // Startar om en tidigare stoppad agent - den fortsätter jobba från där
  // den var, med samma historik, bio och genre intakt.
  resumeAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent hittades inte.");
    agent.start();
    this.log(`${agent.name} startades om.`);
    this.broadcastAgentUpdate(agent);
    this.persist();
  }

  removeAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.stop();
    this.agents.delete(agentId);
    this.broadcastStats();
    this.persist();
  }

  // ---- Försäljning (manuellt loggad tills ett riktigt betalflöde kopplas in) ----

  logSale({ agentId, amountCents, description }) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent hittades inte.");
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      throw new Error("Ogiltigt belopp.");
    }
    agent.earningsCents += amountCents;
    this.log(
      `💰 Försäljning loggad för ${agent.name}: ${(amountCents / 100).toFixed(
        2
      )} kr (${description || "utan beskrivning"})`
    );
    this.broadcastAgentUpdate(agent);
    this.broadcastStats();
    this.persist();
  }

  // ---- Statistik ----

  getTotalEarningsCents() {
    let total = 0;
    for (const agent of this.agents.values()) total += agent.earningsCents;
    return total;
  }

  getStats() {
    const totalCents = this.getTotalEarningsCents();
    return {
      agentCount: this.agents.size,
      maxAgents: MAX_AGENTS,
      totalEarningsCents: totalCents,
      dailyGoalCents: DAILY_GOAL_CENTS,
      goalProgressPct: Math.min(
        100,
        Math.round((totalCents / DAILY_GOAL_CENTS) * 100)
      ),
      dayStartedAt: this.dayStartedAt,
    };
  }

  // ---- Broadcast / logg ----

  log(text) {
    const entry = { text, ts: new Date().toISOString() };
    this.logs.push(entry);
    if (this.logs.length > 200) this.logs.shift();
    if (this.io) this.io.emit("log", entry);
  }

  broadcastAgentUpdate(agent) {
    if (this.io) this.io.emit("agent:update", agent.toJSON());
  }

  broadcastStats() {
    if (this.io) this.io.emit("stats:update", this.getStats());
  }

  getAllAgentsJSON() {
    return Array.from(this.agents.values()).map((a) => a.toJSON());
  }

  getAgent(id) {
    return this.agents.get(id) || null;
  }

  // ---- Persistens ----
  // Sparar till Upstash Redis (gratis, överlever Render-omstarter) om
  // konfigurerat, annars faller tillbaka på en lokal fil (fungerar bara
  // för lokal utveckling - inte pålitligt på Render utan Upstash).

  async persist() {
    const snapshot = {
      savedAt: new Date().toISOString(),
      dayStartedAt: this.dayStartedAt,
      agents: this.getAllAgentsJSON(),
    };
    const json = JSON.stringify(snapshot);

    if (REDIS_URL && REDIS_TOKEN) {
      try {
        await fetch(`${REDIS_URL}/set/${REDIS_KEY}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${REDIS_TOKEN}`,
            "Content-Type": "text/plain",
          },
          body: json,
        });
        return;
      } catch (err) {
        console.error("Kunde inte spara till Upstash:", err.message);
        // Fortsätt till fil-fallbacken nedan istället för att ge upp helt
      }
    }

    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, json);
    } catch (err) {
      console.error("Kunde inte spara state lokalt:", err.message);
    }
  }

  // Läser tillbaka tidigare sparade agenter och deras alster. Anropas en
  // gång vid serverstart. Returnerar true om något återställdes.
  async loadState() {
    let snapshot = null;

    if (REDIS_URL && REDIS_TOKEN) {
      try {
        const resp = await fetch(`${REDIS_URL}/get/${REDIS_KEY}`, {
          headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
        });
        const data = await resp.json();
        if (data.result) snapshot = JSON.parse(data.result);
      } catch (err) {
        console.error("Kunde inte läsa från Upstash:", err.message);
      }
    }

    if (!snapshot) {
      try {
        if (fs.existsSync(STATE_FILE)) {
          snapshot = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
        }
      } catch (err) {
        console.error("Kunde inte läsa lokal state:", err.message);
      }
    }

    if (!snapshot?.agents?.length) return false;

    this.dayStartedAt = snapshot.dayStartedAt || this.dayStartedAt;
    for (const saved of snapshot.agents) {
      const agent = new Agent({ manager: this, kind: saved.kind, parentId: saved.parentId });
      agent.restoreFrom(saved);
      this.agents.set(agent.id, agent);
      if (agent.status !== "stopped") agent.start();
    }
    this.log(`Återställde ${this.agents.size} agent(er) från tidigare session.`);
    return true;
  }
}

module.exports = { AgentManager, MAX_AGENTS, DAILY_GOAL_CENTS };
