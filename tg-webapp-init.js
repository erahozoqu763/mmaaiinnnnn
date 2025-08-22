(function () {
    "use strict";

    // Працюємо лише всередині Telegram
    var tg = (window.Telegram && Telegram.WebApp) ? Telegram.WebApp : null;
    if (!tg) return;

    try { tg.ready(); } catch (_) {}

    // 1) Одразу розгортаємо на повний екран
    try { tg.expand(); } catch (_) {}

    // 2) Якщо юзер/Telegram змінює вікно — знову розгортаємо
    try {
        tg.onEvent("viewportChanged", function () {
            if (!tg.isExpanded) {
                try { tg.expand(); } catch (_) {}
            }
        });
    } catch (_) {}

    // 3) Вимикаємо вертикальні свайпи, щоб не було "лінії згортання" знизу
    try {
        if (typeof tg.disableVerticalSwipes === "function") {
            tg.disableVerticalSwipes();
        }
    } catch (_) {}

    // 4) Показуємо системну кнопку «Назад/Закрити» в хедері Telegram
    try {
        if (tg.BackButton && typeof tg.BackButton.show === "function") {
            tg.BackButton.show();
            tg.BackButton.onClick(function () {
                try { tg.close(); } catch (_) {}
            });
        }
    } catch (_) {}

    // (необов'язково) Підігнати кольори під тему Telegram
    try {
        tg.setHeaderColor("secondary_bg_color");
        // Можеш поставити свій фон, якщо треба:
        // tg.setBackgroundColor("#0d111a");
    } catch (_) {}

    // 5) Трішки UX: додаємо safe-area для нижньої навігації
    try {
        var root = document.documentElement;
        // iOS safe area
        root.style.setProperty("--safe-bottom", (window.visualViewport && window.visualViewport.height ? "env(safe-area-inset-bottom)" : "0px"));
    } catch (_) {}
})();
