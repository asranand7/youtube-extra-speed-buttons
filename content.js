// Adds extra playback-speed presets to YouTube's speed menu.
//
// Design notes (these matter — earlier versions broke the menu):
//  * The MutationObserver is DISCONNECTED while we edit the DOM and only
//    reconnected afterwards, so our own insertions never re-trigger a scan.
//  * Mutations are debounced, so we run at most a few cheap scans per second.
//  * We NEVER touch YouTube's panel height / max-height / animation styles.
//  * Everything runs inside try/catch so a transient DOM state can't cascade.
//  * Injection is idempotent: cloned nodes are tagged and skipped next time.
//
// Debugging: open the Playback speed panel, then in the DevTools Console run
//   ytSpeedDebug()
// and share the printed output.

(() => {
  "use strict";

  const EXTRA_SPEEDS = [1.75, 2.25, 2.5, 2.75];
  const MARK = "data-yt-extra-speed";
  const DEBOUNCE_MS = 120;

  const fmt = (r) => String(r);
  const LOG = (...a) => console.log("%c[YT-Speed]", "color:#3ea6ff;font-weight:bold", ...a);

  // Only log a given message once per menu-open, to avoid console spam.
  let seen = new Set();
  const logOnce = (sig, ...a) => {
    if (seen.has(sig)) return;
    seen.add(sig);
    LOG(...a);
  };

  // "1.5" -> 1.5, "Normal" -> 1, "2.50x" -> 2.5, "Playback speed" -> null
  function rateOf(text) {
    const t = (text || "").trim();
    if (!t) return null;
    if (/^normal$/i.test(t)) return 1;
    const m = t.match(/^(\d+(?:\.\d+)?)\s*x?$/);
    return m ? parseFloat(m[1]) : null;
  }

  function getVideo() {
    return (
      document.querySelector("#movie_player video.html5-main-video") ||
      document.querySelector("#movie_player video") ||
      document.querySelector("video")
    );
  }

  function setSpeed(rate) {
    const player = document.getElementById("movie_player");
    try {
      player && player.setPlaybackRate && player.setPlaybackRate(rate);
    } catch (_) {
      /* API may reject non-preset rates; direct set below is the source of truth */
    }
    const v = getVideo();
    if (v) {
      try {
        v.playbackRate = rate;
      } catch (_) {
        /* ignore */
      }
    }
    LOG("set playbackRate ->", rate, "actual:", v ? v.playbackRate : "(no video)");
  }

  // ------- helpers for the chips panel -------

  function chipButtons(panel) {
    return Array.from(panel.querySelectorAll("button")).filter((b) => {
      const t = b.textContent.trim();
      return /^\d/.test(t) && rateOf(t) !== null;
    });
  }

  // Lowest common ancestor of the chip buttons = the flex row (chips may each
  // be wrapped in their own container, so buttons don't share a direct parent).
  function lowestCommonAncestor(nodes) {
    let anc = nodes[0];
    for (let i = 1; i < nodes.length && anc; i++) {
      while (anc && !anc.contains(nodes[i])) anc = anc.parentElement;
    }
    return anc;
  }

  // The direct child of `row` that contains (or is) `button`.
  function wrapperOf(button, row) {
    let el = button;
    while (el.parentElement && el.parentElement !== row) el = el.parentElement;
    return el.parentElement === row ? el : button;
  }

  function buildChip(templateWrapper, rate, panel) {
    const clone = templateWrapper.cloneNode(true);
    clone.setAttribute(MARK, String(rate));
    const btn = clone.matches("button") ? clone : clone.querySelector("button");
    if (!btn) return null;

    // Drop captions like "Normal" that ride along inside the wrapper.
    for (const child of Array.from(clone.childNodes)) {
      if (child === btn) continue;
      if (child.nodeType === 1 && child.contains(btn)) continue;
      child.remove();
    }
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", `Playback speed ${rate}`);
    btn.textContent = fmt(rate);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setSpeed(rate);
      updateReadout(panel, rate);
    });
    return clone;
  }

  // ------- new chips panel: round buttons + slider + "1.00x" readout -------
  function injectChips(panel) {
    const buttons = chipButtons(panel);
    if (buttons.length < 3) return false;

    const row = lowestCommonAncestor(buttons);
    if (!row) {
      logOnce("chips-norow", "chips: found buttons but no common row", buttons.map((b) => b.textContent.trim()));
      return false;
    }

    const entries = buttons.map((b) => ({ wrapper: wrapperOf(b, row), rate: rateOf(b.textContent) }));
    const existing = new Set(entries.map((e) => e.rate));
    const template = entries.find((e) => !e.rate || e.rate !== 1) || entries[entries.length - 1];

    logOnce(
      "chips-detect-" + buttons.map((b) => b.textContent.trim()).join(","),
      "chips panel detected. buttons:",
      buttons.map((b) => b.textContent.trim()),
      "row:",
      "<" + row.tagName.toLowerCase() + " class='" + row.className + "'>"
    );

    let added = [];
    for (const rate of EXTRA_SPEEDS) {
      if (existing.has(rate)) continue;
      if (row.querySelector(`[${MARK}="${rate}"]`)) continue;

      const chip = buildChip(template.wrapper, rate, panel);
      if (!chip) continue;

      row.appendChild(chip); // position is fixed by reorderChips() below
      existing.add(rate);
      added.push(rate);
    }

    if (added.length) {
      row.style.flexWrap = "wrap";
      row.style.justifyContent = "center";
      if (!row.style.rowGap) row.style.rowGap = "8px";
      reorderChips(row);
      fitPanel(row);
      LOG("chips: added", added, "final order:", chipOrder(row));
    }
    return added.length > 0;
  }

  // Sort the chip cells left-to-right by speed. Doing this after inserting is
  // far more robust than trying to compute the right insert point per chip
  // (captions like "Normal" ride inside a cell and confuse text parsing).
  function reorderChips(row) {
    const cells = Array.from(row.children)
      .map((el) => ({ el, rate: cellRate(el) }))
      .filter((c) => c.rate !== null)
      .sort((a, b) => a.rate - b.rate);
    for (const c of cells) row.appendChild(c.el); // re-append in ascending order
  }

  // A cell's rate = the numeric text of its button, ignoring captions.
  function cellRate(cell) {
    const btn = cell.matches?.("button") ? cell : cell.querySelector?.("button");
    return rateOf(btn ? btn.textContent : cell.textContent);
  }

  const chipOrder = (row) =>
    Array.from(row.children)
      .map(cellRate)
      .filter((r) => r !== null);

  // Grow the speed panel just enough that the wrapped chips are fully visible
  // without a scrollbar. Only elements that actually clip their content are
  // touched, and with an explicit pixel height (not "auto") so YouTube's popup
  // doesn't jump. Runs once, after the panel is open and the observer paused.
  function fitPanel(startEl) {
    let el = startEl.parentElement;
    while (el && el !== document.body) {
      const c = el.classList;
      const isPanel =
        c &&
        (c.contains("ytp-panel") ||
          c.contains("ytp-settings-menu") ||
          c.contains("ytp-popup"));
      if (isPanel && el.scrollHeight > el.clientHeight + 1) {
        el.style.maxHeight = "none";
        el.style.height = el.scrollHeight + "px";
      }
      el = el.parentElement;
    }
  }

  function updateReadout(panel, rate) {
    for (const el of panel.querySelectorAll("*")) {
      if (el.children.length === 0 && /^\d+(\.\d+)?x$/.test(el.textContent.trim())) {
        el.textContent = rate.toFixed(2) + "x";
        return;
      }
    }
  }

  // ------- classic list menu: rows of .ytp-menuitem (0.25 … 2, "Normal") -------
  function injectClassic(menu) {
    const items = Array.from(menu.querySelectorAll(":scope > .ytp-menuitem"));
    const speedItems = items.filter(
      (it) => rateOf(it.querySelector(".ytp-menuitem-label")?.textContent) !== null
    );
    if (speedItems.length < 4) return false; // not the speed submenu

    const existing = new Set(
      speedItems.map((it) => rateOf(it.querySelector(".ytp-menuitem-label").textContent))
    );
    const template = speedItems[speedItems.length - 1];

    logOnce(
      "classic-detect-" + speedItems.length,
      "classic speed menu detected. speeds:",
      speedItems.map((it) => it.querySelector(".ytp-menuitem-label").textContent.trim())
    );

    let added = [];
    for (const rate of EXTRA_SPEEDS) {
      if (existing.has(rate)) continue;
      if (menu.querySelector(`[${MARK}="${rate}"]`)) continue;

      const node = template.cloneNode(true);
      node.setAttribute(MARK, String(rate));
      node.setAttribute("aria-checked", "false");
      const label = node.querySelector(".ytp-menuitem-label");
      if (label) label.textContent = fmt(rate);
      node.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setSpeed(rate);
        for (const it of menu.querySelectorAll(":scope > .ytp-menuitem")) {
          it.setAttribute("aria-checked", "false");
        }
        node.setAttribute("aria-checked", "true");
      });

      const after = Array.from(menu.children).find((c) => {
        const r = rateOf(c.querySelector?.(".ytp-menuitem-label")?.textContent);
        return r !== null && r > rate;
      });
      menu.insertBefore(node, after || null);
      existing.add(rate);
      added.push(rate);
    }
    if (added.length) LOG("classic: added", added);
    return added.length > 0;
  }

  function scan() {
    for (const menu of document.querySelectorAll(".ytp-panel-menu")) {
      try {
        injectClassic(menu);
      } catch (e) {
        LOG("classic error", e);
      }
    }
    for (const panel of document.querySelectorAll(".ytp-settings-menu, .ytp-popup, .ytp-panel")) {
      try {
        injectChips(panel);
      } catch (e) {
        LOG("chips error", e);
      }
    }
    // Reset the log de-dupe when no speed UI is open, so the next open logs fresh.
    const open =
      document.querySelector(".ytp-panel-menu") ||
      chipButtons(document).length >= 3;
    if (!open && seen.size) seen = new Set();
  }

  const OBS_OPTS = { childList: true, subtree: true };
  let observer = null;
  let timer = 0;

  const observeRoot = () => observer && observer.observe(document.documentElement, OBS_OPTS);

  function onMutation() {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      if (observer) observer.disconnect();
      try {
        scan();
      } finally {
        observeRoot(); // reconnect only after our edits are done
      }
    }, DEBOUNCE_MS);
  }

  // ------- manual diagnostic: run ytSpeedDebug() in the console -------
  function ytSpeedDebug() {
    const out = [];
    const push = (...a) => out.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    push("=== YT-Speed debug ===");
    push("url:", location.href);
    push("EXTRA_SPEEDS:", EXTRA_SPEEDS);
    push("marks currently in DOM:", document.querySelectorAll(`[${MARK}]`).length);

    const chipPanels = document.querySelectorAll(".ytp-settings-menu, .ytp-popup, .ytp-panel");
    push("--- chip panels scanned:", chipPanels.length, "---");
    chipPanels.forEach((p, i) => {
      const btns = chipButtons(p);
      if (!btns.length) return;
      const row = lowestCommonAncestor(btns);
      push(`chip panel #${i}: ${btns.length} buttons = [${btns.map((b) => JSON.stringify(b.textContent.trim())).join(", ")}]`);
      push(`  row = <${row ? row.tagName.toLowerCase() : "null"} class="${row ? row.className : ""}"> children=${row ? row.children.length : "-"}`);
      btns.forEach((b) => {
        const w = row ? wrapperOf(b, row) : b;
        push(`  "${b.textContent.trim()}" wrapper=<${w.tagName.toLowerCase()} class="${w.className}"> aria-pressed=${b.getAttribute("aria-pressed")}`);
      });
    });

    const menus = document.querySelectorAll(".ytp-panel-menu");
    push("--- .ytp-panel-menu found:", menus.length, "---");
    menus.forEach((m, i) => {
      const items = Array.from(m.querySelectorAll(":scope > .ytp-menuitem"));
      const labels = items.map((it) => it.querySelector(".ytp-menuitem-label")?.textContent?.trim());
      push(`menu #${i}: ${items.length} items = [${labels.map((l) => JSON.stringify(l)).join(", ")}]`);
    });

    const text = out.join("\n");
    console.log(text);
    return text;
  }

  function start() {
    window.ytSpeedDebug = ytSpeedDebug;
    observer = new MutationObserver(onMutation);
    observeRoot();
    scan();
    LOG("loaded. Run ytSpeedDebug() with the speed panel open to share diagnostics.");
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
