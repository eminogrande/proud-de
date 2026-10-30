// Page-by-page reader. Pure view helpers are exported for tests, init runs only in a browser.
// Reading order: page 1 alone, then facing pairs, last page alone when the count is even.

const FADE = 75;

export function clampPage(value, pageCount) {
  const count = Math.max(1, Number(pageCount) || 1);
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    return 1;
  }
  return Math.min(Math.max(n, 1), count);
}

export function viewFor(page, pageCount, pair) {
  const count = Math.max(1, Number(pageCount) || 1);
  const n = clampPage(page, count);
  if (!pair || n <= 1) {
    return [n];
  }
  const left = n % 2 === 0 ? n : n - 1;
  return left + 1 <= count ? [left, left + 1] : [left];
}

export function nextView(view, pageCount, pair) {
  const count = Math.max(1, Number(pageCount) || 1);
  const last = view[view.length - 1] ?? 1;
  return viewFor(Math.min(last + 1, count), count, pair);
}

export function prevView(view, pageCount, pair) {
  const count = Math.max(1, Number(pageCount) || 1);
  const first = view[0] ?? 1;
  return viewFor(Math.max(first - 1, 1), count, pair);
}

export function parsePageParam(raw, pageCount) {
  return clampPage(raw ?? 1, pageCount);
}

function fill(template, values) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

function init(section) {
  const count = Number(section.dataset.pageCount) || 1;
  const title = section.dataset.title || "";
  const pageAlt = section.dataset.pageAlt || "";
  const counterSingle = section.dataset.counterSingle || "{a}";
  const counterPair = section.dataset.counterPair || "{a}-{b}";
  const stage = section.querySelector(".reader-stage");
  const spread = section.querySelector(".reader-spread");
  const counter = section.querySelector(".reader-counter");
  const slider = section.querySelector(".reader-slider");
  const dialog = section.querySelector("#reader-grid");
  const gridOpen = section.querySelector(".reader-grid-open");
  const gridClose = section.querySelector(".reader-grid-close");
  const pages = [...section.querySelectorAll(".reader-pages li img")].map((img) => ({
    src: img.getAttribute("src"),
    srcset: img.getAttribute("srcset"),
    sizes: img.getAttribute("sizes"),
    w: img.getAttribute("width"),
    h: img.getAttribute("height"),
  }));
  if (!stage || !spread || !counter || pages.length === 0) {
    return;
  }

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let current = 1;
  let timer = 0;
  let preloaded = [];

  const isPair = () => stage.clientWidth >= 900 && stage.clientWidth > stage.clientHeight;

  function preload(view) {
    const last = view[view.length - 1] ?? count;
    if (last >= count) {
      return;
    }
    preloaded = nextView(view, count, isPair()).map((n) => {
      const page = pages[n - 1];
      const img = new Image();
      img.sizes = page.sizes;
      img.srcset = page.srcset;
      img.src = page.src;
      return img;
    });
  }

  function paint() {
    const pair = isPair();
    const view = viewFor(current, count, pair);
    section.dataset.mode = pair ? "pair" : "single";
    section.dataset.pair = String(view.length > 1);
    spread.replaceChildren(
      ...view.map((n) => {
        const page = pages[n - 1];
        const img = document.createElement("img");
        img.src = page.src;
        img.srcset = page.srcset;
        img.sizes = page.sizes;
        img.width = page.w;
        img.height = page.h;
        img.decoding = "async";
        img.alt = `${title}, ${pageAlt} ${n}`;
        return img;
      }),
    );
    const label = view.length > 1
      ? fill(counterPair, { a: view[0], b: view[1], n: count })
      : fill(counterSingle, { a: view[0], n: count });
    counter.textContent = label;
    if (slider) {
      slider.value = String(current);
      slider.setAttribute("aria-valuetext", label);
    }
    const url = new URL(location.href);
    url.searchParams.set("page", String(current));
    history.replaceState(null, "", url);
    preload(view);
  }

  function go(page) {
    current = clampPage(page, count);
    if (motion.matches) {
      paint();
      return;
    }
    spread.classList.add("is-turning");
    clearTimeout(timer);
    timer = setTimeout(() => {
      paint();
      spread.classList.remove("is-turning");
    }, FADE);
  }

  function step(direction) {
    const view = viewFor(current, count, isPair());
    const target = direction > 0 ? nextView(view, count, isPair()) : prevView(view, count, isPair());
    go(target[0]);
  }

  function onKey(event) {
    if (dialog?.open) {
      return;
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName ?? "")) {
      return;
    }
    switch (event.key) {
      case "ArrowRight":
      case "PageDown":
        step(1);
        break;
      case "ArrowLeft":
      case "PageUp":
        step(-1);
        break;
      case " ":
        step(event.shiftKey ? -1 : 1);
        break;
      case "Home":
        go(1);
        break;
      case "End":
        go(count);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  let startX = 0;
  let startY = 0;
  let pointerId = null;

  stage.addEventListener("pointerdown", (event) => {
    if (window.visualViewport && window.visualViewport.scale > 1.01) {
      return;
    }
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
  });

  stage.addEventListener("pointerup", (event) => {
    if (pointerId !== event.pointerId) {
      return;
    }
    pointerId = null;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      step(dx < 0 ? 1 : -1);
    }
  });

  section.querySelector(".reader-prev")?.addEventListener("click", () => step(-1));
  section.querySelector(".reader-next")?.addEventListener("click", () => step(1));
  section.querySelector(".reader-first")?.addEventListener("click", () => go(1));
  section.querySelector(".reader-last")?.addEventListener("click", () => go(count));
  slider?.addEventListener("input", () => {
    current = viewFor(slider.value, count, isPair())[0];
    paint();
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(paint, 150);
  });

  document.addEventListener("keydown", onKey);

  if (dialog) {
    gridOpen?.addEventListener("click", () => {
      dialog.showModal();
      for (const button of dialog.querySelectorAll("button[data-page]")) {
        if (button.dataset.page === String(viewFor(current, count, isPair())[0])) {
          button.setAttribute("aria-current", "true");
        } else {
          button.removeAttribute("aria-current");
        }
      }
      dialog.querySelector('button[aria-current="true"]')?.focus();
    });
    gridClose?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
      const button = event.target.closest?.("button[data-page]");
      if (button) {
        go(Number(button.dataset.page));
        dialog.close();
      }
    });
    dialog.addEventListener("close", () => gridOpen?.focus());
  }

  const params = new URLSearchParams(location.search);
  current = parsePageParam(params.get("page") ?? section.dataset.startPage, count);
  section.dataset.enhanced = "true";
  paint();
  // The first paint can run before the stylesheet is applied, when the stage has no height yet.
  requestAnimationFrame(paint);
  window.addEventListener("load", paint, { once: true });
}

function boot() {
  const section = document.querySelector(".reader");
  if (section) {
    init(section);
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}
