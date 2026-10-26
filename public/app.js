const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const configForm = document.getElementById("config-form");
const saveMsg = document.getElementById("save-msg");
const ordersBody = document.getElementById("orders-body");
const pairCode = document.getElementById("pair-code");
const pairError = document.getElementById("pair-error");
const connDot = document.getElementById("conn-dot");
const connText = document.getElementById("conn-text");
const botTitle = document.getElementById("bot-title");

let token = localStorage.getItem("ffpass_token") || "";

function authHeaders() {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Falha de rede" }));
  if (res.status === 401) {
    token = "";
    localStorage.removeItem("ffpass_token");
    showLogin();
  }
  return data;
}

function showLogin() {
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
}

function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const pin = document.getElementById("pin").value;
  const data = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin })
  }).then((r) => r.json());
  if (!data.ok) {
    loginError.textContent = data.error || "PIN incorreto";
    return;
  }
  token = data.token;
  localStorage.setItem("ffpass_token", token);
  showApp();
  await refreshAll();
});

configForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(configForm);
  const body = Object.fromEntries(form.entries());
  body.botActive = form.has("botActive");
  body.autoSend = form.has("autoSend");
  const data = await api("/api/config", { method: "POST", body: JSON.stringify(body) });
  saveMsg.textContent = data.ok ? "Configuracoes salvas." : data.error || "Erro ao salvar";
});

document.getElementById("btn-connect").addEventListener("click", async () => {
  pairError.textContent = "Gerando codigo...";
  const data = await api("/api/connect", { method: "POST", body: "{}" });
  if (!data.ok) pairError.textContent = data.error || "Falha ao gerar codigo";
  await refreshStatus();
});

document.getElementById("btn-copy").addEventListener("click", async () => {
  const code = pairCode.textContent.replace(/-/g, "");
  if (!code || code === "------") return;
  try {
    await navigator.clipboard.writeText(code);
    pairError.textContent = "Codigo copiado.";
  } catch {
    pairError.textContent = "Copie o codigo manualmente.";
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" });
  await refreshStatus();
});

function fillConfig(config) {
  botTitle.textContent = config.botName || "FF Pass Bot";
  for (const el of configForm.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") {
      el.checked = Boolean(config[el.name]);
    } else if (config[el.name] != null) {
      el.value = config[el.name];
    }
  }
}

function renderOrders(orders) {
  if (!orders.length) {
    ordersBody.innerHTML = '<tr><td colspan="6">Nenhum pedido ainda.</td></tr>';
    return;
  }
  ordersBody.innerHTML = orders
    .map(
      (item) => `<tr>
        <td>${item.id}</td>
        <td>${item.playerId}</td>
        <td>${item.from}</td>
        <td>R$ ${item.price}</td>
        <td>${item.status}</td>
        <td>
          <button data-id="${item.id}" data-status="enviado" type="button">Marcar enviado</button>
        </td>
      </tr>`
    )
    .join("");
  ordersBody.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/orders/${btn.dataset.id}`, {
        method: "POST",
        body: JSON.stringify({ status: btn.dataset.status })
      });
      await refreshOrders();
    });
  });
}

async function refreshStatus() {
  const data = await api("/api/config");
  if (!data.ok) return;
  fillConfig(data.config);
  const bot = data.bot || {};
  connDot.classList.toggle("on", Boolean(bot.connected));
  connText.textContent = bot.connected
    ? `Conectado ${bot.number || data.config.botNumber}`
    : bot.connecting
      ? "Conectando..."
      : "Desconectado";
  pairCode.textContent = bot.pairingCode || (bot.connected ? "CONECTADO" : "------");
  pairError.textContent = bot.lastError || "";
}

async function refreshOrders() {
  const data = await api("/api/orders");
  if (data.ok) renderOrders(data.orders || []);
}

async function refreshAll() {
  await refreshStatus();
  await refreshOrders();
}

if (token) {
  showApp();
  refreshAll();
} else {
  showLogin();
}

setInterval(() => {
  if (token) refreshAll();
}, 5000);
