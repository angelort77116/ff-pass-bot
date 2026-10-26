const path = require("path");
const express = require("express");
const { ensureFiles, getConfig, saveConfig, getOrders, updateOrder } = require("./store");
const { startBot, logoutBot, getStatus } = require("./bot");

ensureFiles();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const sessions = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));

function getToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return req.query.token || req.body?.token || "";
}

function requireAuth(req, res, next) {
  const token = getToken(req);
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    return res.status(401).json({ ok: false, error: "Nao autorizado" });
  }
  next();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.get("/api/status", (req, res) => {
  const config = getConfig();
  const bot = getStatus();
  res.json({
    ok: true,
    botName: config.botName,
    botNumber: config.botNumber,
    connected: bot.connected,
    connecting: bot.connecting,
    pairingCode: bot.pairingCode,
    lastError: bot.lastError || ""
  });
});

app.post("/api/login", (req, res) => {
  const config = getConfig();
  const pin = String(req.body?.pin || "").trim();
  if (pin !== String(config.panelPin)) {
    return res.status(401).json({ ok: false, error: "PIN incorreto" });
  }
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  sessions.set(token, { expires: Date.now() + 1000 * 60 * 60 * 12 });
  res.json({ ok: true, token });
});

app.get("/api/config", requireAuth, (req, res) => {
  const config = getConfig();
  res.json({ ok: true, config, bot: getStatus() });
});

app.post("/api/config", requireAuth, (req, res) => {
  const allowed = [
    "botName",
    "botNumber",
    "ownerNumber",
    "panelPin",
    "botActive",
    "autoSend",
    "passName",
    "passPrice",
    "passDuration",
    "pixKey",
    "pixType",
    "pixName",
    "support",
    "welcomeMessage",
    "passMessage",
    "ownerMenu",
    "offlineMessage"
  ];
  const patch = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) patch[key] = req.body[key];
  }
  const config = saveConfig(patch);
  res.json({ ok: true, config });
});

app.get("/api/orders", requireAuth, (req, res) => {
  res.json({ ok: true, orders: getOrders() });
});

app.post("/api/orders/:id", requireAuth, (req, res) => {
  const order = updateOrder(req.params.id, {
    status: req.body.status,
    updatedAt: new Date().toISOString()
  });
  if (!order) return res.status(404).json({ ok: false, error: "Pedido nao encontrado" });
  res.json({ ok: true, order });
});

app.post("/api/connect", requireAuth, async (req, res) => {
  try {
    await startBot();
    for (let i = 0; i < 20; i += 1) {
      const bot = getStatus();
      if (bot.pairingCode || bot.connected) break;
      await sleep(500);
    }
    res.json({ ok: true, bot: getStatus() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Falha ao conectar" });
  }
});

app.post("/api/logout", requireAuth, async (req, res) => {
  await logoutBot();
  res.json({ ok: true });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Painel do dono em http://localhost:${PORT}`);
});
