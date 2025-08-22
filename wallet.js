// ⚙️ ПІДСТАВ СВІЙ ПУБЛІЧНИЙ URL API:
const API_BASE_URL = "https://api.103.246.147.200.sslip.io";

// ===== Внутрішній стан =====
const STATE = {
    provider: null,
    signer: null,
    account: null,
    chainId: null,
    config: null, // завантажимо з /api/config (без показу на UI)
};

// ===== DOM =====
const $ = (id) => document.getElementById(id);
const elStatus = $("status");
const btnConnect = $("btnConnect");
const btnBind = $("btnBind");

// ===== Допоміжні =====
function short(addr) {
    return addr ? (addr.slice(0, 6) + "…" + addr.slice(-4)) : "";
}

function tgUserId() {
    try {
        const u = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
        if (u) return Number(u);
    } catch { /* ignore */ }
    const q = new URLSearchParams(location.search);
    const v = q.get("tg_user_id");
    return v ? Number(v) : null;
}

async function apiGet(path) {
    const r = await fetch(API_BASE_URL + path, { credentials: "omit" });
    if (!r.ok) throw new Error("GET " + path + " -> " + r.status);
    return r.json();
}

async function apiPost(path, body) {
    const r = await fetch(API_BASE_URL + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error("POST " + path + " -> " + r.status);
    return r.json();
}

function buildBindMessage(tgId, address) {
    const now = new Date().toISOString();
    const nonce = Math.random().toString(36).slice(2);
    return `SafeChain Wallet Bind

Bind Telegram ID: ${tgId}
Address: ${address}
ChainId: ${STATE.chainId}
Timestamp: ${now}
Nonce: ${nonce}`;
}

// ===== Дії =====
async function loadConfig() {
    try {
        const cfg = await apiGet("/api/config");
        STATE.config = cfg; // chainId/spender/vault (не виводимо)
    } catch (e) {
        // не критично для UI, просто запишемо в статус
        console.warn("config load failed", e);
    }
}

async function connect() {
    if (!window.ethereum) {
        elStatus.textContent = "MetaMask не найден. Установи расширение або відкрий у браузері з кошельком.";
        return;
    }

    STATE.provider = new ethers.BrowserProvider(window.ethereum);
    await window.ethereum.request({ method: "eth_requestAccounts" });
    STATE.signer = await STATE.provider.getSigner();
    STATE.account = await STATE.signer.getAddress();

    const net = await STATE.provider.getNetwork();
    STATE.chainId = Number(net.chainId);

    // Якщо API каже інший chainId — спробуємо перемкнути (без UI)
    const want = Number(STATE?.config?.chainId);
    if (want && want !== STATE.chainId) {
        try {
            await window.ethereum.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: ethers.toBeHex(want) }],
            });
            const n2 = await STATE.provider.getNetwork();
            STATE.chainId = Number(n2.chainId);
        } catch (e) {
            // даємо продовжити, просто повідомимо
            console.warn("network switch failed", e);
        }
    }

    elStatus.textContent = "Підключено: " + short(STATE.account);
    btnBind.disabled = !STATE.account;
}

async function signAndBind() {
    const id = tgUserId();
    if (!id) {
        elStatus.textContent = "Не знайдено Telegram ID: відкрий із бота або додай ?tg_user_id=...";
        return;
    }
    if (!STATE.signer || !STATE.account) {
        elStatus.textContent = "Спочатку підключи MetaMask.";
        return;
    }

    const msg = buildBindMessage(id, STATE.account);
    let sig;
    try {
        sig = await STATE.signer.signMessage(msg);
    } catch (e) {
        elStatus.textContent = "Підпис скасовано.";
        return;
    }

    try {
        const res = await apiPost("/api/bind", {
            tg_user_id: Number(id),
            address: STATE.account,
            message: msg,
            signature: sig,
        });
        if (res && (res.ok === true || res === "ok")) {
            elStatus.textContent = "✅ Прив’язка збережена";
        } else {
            elStatus.textContent = "⚠️ Відповідь API без ok=true";
        }
    } catch (e) {
        elStatus.textContent = "❌ Помилка API bind";
        console.error(e);
    }
}

// ===== Ініціалізація =====
document.addEventListener("DOMContentLoaded", async () => {
    // ethers v6 (через CDN)
    if (typeof window.ethers === "undefined") {
        // Підвантажимо динамічно, якщо не підключили окремо
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/ethers@6.13.2/dist/ethers.min.js";
        document.head.appendChild(s);
        await new Promise(resolve => { s.onload = resolve; });
    }

    await loadConfig();

    btnConnect.addEventListener("click", connect);
    btnBind.addEventListener("click", signAndBind);
});
