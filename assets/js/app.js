/* АМЦ - дневник трезвости. Всё хранится в localStorage этого браузера. */
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
    mirrorState();
  };

  /* копия для ежедневного напоминания: service worker не видит localStorage,
     а текст «6 дней без алкоголя» он собирает сам, на телефоне */
  var mirrorState = function () {
    if (!("caches" in window)) return;
    try {
      caches.open("amc-state").then(function (c) {
        return state ? c.put("/__amc_state", new Response(JSON.stringify(state), { headers: { "Content-Type": "application/json" } }))
                     : c.delete("/__amc_state");
      }).catch(function () {});
    } catch (e) {}
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
        (nx ? '<div class="cnt-bar"><i data-w="' + nx.pct.toFixed(1) + '"></i></div>' +
              '<div class="cnt-next">Следующая отметка: ' + nx.label + '</div>' : '');
      card.querySelector(".cnt-days b").setAttribute("data-n", d);
      box.appendChild(card);
    });
    animateCounters(box);
  };

  /* ---------- анимация ---------- */

  var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var counted = false;   // цифры «набегают» один раз за открытие, дальше просто ставятся

  var animateCounters = function (box) {
    var nums = box.querySelectorAll(".cnt-days b"), bars = box.querySelectorAll(".cnt-bar i");
    var setBars = function () { bars.forEach(function (b) { b.style.width = b.getAttribute("data-w") + "%"; }); };
    if (calm || counted) {
      nums.forEach(function (b) { b.textContent = b.getAttribute("data-n"); });
      setBars();
      return;
    }
    counted = true;
    var t0 = null, dur = 1100;
    nums.forEach(function (b) { b.textContent = "0"; });
    var step = function (t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      nums.forEach(function (b) { b.textContent = Math.round(+b.getAttribute("data-n") * e); });
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    /* полоски растут вслед за цифрами */
    requestAnimationFrame(function () { requestAnimationFrame(setBars); });
  };

  /* ---------- слова поддержки на сегодня ---------- */

  var CHEER = [
    [1,   ["Первый день самый важный. Вы уже начали.", "Сегодня вы выбрали себя. Это главное."]],
    [2,   ["Первые дни самые трудные. Держитесь, дальше будет легче.", "Тяга приходит волной и уходит. Вы сильнее её."]],
    [4,   ["Организм уже говорит спасибо. Держитесь!", "Вы прошли самое тяжёлое начало. Так держать."]],
    [7,   ["Больше недели! Вы справляетесь.", "Неделя позади. Каждый день теперь даётся чуть проще."]],
    [14,  ["Две недели. Это уже привычка, а не попытка.", "Вы держитесь больше двух недель. Гордитесь собой."]],
    [30,  ["Больше месяца! Это большой путь.", "Месяц трезвости. Близкие это видят."]],
    [90,  ["Три месяца. Вы живёте по-новому.", "Больше трёх месяцев. Это ваша новая норма."]],
    [365, ["Больше года. Вы это сделали.", "Год и больше. Помогите тому, кто только начинает."]]
  ];

  var renderCheer = function () {
    var box = el("cheer");
    if (!box) return;
    var parts = [], top = 0;
    Object.keys(KINDS).forEach(function (kind) {
      if (!state[kind] || !state[kind].on) return;
      var d = streak(kind);
      top = Math.max(top, d);
      parts.push(d + " " + plural(d, "день", "дня", "дней") + " " + (kind === "alcohol" ? "без алкоголя" : "без сигарет"));
    });
    if (!parts.length) { box.hidden = true; return; }
    var pool = CHEER[0][1];
    CHEER.forEach(function (c) { if (top >= c[0]) pool = c[1]; });
    var now = new Date();
    var line = pool[(now.getDate() + now.getMonth()) % pool.length];
    if (now.getDay() === 5 && now.getHours() >= 15) line = "Сегодня пятница, самый частый день срыва. Вечер дома того стоит.";
    else if (now.getDay() === 6 && now.getHours() >= 12) line = "Выходной не повод. Ваши дни подряд дороже одного вечера.";
    box.innerHTML = '<b>Уже ' + parts.join(" и ") + '.</b><span>' + line + '</span>';
    box.hidden = false;
  };

  /* ---------- праздник при новой отметке ---------- */

  var confetti = function (canvas) {
    if (calm || !canvas.getContext) return;
    var ctx = canvas.getContext("2d"), r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr; ctx.scale(dpr, dpr);
    var colors = ["#f5553f", "#671cfd", "#ffc94d", "#22c55e", "#ffffff"], bits = [];
    for (var i = 0; i < 110; i++) {
      bits.push({ x: r.width / 2, y: r.height * 0.42, vx: (Math.random() - 0.5) * 9, vy: -Math.random() * 9 - 3,
                  s: 5 + Math.random() * 6, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3, c: colors[i % colors.length] });
    }
    var t0 = performance.now();
    var frame = function (t) {
      var live = t - t0 < 2600;
      ctx.clearRect(0, 0, r.width, r.height);
      bits.forEach(function (b) {
        b.vy += 0.22; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.a += b.va;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
        ctx.globalAlpha = Math.max(0, 1 - (t - t0) / 2600);
        ctx.fillStyle = b.c; ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2); ctx.restore();
      });
      if (live) requestAnimationFrame(frame); else ctx.clearRect(0, 0, r.width, r.height);
    };
    requestAnimationFrame(frame);
  };

  /* Пройденные отметки празднуем один раз. Если человек начал вести дневник
     задним числом, празднуем только самую большую, остальные молча отмечаем. */
  var checkCelebrate = function () {
    var box = el("celebrate");
    if (!box || !state) return;
    state.party = state.party || {};
    var show = null;
    Object.keys(KINDS).forEach(function (kind) {
      if (!state[kind] || !state[kind].on) return;
      var d = streak(kind), best = null;
      MILESTONES[kind].forEach(function (m) {
        if (d >= m[0] && m[0] >= 1) {
          var key = kind + ":" + m[0];
          if (!state.party[key]) { state.party[key] = true; best = { kind: kind, m: m, d: d }; }
        }
      });
      if (best && (!show || best.m[0] > show.m[0])) show = best;
    });
    save();
    if (!show) return;
    el("cel-kind").textContent = KINDS[show.kind].title;
    el("cel-title").textContent = show.m[1].charAt(0).toUpperCase() + show.m[1].slice(1) + "!";
    el("cel-text").textContent = show.m[2] + (show.d > show.m[0] ? " Сейчас уже " + show.d + " " + plural(show.d, "день", "дня", "дней") + " подряд." : "");
    box.hidden = false;
    requestAnimationFrame(function () { box.classList.add("open"); confetti(el("cel-canvas")); });
    el("cel-ok").focus();
  };

  var closeCelebrate = function () {
    var box = el("celebrate");
    box.classList.remove("open");
    setTimeout(function () { box.hidden = true; }, 250);
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
    renderCheer();
    renderCounters();
    renderScreen();
    renderCalendar();
    renderSavings();
    renderMilestones();
    renderLessons();
    checkCelebrate();
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

  /* ---------- напоминания ----------
     На iPhone уведомления работают только в приложении, добавленном на
     домашний экран, и только через service worker. Пока приложение закрыто,
     веб не может ничего запланировать без push-сервера, поэтому мы
     показываем напоминание в момент открытия дневника. */

  var swReg = null;

  var notifSupported = function () {
    return "serviceWorker" in navigator && "Notification" in window &&
           typeof ServiceWorkerRegistration !== "undefined" &&
           "showNotification" in ServiceWorkerRegistration.prototype;
  };

  var standalone = function () {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
           window.navigator.standalone === true;
  };

  var isIOS = function () {
    return /iP(hone|ad|od)/.test(navigator.userAgent) ||
           (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  };

  /* Ежедневное напоминание с сервера (admin/push.php). На сервер уходит только
     адрес доставки, который выдал браузер; что и сколько дней, он не знает. */
  var VAPID = "BIPAjZvyadzzWIZgmw7FbYDLaZfNDHw6hAIHIwQH0DBDpuxZYDBtoogS1xaNihlznQKaMibBSHlI8lAXgkWMeMU";
  var pushSupported = function () { return notifSupported() && "PushManager" in window; };
  var b64ToBytes = function (s) {
    var raw = atob((s + "===".slice((s.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  };
  var pushPost = function (what, sub) {
    return fetch("/admin/push.php?a=" + what, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }), keepalive: true
    }).catch(function () {});
  };
  /* подписаться (или подтвердить подписку) и сообщить серверу адрес */
  var pushOn = function () {
    if (!swReg || !pushSupported() || Notification.permission !== "granted") return Promise.resolve(null);
    return swReg.pushManager.getSubscription().then(function (sub) {
      return sub || swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID) });
    }).then(function (sub) {
      if (!sub) return null;
      pushPost("sub", sub);
      try { if (!localStorage.getItem("amc-push")) { localStorage.setItem("amc-push", "1"); beacon("Включил напоминания", "дневник:напоминания"); } } catch (e) {}
      return sub;
    }).catch(function () { return null; });
  };
  var pushOff = function () {
    if (!swReg || !pushSupported()) return Promise.resolve();
    return swReg.pushManager.getSubscription().then(function (sub) {
      if (!sub) return;
      pushPost("unsub", sub);
      return sub.unsubscribe();
    }).catch(function () {}).then(function () {
      try { localStorage.setItem("amc-push-off", "1"); localStorage.removeItem("amc-push"); } catch (e) {}
    });
  };
  var pushIsOff = function () { try { return localStorage.getItem("amc-push-off") === "1"; } catch (e) { return false; } };

  var notifCard = el("notif-card");
  var notifState = el("notif-state");
  var notifBtn = el("notif-enable");
  var notifTest = el("notif-test");
  var notifNote = el("notif-note");
  var notifOff = el("notif-off");

  var paintNotifUi = function () {
    if (!notifCard) return;
    var supported = notifSupported();

    if (!supported) {
      notifState.textContent = "Браузер не поддерживает";
      notifNote.textContent = isIOS()
        ? "На iPhone уведомления доступны только в приложении, добавленном на домашний экран. Добавьте дневник на экран «Домой» и откройте его с значка."
        : "Этот браузер не умеет показывать уведомления с сайта.";
      notifBtn.hidden = true;
      notifTest.hidden = true;
      return;
    }

    if (isIOS() && !standalone()) {
      notifState.textContent = "Нужен значок на домашнем экране";
      notifNote.textContent = "На iPhone уведомления работают только из приложения, добавленного на экран «Домой». Инструкция ниже на этой странице.";
      notifBtn.hidden = true;
      notifTest.hidden = true;
      return;
    }

    var perm = Notification.permission;
    if (perm === "granted" && pushIsOff()) {
      notifState.textContent = "Выключены";
      notifBtn.hidden = false;
      notifTest.hidden = true;
      if (notifOff) notifOff.hidden = true;
      notifNote.textContent = "Каждый вечер короткое сообщение: сколько дней вы держитесь и пара слов поддержки.";
    } else if (perm === "granted") {
      notifState.textContent = "Включены";
      notifBtn.hidden = true;
      notifTest.hidden = false;
      if (notifOff) notifOff.hidden = !pushSupported();
      notifNote.textContent = pushSupported()
        ? "Каждый вечер придёт короткое сообщение: сколько дней вы держитесь и пара слов поддержки, в пятницу и субботу отдельные. Даже если дневник закрыт. Что именно вы отмечаете, знает только ваш телефон."
        : "Раз в день при открытии дневник покажет короткое сообщение поддержки и отметит пройденные этапы.";
    } else if (perm === "denied") {
      notifState.textContent = "Запрещены";
      notifBtn.hidden = true;
      notifTest.hidden = true;
      notifNote.textContent = "Вы отклонили запрос. Разрешить снова можно в настройках браузера или телефона для этого сайта.";
    } else {
      notifState.textContent = "Выключены";
      notifBtn.hidden = false;
      notifTest.hidden = true;
      notifNote.textContent = "Каждый вечер короткое сообщение: сколько дней вы держитесь и пара слов поддержки, в пятницу и субботу отдельные. Всё считается на вашем телефоне.";
    }
  };

  var notify = function (title, body, tag) {
    if (!swReg || !notifSupported() || Notification.permission !== "granted") return;
    try {
      swReg.showNotification(title, {
        body: body,
        tag: tag || "amc",
        icon: "assets/img/icon-192.png",
        badge: "assets/img/icon-192.png",
        lang: "ru",
        data: { url: "./app.html" }
      });
    } catch (e) {}
  };

  /* Тексты напоминаний. Пятница и суббота вынесены отдельно: это дни,
     когда срываются чаще всего. */
  var NOTES = {
    any: [
      ["Сегодня новый день", "И он начинается с чистого листа. Всё будет хорошо. Просто не пейте сегодня."],
      ["Ещё один трезвый день", "Вы уже знаете, что справляетесь. Сегодня будет так же."],
      ["Один день за раз", "Не нужно обещать себе всю жизнь. Достаточно сегодняшнего дня."],
      ["Вы держитесь", "Каждый прожитый день делает следующий чуть легче."],
      ["Если потянет", "Тяга держится минут пятнадцать и уходит. Вы пережидали её не раз."]
    ],
    evening: [
      ["Вечер самый сложный", "Займите руки: чай, душ, прогулка, книга. Через час станет легче."],
      ["День почти прошёл", "Осталось немного. Лягте пораньше, и утром счётчик станет больше."]
    ],
    fri: [
      ["Сегодня пятница", "Самый частый день срыва. Не ходите туда, где наливают. Лучше книга, прогулка или ранний сон."],
      ["Пятничный вечер", "Если позовут, ответ готов: «Я не пью». Объяснять ничего не нужно."],
      ["Пятница проверяет", "Один вечер не стоит всех ваших дней подряд. Останьтесь дома."]
    ],
    sat: [
      ["Суббота", "Выходной не повод. Побудьте дома, почитайте, выспитесь. Завтра скажете себе спасибо."],
      ["Сегодня суббота", "Тусовка подождёт. Ваши дни подряд дороже одного вечера."],
      ["Суббота без бара", "Сходите погулять, посмотрите фильм, откройте книгу. Это тоже вечер."]
    ],
    sun: [
      ["Воскресенье", "Неделя позади, и вы прошли её трезвым. Это уже результат."]
    ],
    mon: [
      ["Новая неделя", "Хорошее время начать заново, если сорвались. И продолжить, если нет."]
    ]
  };

  /* какой набор подходит этому дню и часу */
  var pickNote = function () {
    var n = new Date(), dow = n.getDay(), h = n.getHours(), pool;
    if (dow === 5 && h >= 15) pool = NOTES.fri;
    else if (dow === 6 && h >= 12) pool = NOTES.sat;
    else if (dow === 0) pool = NOTES.sun;
    else if (dow === 1) pool = NOTES.mon;
    else if (h >= 18) pool = NOTES.evening;
    else pool = NOTES.any;

    state.noteIx = state.noteIx || {};
    var key = pool === NOTES.fri ? "fri" : pool === NOTES.sat ? "sat"
            : pool === NOTES.sun ? "sun" : pool === NOTES.mon ? "mon"
            : pool === NOTES.evening ? "evening" : "any";
    var i = (typeof state.noteIx[key] === "number" ? state.noteIx[key] + 1 : 0) % pool.length;
    state.noteIx[key] = i;
    return pool[i];
  };

  /* что показать при открытии: новая отметка или незаполненный день */
  var checkReminders = function () {
    if (!state || Notification.permission !== "granted") return;
    state.seen = state.seen || {};
    var fired = false;

    /* пройденная отметка важнее всего остального */
    Object.keys(KINDS).forEach(function (kind) {
      if (fired || !state[kind] || !state[kind].on) return;
      var d = streak(kind);
      var list = MILESTONES[kind];
      for (var i = list.length - 1; i >= 0; i--) {
        if (d >= list[i][0]) {
          var key = kind + ":" + list[i][0];
          if (!state.seen[key]) {
            state.seen[key] = true;
            save();
            notify(KINDS[kind].title + ": " + list[i][1],
                   list[i][2] + " Уже " + d + " " + plural(d, "день", "дня", "дней") + " подряд.",
                   "ms-" + key);
            fired = true;
          }
          break;
        }
      }
    });
    if (fired) return;

    /* иначе одно поддерживающее сообщение, не чаще раза в день.
       Если включены вечерние напоминания с сервера, их хватает. */
    if (pushSupported() && !pushIsOff()) return;
    var day = iso(today());
    if (state.seen["note:" + day]) return;
    state.seen["note:" + day] = true;

    var m = pickNote();
    var body = m[1];
    var d2 = (state.alcohol && state.alcohol.on) ? streak("alcohol")
           : (state.tobacco && state.tobacco.on) ? streak("tobacco") : 0;
    if (d2 > 0) body += " Ваш счёт: " + d2 + " " + plural(d2, "день", "дня", "дней") + ".";
    save();
    notify(m[0], body, "daily-" + day);
  };

  if (notifCard) {
    paintNotifUi();
    if (notifBtn) {
      notifBtn.addEventListener("click", function () {
        /* разрешение запрашивается только по нажатию, иначе браузеры его игнорируют */
        try { localStorage.removeItem("amc-push-off"); } catch (e) {}
        Notification.requestPermission().then(function (p) {
          paintNotifUi();
          if (p === "granted") {
            pushOn();
            notify("Напоминания включены", "Каждый вечер дневник напомнит, сколько дней вы держитесь.", "hello");
          }
        });
      });
    }
    if (notifOff) {
      notifOff.addEventListener("click", function () { pushOff().then(paintNotifUi); });
    }
    if (notifTest) {
      notifTest.addEventListener("click", function () {
        var m = pickNote();
        save();
        notify(m[0], m[1], "demo");
      });
    }
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        swReg = reg;
        paintNotifUi();
        if (!pushIsOff()) pushOn();
        mirrorState();
        setTimeout(checkReminders, 1200);
      }).catch(function () {});
    });
  }

  /* ---------- установка и учёт ----------
     Во вкладку «Клики» админки уходят три события, без данных о человеке:
     установка, запуск с домашнего экрана (не чаще раза в день с телефона)
     и включение напоминаний. */

  var beacon = function (label, to) {
    if (!navigator.sendBeacon) return;
    try { navigator.sendBeacon("/admin/track.php", JSON.stringify({ p: "/app.html", t: "Дневник трезвости", l: label, h: to })); } catch (e) {}
  };
  var once = function (key) {
    try { if (localStorage.getItem(key)) return false; localStorage.setItem(key, "1"); return true; } catch (e) { return false; }
  };

  if (standalone()) {
    if (once("amc-installed")) beacon("Установил дневник", "дневник:установка");
    if (once("amc-launch-" + iso(today()))) beacon("Открыл дневник с домашнего экрана", "дневник:запуск");
  }
  window.addEventListener("appinstalled", function () {
    if (once("amc-installed")) beacon("Установил дневник", "дневник:установка");
    var b = el("install-btn");
    if (b) b.hidden = true;
  });

  /* Chrome и браузеры на его основе умеют ставить приложение одной кнопкой */
  var installEvt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    installEvt = e;
    var b = el("install-btn");
    if (b) b.hidden = false;
  });
  var installBtn = el("install-btn");
  if (installBtn) {
    installBtn.addEventListener("click", function () {
      if (!installEvt) return;
      installEvt.prompt();
      installEvt.userChoice.then(function () { installEvt = null; installBtn.hidden = true; });
    });
  }

  /* инструкция: сразу открыть вкладку под телефон человека */
  var instTabs = document.querySelectorAll("[data-inst]");
  var showInst = function (name) {
    instTabs.forEach(function (t) {
      var on = t.getAttribute("data-inst") === name;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.classList.toggle("on", on);
    });
    document.querySelectorAll("[data-inst-pane]").forEach(function (p) { p.hidden = p.getAttribute("data-inst-pane") !== name; });
  };
  if (instTabs.length) {
    instTabs.forEach(function (t) { t.addEventListener("click", function () { showInst(t.getAttribute("data-inst")); }); });
    showInst(/Android/i.test(navigator.userAgent) ? "android" : "iphone");
  }

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

  el("cel-ok").addEventListener("click", closeCelebrate);
  el("celebrate").addEventListener("click", function (e) { if (e.target === el("celebrate")) closeCelebrate(); });

  el("panic-open").addEventListener("click", openPanic);
  panic.querySelectorAll("[data-close-panic]").forEach(function (b) {
    b.addEventListener("click", closePanic);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panic.classList.contains("open")) closePanic();
    if (e.key === "Escape" && !el("celebrate").hidden) closeCelebrate();
  });

  el("app-reset").addEventListener("click", function () {
    if (!window.confirm("Удалить все записи дневника? Действие нельзя отменить.")) return;
    try { localStorage.removeItem(KEY); } catch (e) {}
    state = null;
    mirrorState();
    pushOff();
    showSetup();
    updateLessonMarks();
  });
})();
