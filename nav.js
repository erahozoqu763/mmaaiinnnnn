document.addEventListener("DOMContentLoaded", () => {
    const tabs = document.querySelectorAll(".nav .tab");
    if (!tabs.length) return;

    const file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    const hash = location.hash.toLowerCase();

    let current = "home";
    if (file === "index.html" || file === "") {
        current = (hash === "#mine") ? "mine" : "home";
    } else if (file === "wallet.html") {
        current = "wallet";
    } else if (file === "profile.html") {
        current = "profile";
    }

    tabs.forEach(a => {
        const isActive = a.dataset.tab === current;
        a.classList.toggle("active", isActive);
        a.setAttribute("aria-current", isActive ? "page" : "false");
    });
});
