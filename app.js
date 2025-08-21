(function () {
    "use strict";

    // Проставляємо active для поточної вкладки
    function setActiveTab() {
        const tabs = document.querySelectorAll(".tab");
        const path = location.pathname.split("/").pop() || "index.html";

        tabs.forEach(tab => tab.classList.remove("active"));

        let matched = false;
        tabs.forEach(tab => {
            const href = tab.getAttribute("href");
            if (!matched && href && path === href) {
                tab.classList.add("active");
                tab.setAttribute("aria-current", "page");
                matched = true;
            } else {
                tab.removeAttribute("aria-current");
            }
        });

        // Якщо це якор (напр. index.html#mine) — підсвітимо "Майнинг"
        if (!matched && location.hash && location.pathname.endsWith("index.html")) {
            const mineTab = document.querySelector('.tab[data-tab="mine"]');
            if (mineTab) {
                mineTab.classList.add("active");
                mineTab.setAttribute("aria-current", "page");
            }
        }

        // Якщо головна відкривається як "/" без файлу — підсвітити home
        if (!matched && (path === "" || path === "/")) {
            const homeTab = document.querySelector('.tab[data-tab="home"]');
            if (homeTab) {
                homeTab.classList.add("active");
                homeTab.setAttribute("aria-current", "page");
            }
        }
    }

    document.addEventListener("DOMContentLoaded", setActiveTab);
})();
