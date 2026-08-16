// Runs on every page. Highlight (drag-select or double-click) any Chinese
// text and a popup shows its definition — same interaction as the in-app
// reader/chatbot popup, minus hover: there's no reliable word tokenization
// on arbitrary third-party DOM, so this always looks up exactly what you
// selected. If that span isn't a single dictionary headword, the server
// decomposes it into its constituent words (`parts`) and this renders each
// one as its own row.
(() => {
  const HANZI_RE = /[一-鿿㐀-䶿]/;

  let hostEl = null;
  let shadow = null;
  let cardEl = null;
  let config = { serverUrl: "", connected: false, savedWords: {} };
  const cache = new Map(); // hanzi -> lookup result, cleared on page load (fresh module scope)

  function ensureHost() {
    if (hostEl) return;
    hostEl = document.createElement("div");
    hostEl.id = "smartmandarin-popup-host";
    hostEl.style.all = "initial";
    document.documentElement.appendChild(hostEl);
    shadow = hostEl.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .card {
        position: fixed;
        z-index: 2147483647;
        max-width: 280px;
        max-height: calc(100vh - 16px);
        overflow-y: auto;
        padding: 10px 12px;
        border-radius: 12px;
        background: #171717;
        color: #fff;
        box-shadow: 0 12px 32px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.1);
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: grab;
        touch-action: none;
        user-select: none;
      }
      .card.dragging { cursor: grabbing; }
      .word { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
      .loading, .empty { color: rgba(255,255,255,.5); font-style: italic; }
      .rows { display: flex; flex-direction: column; gap: 6px; }
      .row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
      .row .text { min-width: 0; flex: 1; }
      .partword-link { border-radius: 6px; margin: -3px -4px; padding: 3px 4px; }
      .partword-link:hover { background: rgba(255,255,255,.08); }
      .pinyin { color: #c4b5fd; font-size: 12px; }
      .meaning { color: rgba(255,255,255,.9); font-size: 12px; }
      .partword { color: rgba(255,255,255,.55); font-size: 11px; margin-bottom: 1px; }
      .queue-btn {
        flex-shrink: 0; width: 20px; height: 20px; border-radius: 999px; border: none;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 700; line-height: 1; color: #fff; cursor: pointer;
      }
      .queue-btn.add { background: rgba(139,92,246,.9); }
      .queue-btn.add:hover { background: rgba(139,92,246,1); }
      .queue-btn.remove { background: rgba(239,68,68,.9); }
      .queue-btn.remove:hover { background: rgba(239,68,68,1); }
      .ai-note { margin-top: 6px; font-size: 10px; color: rgba(251,191,36,.8); }
      .connect-note { margin-top: 6px; font-size: 10px; color: rgba(255,255,255,.45); }
      .hint { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.12); font-size: 10px; color: rgba(255,255,255,.4); }
    `;
    shadow.appendChild(style);
  }

  function hideCard() {
    if (cardEl) {
      cardEl.remove();
      cardEl = null;
    }
  }

  function positionCard(el, rect) {
    const margin = 8;
    const preferBelow = rect.top < 90;
    el.style.left = `${rect.left + rect.width / 2}px`;
    el.style.top = preferBelow ? `${rect.bottom + margin}px` : `${rect.top - margin}px`;
    el.style.transform = preferBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)";
    clampCardPosition(el);
  }

  // Nudges the card back inside the viewport based on its *actual* rendered
  // size — called again after content replaces the loading placeholder,
  // since a long decomposed-word list (many parts, each with multiple
  // senses) can grow well past what fit at the initial guess. Deltas are
  // additive on top of whatever position is already live, so repeat calls
  // as content grows keep it correct instead of re-deriving from scratch.
  function clampCardPosition(el) {
    const margin = 8;
    const r = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (r.left < margin) dx = margin - r.left;
    else if (r.right > window.innerWidth - margin) dx = window.innerWidth - margin - r.right;
    if (r.top < margin) dy = margin - r.top;
    else if (r.bottom > window.innerHeight - margin) dy = window.innerHeight - margin - r.bottom;
    if (dx) el.style.left = `${(parseFloat(el.style.left) || 0) + dx}px`;
    if (dy) el.style.top = `${(parseFloat(el.style.top) || 0) + dy}px`;
  }

  // Drag-to-move: pointerdown on the card body (not a queue button) grabs it;
  // dropping off the anchor-centered transform in favor of plain top-left so
  // it can just follow the cursor. A short move threshold before treating it
  // as a drag (rather than a click) keeps "click to open full word page"
  // working for an actual click.
  function makeDraggable(el) {
    let dragging = false;
    let dragged = false;
    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;

    el.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest(".queue-btn")) return;
      // Same reason as .queue-btn: capturing the pointer here means the
      // *click* event that follows gets dispatched at the card itself
      // instead of the part row actually under the cursor, so its own
      // stopPropagation()+openWordPage(row.word) handler never runs and the
      // click silently falls through to the card's whole-chunk handler.
      if (e.target.closest(".partword-link")) return;
      dragging = true;
      dragged = false;
      const r = el.getBoundingClientRect();
      el.style.left = `${r.left}px`;
      el.style.top = `${r.top}px`;
      el.style.transform = "none";
      baseLeft = r.left;
      baseTop = r.top;
      startX = e.clientX;
      startY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragged && Math.hypot(dx, dy) > 4) {
        dragged = true;
        el.classList.add("dragging");
      }
      if (dragged) {
        el.style.left = `${baseLeft + dx}px`;
        el.style.top = `${baseTop + dy}px`;
      }
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("dragging");
      el.releasePointerCapture(e.pointerId);
      if (dragged) clampCardPosition(el);
    }
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);

    // Registered before the click-to-open-word-page listener so it can veto
    // it via stopImmediatePropagation — at the target element, listeners run
    // in registration order regardless of capture/bubble phase.
    el.addEventListener("click", (e) => {
      if (dragged) {
        e.stopImmediatePropagation();
        e.preventDefault();
        dragged = false;
      }
    });
  }

  function openWordPage(word) {
    if (!config.serverUrl) return;
    window.open(`${config.serverUrl.replace(/\/+$/, "")}/vocab/word/${encodeURIComponent(word)}`, "_blank", "noopener");
  }

  function isSaved(word, pinyin, meaning) {
    const rows = config.savedWords[word] || [];
    return rows.find((r) => r.pinyin === pinyin && r.meaning === meaning) || null;
  }

  function toggleQueue(row, btn) {
    const saved = isSaved(row.word, row.pinyin, row.meaning);
    const action = saved ? "remove" : "add";
    btn.disabled = true;
    chrome.runtime.sendMessage(
      {
        type: "queue",
        payload: {
          hanzi: row.word,
          pinyin: row.pinyin,
          meaning: row.meaning,
          hsk_level: row.hsk_level ?? null,
          id: saved?.id,
          action,
        },
      },
      (res) => {
        btn.disabled = false;
        if (!res?.ok) return;
        // Keep local config.savedWords in sync so re-opening reflects it immediately.
        const rows = config.savedWords[row.word] || [];
        if (action === "add") {
          rows.push({ id: "", pinyin: row.pinyin, meaning: row.meaning, hsk_level: row.hsk_level ?? null });
        } else {
          const idx = rows.findIndex((r) => r.pinyin === row.pinyin && r.meaning === row.meaning);
          if (idx !== -1) rows.splice(idx, 1);
        }
        config.savedWords[row.word] = rows;
        btn.textContent = action === "add" ? "–" : "+";
        btn.className = `queue-btn ${action === "add" ? "remove" : "add"}`;
        btn.title = action === "add" ? "Remove from review" : "Queue for review";
      }
    );
  }

  // rows: [{ word, pinyin, meaning, hsk_level, isPart }]
  function renderRows(rows) {
    const wrap = document.createElement("div");
    wrap.className = "rows";
    for (const row of rows) {
      const rowEl = document.createElement("div");
      rowEl.className = "row";

      const textEl = document.createElement("div");
      textEl.className = "text";
      if (row.isPart) {
        const w = document.createElement("div");
        w.className = "partword";
        w.textContent = row.word;
        textEl.appendChild(w);
      }
      if (row.pinyin) {
        const p = document.createElement("div");
        p.className = "pinyin";
        p.textContent = row.pinyin;
        textEl.appendChild(p);
      }
      const m = document.createElement("div");
      m.className = "meaning";
      m.textContent = row.meaning || "";
      textEl.appendChild(m);

      if (row.isPart) {
        // A decomposed part is its own word — clicking it should open *its*
        // full word page, not the original multi-char chunk's (that's what
        // the card's own click handler / hint at the bottom already does).
        textEl.classList.add("partword-link");
        textEl.addEventListener("click", (e) => {
          e.stopPropagation();
          openWordPage(row.word);
        });
      }
      rowEl.appendChild(textEl);

      if (config.connected && (row.pinyin || row.meaning)) {
        const saved = isSaved(row.word, row.pinyin, row.meaning);
        const btn = document.createElement("button");
        btn.className = `queue-btn ${saved ? "remove" : "add"}`;
        btn.textContent = saved ? "–" : "+";
        btn.title = saved ? "Remove from review" : "Queue for review";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleQueue(row, btn);
        });
        rowEl.appendChild(btn);
      }

      wrap.appendChild(rowEl);
    }
    return wrap;
  }

  function renderResult(word, result) {
    cardEl.innerHTML = "";
    const wordEl = document.createElement("div");
    wordEl.className = "word";
    wordEl.textContent = word;
    cardEl.appendChild(wordEl);

    if (!result || result.error) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = (result && result.error) || "Lookup failed";
      cardEl.appendChild(e);
      return;
    }

    if (result.parts && result.parts.length > 0) {
      // A part with multiple CEDICT senses (e.g. 乘 as Chéng/chéng/shèng)
      // gets one row per sense instead of collapsing to just the first —
      // otherwise the other readings are silently dropped from the popup.
      const rows = result.parts.flatMap((p) =>
        p.senses && p.senses.length > 0
          ? p.senses.map((s) => ({ word: p.word, pinyin: s.pinyin, meaning: s.meaning, hsk_level: s.hsk_level, isPart: true }))
          : [{ word: p.word, pinyin: p.pinyin, meaning: p.meaning, hsk_level: p.hsk_level, isPart: true }]
      );
      cardEl.appendChild(renderRows(rows));
    } else if (result.senses && result.senses.length > 0) {
      cardEl.appendChild(
        renderRows(result.senses.map((s) => ({ word, pinyin: s.pinyin, meaning: s.meaning, hsk_level: s.hsk_level })))
      );
    } else if (result.pinyin || result.meaning) {
      cardEl.appendChild(renderRows([{ word, pinyin: result.pinyin, meaning: result.meaning, hsk_level: result.hsk_level }]));
    } else {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = "Not in dictionary";
      cardEl.appendChild(e);
    }

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Click to open full word page →";
    cardEl.appendChild(hint);

    clampCardPosition(cardEl);
  }

  function showCard(word, rect) {
    ensureHost();
    hideCard();
    cardEl = document.createElement("div");
    cardEl.className = "card";
    positionCard(cardEl, rect);
    makeDraggable(cardEl);
    cardEl.addEventListener("click", () => openWordPage(word));
    shadow.appendChild(cardEl);

    const loading = document.createElement("div");
    loading.className = "loading";
    loading.textContent = "…";
    cardEl.innerHTML = "";
    const wordEl = document.createElement("div");
    wordEl.className = "word";
    wordEl.textContent = word;
    cardEl.appendChild(wordEl);
    cardEl.appendChild(loading);

    if (!config.connected) {
      const note = document.createElement("div");
      note.className = "connect-note";
      note.textContent = "Connect your account in the extension settings to save words.";
      cardEl.appendChild(note);
    }

    clampCardPosition(cardEl);

    if (cache.has(word)) {
      renderResult(word, cache.get(word));
      return;
    }

    // chrome.runtime.sendMessage throws synchronously (not via the callback)
    // once the extension has been reloaded/updated and this content script's
    // context is stale — any tab that was open before the reload hits this
    // on its first lookup. Catch it and point at the fix instead of an
    // uncaught error + a card stuck on "…" forever.
    try {
      chrome.runtime.sendMessage({ type: "lookup", hanzi: word }, (res) => {
        if (!cardEl) return; // dismissed while waiting
        if (!res?.ok) {
          const detail =
            res?.reason === "not-configured"
              ? "Extension not connected — open Settings"
              : res?.reason === "network"
              ? `Can't reach server: ${res.message || "network error"}`
              : res?.reason === "api-error"
              ? `Server error ${res.status ?? ""}${res.message ? ": " + res.message : ""}`
              : chrome.runtime.lastError
              ? chrome.runtime.lastError.message
              : "Lookup failed";
          renderResult(word, { error: detail });
          return;
        }
        cache.set(word, res.data);
        renderResult(word, res.data);
      });
    } catch (e) {
      // Expected, not a bug: this tab's content script predates the
      // extension's last reload/update, so its runtime context is stale.
      // Already fully handled (the card shows a "reload this page" message
      // below) — console.warn instead of console.error so it doesn't show
      // up as a red error in chrome://extensions for a condition we already
      // recovered from.
      console.warn("[SmartMandarin] sendMessage threw synchronously:", e);
      renderResult(word, { error: "Extension was updated — reload this page and try again" });
    }
  }

  function extractHanziSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const raw = sel.toString();
    if (!HANZI_RE.test(raw)) return null;
    const hanzi = Array.from(raw).filter((c) => HANZI_RE.test(c)).join("");
    if (!hanzi) return null;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return { hanzi, rect };
  }

  function onSelectionFinished() {
    // Selection landing inside our own popup shouldn't retrigger anything.
    if (cardEl && shadow?.contains(document.activeElement)) return;
    const picked = extractHanziSelection();
    if (!picked) return;
    showCard(picked.hanzi, picked.rect);
  }

  document.addEventListener("mouseup", (e) => {
    if (hostEl && e.composedPath().includes(hostEl)) return;
    setTimeout(onSelectionFinished, 0);
  });

  document.addEventListener("pointerdown", (e) => {
    if (!cardEl) return;
    if (hostEl && e.composedPath().includes(hostEl)) return;
    hideCard();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideCard();
  });

  // Deliberately no scroll-to-dismiss — the card is `position: fixed`, so it
  // just stays put on screen while the page scrolls under it instead of
  // tracking the original selection. Only a click outside it (pointerdown
  // listener above) or Escape closes it now.

  function loadConfig() {
    chrome.runtime.sendMessage({ type: "getConfig" }, (res) => {
      if (res) config = res;
    });
  }
  loadConfig();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.serverUrl || changes.token || changes.savedWords)) loadConfig();
  });
})();
