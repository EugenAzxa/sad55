/* АМЦ - shared interactions */
(function () {
  "use strict";

  /* sticky header */
  var header = document.getElementById("header");
  var onScroll = function () {
    header.classList.toggle("scrolled", window.scrollY > 8);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* mobile menu */
  var burger = document.getElementById("burger");
  var menu = document.getElementById("mobile-menu");
  if (burger && menu) {
    burger.addEventListener("click", function () {
      var open = menu.classList.toggle("open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        menu.classList.remove("open");
        burger.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* accessibility mode: larger text, higher contrast, and the page read aloud in Russian */
  var root = document.documentElement;
  var a11yBtn = document.getElementById("a11y-toggle");
  var a11yBar = document.getElementById("a11y-bar");

  var store = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  var load = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };

  var setFont = function (level) {
    root.classList.remove("a11y-f1", "a11y-f2", "a11y-f3");
    root.classList.add("a11y-f" + level);
    store("amc-a11y-font", String(level));
    document.querySelectorAll(".a11y-f").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-font") === String(level) ? "true" : "false");
    });
  };

  var setA11y = function (on) {
    root.classList.toggle("a11y", on);
    root.classList.toggle("a11y-bar-on", on);
    if (a11yBar) a11yBar.hidden = !on;
    if (a11yBtn) a11yBtn.setAttribute("aria-pressed", on ? "true" : "false");
    store("amc-a11y", on ? "1" : "0");
    if (!on) stopSpeech();
  };

  /* ---- read the page aloud (ru-RU) ---- */

  var synth = window.speechSynthesis;
  var speakBtn = document.getElementById("a11y-speak");
  var speakText = document.getElementById("a11y-speak-text");
  var stopBtn = document.getElementById("a11y-stop");
  var queue = [];
  var qi = 0;
  var marked = null;
  var keepAlive = null;

  var ruVoice = function () {
    if (!synth) return null;
    var vs = synth.getVoices() || [];
    for (var i = 0; i < vs.length; i++) {
      if (/^ru/i.test(vs[i].lang)) return vs[i];
    }
    return null;
  };

  var mark = function (el) {
    if (marked) marked.classList.remove("a11y-reading");
    marked = el || null;
    if (marked) {
      marked.classList.add("a11y-reading");
      try { marked.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {}
    }
  };

  /* visible prose, in reading order, skipping anything already covered by an ancestor */
  var buildQueue = function () {
    var scope = document.querySelector("main") || document.body;
    var picked = [];
    scope.querySelectorAll("h1, h2, h3, h4, p, li, blockquote, figcaption, th, td").forEach(function (el) {
      if (el.closest(".intro") || el.closest("[hidden]")) return;
      if (!el.getClientRects().length) return;
      for (var i = 0; i < picked.length; i++) {
        if (picked[i].contains(el)) return;
      }
      var t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length < 2) return;
      picked.push(el);
    });

    var out = [];
    picked.forEach(function (el) {
      var t = (el.textContent || "").replace(/\s+/g, " ").trim();
      /* short utterances keep Chrome from stalling partway through a long block */
      var parts = t.match(/[^.!?]+[.!?]*\s*/g) || [t];
      var buf = "";
      parts.forEach(function (part) {
        if ((buf + part).length > 200 && buf) { out.push({ el: el, text: buf.trim() }); buf = ""; }
        buf += part;
      });
      if (buf.trim()) out.push({ el: el, text: buf.trim() });
    });
    return out;
  };

  var setSpeakUi = function (state) {
    if (!speakBtn) return;
    speakBtn.classList.toggle("is-on", state !== "idle");
    if (speakText) {
      speakText.textContent = state === "playing" ? "Пауза"
        : state === "paused" ? "Продолжить" : "Озвучить страницу";
    }
    if (stopBtn) stopBtn.hidden = state === "idle";
  };

  function stopSpeech() {
    if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
    if (synth) synth.cancel();
    queue = [];
    qi = 0;
    mark(null);
    setSpeakUi("idle");
  }

  var speakNext = function () {
    if (qi >= queue.length) { stopSpeech(); return; }
    var item = queue[qi];
    var u = new SpeechSynthesisUtterance(item.text);
    u.lang = "ru-RU";
    u.rate = 0.95;
    var v = ruVoice();
    if (v) u.voice = v;
    u.onstart = function () { mark(item.el); };
    u.onend = function () { qi++; speakNext(); };
    u.onerror = function () { qi++; speakNext(); };
    synth.speak(u);
  };

  if (synth && speakBtn) {
    if (synth.onvoiceschanged !== undefined) {
      synth.addEventListener("voiceschanged", function () {});
    }
    speakBtn.addEventListener("click", function () {
      if (synth.speaking && !synth.paused) { synth.pause(); setSpeakUi("paused"); return; }
      if (synth.paused) { synth.resume(); setSpeakUi("playing"); return; }
      queue = buildQueue();
      qi = 0;
      if (!queue.length) return;
      setSpeakUi("playing");
      /* Chrome suspends long speech runs; a periodic resume keeps it going */
      keepAlive = setInterval(function () {
        if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); }
      }, 9000);
      speakNext();
    });
    if (stopBtn) stopBtn.addEventListener("click", stopSpeech);
    window.addEventListener("pagehide", stopSpeech);
  } else {
    var speechBox = document.getElementById("a11y-speech");
    if (speechBox) speechBox.hidden = true;
  }

  /* ---- wiring ---- */

  if (a11yBtn) {
    a11yBtn.addEventListener("click", function () { setA11y(!root.classList.contains("a11y")); });
  }
  var a11yOff = document.getElementById("a11y-off");
  if (a11yOff) a11yOff.addEventListener("click", function () { setA11y(false); });
  document.querySelectorAll("[data-a11y-open]").forEach(function (b) {
    b.addEventListener("click", function () {
      setA11y(true);
      if (menu) menu.classList.remove("open");
      if (burger) burger.setAttribute("aria-expanded", "false");
    });
  });
  document.querySelectorAll(".a11y-f").forEach(function (b) {
    b.addEventListener("click", function () { setFont(b.getAttribute("data-font")); });
  });

  setFont(load("amc-a11y-font") || "2");
  if (load("amc-a11y") === "1") setA11y(true);

  /* scroll reveal */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && reveals.length) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add("visible");
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("visible"); });
  }

  /* stat counters */
  var counters = document.querySelectorAll("[data-count]");
  var animateCount = function (el) {
    var target = parseInt(el.getAttribute("data-count"), 10);
    var suffix = el.getAttribute("data-suffix") || "";
    var start = null;
    var dur = 1400;
    var step = function (ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toString() + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if ("IntersectionObserver" in window && counters.length) {
    var cio = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            animateCount(en.target);
            cio.unobserve(en.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    counters.forEach(function (el) { cio.observe(el); });
  }

  /* FAQ accordion */
  document.querySelectorAll(".faq-item").forEach(function (item) {
    var q = item.querySelector(".faq-q");
    var a = item.querySelector(".faq-a");
    if (!q || !a) return;
    if (item.classList.contains("open")) {
      a.style.maxHeight = a.scrollHeight + "px";
    }
    q.addEventListener("click", function () {
      var isOpen = item.classList.contains("open");
      item.closest(".faq").querySelectorAll(".faq-item.open").forEach(function (other) {
        other.classList.remove("open");
        other.querySelector(".faq-q").setAttribute("aria-expanded", "false");
        other.querySelector(".faq-a").style.maxHeight = "0px";
      });
      if (!isOpen) {
        item.classList.add("open");
        q.setAttribute("aria-expanded", "true");
        a.style.maxHeight = a.scrollHeight + "px";
      }
    });
  });

  /* callback modal */
  var modal = document.getElementById("callback-modal");
  if (modal) {
    var lastFocus = null;
    var openModal = function () {
      lastFocus = document.activeElement;
      modal.classList.add("open");
      document.body.style.overflow = "hidden";
      var input = modal.querySelector("input");
      if (input) setTimeout(function () { input.focus(); }, 60);
    };
    var closeModal = function () {
      modal.classList.remove("open");
      document.body.style.overflow = "";
      if (lastFocus) lastFocus.focus();
    };
    document.querySelectorAll("[data-open-modal]").forEach(function (b) {
      b.addEventListener("click", openModal);
    });
    modal.querySelectorAll("[data-close-modal]").forEach(function (b) {
      b.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("open")) closeModal();
    });

    var form = document.getElementById("callback-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        modal.querySelector(".modal-form").style.display = "none";
        document.getElementById("modal-success").style.display = "block";
      });
    }
  }

  /* welcome intro: boat to sobriety */
  var intro = document.getElementById("intro");
  if (intro && !document.documentElement.classList.contains("intro-off")) {
    var introTimer = null;
    var introDone = false;
    var onIntroKey = function (e) {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") endIntro();
    };
    var endIntro = function () {
      if (introDone) return;
      introDone = true;
      clearTimeout(introTimer);
      try { sessionStorage.setItem("amc-intro", "1"); } catch (e) {}
      intro.classList.add("is-leaving");
      document.documentElement.classList.remove("intro-lock");
      document.removeEventListener("keydown", onIntroKey);
      intro.removeEventListener("wheel", endIntro);
      intro.removeEventListener("touchmove", endIntro);
      setTimeout(function () { intro.classList.add("is-gone"); }, 950);
    };
    var skipBtn = document.getElementById("intro-skip");
    if (skipBtn) skipBtn.addEventListener("click", endIntro);
    document.addEventListener("keydown", onIntroKey);
    intro.addEventListener("wheel", endIntro, { passive: true });
    intro.addEventListener("touchmove", endIntro, { passive: true });
    introTimer = setTimeout(endIntro, 7200);
  }

  /* doctor detail modal */
  var docModal = document.getElementById("doctor-modal");
  if (docModal) {
    var dmMedia = docModal.querySelector(".dm-media");
    var dmBody = docModal.querySelector(".dm-body");
    var dmRole = document.getElementById("dm-role");
    var dmName = document.getElementById("dm-name");
    var dmSpec = document.getElementById("dm-spec");
    var docReturn = null;
    var lessMotion = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var closeDoc = function () {
      docModal.classList.remove("open");
      document.body.style.overflow = "";
      dmMedia.innerHTML = "";          /* drop the looping clip so it stops decoding */
      if (docReturn) { docReturn.focus(); docReturn = null; }
    };

    var openDoc = function (card) {
      var photo = card.querySelector(".doc-photo img");
      var anim = card.getAttribute("data-anim");
      var poster = card.getAttribute("data-poster") || (photo ? photo.getAttribute("src") : "");
      /* the clip is ~1.1 MB, so it is only requested once the card is actually opened */
      var src = (anim && !lessMotion) ? anim : poster;

      dmMedia.innerHTML = "";
      if (src) {
        var img = document.createElement("img");
        img.src = src;
        img.alt = "";
        dmMedia.appendChild(img);
      }
      dmRole.textContent = (card.querySelector(".doc-role") || {}).textContent || "";
      dmName.textContent = card.getAttribute("data-name") || "";
      dmSpec.textContent = (card.querySelector(".doc-spec") || {}).textContent || "";
      var full = card.querySelector(".doc-full");
      dmBody.innerHTML = full ? full.innerHTML : "";

      docReturn = card.querySelector(".doc-open");
      docModal.classList.add("open");
      document.body.style.overflow = "hidden";
      docModal.querySelector(".modal-close").focus();
      docModal.querySelector(".dm-card").scrollTop = 0;
    };

    document.querySelectorAll(".doc-card[data-doc]").forEach(function (card) {
      var btn = card.querySelector(".doc-open");
      if (btn) btn.addEventListener("click", function () { openDoc(card); });
    });
    docModal.querySelectorAll("[data-close-doc]").forEach(function (b) {
      b.addEventListener("click", closeDoc);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && docModal.classList.contains("open")) closeDoc();
    });
    /* the CTA hands over to the callback form, so close this one first */
    var dmCta = docModal.querySelector(".dm-cta");
    if (dmCta) dmCta.addEventListener("click", closeDoc);
  }

  /* footer year */
  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear().toString();
})();
