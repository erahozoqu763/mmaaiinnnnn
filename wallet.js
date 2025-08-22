/* ==========================================================================
   wallet.js  (includes nav.js functionality)
   - 4-space indents
   - Uses ethers v6 for MetaMask
   - Pulls runtime config from your backend /api/config
   - Minimal UI wiring to typical dApp-style wallet connect + bind
   ========================================================================== */

/* =========================
   Config (edit for prod)
   ========================= */
// For local development use your forwarded/Exposed API (same host/port as docker logs show)
// Example local: "http://localhost:31827"
// Example public: "https://api.103.246.147.200.sslip.io"
const API_BASE_URL = "http://localhost:31827";

/* =========================
   Global state
   ========================= */
const STATE = {
    provider: null,
    signer: null,
    account: null,
    chainId: null,
    config: null
};

/* =========================
   DOM helpers
   ========================= */
function $(id) {
    return document.getElementById(id);
}
function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
}
function show(el, yes) {
    if (!el) return;
    el.style.display = yes ? "" : "none";
}

/* =========================
   Nav (embedded nav.js)
   ========================= */
function setActiveNav() {
    const tabsWrap = document.querySelector(".nav .tabs");
    if (!tabsWrap) return;
    const tabs = Array.from(tabsWrap.querySelectorAll(".tab"));
    const here = location.pathname.split("/").pop() || "index.html";

    tabs.forEach(tab => {
        tab.classList.remove("active");
        tab.removeAttribute("aria-current");
        const href = tab.getAttribute("href") || "";
        // treat index.html + wallet.html explicitly; hash-only links remain active if same base file
        const target = href.split("#")[0] || "";
        const same = (target === here) || (here === "" && target === "index.html");
        if (same) {
            tab.classList.add("active");
            tab.setAttribute("aria-current", "page");
        }
    });
}

/* =========================
   API helpers
   ========================= */
async function apiGet(path, params = null) {
    const url = new URL(API_BASE_URL + path);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const r = await fetch(url.toString(), { credentials: "omit" });
    if (!r.ok) throw new Error("GET " + path + " failed: " + r.status);
    return r.json();
}
async function apiPost(path, body = {}) {
    const r = await fetch(API_BASE_URL + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error("POST " + path + " failed: " + r.status);
    return r.json();
}

/* =========================
   Telegram ID resolve
   ========================= */
function tgUserId() {
    try {
        if (window.Telegram && Telegram.WebApp && Telegram.WebApp.initDataUnsafe?.user?.id) {
            return Number(Telegram.WebApp.initDataUnsafe.user.id);
        }
    } catch (_) {}
    const q = new URLSearchParams(location.search);
    const v = q.get("tg_user_id");
    return v ? Number(v) : null;
}

/* =========================
   Bind message (SIWE-like)
   ========================= */
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

/* =========================
   UI updates
   ========================= */
function reflectConfig() {
    if (!STATE.config) return;
    setText("cfgChainId", String(STATE.config.chainId));
    setText("cfgSpender", STATE.config.spender);
    setText("cfgApi", API_BASE_URL);
}

function reflectConnection() {
    if (STATE.account) {
        setText("addr", STATE.account);
        setText("addr2", STATE.account);
    } else {
        setText("addr", "—");
        setText("addr2", "—");
    }
    if (STATE.chainId != null) {
        setText("chainInfo", "chainId=" + STATE.chainId);
    } else {
        setText("chainInfo", "chainId=—");
    }
}

function enableControlsAfterConnect() {
    const btnPrepare = $("btnPrepare");
    const btnSignBind = $("btnSignBind");
    if (btnPrepare) btnPrepare.disabled = !(STATE.account && STATE.chainId);
    if (btnSignBind) btnSignBind.disabled = true; // only enable after prepare
}

/* =========================
   Actions
   ========================= */
async function loadConfig() {
    try {
        const cfg = await apiGet("/api/config");
        STATE.config = cfg;
        reflectConfig();
    } catch (e) {
        console.warn("Failed to load config:", e);
        setText("cfgApi", API_BASE_URL + " (config error)");
    }
}

async function connectWallet() {
    const connState = $("connState");
    const btn = $("btnConnect");

    try {
        if (!window.ethereum) {
            if (connState) connState.textContent = "MetaMask не найден — установите расширение";
            alert("MetaMask не найден. Установите расширение или используйте браузер-кошелёк.");
            return;
        }
        if (btn) btn.disabled = true;

        STATE.provider = new ethers.BrowserProvider(window.ethereum);
        await window.ethereum.request({ method: "eth_requestAccounts" });
        STATE.signer = await STATE.provider.getSigner();
        STATE.account = await STATE.signer.getAddress();
        const net = await STATE.provider.getNetwork();
        STATE.chainId = Number(net.chainId);

        reflectConnection();
        if (connState) connState.textContent = "✅ Кошелёк подключен";

        // Try switch chain if backend config exists and mismatch
        if (STATE.config && STATE.chainId !== Number(STATE.config.chainId)) {
            try {
                await window.ethereum.request({
                    method: "wallet_switchEthereumChain",
                    params: [{ chainId: ethers.toBeHex(Number(STATE.config.chainId)) }]
                });
                const net2 = await STATE.provider.getNetwork();
                STATE.chainId = Number(net2.chainId);
                reflectConnection();
                if (connState) connState.textContent = "✅ Сеть переключена";
            } catch (e) {
                // If user rejects or chain missing, we just warn
                if (connState) {
                    connState.textContent = "⚠️ Сеть кошелька не совпадает с конфигом";
                }
            }
        }

        enableControlsAfterConnect();
    } catch (e) {
        console.error(e);
        if (connState) connState.textContent = "❌ Ошибка подключения";
        alert("Ошибка подключения к кошельку: " + (e?.message || e));
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function prepareBind() {
    const id = tgUserId();
    setText("tgIdView", id ? String(id) : "—");

    if (!id || !STATE.account) {
        setText("bindState", "Требуется Telegram ID и подключенный кошелёк");
        return;
    }
    const msg = buildBindMessage(id, STATE.account);
    setText("msgPreview", msg);
    setText("bindState", "Готово к подписи");

    const btnSignBind = $("btnSignBind");
    if (btnSignBind) btnSignBind.disabled = false;
}

async function signAndBind() {
    const id = tgUserId();
    const status = $("bindState");
    const btnSign = $("btnSignBind");

    try {
        if (!id) {
            if (status) status.textContent = "⚠️ Не найден Telegram ID";
            return;
        }
        if (!STATE.signer || !STATE.account) {
            alert("Сначала подключите кошелёк.");
            return;
        }
        if (btnSign) btnSign.disabled = true;

        const msg = buildBindMessage(id, STATE.account);
        let sig;
        try {
            sig = await STATE.signer.signMessage(msg);
        } catch {
            if (status) status.textContent = "❌ Подпись отклонена";
            return;
        }

        const res = await apiPost("/api/bind", {
            tg_user_id: Number(id),
            address: STATE.account,
            message: msg,
            signature: sig
        });

        if (res && (res.ok || res === true)) {
            if (status) status.textContent = "✅ Привязка сохранена";
        } else {
            if (status) status.textContent = "⚠️ Ответ API без ok=true";
        }
    } catch (e) {
        console.error(e);
        if (status) status.textContent = "❌ Ошибка API bind";
        alert("Ошибка привязки: " + (e?.message || e));
    } finally {
        if (btnSign) btnSign.disabled = false;
    }
}

async function validateTokens() {
    const btn = $("btnValidate");
    const out = $("tokStatus");
    try {
        if (btn) btn.disabled = true;
        const r = await apiGet("/api/validate-tokens");
        if (!out) return;
        if (!r || !r.ok || !Array.isArray(r.results)) {
            out.textContent = "Не удалось получить список токенов.";
            return;
        }
        // Render simple compact list
        out.innerHTML = "";
        r.results.forEach(t => {
            const li = document.createElement("div");
            li.className = "chip";
            const code = t.has_code ? "✓" : "—";
            li.textContent = `${t.symbol} • ${t.address.slice(0, 6)}…${t.address.slice(-4)} • ${code}`;
            out.appendChild(li);
        });
    } catch (e) {
        console.error(e);
        if (out) out.textContent = "Ошибка проверки токенов.";
    } finally {
        if (btn) btn.disabled = false;
    }
}

/* =========================
   Bootstrap
   ========================= */
document.addEventListener("DOMContentLoaded", async () => {
    // Activate bottom nav
    setActiveNav();

    // Show API base & try load config
    setText("cfgApi", API_BASE_URL);
    await loadConfig();

    // Reflect initial TG ID
    const id = tgUserId();
    setText("tgIdView", id ? String(id) : "—");

    // Wire buttons (only if present on page)
    const btnConnect = $("btnConnect");
    if (btnConnect) btnConnect.addEventListener("click", connectWallet);

    const btnPrepare = $("btnPrepare");
    if (btnPrepare) btnPrepare.addEventListener("click", prepareBind);

    const btnSignBind = $("btnSignBind");
    if (btnSignBind) btnSignBind.addEventListener("click", signAndBind);

    const btnValidate = $("btnValidate");
    if (btnValidate) btnValidate.addEventListener("click", validateTokens);

    // If wallet already available (previous session), softly read address
    if (window.ethereum && ethereum.selectedAddress) {
        try {
            STATE.provider = new ethers.BrowserProvider(window.ethereum);
            STATE.signer = await STATE.provider.getSigner();
            STATE.account = await STATE.signer.getAddress();
            const net = await STATE.provider.getNetwork();
            STATE.chainId = Number(net.chainId);
            reflectConnection();
            enableControlsAfterConnect();
            setText("connState", "✅ Кошелёк подключен");
        } catch (_) {
            // ignore silent init errors
        }
    }
});
