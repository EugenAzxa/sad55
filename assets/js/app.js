/* АМЦ - дневник трезвости (демо). Всё хранится в localStorage этого браузера. */
(function () {
  "use strict";

  var KEY = "amc-sober";
  var MS_DAY = 86400000;

  /* ---------- содержимое ---------- */

  var MILESTONES = {
    alcohol: [
      [1,    "24 часа",  "Уровень сахара в крови стабилизируется, уходит утренняя дрожь."],
      [3,    "3 дня",    "Острые проявления отмены обычно стихают."],
      [7,    "неделя",   "Сон становится глубже, днём появляется энергия."],
      [14,   "2 недели", "Уходит отёчность, снижается вес, ровнее становится дыхание."],
      [30,   "месяц",    "Снижается артериальное давление, заметно улучшается состояние кожи."],
      [90,   "3 месяца", "Печень восстанавливается, возвращаются концентрация и память."],
      [365,  "год",      "Существенно снижается риск болезней печени, сердца и сосудов."]
    ],
    tobacco: [
      [0.014, "20 минут", "Пульс и артериальное давление возвращаются к норме."],
      [0.5,   "12 часов", "Уровень угарного газа в крови падает до нормального."],
      [14,    "2 недели", "Улучшается кровообращение, дышать становится легче."],
      [30,    "месяц",    "Меньше кашля и одышки, растёт выносливость."],
      [90,    "3 месяца", "Заметно увеличивается объём лёгких."],
      [270,   "9 месяцев","Восстанавливаются реснички лёгких, реже бронхиты и простуды."],
      [365,   "год",      "Риск ишемической болезни сердца снижается примерно вдвое."],
      [1825,  "5 лет",    "Риск инсульта приближается к уровню никогда не куривших."]
    ]
  };

  var LESSONS = [
    ["Узнайте свои триггеры",
     "<p>Тяга почти никогда не приходит из ниоткуда. У неё есть повод: время суток, место, человек, усталость, злость, скука или, наоборот, радость и желание отметить.</p>" +
     "<p>Неделю понаблюдайте за собой и запишите, когда именно появлялось желание выпить или закурить. Через семь дней вы увидите не случайный набор, а три или четыре повторяющиеся ситуации. С ними уже можно работать.</p>"],
    ["Правило пятнадцати минут",
     "<p>Тяга ведёт себя как волна: нарастает, достигает пика и спадает. Обычно на это уходит около пятнадцати минут. Она кажется бесконечной только изнутри.</p>" +
     "<p>Задача не в том, чтобы перетерпеть навсегда, а в том, чтобы дожить до спада. Выпейте воды, смените комнату, позвоните кому-то, выйдите на улицу. Через четверть часа решение принимает уже другой человек.</p>"],
    ["Замените ритуал, а не только вещество",
     "<p>Зависимость держится не только на веществе, но и на привычном действии: перерыв, компания, пауза после работы, способ успокоиться.</p>" +
     "<p>Если убрать вещество и оставить пустоту, её быстро займёт прежняя привычка. Продумайте заранее, что будет стоять на этом месте: прогулка, звонок, тренировка, чай, любое дело, которое занимает руки и даёт ту же паузу.</p>"],
    ["Подготовьте окружение и ответ",
     "<p>Уберите из дома то, что провоцирует. Предупредите близких о своём решении: тем, кто знает, проще вас поддержать и труднее случайно подтолкнуть.</p>" +
     "<p>Заранее придумайте короткую фразу для отказа и проговорите её вслух. Не объяснение и не спор, а спокойное предложение: «Я не пью, давай лучше кофе». Готовый ответ снимает половину напряжения.</p>"],
    ["Срыв не перечёркивает путь",
     "<p>Срыв случается у многих и не отменяет пройденного. Опасен не он сам, а мысль «всё пропало, начинать заново нет смысла». Именно она превращает один эпизод в возвращение к прежнему.</p>" +
     "<p>Отметьте день в календаре, разберите без самообвинений, что ему предшествовало, и продолжайте со следующего дня. И сообщите врачу: это рабочая информация, а не повод для стыда.</p>"]
  ];

  /* ---------- хранилище ---------- */

  var state = null;

  var load = function () {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };
  var save = function () {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  };

  /* ---------- даты ---------- */

  var iso = function (d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  };
  var fromIso = function (s) {
    var p = s.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  };
  var today = function () {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  };
  var daysBetween = function (a, b) { return Math.round((b - a) / MS_DAY); };

  var plural = function (n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  };

  /* ---------- расчёты ---------- */

  var slipsOf = function (kind) {
    return (state.slips && state.slips[kind]) || [];
  };

  /* текущая серия: со дня после последнего срыва, иначе со дня старта */
  var streak = function (kind) {
    var start = fromIso(state.start);
    var from = start;
    slipsOf(kind).forEach(function (s) {
      var d = fromIso(s);
      if (d >= from) from = new Date(d.getTime() + MS_DAY);
    });
    var n = daysBetween(from, today()) + 1;
    return Math.max(0, n);
  };

  /* всего чистых дней за весь период */
  var totalClean = function (kind) {
    var all = daysBetween(fromIso(state.start), today()) + 1;
    return Math.max(0, all - slipsOf(kind).length);
  };

  var nextMilestone = function (kind, days) {
    var list = MILESTONES[kind];
    for (var i = 0; i < list.length; i++) {
      if (days < list[i][0]) {
        var prev = i ? list[i - 1][0] : 0;
        var pct = Math.max(0, Math.min(100, ((days - prev) / (list[i][0] - prev)) * 100));
        return { label: list[i][1], text: list[i][2], pct: pct };
      }
    }
    return null;
  };

  /* ---------- вывод ---------- */

  var KINDS = {
    alcohol: { title: "Без алкоголя", cls: "cnt-alcohol",
      icon: '<path d="M8 22h8"/><path d="M12 15v7"/><path d="M5 3h14l-1.5 7a5.5 5.5 0 0 1-11 0Z"/>' },
    tobacco: { title: "Без сигарет", cls: "cnt-tobacco",
      icon: '<path d="M18 12H2v4h16"/><path d="M22 12v4"/><path d="M18 8c0-2-1.5-3-3-3"/>' }
  };

  var el = function (id) { return document.getElementById(id); };

  var renderCounters = function () {
    var box = el("cnt-grid");
    box.innerHTML = "";
    Object.keys(KINDS).forEach(function (kind) {
      if (!state[kind] || !state[kind].on) return;
      var k = KINDS[kind];
      var d = streak(kind);
      var total = totalClean(kind);
      var nx = nextMilestone(kind, d);
      var card = document.createElement("div");
      card.className = "cnt " + k.cls;
      card.innerHTML =
        '<div class="cnt-top"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + k.icon + '</svg>' + k.title + '</div>' +
        '<div class="cnt-days"><b>' + d + '</b><span>' + plural(d, "день", "дня", "дней") + ' подряд</span></div>' +
        '<div class="cnt-sub">Всего чистых дней: ' + total + '</div>' +
        (nx ? '<div class="cnt-bar"><i style="width:' + nx.pct.toFixed(1) + '%"></i></div>' +
              '<div class="cnt-next">Следующая отметка: ' + nx.label + '</div>' : '');
      box.appendChild(card);
    });
  };

  var calMonth = null;

  var renderCalendar = function () {
    var grid = el("cal-grid");
    var dow = document.querySelector(".cal-dow");
    if (!dow.childNodes.length) {
      ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].forEach(function (n) {
        var s = document.createElement("span"); s.textContent = n; dow.appendChild(s);
      });
    }
    var M = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
    el("cal-title").textContent = M[calMonth.getMonth()] + " " + calMonth.getFullYear();

    grid.innerHTML = "";
    var first = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
    var pad = (first.getDay() + 6) % 7;                  /* неделя с понедельника */
    var last = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
    var start = fromIso(state.start), now = today();

    for (var i = 0; i < pad; i++) {
      var p = document.createElement("div");
      p.className = "cal-day is-pad";
      grid.appendChild(p);
    }
    var active = Object.keys(KINDS).filter(function (k) { return state[k] && state[k].on; });

    for (var day = 1; day <= last; day++) {
      var date = new Date(calMonth.getFullYear(), calMonth.getMonth(), day);
      var key = iso(date);
      var cell = document.createElement(date >= start && date <= now ? "button" : "div");
      cell.className = "cal-day";
      cell.textContent = day;
      if (date >= start && date <= now) {
        var slipped = active.some(function (k) { return slipsOf(k).indexOf(key) !== -1; });
        cell.className += slipped ? " is-slip is-click" : " is-clean is-click";
        cell.type = "button";
        cell.setAttribute("aria-pressed", slipped ? "true" : "false");
        cell.setAttribute("aria-label", day + " " + M[calMonth.getMonth()] + (slipped ? ", срыв" : ", чистый день"));
        cell.addEventListener("click", toggleDay(key));
      }
      if (key === iso(now)) cell.className += " is-today";
      grid.appendChild(cell);
    }
  };

  var toggleDay = function (key) {
    return function () {
      Object.keys(KINDS).forEach(function (kind) {
        if (!state[kind] || !state[kind].on) return;
        state.slips[kind] = state.slips[kind] || [];
        var i = state.slips[kind].indexOf(key);
        if (i === -1) state.slips[kind].push(key);
        else state.slips[kind].splice(i, 1);
        state.slips[kind].sort();
      });
      save();
      renderAll();
    };
  };

  var renderSavings = function () {
    var rub = 0, rows = [];
    if (state.alcohol && state.alcohol.on && state.alcohol.spend) {
      var ad = totalClean("alcohol"), asum = ad * state.alcohol.spend;
      rub += asum;
      rows.push(["Алкоголь, " + ad + " " + plural(ad, "день", "дня", "дней"), asum.toLocaleString("ru-RU") + " руб."]);
    }
    if (state.tobacco && state.tobacco.on && state.tobacco.cigs) {
      var td = totalClean("tobacco");
      var cigs = td * state.tobacco.cigs;
      var tsum = state.tobacco.pack ? Math.round(cigs / 20 * state.tobacco.pack) : 0;
      rub += tsum;
      rows.push(["Не выкурено сигарет", cigs.toLocaleString("ru-RU") + " шт."]);
      if (tsum) rows.push(["Сигареты, " + td + " " + plural(td, "день", "дня", "дней"), tsum.toLocaleString("ru-RU") + " руб."]);
    }
    el("save-money").textContent = rub.toLocaleString("ru-RU");
    var list = el("save-list");
    list.innerHTML = "";
    rows.forEach(function (r) {
      var li = document.createElement("li");
      li.innerHTML = "<span>" + r[0] + "</span><b>" + r[1] + "</b>";
      list.appendChild(li);
    });
  };

  var renderMilestones = function () {
    var box = el("milestones");
    box.innerHTML = "";
    Object.keys(KINDS).forEach(function (kind) {
      if (!state[kind] || !state[kind].on) return;
      var d = streak(kind);
      var g = document.createElement("div");
      g.className = "ms-group";
      var html = "<h4>" + KINDS[kind].title + "</h4>";
      MILESTONES[kind].forEach(function (m) {
        var done = d >= m[0];
        html += '<div class="ms' + (done ? " is-done" : "") + '">' +
          '<span class="ms-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></span>' +
          '<span class="ms-when">' + m[1] + '</span>' +
          '<span class="ms-text">' + m[2] + '</span></div>';
      });
      g.innerHTML = html;
      box.appendChild(g);
    });
  };

  var renderLessons = function () {
    var box = el("lessons");
    if (box.childNodes.length) { updateLessonMarks(); return; }
    LESSONS.forEach(function (l, i) {
      var item = document.createElement("div");
      item.className = "les";
      item.innerHTML =
        '<button class="les-q" type="button" aria-expanded="false"><span class="les-num">' + (i + 1) + '</span>' + l[0] +
        '<svg class="les-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>' +
        '<div class="les-a"><div class="les-a-in">' + l[1] +
        '<button class="les-done-btn" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg><span>Отметить пройденным</span></button>' +
        '</div></div>';
      var q = item.querySelector(".les-q"), a = item.querySelector(".les-a");
      q.addEventListener("click", function () {
        var open = item.classList.toggle("is-open");
        q.setAttribute("aria-expanded", open ? "true" : "false");
        a.style.maxHeight = open ? a.scrollHeight + "px" : "0px";
      });
      item.querySelector(".les-done-btn").addEventListener("click", function () {
        state.lessons = state.lessons || [];
        var k = state.lessons.indexOf(i);
        if (k === -1) state.lessons.push(i); else state.lessons.splice(k, 1);
        save();
        updateLessonMarks();
      });
      box.appendChild(item);
    });
    el("les-total").textContent = LESSONS.length;
    updateLessonMarks();
  };

  var updateLessonMarks = function () {
    var done = state && state.lessons ? state.lessons : [];
    document.querySelectorAll("#lessons .les").forEach(function (item, i) {
      var on = done.indexOf(i) !== -1;
      item.classList.toggle("is-done", on);
      var b = item.querySelector(".les-done-btn span");
      if (b) b.textContent = on ? "Пройдено" : "Отметить пройденным";
    });
    el("les-done").textContent = done.length;
  };

  var renderAll = function () {
    renderCounters();
    renderScreen();
    renderCalendar();
    renderSavings();
    renderMilestones();
    renderLessons();
  };

  /* ---------- настройка ---------- */

  var showSetup = function () {
    setupMode(true);
    var d = el("s-date");
    if (!d.value) d.value = iso(today());
    d.max = iso(today());
    if (state) {
      el("g-alcohol").checked = !!(state.alcohol && state.alcohol.on);
      el("g-tobacco").checked = !!(state.tobacco && state.tobacco.on);
      el("g-screen").checked = !!(state.screen && state.screen.on);
      d.value = state.start;
      if (state.alcohol) el("s-alc-spend").value = state.alcohol.spend || "";
      if (state.tobacco) {
        el("s-cigs").value = state.tobacco.cigs || "";
        el("s-pack").value = state.tobacco.pack || "";
      }
      if (state.screen) {
        el("s-scr-before").value = state.screen.before || "";
        el("s-scr-limit").value = state.screen.limit || "";
      }
    }
    syncSetupFields();
  };

  var syncSetupFields = function () {
    var a = el("g-alcohol").checked, t = el("g-tobacco").checked, sc = el("g-screen").checked;
    document.querySelectorAll('[data-for="alcohol"]').forEach(function (f) { f.hidden = !a; });
    document.querySelectorAll('[data-for="tobacco"]').forEach(function (f) { f.hidden = !t; });
    document.querySelectorAll('[data-for="screen"]').forEach(function (f) { f.hidden = !sc; });
    el("s-start").disabled = !a && !t && !sc;
  };

  var startTracking = function () {
    var a = el("g-alcohol").checked, t = el("g-tobacco").checked, sc = el("g-screen").checked;
    if (!a && !t && !sc) return;
    var date = el("s-date").value || iso(today());
    if (fromIso(date) > today()) date = iso(today());
    var prev = state || {};
    state = {
      v: 1,
      start: date,
      alcohol: { on: a, spend: +el("s-alc-spend").value || 0 },
      tobacco: { on: t, cigs: +el("s-cigs").value || 0, pack: +el("s-pack").value || 0 },
      screen: { on: sc, before: +el("s-scr-before").value || 0, limit: +el("s-scr-limit").value || 60 },
      slips: prev.slips || { alcohol: [], tobacco: [] },
      screenLog: prev.screenLog || {},
      lessons: prev.lessons || []
    };
    save();
    setupMode(false);
    calMonth = today();
    renderAll();
  };

  /* ---------- экранное время ---------- */

  /* соцсети устроены иначе: не воздержание, а дневная норма, поэтому
     считаем не чистые дни, а фактические минуты против цели */

  var scrLog = function () { return (state && state.screenLog) || {}; };
  var scrLimit = function () { return (state.screen && state.screen.limit) || 60; };
  var scrBefore = function () { return (state.screen && state.screen.before) || 0; };

  var scrMinsToday = function () {
    var v = scrLog()[iso(today())];
    return typeof v === "number" ? v : 0;
  };

  var setScrToday = function (mins) {
    state.screenLog = state.screenLog || {};
    state.screenLog[iso(today())] = Math.max(0, Math.round(mins));
    save();
    renderScreen();
  };

  var hoursWord = function (h) { return plural(h, "час", "часа", "часов"); };

  var renderScreen = function () {
    if (!state || !state.screen || !state.screen.on) return;
    var mins = scrMinsToday(), limit = scrLimit(), over = mins > limit;

    var fill = el("scr-fill");
    if (fill) {
      var C = 2 * Math.PI * 52;
      var pct = limit ? Math.min(1, mins / limit) : 0;
      fill.style.strokeDashoffset = (C * (1 - pct)).toFixed(1);
      fill.classList.toggle("is-over", over);
    }
    el("scr-mins").textContent = mins;

    var line = el("scr-limit-line");
    line.classList.toggle("is-over", over);
    line.innerHTML = over
      ? 'Цель <b>' + limit + ' мин</b>, превышена на <b>' + (mins - limit) + ' мин</b>'
      : 'Цель <b>' + limit + ' мин</b>, осталось <b>' + (limit - mins) + ' мин</b>';

    /* последние 7 дней */
    var chart = el("scr-chart");
    chart.innerHTML = "";
    var log = scrLog();
    var vals = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(today().getTime() - i * MS_DAY);
      vals.push({ d: d, key: iso(d), v: log[iso(d)] });
    }
    var peak = Math.max(limit, 1);
    vals.forEach(function (x) { if (typeof x.v === "number" && x.v > peak) peak = x.v; });

    var DOW = ["вс","пн","вт","ср","чт","пт","сб"];
    vals.forEach(function (x) {
      var has = typeof x.v === "number";
      var v = has ? x.v : 0;
      var bar = document.createElement("div");
      bar.className = "scr-bar" + (has && v > limit ? " is-over" : "") + (has ? "" : " is-empty") +
        (x.key === iso(today()) ? " is-today" : "");
      var h = has ? Math.max(4, Math.round((v / peak) * 104)) : 4;
      bar.innerHTML = '<i style="height:' + h + 'px" title="' + (has ? v + " мин" : "нет отметки") + '"></i>' +
                      '<span>' + DOW[x.d.getDay()] + '</span>';
      chart.appendChild(bar);
    });

    /* отвоёванное время считаем только по дням с отметкой */
    var before = scrBefore(), savedMin = 0, logged = 0;
    Object.keys(log).forEach(function (k) {
      if (typeof log[k] !== "number") return;
      logged++;
      if (before > log[k]) savedMin += before - log[k];
    });
    var h2 = Math.round(savedMin / 60);
    el("scr-saved").textContent = h2;
    el("scr-saved-note").textContent = !before
      ? "Укажите, сколько времени уходило раньше, и здесь появится разница."
      : logged
        ? "По " + logged + " " + plural(logged, "отмеченному дню", "отмеченным дням", "отмеченным дням") +
          ", против " + before + " мин в день до начала. Это " + h2 + " " + hoursWord(h2) + " обратно."
        : "Отметьте первый день, и здесь появится разница.";
  };

  /* ---------- вкладки ---------- */

  var tabs = el("ios-tabs");
  var scroller = el("ios-scroll");

  var showTab = function (name) {
    document.querySelectorAll(".ios-pane[data-tab]").forEach(function (pane) {
      pane.hidden = pane.getAttribute("data-tab") !== name;
    });
    tabs.querySelectorAll("button").forEach(function (b) {
      if (b.getAttribute("data-go") === name) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
    if (scroller) scroller.scrollTop = 0;
  };

  var syncTabs = function () {
    var scrBtn = tabs.querySelector('button[data-go="screen"]');
    if (scrBtn) scrBtn.hidden = !(state && state.screen && state.screen.on);
    tabs.style.gridTemplateColumns = "repeat(" +
      tabs.querySelectorAll("button:not([hidden])").length + ", 1fr)";
  };

  var setupMode = function (on) {
    el("setup").hidden = !on;
    tabs.hidden = on;
    document.querySelectorAll(".ios-pane[data-tab]").forEach(function (p) {
      if (on) p.hidden = true;
    });
    if (!on) { syncTabs(); showTab("today"); }
  };

  /* ---------- часы в статус-баре ---------- */

  var clock = el("ios-time");
  if (clock) {
    var tick = function () {
      var n = new Date();
      clock.textContent = n.getHours() + ":" + ("0" + n.getMinutes()).slice(-2);
    };
    tick();
    setInterval(tick, 20000);
  }

  /* ---------- помощь при тяге ---------- */

  var panic = el("panic");
  var breathTimer = null, cycles = 0, panicReturn = null;

  var startBreathing = function () {
    var ring = el("breath-ring"), word = el("breath-word");
    cycles = 0;
    el("breath-cycles").textContent = "0";
    ring.classList.add("is-running");
    var step = 0;
    var phases = [["Вдох", 4000], ["Задержка", 4000], ["Выдох", 6000]];
    word.textContent = phases[0][0];
    var tick = function () {
      step = (step + 1) % 3;
      word.textContent = phases[step][0];
      if (step === 0) { cycles++; el("breath-cycles").textContent = cycles; }
      breathTimer = setTimeout(tick, phases[step][1]);
    };
    breathTimer = setTimeout(tick, phases[0][1]);
  };
  var stopBreathing = function () {
    if (breathTimer) { clearTimeout(breathTimer); breathTimer = null; }
    el("breath-ring").classList.remove("is-running");
  };
  var openPanic = function () {
    panicReturn = document.activeElement;
    panic.classList.add("open");
    document.body.style.overflow = "hidden";
    startBreathing();
    panic.querySelector(".modal-close").focus();
  };
  var closePanic = function () {
    panic.classList.remove("open");
    document.body.style.overflow = "";
    stopBreathing();
    if (panicReturn) { panicReturn.focus(); panicReturn = null; }
  };

  /* ---------- запуск ---------- */

  if (!el("setup")) return;

  state = load();
  calMonth = today();

  if (state && state.start) {
    setupMode(false);
    renderAll();
  } else {
    showSetup();
    renderLessons();
  }

  tabs.querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () { showTab(b.getAttribute("data-go")); });
  });

  document.querySelectorAll(".scr-add button").forEach(function (b) {
    b.addEventListener("click", function () {
      var add = +b.getAttribute("data-add");
      setScrToday(add === 0 ? 0 : scrMinsToday() + add);
    });
  });

  el("g-alcohol").addEventListener("change", syncSetupFields);
  el("g-screen").addEventListener("change", syncSetupFields);
  el("g-tobacco").addEventListener("change", syncSetupFields);
  el("s-start").addEventListener("click", startTracking);
  el("edit-setup").addEventListener("click", showSetup);

  el("cal-prev").addEventListener("click", function () {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  el("cal-next").addEventListener("click", function () {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
    renderCalendar();
  });

  el("panic-open").addEventListener("click", openPanic);
  panic.querySelectorAll("[data-close-panic]").forEach(function (b) {
    b.addEventListener("click", closePanic);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panic.classList.contains("open")) closePanic();
  });

  el("app-reset").addEventListener("click", function () {
    if (!window.confirm("Удалить все записи дневника? Действие нельзя отменить.")) return;
    try { localStorage.removeItem(KEY); } catch (e) {}
    state = null;
    showSetup();
    updateLessonMarks();
  });
})();
