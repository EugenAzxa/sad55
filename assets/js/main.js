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

  /* accessibility mode (larger text, higher contrast) */
  var a11yBtn = document.getElementById("a11y-toggle");
  if (a11yBtn) {
    if (localStorage.getItem("amc-a11y") === "1") {
      document.documentElement.classList.add("a11y");
    }
    a11yBtn.addEventListener("click", function () {
      var on = document.documentElement.classList.toggle("a11y");
      localStorage.setItem("amc-a11y", on ? "1" : "0");
    });
  }

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

  /* footer year */
  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear().toString();
})();
