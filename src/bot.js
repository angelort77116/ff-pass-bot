const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const {
  SESSION_DIR,
  getConfig,
  saveConfig,
  getOrders,
  addOrder,
  isOwner,
  fillTemplate,
  newOrderId,
  onlyDigits
} = require("./store");

const logger = pino({ level: "silent" });
const ownerState = new Map();

let sock = null;
let pairingRequested = false;
let status = {
  connected: false,
  connecting: false,
  pairingCode: null,
  number: "",
  lastError: ""
};

function getStatus() {
  return { ...status };
}

function getSocket() {
  return sock;
}

function formatPairingCode(code) {
  const raw = String(code || "").replace(/\s|-/g, "").toUpperCase();
  return raw.match(/.{1,4}/g)?.join("-") || raw;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textFromMessage(msg) {
  const m = msg.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ""
  ).trim();
}

function parsePasseCommand(text) {
  const raw = text.replace(/\s+/g, "");
  const match = raw.match(/^\/passe[+:\-\s]*([0-9]{5,15})$/i);
  if (match) return match[1];
  const spaced = text.trim().match(/^\/passe\s+([0-9]{5,15})$/i);
  return spaced ? spaced[1] : null;
}

async function sendText(jid, text) {
  if (!sock) return;
  await sock.sendMessage(jid, { text });
}

async function handleOwnerFlow(jid, text, config) {
  const key = onlyDigits(jid);
  const pending = ownerState.get(key);

  if (pending) {
    ownerState.delete(key);
    if (pending === "price") {
      const value = text.replace(",", ".").replace(/[^\d.]/g, "");
      if (!value) {
        await sendText(jid, "Valor invalido. Tente de novo no menu.");
        return;
      }
      saveConfig({ passPrice: value });
      await sendText(jid, `Valor do passe atualizado para R$ ${value}`);
      return;
    }
    if (pending === "passName") {
      saveConfig({ passName: text });
      await sendText(jid, `Nome do passe atualizado para: ${text}`);
      return;
    }
    if (pending === "pix") {
      saveConfig({ pixKey: text });
      await sendText(jid, `Chave PIX atualizada para: ${text}`);
      return;
    }
    if (pending === "pixName") {
      saveConfig({ pixName: text });
      await sendText(jid, `Nome PIX atualizado para: ${text}`);
      return;
    }
    if (pending === "pin") {
      const pin = onlyDigits(text);
      if (pin.length < 4) {
        await sendText(jid, "PIN precisa ter pelo menos 4 numeros.");
        return;
      }
      saveConfig({ panelPin: pin });
      await sendText(jid, "PIN do painel atualizado.");
      return;
    }
  }

  const cmd = text.toLowerCase();
  if (cmd === "/dono" || cmd === "menu" || cmd === "/menu") {
    await sendText(jid, fillTemplate(config.ownerMenu));
    return;
  }

  if (text === "1") {
    ownerState.set(key, "price");
    await sendText(jid, `Valor atual: R$ ${config.passPrice}\n\nDigite o novo valor:`);
    return;
  }
  if (text === "2") {
    ownerState.set(key, "passName");
    await sendText(jid, `Nome atual: ${config.passName}\n\nDigite o novo nome:`);
    return;
  }
  if (text === "3") {
    ownerState.set(key, "pix");
    await sendText(jid, `PIX atual: ${config.pixKey}\n\nDigite a nova chave PIX:`);
    return;
  }
  if (text === "4") {
    ownerState.set(key, "pixName");
    await sendText(jid, `Nome PIX atual: ${config.pixName}\n\nDigite o novo nome:`);
    return;
  }
  if (text === "5") {
    const next = !config.botActive;
    saveConfig({ botActive: next });
    await sendText(jid, next ? "Bot LIGADO." : "Bot DESLIGADO.");
    return;
  }
  if (text === "6") {
    const next = !config.autoSend;
    saveConfig({ autoSend: next });
    await sendText(jid, next ? "Envio automatico LIGADO." : "Envio automatico DESLIGADO.");
    return;
  }
  if (text === "7") {
    const orders = getOrders().slice(0, 10);
    if (!orders.length) {
      await sendText(jid, "Nenhum pedido ainda.");
      return;
    }
    const lines = orders.map(
      (item, i) =>
        `${i + 1}. ${item.id} | ID ${item.playerId} | R$ ${item.price} | ${item.status}`
    );
    await sendText(jid, `*ULTIMOS PEDIDOS*\n\n${lines.join("\n")}`);
    return;
  }
  if (text === "8") {
    await sendText(
      jid,
      `*CONFIGURACOES*\n\nBot: ${config.botName}\nNumero bot: ${config.botNumber}\nDono: ${config.ownerNumber}\nPasse: ${config.passName}\nValor: R$ ${config.passPrice}\nDuracao: ${config.passDuration}\nPIX: ${config.pixKey}\nTipo PIX: ${config.pixType}\nNome PIX: ${config.pixName}\nAtivo: ${config.botActive ? "SIM" : "NAO"}\nAuto envio: ${config.autoSend ? "SIM" : "NAO"}`
    );
    return;
  }
  if (text === "9") {
    ownerState.set(key, "pin");
    await sendText(jid, "Digite o novo PIN do painel web (minimo 4 numeros):");
    return;
  }

  const playerId = parsePasseCommand(text);
  if (playerId) {
    await deliverPass(jid, playerId, config);
    return;
  }

  await sendText(jid, fillTemplate(config.ownerMenu));
}

async function deliverPass(jid, playerId, config) {
  const order = addOrder({
    id: newOrderId(),
    playerId,
    from: onlyDigits(jid),
    price: config.passPrice,
    passName: config.passName,
    status: config.autoSend ? "enviado" : "aguardando",
    createdAt: new Date().toISOString()
  });

  if (!config.autoSend) {
    await sendText(
      jid,
      `Pedido ${order.id} registrado para o ID ${playerId}.\nAguarde a liberacao do dono.`
    );
    const ownerJid = `${onlyDigits(config.ownerNumber)}@s.whatsapp.net`;
    await sendText(
      ownerJid,
      `Novo pedido ${order.id}\nID FF: ${playerId}\nCliente: ${onlyDigits(jid)}\nValor: R$ ${config.passPrice}`
    );
    return order;
  }

  const message = fillTemplate(config.passMessage, {
    id: playerId,
    pedido: order.id
  });
  await sendText(jid, message);
  return order;
}

async function handleMessage(msg) {
  if (!msg.message || msg.key.remoteJid === "status@broadcast") return;
  if (msg.key.fromMe) return;

  const jid = msg.key.remoteJid;
  if (!jid || jid.endsWith("@g.us")) return;

  const text = textFromMessage(msg);
  if (!text) return;

  const config = getConfig();
  const owner = isOwner(jid, config);

  if (owner) {
    await handleOwnerFlow(jid, text, config);
    return;
  }

  if (!config.botActive) {
    await sendText(jid, config.offlineMessage);
    return;
  }

  const playerId = parsePasseCommand(text);
  if (playerId) {
    await deliverPass(jid, playerId, config);
    return;
  }

  if (/^(oi|ola|olá|menu|hi|hey|\/start|\/menu)$/i.test(text)) {
    await sendText(jid, fillTemplate(config.welcomeMessage));
    return;
  }

  await sendText(
    jid,
    fillTemplate(
      "Comando nao reconhecido.\n\nEnvie */passe+SEU_ID*\nExemplo: /passe+123456789\n\nValor: R$ {valor}\nPasse: {passe}"
    )
  );
}

async function requestCode(phone) {
  if (!sock || pairingRequested || sock.authState?.creds?.registered) return;
  pairingRequested = true;
  await sleep(2500);
  try {
    const code = await sock.requestPairingCode(phone);
    status.pairingCode = formatPairingCode(code);
    status.lastError = "";
    status.connecting = true;
  } catch (err) {
    pairingRequested = false;
    status.lastError = err.message || "Falha ao gerar codigo de pareamento";
  }
}

async function startBot() {
  if (status.connected && sock) return getStatus();
  if (status.connecting && sock) return getStatus();

  status.connecting = true;
  status.lastError = "";
  status.pairingCode = null;
  pairingRequested = false;

  const config = getConfig();
  const phone = onlyDigits(config.botNumber);
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !sock.authState.creds.registered) {
      requestCode(phone).catch(() => {});
    }

    if (connection === "open") {
      status.connected = true;
      status.connecting = false;
      status.pairingCode = null;
      status.lastError = "";
      status.number = sock.user?.id?.split(":")[0] || phone;
      try {
        const ownerJid = `${onlyDigits(config.ownerNumber)}@s.whatsapp.net`;
        await sendText(
          ownerJid,
          `${config.botName} conectado.\nNumero: ${status.number}\nEnvie /dono para o menu.`
        );
      } catch {
        /* owner notify is optional */
      }
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      status.connected = false;
      status.connecting = false;
      status.lastError = loggedOut
        ? "Sessao encerrada. Gere um novo codigo."
        : lastDisconnect?.error?.message || "Conexao fechada";
      sock = null;
      pairingRequested = false;
      if (!loggedOut) {
        setTimeout(() => startBot().catch(() => {}), 4000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        await handleMessage(msg);
      } catch (err) {
        status.lastError = err.message || "Erro ao processar mensagem";
      }
    }
  });

  if (!state.creds.registered) {
    requestCode(phone).catch(() => {});
  }

  return getStatus();
}

async function logoutBot() {
  try {
    if (sock) await sock.end(undefined);
  } catch {
    /* ignore */
  }
  sock = null;
  pairingRequested = false;
  status = {
    connected: false,
    connecting: false,
    pairingCode: null,
    number: "",
    lastError: ""
  };
}

module.exports = {
  startBot,
  logoutBot,
  getStatus,
  getSocket
};
