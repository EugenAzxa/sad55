/* АМЦ - редактор цен и акций. Данные приходят встроенными в страницу,
   сохраняются одним POST в ?a=save, сервер сам перерисовывает сайт. */
(function () {
  "use strict";

  var saved = JSON.parse(document.getElementById("initial").textContent || "null");
  var app = document.getElementById("app");
  if (!saved) {
    app.innerHTML = '<p class="fatal">Не читается файл с ценами (admin/data/prices.json). Сообщите разработчику.</p>';
    return;
  }
  var data = clone(saved);
  var dirty = false;
  var tab = "prices";
  try { tab = sessionStorage.getItem("amc-admin-tab") || tab; } catch (e) {}
  var query = "";

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- мелочи ---------- */

  var ICONS = {
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    del: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4Z"/>'
  };
  function icon(n) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + "</svg>";
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "html") n.innerHTML = v;
      else if (k === "text") n.textContent = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  function iconBtn(name, label, fn, extra) {
    return el("button", { type: "button", class: "ibtn" + (extra ? " " + extra : ""), title: label, "aria-label": label, html: icon(name), onclick: fn });
  }

  // то же, что norm_price в lib.php: «10000» -> «10 000», «от 11900» -> «от 11 900»
  function normPrice(v) {
    var s = String(v || "").replace(/\s+/g, " ").trim().replace(/[—–]/g, "-");
    s = s.replace(/\s*(руб\.?|р\.|₽)\s*$/i, "");
    var m = s.match(/^(от\s*)?(\d[\d\s]*)$/i);
    if (!m) return s;
    var n = m[2].replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    return (m[1] ? "от " : "") + n.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function move(list, i, dir) {
    var j = i + dir;
    if (j < 0 || j >= list.length) return false;
    var t = list[i]; list[i] = list[j]; list[j] = t;
    return true;
  }

  function touch() {
    dirty = JSON.stringify(stripMeta(data)) !== JSON.stringify(stripMeta(saved));
    renderBar();
  }
  function stripMeta(d) { var c = clone(d); delete c.updated; return c; }

  // поле ввода, привязанное к obj[key]
  function field(obj, key, opts) {
    opts = opts || {};
    if (opts.grow) opts.area = true;
    var tag = opts.area ? "textarea" : "input";
    var inp = el(tag, {
      class: "inp" + (opts.grow ? " grow" : "") + (opts.cls ? " " + opts.cls : ""),
      type: opts.area ? null : (opts.type || "text"),
      value: opts.area ? null : (obj[key] || ""),
      placeholder: opts.ph || "",
      "aria-label": opts.label || opts.ph || "",
      rows: opts.area ? (opts.grow ? 1 : 2) : null,
      maxlength: opts.max || null,
      inputmode: opts.price ? "numeric" : null
    });
    if (opts.area) inp.value = obj[key] || "";
    if (opts.grow) {
      // название в одну строку: Enter не нужен, текст переносится сам
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); });
    }
    inp.addEventListener("input", function () {
      if (opts.grow) { inp.value = inp.value.replace(/\n/g, " "); fit(inp); }
      obj[key] = inp.value;
      if (opts.onInput) opts.onInput(inp.value);
      touch();
    });
    if (opts.price) {
      inp.addEventListener("blur", function () {
        var n = normPrice(inp.value);
        if (n !== inp.value) { inp.value = n; obj[key] = n; touch(); }
      });
    }
    return inp;
  }

  function fit(t) { t.style.height = "auto"; t.style.height = t.scrollHeight + 2 + "px"; }
  function fitAll() { document.querySelectorAll("textarea.inp").forEach(fit); }
  window.addEventListener("resize", fitAll);

  function priceField(obj, key, label) {
    return el("label", { class: "price-inp" }, [
      field(obj, key, { price: true, ph: "0", label: label || "Цена", max: 40 }),
      el("span", { text: "руб." })
    ]);
  }

  /* ---------- шапка, вкладки, панель сохранения ---------- */

  var bar, toastEl;

  function render() {
    app.innerHTML = "";
    var logout = el("form", { method: "post", action: "?a=logout", class: "top-out" }, [
      el("button", { type: "submit", class: "link-btn", html: icon("out") + "<span>Выйти</span>" })
    ]);
    app.appendChild(el("header", { class: "top" }, [
      el("div", { class: "top-in" }, [
        el("a", { class: "top-logo", href: "../", title: "Открыть сайт" }, [el("img", { src: "../assets/logo.svg", alt: "АМЦ", width: 150, height: 34 })]),
        el("div", { class: "top-title" }, [
          el("b", { text: "Управление ценами" }),
          el("span", { id: "updated", text: saved.updated ? "Сохранено " + fmtDate(saved.updated) : "" })
        ]),
        el("div", { class: "top-act" }, [
          el("button", { type: "button", class: "link-btn", html: icon("clock") + "<span>История</span>", onclick: openHistory }),
          el("a", { class: "link-btn", href: "../price-and-services.html", target: "_blank", rel: "noopener", html: icon("ext") + "<span>Открыть сайт</span>" }),
          logout
        ])
      ])
    ]));

    var tabs = [["prices", "Прайс-лист"], ["promos", "Акции"], ["cards", "Главная и курение"], ["clicks", "Клики"]];
    app.appendChild(el("nav", { class: "tabs", role: "tablist" }, tabs.map(function (t) {
      return el("button", {
        type: "button", role: "tab", class: "tab" + (tab === t[0] ? " on" : ""), "aria-selected": tab === t[0] ? "true" : "false",
        onclick: function () { tab = t[0]; try { sessionStorage.setItem("amc-admin-tab", tab); } catch (e) {} render(); }
      }, [t[1], t[0] === "promos" ? el("span", { class: "tab-n", text: String(activePromos()) }) : null]);
    })));

    var main = el("main", { class: "wrap" });
    if (tab === "prices") renderPrices(main);
    else if (tab === "promos") renderPromos(main);
    else if (tab === "clicks") renderClicks(main);
    else renderCards(main);
    app.appendChild(main);

    bar = el("div", { class: "savebar" });
    if (tab === "clicks" && !dirty) bar.hidden = true;
    app.appendChild(bar);
    renderBar();
    fitAll();
  }

  function activePromos() {
    var t = today();
    return data.promos.filter(function (p) { return p.on && (!p.until || p.until >= t); }).length;
  }

  function renderBar() {
    if (!bar) return;
    bar.className = "savebar" + (dirty ? " dirty" : "");
    bar.innerHTML = "";
    bar.appendChild(el("div", { class: "savebar-in" }, [
      el("span", { class: "savebar-msg", text: dirty ? "Есть несохранённые изменения" : "Все изменения сохранены" }),
      dirty ? el("button", { type: "button", class: "btn btn-ghost", text: "Отменить", onclick: function () {
        if (!confirm("Вернуть всё как было при последнем сохранении?")) return;
        data = clone(saved); dirty = false; render();
      } }) : null,
      el("button", { type: "button", class: "btn btn-primary", id: "save", disabled: dirty ? null : true, html: icon("check") + "<span>Сохранить</span>", onclick: save })
    ]));
  }

  function toast(msg, bad) {
    if (toastEl) toastEl.remove();
    toastEl = el("div", { class: "toast" + (bad ? " bad" : ""), role: "status", text: msg });
    document.body.appendChild(toastEl);
    setTimeout(function () { if (toastEl) toastEl.classList.add("hide"); }, bad ? 7000 : 3500);
  }

  /* ---------- прайс-лист ---------- */

  function renderPrices(main) {
    main.appendChild(el("div", { class: "intro" }, [
      el("p", { text: "Слева название услуги, справа цена. Пишите только число, например 10000 или «от 11900», «руб.» сайт добавит сам. Порядок меняется стрелками." })
    ]));
    var search = el("label", { class: "search" }, [
      el("span", { html: icon("search") }),
      el("input", { type: "search", class: "inp", placeholder: "Найти услугу", value: query, "aria-label": "Найти услугу", oninput: function (e) { query = e.target.value; filter(); } })
    ]);
    main.appendChild(search);

    var list = el("div", { class: "groups" });
    data.groups.forEach(function (g, gi) { list.appendChild(groupCard(g, gi)); });
    main.appendChild(list);
    main.appendChild(el("button", { type: "button", class: "add-btn add-group", html: icon("plus") + "Добавить раздел прайса", onclick: function () {
      data.groups.push({ title: "Новый раздел", note: "", time: false, rows: [{ name: "", time: "", price: "" }] });
      touch(); render();
      var cards = document.querySelectorAll(".group");
      var last = cards[cards.length - 1];
      last.scrollIntoView({ behavior: "smooth", block: "center" });
      last.querySelector(".g-title").select();
    } }));
    filter();
  }

  function filter() {
    var q = query.trim().toLowerCase();
    document.querySelectorAll(".group").forEach(function (g) {
      var any = false;
      g.querySelectorAll(".row").forEach(function (r) {
        var hit = !q || r.querySelector(".r-name").value.toLowerCase().indexOf(q) !== -1;
        r.hidden = !hit;
        any = any || hit;
      });
      var titleHit = q && g.querySelector(".g-title").value.toLowerCase().indexOf(q) !== -1;
      if (titleHit) g.querySelectorAll(".row").forEach(function (r) { r.hidden = false; });
      g.hidden = !(any || titleHit || !q);
    });
    fitAll();
  }

  function groupCard(g, gi) {
    var rows = el("div", { class: "rows" + (g.time ? " with-time" : "") });
    function drawRows() {
      rows.innerHTML = "";
      rows.appendChild(el("div", { class: "row head", "aria-hidden": "true" }, [
        el("span", { text: "Услуга" }), g.time ? el("span", { text: "Время" }) : null, el("span", { text: "Цена" }), el("span")
      ]));
      g.rows.forEach(function (r, ri) {
        rows.appendChild(el("div", { class: "row" }, [
          field(r, "name", { grow: true, cls: "r-name", ph: "Название услуги", label: "Услуга", max: 200 }),
          g.time ? field(r, "time", { cls: "r-time", ph: "любое", label: "Время", max: 30 }) : null,
          priceField(r, "price"),
          el("div", { class: "r-act" }, [
            iconBtn("up", "Выше", function () { if (move(g.rows, ri, -1)) { touch(); drawRows(); } }),
            iconBtn("down", "Ниже", function () { if (move(g.rows, ri, 1)) { touch(); drawRows(); } }),
            iconBtn("del", "Удалить услугу", function () {
              if ((r.name || r.price) && !confirm("Удалить «" + (r.name || "услугу") + "»?")) return;
              g.rows.splice(ri, 1); touch(); drawRows();
            }, "danger")
          ])
        ]));
      });
      filter();
    }
    drawRows();

    var timeToggle = el("label", { class: "check" }, [
      el("input", { type: "checkbox", checked: g.time ? true : null, onchange: function (e) { g.time = e.target.checked; touch(); render(); } }),
      el("span", { text: "Колонка «Время»" })
    ]);

    return el("section", { class: "group card" }, [
      el("div", { class: "g-head" }, [
        el("div", { class: "g-fields" }, [
          field(g, "title", { cls: "g-title", ph: "Название раздела", label: "Название раздела", max: 150 }),
          field(g, "note", { cls: "g-note", ph: "Пояснение под названием (необязательно)", label: "Пояснение", max: 300 })
        ]),
        el("div", { class: "r-act" }, [
          iconBtn("up", "Раздел выше", function () { if (move(data.groups, gi, -1)) { touch(); render(); } }),
          iconBtn("down", "Раздел ниже", function () { if (move(data.groups, gi, 1)) { touch(); render(); } }),
          iconBtn("del", "Удалить раздел", function () {
            if (!confirm("Удалить раздел «" + g.title + "» со всеми услугами (" + g.rows.length + ")?")) return;
            data.groups.splice(gi, 1); touch(); render();
          }, "danger")
        ])
      ]),
      rows,
      el("div", { class: "g-foot" }, [
        el("button", { type: "button", class: "add-btn", html: icon("plus") + "Добавить услугу", onclick: function () {
          var prev = g.rows[g.rows.length - 1];
          g.rows.push({ name: g.time && prev ? prev.name : "", time: "", price: "" });
          touch(); drawRows();
          var inputs = rows.querySelectorAll(g.time ? ".r-time" : ".r-name");
          inputs[inputs.length - 1].focus();
        } }),
        timeToggle
      ]),
      g.time ? el("p", { class: "hint", text: "Строки с одинаковым названием подряд на сайте сольются в одну услугу с разной ценой по времени." }) : null
    ]);
  }

  /* ---------- акции ---------- */

  function promoState(p) {
    if (!p.on) return ["off", "Скрыта"];
    if (p.until && p.until < today()) return ["old", "Срок истёк"];
    return ["live", "На сайте"];
  }

  function renderPromos(main) {
    main.appendChild(el("div", { class: "intro" }, [
      el("p", { text: "Акции показываются плашками на главной (над ценами) и на странице цен. После даты «Действует до» плашка исчезнет с сайта сама. Чтобы убрать акцию на время, снимите галочку «Показывать»." })
    ]));
    var list = el("div", { class: "promos-ed" });
    data.promos.forEach(function (p, pi) {
      var st = promoState(p);
      var badge = el("span", { class: "state " + st[0], text: st[1] });
      function upd() { var s = promoState(p); badge.className = "state " + s[0]; badge.textContent = s[1]; }
      list.appendChild(el("section", { class: "promo-ed card" + (p.on ? "" : " is-off") }, [
        el("div", { class: "p-head" }, [
          el("span", { class: "p-tag", html: icon("tag") + "Акция" }),
          badge,
          el("div", { class: "r-act" }, [
            iconBtn("up", "Выше", function () { if (move(data.promos, pi, -1)) { touch(); render(); } }),
            iconBtn("down", "Ниже", function () { if (move(data.promos, pi, 1)) { touch(); render(); } }),
            iconBtn("del", "Удалить акцию", function () {
              if (!confirm("Удалить акцию «" + p.title + "»?")) return;
              data.promos.splice(pi, 1); touch(); render();
            }, "danger")
          ])
        ]),
        field(p, "title", { grow: true, cls: "p-title", ph: "Заголовок, например «Скидка 10% при повторном обращении»", label: "Заголовок акции", max: 120 }),
        field(p, "text", { area: true, ph: "Пара предложений об условиях", label: "Текст акции", max: 400 }),
        el("div", { class: "p-foot" }, [
          el("label", { class: "check" }, [
            el("input", { type: "checkbox", checked: p.on ? true : null, onchange: function (e) {
              p.on = e.target.checked; e.target.closest(".promo-ed").classList.toggle("is-off", !p.on); upd(); touch();
            } }),
            el("span", { text: "Показывать на сайте" })
          ]),
          el("label", { class: "date" }, [
            el("span", { text: "Действует до" }),
            field(p, "until", { type: "date", label: "Действует до", onInput: upd })
          ])
        ])
      ]));
    });
    main.appendChild(list);
    main.appendChild(el("button", { type: "button", class: "add-btn add-group", html: icon("plus") + "Добавить акцию", onclick: function () {
      data.promos.unshift({ on: true, title: "", text: "", until: "" });
      touch(); render();
      document.querySelector(".p-title").focus();
    } }));
  }

  /* ---------- карточки на главной и на «Бросить курить» ---------- */

  function renderCards(main) {
    main.appendChild(el("div", { class: "intro" }, [
      el("p", { text: "Три карточки «Прозрачные цены» на главной странице и цена курса на странице «Бросить курить». Они не связаны с прайсом автоматически: если поменяли цену в прайсе, проверьте и здесь." })
    ]));
    var grid = el("div", { class: "cards-ed" });
    data.home.forEach(function (c, i) {
      grid.appendChild(el("section", { class: "card home-card" + (i === 1 ? " featured" : "") }, [
        el("span", { class: "k", text: "Главная, карточка " + (i + 1) }),
        field(c, "name", { grow: true, cls: "c-name", ph: "Название", label: "Название", max: 120 }),
        priceField(c, "price"),
        field(c, "desc", { area: true, ph: "Короткое описание", label: "Описание", max: 200 })
      ]));
    });
    main.appendChild(grid);
    main.appendChild(el("section", { class: "card smoke-card" }, [
      el("span", { class: "k", text: "Бросить курить" }),
      el("b", { text: "Основной курс против курения" }),
      priceField(data.smoke, "price", "Цена курса против курения")
    ]));
  }

  /* ---------- сохранение и история ---------- */

  function save() {
    if (!dirty) return;
    document.querySelectorAll(".price-inp input").forEach(function (i) { i.dispatchEvent(new Event("blur")); });
    var btn = document.getElementById("save");
    btn.disabled = true;
    btn.lastChild.textContent = "Сохраняю...";
    fetch("?a=save", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF": window.CSRF },
      body: JSON.stringify(data),
      credentials: "same-origin"
    }).then(function (r) {
      return r.json().catch(function () { return { error: "Сервер ответил ошибкой " + r.status }; });
    }).then(function (res) {
      if (!res.ok) throw new Error(res.error || "Не сохранилось");
      saved = res.data;
      data = clone(saved);
      dirty = false;
      render();
      toast("Сохранено. На сайте уже новые цены.");
    }).catch(function (e) {
      toast(e.message || "Нет связи с сервером. Изменения не потеряны, попробуйте ещё раз.", true);
      renderBar();
    });
  }

  /* ---------- клики ---------- */

  var clickDays = 30;
  try { clickDays = parseInt(sessionStorage.getItem("amc-admin-days"), 10) || 30; } catch (e) {}

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  // «/blog/esperal.html» -> «blog/esperal», «/» -> «главная»
  function pageName(p) {
    if (!p || p === "/" || p === "/index.html") return "главная";
    return p.replace(/^\//, "").replace(/\.html$/, "");
  }

  function targetName(h) {
    if (!h) return "";
    if (/^tel:/i.test(h)) return "звонок " + h.slice(4);
    return pageName(h);
  }

  var pageTitles = {};
  function pageLabel(p) { return pageTitles[p] || pageName(p); }

  function renderClicks(main) {
    var body = el("div", { class: "clicks-body", text: "Загружаю..." });
    main.appendChild(el("div", { class: "intro" }, [
      el("h2", { class: "c-title", text: "На что нажимают посетители" }),
      el("p", { class: "muted", text: "Считаем нажатия на кнопки и ссылки сайта: где нажали, на что и куда это ведёт. Кто нажал, не сохраняется: ни IP, ни cookie. Подробную карту кликов и записи визитов смотрите в Яндекс Метрике." })
    ]));
    main.appendChild(el("div", { class: "seg", role: "group", "aria-label": "Период" }, [7, 30, 90].map(function (d) {
      return el("button", { type: "button", class: "seg-btn" + (clickDays === d ? " on" : ""), "aria-pressed": clickDays === d ? "true" : "false",
        text: d + " дней", onclick: function () { clickDays = d; try { sessionStorage.setItem("amc-admin-days", d); } catch (e) {} render(); } });
    })));
    main.appendChild(body);

    fetch("?a=clicks&days=" + clickDays, { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (res) {
      if (res.error) throw new Error(res.error);
      body.innerHTML = "";
      pageTitles = res.titles || {};
      if (!res.total) {
        body.appendChild(el("div", { class: "card empty" }, [
          el("b", { text: "Пока нажатий нет" }),
          el("p", { class: "muted", text: res.since ? "За выбранный период никто ничего не нажимал. Выберите период побольше." : "Счётчик только что включён. Первые цифры появятся, когда посетители начнут нажимать на кнопки и ссылки, обычно в течение дня." })
        ]));
        return;
      }
      body.appendChild(el("div", { class: "kpis" }, [
        kpi(res.total, plural(res.total, "нажатие", "нажатия", "нажатий"), "всего за " + res.days + " дней"),
        kpi(res.tel, "на номер телефона", "звонок с телефона в один тап"),
        kpi(res.modal, "открыли окно «Позвоните нам»", "кнопки «Позвонить», «Узнать подробнее» и похожие")
      ]));

      var max = res.items.length ? res.items[0].n : 1;
      var rows = res.items.map(function (it, i) {
        var where = Object.keys(it.p).map(pageLabel).join("; ") + (it.pages > 3 ? " и ещё " + (it.pages - 3) : "");
        return el("tr", {}, [
          el("td", { class: "c-n", text: String(i + 1) }),
          el("td", {}, [
            el("b", { text: it.l || "(без текста)" }),
            it.h ? el("span", { class: "c-to", text: "ведёт: " + targetName(it.h) }) : null,
            el("span", { class: "c-where-m", text: "где: " + where })
          ]),
          el("td", { class: "c-where", text: where }),
          el("td", {}, [el("div", { class: "c-count" }, [
            el("span", { class: "c-bar", style: "width:" + Math.max(4, Math.round(it.n / max * 100)) + "%" }),
            el("b", { text: String(it.n) })
          ])])
        ]);
      });
      body.appendChild(el("div", { class: "card c-card" }, [
        el("h2", { text: "Самые нажимаемые кнопки и ссылки" }),
        el("div", { class: "c-scroll" }, [el("table", { class: "c-table" }, [
          el("thead", {}, [el("tr", {}, [el("th", { text: "#" }), el("th", { text: "Что нажали" }), el("th", { text: "Где" }), el("th", { text: "Нажатий" })])]),
          el("tbody", {}, rows)
        ])])
      ]));

      var pmax = 1; Object.keys(res.pages).forEach(function (p) { pmax = Math.max(pmax, res.pages[p]); });
      body.appendChild(el("div", { class: "card c-card" }, [
        el("h2", { text: "Страницы, где нажимают больше всего" }),
        el("ul", { class: "c-pages" }, Object.keys(res.pages).map(function (p) {
          return el("li", {}, [
            el("a", { href: ".." + (p === "/" ? "/" : p), target: "_blank", rel: "noopener", text: pageLabel(p) }),
            el("span", { class: "c-count" }, [el("span", { class: "c-bar", style: "width:" + Math.max(4, Math.round(res.pages[p] / pmax * 100)) + "%" }), el("b", { text: String(res.pages[p]) })])
          ]);
        }))
      ]));
      if (res.since) body.appendChild(el("p", { class: "hint", text: "Счётчик работает с " + new Date(res.since + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) + "." }));
    }).catch(function (e) { body.textContent = e.message || "Не загрузилось. Обновите страницу."; });
  }

  function kpi(n, label, note) {
    return el("div", { class: "card kpi" }, [el("b", { text: String(n) }), el("span", { text: label }), el("small", { text: note })]);
  }

  function openHistory() {
    var box = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": "История сохранений" });
    var list = el("div", { class: "h-list", text: "Загружаю..." });
    function close() { box.remove(); }
    box.appendChild(el("div", { class: "modal-card" }, [
      el("h2", { text: "История сохранений" }),
      el("p", { class: "muted", text: "Хранятся 30 последних версий. Выберите версию, она откроется в редакторе. На сайт она попадёт, только когда нажмёте «Сохранить»." }),
      list,
      el("button", { type: "button", class: "btn btn-ghost", text: "Закрыть", onclick: close })
    ]));
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); } });
    document.body.appendChild(box);

    fetch("?a=history", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (res) {
      if (res.error) throw new Error(res.error);
      list.innerHTML = "";
      if (!res.items.length) { list.textContent = "Пока пусто: история появится после первого сохранения."; return; }
      res.items.forEach(function (it) {
        list.appendChild(el("button", { type: "button", class: "h-item", onclick: function () {
          if (dirty && !confirm("Несохранённые изменения пропадут. Открыть версию от " + it.label + "?")) return;
          fetch("?a=backup&id=" + encodeURIComponent(it.id), { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (b) {
            if (b.error) throw new Error(b.error);
            data = b.data;
            data.updated = saved.updated;
            close(); touch(); render();
            toast("Открыта версия от " + it.label + ". Нажмите «Сохранить», чтобы вернуть её на сайт.");
          }).catch(function (e) { toast(e.message, true); });
        } }, [el("span", { text: "Было на сайте до " + it.label })]));
      });
    }).catch(function (e) { list.textContent = e.message || "Не загрузилось"; });
  }

  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
  });
  window.addEventListener("beforeunload", function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  render();
})();
