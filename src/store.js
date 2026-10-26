const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const ORDERS_PATH = path.join(DATA_DIR, "orders.json");
const SESSION_DIR = path.join(__dirname, "..", "auth_session");

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig(), null, 2));
  }
  if (!fs.existsSync(ORDERS_PATH)) {
    fs.writeFileSync(ORDERS_PATH, "[]");
  }
}

function defaultConfig() {
  return {
    botName: "FF Pass Bot",
    botNumber: "556593511752",
    ownerNumber: "5569993841805",
    panelPin: "1805",
    botActive: true,
    autoSend: true,
    passName: "Passe Booyah Free Fire",
    passPrice: "29.90",
    passDuration: "30 dias",
    pixKey: "5569993841805",
    pixType: "TELEFONE",
    pixName: "Dono FF Pass",
    support: "5569993841805",
    welcomeMessage:
      "Ola! Sou o *{bot}*.\n\nPara receber o passe automatico, envie:\n*/passe+SEU_ID*\n\nExemplo: /passe+123456789\n\nValor: R$ {valor}\nPasse: {passe}",
    passMessage:
      "*PEDIDO CONFIRMADO*\n\nPasse: {passe}\nID Free Fire: {id}\nValor: R$ {valor}\nDuracao: {duracao}\n\n*PAGAMENTO PIX*\nTipo: {pixTipo}\nChave: {pix}\nNome: {pixNome}\n\nAssim que o pagamento cair, o passe e aplicado no ID informado.\n\nPedido: {pedido}",
    ownerMenu:
      "*PAINEL DONO - {bot}*\n\n1. Alterar valor do passe\n2. Alterar nome do passe\n3. Alterar chave PIX\n4. Alterar nome PIX\n5. Ligar/Desligar bot\n6. Ligar/Desligar envio automatico\n7. Ver pedidos\n8. Ver configuracoes\n9. Alterar PIN do painel\n\nToque e responda o numero, ou use o painel web.",
    offlineMessage: "Bot temporariamente desligado. Tente novamente mais tarde."
  };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getConfig() {
  ensureFiles();
  return { ...defaultConfig(), ...readJson(CONFIG_PATH, {}) };
}

function saveConfig(partial) {
  const next = { ...getConfig(), ...partial };
  writeJson(CONFIG_PATH, next);
  return next;
}

function getOrders() {
  ensureFiles();
  const orders = readJson(ORDERS_PATH, []);
  return Array.isArray(orders) ? orders : [];
}

function saveOrders(orders) {
  writeJson(ORDERS_PATH, orders);
  return orders;
}

function addOrder(order) {
  const orders = getOrders();
  orders.unshift(order);
  saveOrders(orders);
  return order;
}

function updateOrder(id, partial) {
  const orders = getOrders();
  const idx = orders.findIndex((item) => item.id === id);
  if (idx === -1) return null;
  orders[idx] = { ...orders[idx], ...partial };
  saveOrders(orders);
  return orders[idx];
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isOwner(jid, config) {
  const number = onlyDigits(jid).replace(/^55/, "");
  const owner = onlyDigits(config.ownerNumber).replace(/^55/, "");
  return number.endsWith(owner) || owner.endsWith(number);
}

function fillTemplate(template, extra) {
  const config = getConfig();
  const map = {
    bot: config.botName,
    valor: config.passPrice,
    passe: config.passName,
    duracao: config.passDuration,
    pix: config.pixKey,
    pixTipo: config.pixType,
    pixNome: config.pixName,
    suporte: config.support,
    ...extra
  };
  return String(template || "").replace(/\{(\w+)\}/g, (_, key) =>
    map[key] != null ? String(map[key]) : `{${key}}`
  );
}

function newOrderId() {
  const now = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `FF${now}${rand}`;
}

module.exports = {
  DATA_DIR,
  SESSION_DIR,
  ensureFiles,
  getConfig,
  saveConfig,
  getOrders,
  saveOrders,
  addOrder,
  updateOrder,
  onlyDigits,
  isOwner,
  fillTemplate,
  newOrderId
};
