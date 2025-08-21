(function () {
    "use strict";

    // ============ Налаштування ============
    // Поміняй на свій публічний URL, якщо піднято на сервері.
    // Для локальної розробки використовуй бекенд з портом API (див. docker-compose, лог /api/config).
    const API_BASE_URL = "http://localhost:31827";

    // ============ Стан ============
    const STATE = {
        cfg: null,
        provider: null,
        signer: null,
        account: null,
        chainId: null,
        message: null,
        tgId: null
    };

    // ============ Утиліти ============
    const $ = (id) => document.getElementById(id);
    const short = (addr) => addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";

    function setChip(el, kind, text) {
        el.classList.remove("ok", "warn", "err");
        if (kind) el.classList.add(kind);
        el.textContent = text;
    }

    function getTgId() {
        try {
            if (window.Telegram && Telegram.WebApp?.initDataUnsafe?.user?.id) {
                return Number(Telegram.WebApp.initDataUnsafe.user.id);
            }
        } catch (_) {}
        const q = new URLSearchParams(location.search);
        const v = q.get("tg_user_id");
        return v ? Number(v) : null;
    }

    async function apiGet(path) {
        const r = await fetch(API_BASE_URL + path, { credentials: "omit" });
        if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
        return r.json();
    }
    async function apiPost(path, body) {
        const r = await fetch(API_BASE_URL + path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        if (!r.ok) throw new Error(`POST ${path} -> ${r.status}`);
        return r.json();
    }

    // ============ Крок 1: конфіг з бекенда ============
    async function loadConfig() {
        $("cfgApi").textContent = API_BASE_URL;
        setChip($("cfgState"), null, "Загрузка…");
        try {
            const cfg = await apiGet("/api/config");
            STATE.cfg = cfg;
            $("cfgChainId").textContent = String(cfg.chainId);
            $("cfgSpender").textContent = cfg.spender;
            $("cfgVault").textContent = cfg.vault;
            setChip($("cfgState"), "ok", "OK");
        } catch (e) {
            setChip($("cfgState"), "err", "Ошибка");
            console.error(e);
        }
    }

    // ============ Крок 2: підключення MetaMask ============
    async function connect() {
        const mmState = $("mmState");
        if (!window.ethereum) {
            setChip(mmState, "err", "MetaMask не найден");
            alert("MetaMask не найден. Открой страницу в браузере с установленным кошельком.");
            return;
        }

        try {
            STATE.provider = new ethers.BrowserProvider(window.ethereum);
            await window.ethereum.request({ method: "eth_requestAccounts" });
            STATE.signer = await STATE.provider.getSigner();
            STATE.account = await STATE.signer.getAddress();
            const net = await STATE.provider.getNetwork();
            STATE.chainId = Number(net.chainId);

            $("addr").textContent = STATE.account;
            $("addr2").textContent = STATE.account;
            $("netInfo").textContent = `chainId=${STATE.chainId}`;
            setChip(mmState, "ok", "Подключено");

            $("btnCopy").disabled = false;
            $("btnPrepare").disabled = false;

            // Якщо відомий chainId з бекенда — перевір відповідність
            if (STATE.cfg?.chainId && STATE.chainId !== Number(STATE.cfg.chainId)) {
                setChip(mmState, "warn", "Сеть не совпадает с API");
                $("btnSwitch").disabled = false;
            } else {
                $("btnSwitch").disabled = true;
            }
        } catch (e) {
            setChip(mmState, "err", "Отклонено/Ошибка");
            console.error(e);
        }
    }

    async function switchNetwork() {
        if (!STATE.cfg?.chainId) return;
        try {
            await window.ethereum.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: ethers.toBeHex(Number(STATE.cfg.chainId)) }]
            });
            const net = await STATE.provider.getNetwork();
            STATE.chainId = Number(net.chainId);
            $("netInfo").textContent = `chainId=${STATE.chainId}`;
            $("btnSwitch").disabled = (STATE.chainId === Number(STATE.cfg.chainId));
            if (STATE.chainId === Number(STATE.cfg.chainId)) {
                setChip($("mmState"), "ok", "Подключено");
            }
        } catch (e) {
            setChip($("mmState"), "warn", "Не удалось переключить");
            console.error(e);
        }
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

    function prepareMessage() {
        const id = getTgId();
        STATE.tgId = id || null;
        $("tgIdView").textContent = id ? String(id) : "—";

        if (!STATE.account) {
            alert("Сначала подключи кошелёк.");
            return;
        }
        if (!id) {
            alert("Открой страницу через Telegram WebApp в боте или добавь ?tg_user_id=123 в адресную строку.");
        }

        const msg = buildBindMessage(id, STATE.account);
        STATE.message = msg;
        $("msgPreview").textContent = msg;
        setChip($("bindState"), null, "Готово к подписи");
        $("btnSignBind").disabled = false;
    }

    async function signAndBind() {
        if (!STATE.signer || !STATE.account) {
            alert("Сначала подключи кошелёк.");
            return;
        }
        if (!STATE.tgId) {
            alert("Не найден Telegram ID.");
            return;
        }
        if (!STATE.message) {
            alert("Сформируй сообщение для подписи.");
            return;
        }

        setChip($("bindState"), null, "Подписываю…");
        let sig;
        try {
            sig = await STATE.signer.signMessage(STATE.message);
        } catch (e) {
            setChip($("bindState"), "err", "Подпись отклонена");
            console.error(e);
            return;
        }

        setChip($("bindState"), null, "Отправляю в API…");
        try {
            const res = await apiPost("/api/bind", {
                tg_user_id: Number(STATE.tgId),
                address: STATE.account,
                message: STATE.message,
                signature: sig
            });
            // ожидаем { ok: true } либо подобный ответ
            if (res && (res.ok === true || res.status === "ok")) {
                setChip($("bindState"), "ok", "Привязано");
                // обновим список привязок
                await loadMy();
            } else {
                setChip($("bindState"), "warn", "Ответ без ok=true");
            }
        } catch (e) {
            setChip($("bindState"), "err", "Ошибка API");
            console.error(e);
        }
    }

    async function loadMy() {
        const box = $("myList");
        box.textContent = "Загрузка…";
        try {
            const data = await apiGet("/api/my-wallets");
            // формат неизвестен — аккуратно отрисуем JSON
            if (!data || (Array.isArray(data) && data.length === 0)) {
                box.textContent = "Пусто";
                return;
            }
            if (Array.isArray(data)) {
                box.innerHTML = "";
                data.forEach((it, i) => {
                    const div = document.createElement("div");
                    div.className = "item";
                    div.innerHTML = `
                        <div class="t">#${i + 1}</div>
                        <div class="mono break">${typeof it === "string" ? it : JSON.stringify(it)}</div>
                    `;
                    box.appendChild(div);
                });
            } else {
                box.innerHTML = `
                    <div class="item">
                        <div class="t">Ответ API</div>
                        <div class="mono break">${JSON.stringify(data)}</div>
                    </div>
                `;
            }
        } catch (e) {
            box.textContent = "Ошибка загрузки";
            console.error(e);
        }
    }

    function copyAddr() {
        if (!STATE.account) return;
        navigator.clipboard.writeText(STATE.account).catch(() => {});
    }

    function initUi() {
        $("cfgApi").textContent = API_BASE_URL;
        $("btnConnect").addEventListener("click", connect);
        $("btnSwitch").addEventListener("click", switchNetwork);
        $("btnCopy").addEventListener("click", copyAddr);
        $("btnPrepare").addEventListener("click", prepareMessage);
        $("btnSignBind").addEventListener("click", signAndBind);
        $("btnLoadMy").addEventListener("click", loadMy);

        const id = getTgId();
        $("tgIdView").textContent = id ? String(id) : "—";

        // Якщо немає MM — підсвічуємо стейт
        if (!window.ethereum) {
            setChip($("mmState"), "warn", "MetaMask не найден");
        }
    }

    document.addEventListener("DOMContentLoaded", async () => {
        initUi();
        await loadConfig();
        // опціонально — одразу спробувати підключитись, якщо рахунки вже дозволені
        // (в деяких браузерах потрібна явна взаємодія користувача)
        try {
            if (window.ethereum?.selectedAddress || (window.ethereum?.isMetaMask && (await window.ethereum.request({ method: "eth_accounts" }))?.length)) {
                await connect();
            }
        } catch (_) {}
        // завантажимо список прив'язок
        loadMy();
    });
})();
