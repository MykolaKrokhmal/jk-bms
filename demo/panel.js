/*
 * JK BMS V2 demo — dev-only scenario panel.
 *
 * NOT part of production. jk_bms.js has no knowledge this file exists;
 * this only works because index.html loads it as a second <script> tag,
 * after jk_bms.js has already built the real DOM. It talks exclusively to
 * the /demo/* endpoints, which don't exist on a real device and are never
 * called by the production frontend.
 *
 * Deterministic review links: ?scenario=charging&writeMode=mismatch&theme=dark
 * apply on load, so a specific state can be reopened and compared later.
 */
(function () {
  "use strict";

  const THEME_KEY = "jkbms-theme"; // same key jk_bms.js's own theme code uses
  // Demo panel visibility is deliberately NOT persisted (collapsed/expanded
  // is a per-load default, not per-session state — see setCollapsed() below).
  // This is the old sessionStorage key from a prior pass; removed on every
  // init so a stale value from before this change can never influence
  // anything, even in a tab that already had it set.
  const STALE_COLLAPSE_KEY = "jkbms-demo-panel-collapsed";

  async function post(path, params) {
    await fetch(path + "?" + new URLSearchParams(params), { method: "POST" });
  }

  function applyThemeFromQuery(theme) {
    if (theme !== "light" && theme !== "dark" && theme !== "auto") return;
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    try { if (theme === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, theme); } catch (_) {}
  }

  function labelize(name) {
    return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async function init() {
    const query = new URLSearchParams(window.location.search);
    if (query.has("theme")) applyThemeFromQuery(query.get("theme"));

    let data;
    try { data = await (await fetch("/demo/state")).json(); }
    catch (_) { return; } // demo endpoints not reachable — silently skip, production UI still works standalone

    if (query.has("scenario")) { await post("/demo/scenario", { name: query.get("scenario") }); data.scenario = query.get("scenario"); }
    if (query.has("writeMode")) { await post("/demo/write-mode", { name: query.get("writeMode") }); data.writeMode = query.get("writeMode"); }

    const panel = document.createElement("div");
    panel.id = "demoPanel";
    // Starts collapsed in the markup itself (not via a post-append JS
    // toggle) so there is no expanded-then-collapsed flash — the very
    // first paint already shows the collapsed header only.
    panel.className = "collapsed";
    panel.innerHTML = `
      <style>
        #demoPanel{position:fixed;right:12px;bottom:12px;z-index:9999;width:230px;max-height:70vh;overflow:auto;
          font:12.5px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;background:#1b1e26;color:#e8eaee;
          border:1px solid rgba(255,255,255,.14);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.4);}
        #demoPanel *{box-sizing:border-box;}
        /* position:sticky is the actual fix (see init() comment below) — the
           header must stay reachable even when the body's own content
           (scenario/write-outcome/charge-history lists) is taller than the
           panel's 70vh cap and the user has scrolled inside it. */
        #demoPanel .dp-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;
          width:100%;min-height:32px;padding:8px 10px;border:0;border-bottom:1px solid rgba(255,255,255,.1);
          background:#1b1e26;color:inherit;font:inherit;font-weight:600;letter-spacing:.02em;cursor:pointer;text-align:left;}
        #demoPanel .dp-head:hover{background:#20242e;}
        #demoPanel .dp-head:focus-visible{outline:2px solid #5b8bf5;outline-offset:-2px;}
        #demoPanel .dp-toggle{display:flex;align-items:center;justify-content:center;width:20px;height:20px;flex:none;font-size:15px;line-height:1;}
        #demoPanel .dp-body{padding:8px 10px 10px;}
        #demoPanel.collapsed .dp-body{display:none;}
        @media (max-width:480px){ #demoPanel.collapsed{width:auto;min-width:132px;} }
        #demoPanel h4{margin:8px 0 4px;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#9aa0ab;}
        #demoPanel button{display:block;width:100%;margin:2px 0;padding:5px 7px;border:1px solid rgba(255,255,255,.14);
          border-radius:6px;background:#262b37;color:#e8eaee;text-align:left;cursor:pointer;font:inherit;}
        #demoPanel button:hover{border-color:rgba(255,255,255,.3);}
        #demoPanel button.active{background:#3a4a7a;border-color:#5b8bf5;color:#fff;}
        #demoPanel a{color:#8fb2ff;}
      </style>
      <button type="button" class="dp-head" id="dpHead" aria-expanded="false" aria-controls="dpBody" aria-label="Expand demo panel">
        <span>Demo panel</span><span class="dp-toggle" aria-hidden="true">&plus;</span>
      </button>
      <div class="dp-body" id="dpBody">
        <h4>Scenario</h4>
        <div class="dp-scenarios"></div>
        <h4>Write outcome (other registers)</h4>
        <div class="dp-writemodes"></div>
        <h4>Cell Count write outcome</h4>
        <div class="dp-cellcount-scenarios"></div>
        <h4>Physical topology (independent of the register)</h4>
        <div style="display:flex;gap:4px;align-items:center;margin:4px 0;">
          <input type="number" id="dpPhysicalCount" min="0" max="16" style="width:52px;padding:4px;border-radius:6px;border:1px solid rgba(255,255,255,.14);background:#262b37;color:#e8eaee;">
          <button type="button" id="dpPhysicalApply" style="flex:1;margin:0;">Set physical N</button>
        </div>
        <button type="button" id="dpBmsRestart">Simulate BMS restart</button>
        <h4>Charge history fixture</h4>
        <div class="dp-cchistory"></div>
        <h4 style="margin-top:10px">Link to this state</h4>
        <div class="dp-link" style="word-break:break-all;color:#9aa0ab;"></div>
      </div>`;
    document.body.appendChild(panel);

    function updateLink() {
      const u = new URL(window.location.href);
      u.search = "";
      u.searchParams.set("scenario", data.scenario);
      u.searchParams.set("writeMode", data.writeMode);
      const theme = document.documentElement.getAttribute("data-theme") || "auto";
      u.searchParams.set("theme", theme);
      panel.querySelector(".dp-link").textContent = u.toString();
    }

    function renderButtons(container, items, current, onPick) {
      container.innerHTML = "";
      items.forEach((name) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = labelize(name);
        b.className = name === current ? "active" : "";
        b.addEventListener("click", async () => { await onPick(name); refresh(); });
        container.appendChild(b);
      });
    }

    function refresh() {
      renderButtons(panel.querySelector(".dp-scenarios"), data.scenarios, data.scenario, async (name) => {
        await post("/demo/scenario", { name }); data.scenario = name;
      });
      renderButtons(panel.querySelector(".dp-writemodes"), data.writeModes, data.writeMode, async (name) => {
        await post("/demo/write-mode", { name }); data.writeMode = name;
      });
      renderButtons(panel.querySelector(".dp-cellcount-scenarios"), data.cellCountScenarios, data.cellCountScenario, async (name) => {
        await post("/demo/cellcount-scenario", { name }); data.cellCountScenario = name;
      });
      const physicalInput = panel.querySelector("#dpPhysicalCount");
      if (physicalInput && document.activeElement !== physicalInput) physicalInput.value = data.physicalTopologyCount;
      renderButtons(panel.querySelector(".dp-cchistory"), data.ccHistoryModes, data.ccHistoryMode, async (name) => {
        await post("/demo/cc-history", { name }); data.ccHistoryMode = name;
      });
      updateLink();
    }
    refresh();

    // Collapse/expand — a plain UI-state toggle (spec §8/§3), never
    // persisted: every fresh load/reload/new tab starts collapsed
    // (markup already sets this, setCollapsed(true) below just makes it
    // explicit/idempotent), and manual expand/collapse only ever affects
    // the current in-memory DOM state — never rebuilds the panel, never
    // touches scenario/write-mode/history-fixture data, and (deliberately,
    // per this pass) never writes anything to storage. Selected demo
    // scenario itself is a separate concern (server-side, via /demo/state)
    // and is untouched by any of this.
    const dpHead = panel.querySelector("#dpHead");
    const dpToggle = panel.querySelector(".dp-toggle");
    function setCollapsed(collapsed) {
      panel.classList.toggle("collapsed", collapsed);
      dpHead.setAttribute("aria-expanded", String(!collapsed));
      dpHead.setAttribute("aria-label", collapsed ? "Expand demo panel" : "Collapse demo panel");
      dpToggle.textContent = collapsed ? "+" : "−";
    }
    try { sessionStorage.removeItem(STALE_COLLAPSE_KEY); } catch (_) {} // a value saved before this pass must not leak in
    setCollapsed(true);

    dpHead.addEventListener("click", () => setCollapsed(!panel.classList.contains("collapsed")));

    // Physical topology and the CellCount register are deliberately two
    // separate controls (spec §10) — this button never touches the
    // register, only the simulated physical channel count/mask.
    panel.querySelector("#dpPhysicalApply")?.addEventListener("click", async () => {
      const count = Number(panel.querySelector("#dpPhysicalCount").value);
      if (!Number.isFinite(count) || count < 0 || count > 16) return;
      await post("/demo/physical-topology", { count });
      data.physicalTopologyCount = count;
      refresh();
    });
    panel.querySelector("#dpBmsRestart")?.addEventListener("click", async () => {
      await post("/demo/bms-restart", {});
    });
    // Optional (spec §10): Escape collapses only when focus is actually
    // inside this panel, so it can never intercept an Escape meant for
    // the production app's own overlays (cell trend modal, settings).
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || panel.classList.contains("collapsed")) return;
      setCollapsed(true);
      dpHead.focus();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
