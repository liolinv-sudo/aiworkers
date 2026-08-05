require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
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
