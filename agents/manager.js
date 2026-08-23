const fs = require("fs");
const path = require("path");
const Agent = require("./agent");

const STATE_FILE = path.join(__dirname, "..", "data", "state.json");
const MAX_AGENTS = 20; // skydd mot skenande kostnader/oändlig förökning
const DAILY_GOAL_CENTS = 20000; // 200 kr i öre

class AgentManager {
  constructor(io) {
    this.io = io;
    this.agents = new Map();
    this.logs = []; // { text, ts }
    this.dayStartedAt = new Date().toISOString();
  }

  // ---- Agentlivscykel ----

  spawnAgent({ parentId = null, kind = "text" } = {}) {
    if (this.agents.size >= MAX_AGENTS) {
      throw new Error(`Max antal agenter (${MAX_AGENTS}) uppnått.`);
    }
    const agent = new Agent({ parentId, manager: this, kind });
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
  reproduce(agentId) {
    const parent = this.agents.get(agentId);
    if (!parent) throw new Error("Agent hittades inte.");
    return this.spawnAgent({ parentId: agentId, kind: parent.kind });
  }

  stopAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent hittades inte.");
    agent.stop();
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

  // ---- Persistens (enkel JSON-fil, byt till riktig databas vid behov) ----

  persist() {
    try {
      const snapshot = {
        savedAt: new Date().toISOString(),
        dayStartedAt: this.dayStartedAt,
        agents: this.getAllAgentsJSON(),
      };
      // Git spårar inte tomma mappar, så "data"-mappen kan saknas efter en
      // färsk klon (t.ex. på Render) - skapa den om den inte redan finns.
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(snapshot, null, 2));
    } catch (err) {
      console.error("Kunde inte spara state:", err.message);
    }
  }
}

module.exports = { AgentManager, MAX_AGENTS, DAILY_GOAL_CENTS };
