#!/usr/bin/env python3
"""Собирает блог из blog-src/*.md в обычные HTML-страницы.

    python3 blog.py

Сайт остаётся статическим: скрипт запускается здесь, на Mac, а на сервер
уезжают готовые HTML. Шапка, меню, окно с телефоном и подвал берутся из
history.html при каждой сборке, так что правка меню там доезжает и до блога.

Статья со status: approved попадает в blog/, в список blog.html, в sitemap.xml
и в llms.txt. Статья со status: draft собирается в drafts/ с плашкой
«черновик» и вопросами к врачу; папка drafts на сервер не уезжает (SKIP_DIRS
в deploy.py), это копия для чтения и согласования.

Разметка статьи:
    ---                      шапка: slug, title, description, topic, status,
    ...                      published, updated, reviewer, image, related, old
    ---
    ## Заголовок             раздел (попадает в оглавление)
    ### Подзаголовок
    - пункт / 1. пункт       списки
    **жирный**, [текст](price-and-services.html), [текст](blog:slug)
    ::: warn Заголовок       цветная врезка (warn, note), закрывается :::
    ::: questions            вопросы к врачу, видны только в черновике
    {{price:Группа|Услуга}}  цена из price-and-services.html (Группа|Услуга|Время
                             для строк с часами)
    {{prices:Группа}}        вся таблица группы из прайса
"""
import datetime
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "blog-src")
SITE = "https://sad56.spb.ru/"
CHROME_PAGE = "history.html"

MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
          "августа", "сентября", "октября", "ноября", "декабря"]

PEOPLE = {
    "sokolov": {
        "name": "Соколов Андрей Владимирович",
        "short": "Андрей Владимирович Соколов",
        "job": "Заместитель главного врача, терапевт, невролог",
        "bio": "Выпускник Военно-медицинской академии им. С. М. Кирова (1998). "
               "Интернатура по терапии, профессиональная переподготовка по неврологии, "
               "организации здравоохранения и общественному здоровью. Ведущий терапевт "
               "и невролог клиники: неврологические и терапевтические расстройства "
               "у больных алкоголизмом.",
        "photo": "assets/img/author-sokolov.jpg",
    },
    "nemchaninov": {
        "name": "Немчанинов Глеб Григорьевич",
        "short": "Глеб Григорьевич Немчанинов",
        "job": "Главный врач, психиатр-нарколог, психотерапевт",
        "bio": "Выпускник Военно-медицинской академии им. С. М. Кирова (2007). "
               "Интернатура по психиатрии, профессиональная переподготовка по "
               "психиатрии-наркологии и психотерапии.",
        "photo": "assets/img/author-nemchaninov.jpg",
    },
}
AUTHOR = "sokolov"

ICON_PHONE = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
              'stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 '
              '19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 '
              '4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 '
              '0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z"/></svg>')
ICON_WARN = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
             'stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 '
             '1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/>'
             '<path d="M12 17h.01"/></svg>')
ICON_NOTE = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
             'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/>'
             '<path d="M12 16v-4"/><path d="M12 8h.01"/></svg>')
ICON_ARROW = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
              'stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>')


def die(msg):
    sys.exit("blog.py: " + msg)


def esc(s):
    return html.escape(s, quote=True)


def ru_date(iso):
    d = datetime.date.fromisoformat(iso)
    return "%d %s %d" % (d.day, MONTHS[d.month - 1], d.year)


def plural(n, one, few, many):
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


# ---------- prices, read from the live price page ----------

def load_prices():
    s = open(os.path.join(ROOT, "price-and-services.html"), encoding="utf-8").read()
    groups = {}
    for g in re.finditer(r'<div class="pgroup[^"]*"[^>]*>\s*<h3>(.*?)</h3>(.*?)</table>', s, re.S):
        name = html.unescape(g.group(1)).strip()
        rows, span_label, span_left = [], None, 0
        for tr in re.finditer(r"<tr>(.*?)</tr>", g.group(2), re.S):
            if "<th" in tr.group(1):
                continue
            cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
                     for c in re.findall(r"<td[^>]*>(.*?)</td>", tr.group(1), re.S)]
            m = re.search(r'rowspan="(\d+)"', tr.group(1))
            if m:
                span_label, span_left = cells[0], int(m.group(1))
            elif span_left:
                cells = [span_label] + cells
            if span_left:
                span_left -= 1
            rows.append(cells)
        groups[name] = rows
    if not groups:
        die("не нашёл ни одной группы цен в price-and-services.html")
    return groups


def price_lookup(prices, ref):
    parts = [p.strip() for p in ref.split("|")]
    rows = prices.get(parts[0])
    if rows is None:
        die("нет группы цен «%s»" % parts[0])
    for r in rows:
        if r[0] == parts[1] and (len(parts) < 3 or r[1] == parts[2]):
            return r[-1]
    die("нет строки «%s» в группе «%s»" % (" | ".join(parts[1:]), parts[0]))


def price_table(prices, group):
    rows = prices.get(group)
    if rows is None:
        die("нет группы цен «%s»" % group)
    timed = any(len(r) == 3 for r in rows)
    out = ['<div class="ptable-wrap"><table class="ptable"><thead><tr><th>Услуга</th>']
    if timed:
        out.append("<th>Время</th>")
    out.append('<th style="text-align:right">Стоимость</th></tr></thead><tbody>')
    i = 0
    while i < len(rows):
        # rows sharing one service name (the hours of a home visit) share one cell, as on the price page
        n = 1
        while timed and i + n < len(rows) and rows[i + n][0] == rows[i][0]:
            n += 1
        for k in range(n):
            r = rows[i + k]
            cells = r if not timed or len(r) == 3 else [r[0], "-", r[-1]]
            tds = []
            if k == 0:
                tds.append('<td rowspan="%d">%s</td>' % (n, esc(cells[0])) if n > 1 else "<td>%s</td>" % esc(cells[0]))
            if timed:
                tds.append('<td style="white-space:nowrap">%s</td>' % esc(cells[1]))
            tds.append("<td>%s</td>" % esc(cells[-1]))
            out.append("<tr>" + "".join(tds) + "</tr>")
        i += n
    out.append("</tbody></table></div>")
    return "".join(out)


# ---------- sources ----------

def parse_source(path):
    text = open(path, encoding="utf-8").read()
    m = re.match(r"---\n(.*?)\n---\n(.*)", text, re.S)
    if not m:
        die("%s: нет шапки ---" % path)
    meta = {}
    for line in m.group(1).splitlines():
        if line.strip():
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip()
    for k in ("slug", "title", "description", "topic", "status"):
        if not meta.get(k):
            die("%s: в шапке нет %s" % (path, k))
    if meta["status"] not in ("draft", "approved"):
        die("%s: status должен быть draft или approved" % path)
    if meta["status"] == "approved" and not meta.get("published"):
        die("%s: у одобренной статьи нужна дата published" % path)
    meta["related"] = [x.strip() for x in meta.get("related", "").split(",") if x.strip()]
    meta["old"] = [x.strip() for x in meta.get("old", "").split(",") if x.strip()]
    meta["reviewer"] = meta.get("reviewer", "nemchaninov")
    meta["body"] = m.group(2)
    return meta


# ---------- markdown subset ----------

class Ctx:
    """What a page needs to resolve links: its depth and which slugs exist where."""
    def __init__(self, prefix, mode, articles, prices):
        self.prefix, self.mode, self.articles, self.prices = prefix, mode, articles, prices

    def article_href(self, slug):
        a = self.articles.get(slug)
        if not a:
            die("ссылка на несуществующую статью blog:%s" % slug)
        if a["status"] == "approved":
            return self.prefix + "blog/%s.html" % slug
        if self.mode == "draft":
            return self.prefix + "drafts/%s.html" % slug
        return None      # a published page must not link to an unpublished draft

    def href(self, url):
        if url.startswith("blog:"):
            return self.article_href(url[5:])
        if re.match(r"^(https?:|tel:|mailto:|#)", url):
            return url
        return self.prefix + url


def inline(s, ctx):
    s = esc(s)
    # "руб." at the end of a sentence must not become "руб.."
    s = re.sub(r"\{\{price:(.+?)\}\}(\.?)", lambda m: esc(price_lookup(ctx.prices, html.unescape(m.group(1)))) +
               ("" if price_lookup(ctx.prices, html.unescape(m.group(1))).endswith(".") else m.group(2)), s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)

    def link(m):
        href = ctx.href(html.unescape(m.group(2)))
        if href is None:
            return m.group(1)
        return '<a href="%s">%s</a>' % (esc(href), m.group(1))
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, s)
    return s


def slugify_heading(t, used):
    tr = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
                  ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o",
                   "p", "r", "s", "t", "u", "f", "h", "c", "ch", "sh", "sch", "", "y", "", "e", "yu", "ya"]))
    base = "".join(tr.get(ch, ch) for ch in t.lower())
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")[:48].strip("-") or "part"
    sid, n = base, 2
    while sid in used:
        sid, n = "%s-%d" % (base, n), n + 1
    used.add(sid)
    return sid


def render_body(src, ctx):
    """Returns (html, toc, questions, words)."""
    out, toc, questions, used = [], [], [], set()
    para, lst, lst_kind = [], [], None
    block = None          # (kind, title, lines)

    def flush_para():
        if para:
            out.append("<p>%s</p>" % inline(" ".join(para), ctx))
            para.clear()

    def flush_list():
        nonlocal lst_kind
        if lst:
            tag = "ol" if lst_kind == "ol" else "ul"
            out.append("<%s>%s</%s>" % (tag, "".join("<li>%s</li>" % inline(i, ctx) for i in lst), tag))
            lst.clear()
        lst_kind = None

    lines = src.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        i += 1
        if block is not None:
            if line.strip() == ":::":
                kind, title, blines = block
                block = None
                if kind == "questions":
                    questions.extend(l[2:].strip() for l in blines if l.startswith("- "))
                    continue
                inner, _, _, _ = render_body("\n".join(blines), ctx)
                icon = ICON_WARN if kind == "warn" else ICON_NOTE
                head = '<div class="callout-h">%s<b>%s</b></div>' % (icon, inline(title, ctx)) if title else ""
                out.append('<aside class="callout callout-%s">%s%s</aside>' % (kind, head, inner))
            else:
                block[2].append(line)
            continue
        if line.startswith(":::"):
            flush_para(); flush_list()
            kind, _, title = line[3:].strip().partition(" ")
            if kind not in ("warn", "note", "questions"):
                die("неизвестная врезка ::: %s" % kind)
            block = (kind, title.strip(), [])
            continue
        if not line.strip():
            flush_para(); flush_list()
            continue
        m = re.match(r"\{\{prices:(.+?)\}\}$", line.strip())
        if m:
            flush_para(); flush_list()
            out.append(price_table(ctx.prices, m.group(1).strip()))
            continue
        m = re.match(r"(#{2,3}) (.+)$", line)
        if m:
            flush_para(); flush_list()
            level, text = len(m.group(1)), m.group(2).strip()
            sid = slugify_heading(text, used)
            if level == 2:
                toc.append((sid, text))
            out.append('<h%d id="%s">%s</h%d>' % (level, sid, inline(text, ctx), level))
            continue
        m = re.match(r"(- |\d+\. )(.+)$", line)
        if m:
            flush_para()
            kind = "ol" if m.group(1)[0].isdigit() else "ul"
            if lst_kind and kind != lst_kind:
                flush_list()
            lst_kind = kind
            lst.append(m.group(2))
            continue
        if lst and line.startswith("  "):
            lst[-1] += " " + line.strip()
            continue
        flush_list()
        para.append(line.strip())
    if block is not None:
        die("врезка ::: %s не закрыта" % block[0])
    flush_para(); flush_list()
    body = "\n".join(out)
    words = len(re.findall(r"\w+", re.sub(r"<[^>]+>", " ", body)))
    return body, toc, questions, words


# ---------- shared chrome from history.html ----------

def load_chrome():
    s = open(os.path.join(ROOT, CHROME_PAGE), encoding="utf-8").read()
    a, b = s.find('<header class="header"'), s.find("<main>")
    c, d = s.find("</main>"), s.find('<script src="assets/js/main.js">')
    if min(a, b, c, d) < 0 or not a < b < c < d:
        die("не разобрал шапку и подвал в %s" % CHROME_PAGE)
    top = s[a:b]
    bottom = s[c + len("</main>"):d]
    bottom = bottom.replace("</html>", "")
    # the page-specific active mark goes; the blog page sets its own
    top = top.replace(' class="active"', "")
    return top, bottom


def relink(fragment, prefix):
    if not prefix:
        return fragment
    return re.sub(r'(href|src)="(?!https?:|tel:|mailto:|#|/|data:)([^"]*)"',
                  lambda m: '%s="%s%s"' % (m.group(1), prefix, m.group(2)), fragment)


def mark_active(fragment, target):
    return fragment.replace('<a href="%s">' % target, '<a href="%s" class="active">' % target, 1)


# ---------- pages ----------

def head(title, description, canonical, prefix, og_image, jsonld, noindex=False, og_type="website"):
    robots = '\n  <meta name="robots" content="noindex, nofollow">' if noindex else ""
    img = SITE + og_image
    return """<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>{t}</title>
  <meta name="description" content="{d}">{robots}
  <link rel="icon" href="{p}favicon.svg" type="image/svg+xml">
  <link rel="icon" href="{p}favicon.ico" sizes="32x32">
  <link rel="canonical" href="{c}">
  <meta property="og:type" content="{ot}">
  <meta property="og:site_name" content="Академический Медицинский Центр">
  <meta property="og:locale" content="ru_RU">
  <meta property="og:url" content="{c}">
  <meta property="og:title" content="{t}">
  <meta property="og:description" content="{d}">
  <meta property="og:image" content="{img}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{t}">
  <meta name="twitter:description" content="{d}">
  <meta name="twitter:image" content="{img}">
  <link rel="apple-touch-icon" href="{p}assets/img/icon-180.png">
  <meta name="theme-color" content="#f5553f">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="{p}assets/css/style.css">
  <script type="application/ld+json">
{j}
  </script>
</head>
<body>
""".format(t=esc(title), d=esc(description), robots=robots, p=prefix, c=canonical, ot=og_type,
           img=img, j=json.dumps(jsonld, ensure_ascii=False, indent=2))


def foot(prefix, bottom):
    return bottom + '\n<script src="%sassets/js/main.js"></script>\n</body>\n</html>\n' % prefix


def crumbs_ld(items):
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": n + 1, "name": name, "item": url}
        for n, (name, url) in enumerate(items)]}


def person_ld(key, prefix_url=SITE):
    p = PEOPLE[key]
    return {"@type": "Person", "name": p["name"], "jobTitle": p["job"],
            "image": prefix_url + p["photo"], "url": SITE + "index.html#doctors",
            "worksFor": {"@id": SITE + "#clinic"}}


CLINIC_LD = {"@type": "MedicalClinic", "@id": SITE + "#clinic",
             "name": "Академический Медицинский Центр", "url": SITE,
             "logo": {"@type": "ImageObject", "url": SITE + "assets/img/icon-512.png"},
             "telephone": "+7-812-314-44-82"}


def person_card(key, prefix, label, extra=""):
    p = PEOPLE[key]
    return """<div class="person-card">
  <img src="{p}{photo}" alt="{name}" width="160" height="160" loading="lazy">
  <div>
    <span class="person-label">{label}</span>
    <b>{name}</b>
    <span class="person-job">{job}</span>
    <p>{bio}</p>{extra}
  </div>
</div>""".format(p=prefix, photo=p["photo"], name=esc(p["name"]), label=label,
                 job=esc(p["job"]), bio=esc(p["bio"]), extra=extra)


def call_card():
    return """<div class="post-cta">
  <div>
    <h3>Если нужна помощь сейчас</h3>
    <p>Позвоните: врач ответит сам, круглосуточно и анонимно. Консультация и анализы в день обращения бесплатно.</p>
  </div>
  <a class="btn btn-primary btn-lg" href="tel:+78123144482">{icon}(812) 314-44-82</a>
</div>""".format(icon=ICON_PHONE)


def article_page(a, ctx, chrome):
    top, bottom = chrome
    prefix, draft = ctx.prefix, ctx.mode == "draft"
    body, toc, questions, words = render_body(a["body"], ctx)
    minutes = max(1, round(words / 180))
    url = SITE + "blog/%s.html" % a["slug"]
    image = a.get("image") or "assets/img/og-cover.jpg"
    author = PEOPLE[AUTHOR]
    reviewer = a["reviewer"] if a["reviewer"] != "none" else None

    when = ru_date(a["published"]) if a.get("published") else "черновик"
    updated = a.get("updated") or a.get("published")
    crumbs = [("Главная", SITE), ("Блог", SITE + "blog.html"), (a["title"], url)]
    article_ld = {"@type": "Article", "@id": url + "#article", "headline": a["title"],
                  "description": a["description"], "image": SITE + image,
                  "inLanguage": "ru", "wordCount": words,
                  "author": person_ld(AUTHOR), "publisher": CLINIC_LD,
                  "mainEntityOfPage": url, "articleSection": a["topic"]}
    if a.get("published"):
        article_ld["datePublished"] = a["published"]
        article_ld["dateModified"] = updated
    page_ld = {"@type": "MedicalWebPage", "@id": url, "url": url, "name": a["title"],
               "inLanguage": "ru", "mainEntity": {"@id": url + "#article"},
               "breadcrumb": {"@id": url + "#crumbs"}}
    if reviewer:
        page_ld["reviewedBy"] = person_ld(reviewer)
        if updated:
            page_ld["lastReviewed"] = updated
    bc = crumbs_ld(crumbs)
    bc["@id"] = url + "#crumbs"
    jsonld = {"@context": "https://schema.org", "@graph": [page_ld, article_ld, bc]}

    toc_html = ""
    if len(toc) >= 3:
        toc_html = '<nav class="toc" aria-label="Содержание"><b>Содержание</b><ol>%s</ol></nav>' % "".join(
            '<li><a href="#%s">%s</a></li>' % (sid, inline(t, ctx)) for sid, t in toc)

    draft_html = ""
    if draft:
        qs = "".join("<li>%s</li>" % inline(q, ctx) for q in questions) or "<li>Вопросов нет.</li>"
        draft_html = """<div class="draft-note">
  <b>Черновик на согласовании.</b> Статья не опубликована и не видна поисковикам. Её нужно прочитать
  и одобрить автору{rv}.
  <h4>Что уточнить у врача</h4>
  <ol>{qs}</ol>
</div>""".format(qs=qs, rv=" и главному врачу" if reviewer else "")

    review_html = ""
    if reviewer:
        review_html = person_card(reviewer, prefix, "Медицинская проверка",
                                  '\n    <span class="person-date">Проверено: %s</span>' % (
                                      ru_date(updated) if updated else "ожидает проверки"))

    related = []
    for slug in a["related"]:
        href = ctx.article_href(slug)
        if href:
            r = ctx.articles[slug]
            related.append('<a class="post-card" href="%s"><span class="post-topic">%s</span><h3>%s</h3><p>%s</p></a>' % (
                esc(href), esc(r["topic"]), esc(r["title"]), esc(r["description"])))
    related_html = ""
    if related:
        related_html = """<section class="section soft-sec">
  <div class="container">
    <h2 class="h2">Читать дальше</h2>
    <div class="blog-grid">{cards}</div>
  </div>
</section>""".format(cards="".join(related))

    title_tag = "%s | Блог АМЦ" % a["title"]
    page = [head(title_tag, a["description"], url, prefix, image, jsonld, noindex=draft, og_type="article")]
    page.append(relink(mark_active(top, "blog.html"), prefix))
    page.append("""<main>

<section class="page-hero post-hero">
  <span class="emblem-float ef-a" aria-hidden="true"></span>
  <span class="emblem-float ef-b" aria-hidden="true"></span>
  <div class="container post-narrow">
    <nav class="crumbs" aria-label="Навигация по разделам"><a href="{p}index.html">Главная</a><span>/</span><a href="{p}blog.html">Блог</a></nav>
    <span class="eyebrow">{topic}</span>
    <h1 class="post-title">{h1}</h1>
    <p class="lead">{desc}</p>
    <div class="post-byline">
      <img src="{p}{photo}" alt="" width="48" height="48">
      <div><b>{aname}</b><span>{ajob}</span></div>
      <div class="post-when"><span>{when}</span><span>{mins} {mword} чтения</span></div>
    </div>
  </div>
</section>

<section class="section post-section">
  <div class="container post-narrow">
    {draft}
    {toc}
    <article class="prose">
{body}
    </article>
    <p class="post-disclaimer">Статья носит справочный характер и не заменяет консультацию врача. Имеются противопоказания. Необходима консультация специалиста.</p>
    {cta}
    <div class="post-people">
      {author}
      {review}
    </div>
  </div>
</section>

{related}

</main>
""".format(p=prefix, topic=esc(a["topic"]), h1=esc(a.get("h1") or a["title"]), desc=esc(a["description"]),
           photo=author["photo"], aname=esc(author["name"]), ajob=esc(author["job"]),
           when=when, mins=minutes, mword=plural(minutes, "минута", "минуты", "минут"),
           draft=draft_html, toc=toc_html, body=body, cta=call_card(),
           author=person_card(AUTHOR, prefix, "Автор статьи",
                              '\n    <a class="person-more" href="%sindex.html#doctors">Все врачи центра %s</a>' % (prefix, ICON_ARROW)),
           review=review_html, related=related_html))
    page.append(foot(prefix, relink(bottom, prefix)))
    return "".join(page), words


def list_page(items, ctx, chrome, draft=False):
    top, bottom = chrome
    prefix = ctx.prefix
    url = SITE + "blog.html"
    author = PEOPLE[AUTHOR]
    cards = []
    for a in items:
        href = ctx.article_href(a["slug"])
        when = ru_date(a["published"]) if a.get("published") else "черновик"
        cards.append("""<a class="post-card" href="{h}">
  <span class="post-topic">{topic}</span>
  <h3>{t}</h3>
  <p>{d}</p>
  <span class="post-card-foot"><img src="{p}{photo}" alt="" width="32" height="32" loading="lazy">{name}<i>{when}</i></span>
</a>""".format(h=esc(href), topic=esc(a["topic"]), t=esc(a["title"]), d=esc(a["description"]),
               p=prefix, photo=author["photo"], name=esc(author["short"]), when=when))
    grid = '<div class="blog-grid">%s</div>' % "".join(cards) if cards else \
        '<p class="blog-empty">Первые статьи сейчас на проверке у врачей и скоро появятся здесь.</p>'

    ld_items = [{"@type": "ListItem", "position": n + 1, "url": SITE + "blog/%s.html" % a["slug"],
                 "name": a["title"]} for n, a in enumerate(items)]
    jsonld = {"@context": "https://schema.org", "@graph": [
        {"@type": "Blog", "@id": url, "url": url, "name": "Блог Академического Медицинского Центра",
         "inLanguage": "ru", "publisher": CLINIC_LD},
        {"@type": "ItemList", "itemListElement": ld_items},
        crumbs_ld([("Главная", SITE), ("Блог", url)])]}
    desc = ("Статьи врачей Академического Медицинского Центра о запое, лечении алкоголизма, "
            "кодировании, отказе от курения и экранном времени.")
    title = "Черновики блога" if draft else "Блог врачей о лечении зависимостей | Академический Медицинский Центр"
    page = [head(title, desc, url, prefix, "assets/img/og-cover.jpg", jsonld, noindex=draft)]
    page.append(relink(mark_active(top, "blog.html"), prefix))
    note = ('<div class="container"><div class="draft-note"><b>Черновики на согласовании.</b> '
            'Эта страница не публикуется. Опубликованные статьи появятся в blog.html.</div></div>') if draft else ""
    page.append("""<main>

<section class="page-hero">
  <span class="emblem-float ef-a" aria-hidden="true"></span>
  <span class="emblem-float ef-b" aria-hidden="true"></span>
  <div class="container">
    <span class="eyebrow">Блог</span>
    <h1 class="display">Спокойно и по делу <span class="accent">о зависимости</span></h1>
    <p class="lead">Статьи врачей центра: что происходит с организмом при запое, как устроено лечение и кодирование, как бросить курить и вернуть себе время у экрана. Статьи о лечении проверяет главный врач.</p>
  </div>
</section>

<section class="section" style="padding-top:clamp(10px,3vh,30px)">
  {note}
  <div class="container">
    {grid}
  </div>
</section>

</main>
""".format(grid=grid, note=note))
    page.append(foot(prefix, relink(bottom, prefix)))
    return "".join(page)


# ---------- sitemap and llms.txt ----------

def replace_block(path, start, end, content):
    s = open(path, encoding="utf-8").read()
    a, b = s.find(start), s.find(end)
    if a < 0 or b < a:
        die("в %s нет меток %s ... %s" % (os.path.basename(path), start, end))
    new = s[:a + len(start)] + content + s[b:]
    if new != s:
        open(path, "w", encoding="utf-8").write(new)


def update_sitemap(approved):
    today = datetime.date.today().isoformat()
    urls = ["""
  <url>
    <loc>{site}blog.html</loc>
    <lastmod>{d}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>""".format(site=SITE, d=max([a.get("updated") or a["published"] for a in approved] or [today]))] if approved else []
    for a in approved:
        urls.append("""
  <url>
    <loc>{site}blog/{slug}.html</loc>
    <lastmod>{d}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>""".format(site=SITE, slug=a["slug"], d=a.get("updated") or a["published"]))
    replace_block(os.path.join(ROOT, "sitemap.xml"), "<!-- blog:start -->", "<!-- blog:end -->",
                  "".join(urls) + "\n  ")


def update_llms(approved):
    if approved:
        lines = ["\n\n## Блог\n\nСтатьи пишет %s, %s. Статьи о лечении зависимостей проверяет %s, %s.\n" % (
            PEOPLE[AUTHOR]["name"], PEOPLE[AUTHOR]["job"].lower(),
            PEOPLE["nemchaninov"]["name"], PEOPLE["nemchaninov"]["job"].lower())]
        lines += ["- [%s](%sblog/%s.html): %s" % (a["title"], SITE, a["slug"], a["description"]) for a in approved]
        text = "\n".join(lines) + "\n\n"
    else:
        text = "\n\n"
    replace_block(os.path.join(ROOT, "llms.txt"), "<!-- blog:start -->", "<!-- blog:end -->", text)


# ---------- main ----------

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if old != text:
        open(path, "w", encoding="utf-8").write(text)
        return True
    return False


def main():
    prices = load_prices()
    chrome = load_chrome()
    articles = {}
    for f in sorted(os.listdir(SRC)):
        if f.endswith(".md"):
            a = parse_source(os.path.join(SRC, f))
            if a["slug"] + ".md" != f:
                die("%s: slug %s не совпадает с именем файла" % (f, a["slug"]))
            articles[a["slug"]] = a
    approved = sorted([a for a in articles.values() if a["status"] == "approved"],
                      key=lambda a: a["published"], reverse=True)
    drafts = [a for a in articles.values() if a["status"] == "draft"]

    live, draft_ctx = Ctx("../", "live", articles, prices), Ctx("../", "draft", articles, prices)
    report = []
    for a in approved:
        text, words = article_page(a, live, chrome)
        changed = write(os.path.join(ROOT, "blog", a["slug"] + ".html"), text)
        report.append("blog/%s.html  %d слов%s" % (a["slug"], words, "  (обновлено)" if changed else ""))
    for a in drafts:
        text, words = article_page(a, draft_ctx, chrome)
        write(os.path.join(ROOT, "drafts", a["slug"] + ".html"), text)
        report.append("drafts/%s.html  %d слов (черновик)" % (a["slug"], words))
    # stale pages of articles that went back to draft or were removed
    for folder, keep in (("blog", {a["slug"] for a in approved}), ("drafts", {a["slug"] for a in drafts})):
        d = os.path.join(ROOT, folder)
        for f in os.listdir(d) if os.path.isdir(d) else []:
            if f.endswith(".html") and f[:-5] not in keep and f != "index.html":
                os.remove(os.path.join(d, f))
                report.append("удалено %s/%s" % (folder, f))

    write(os.path.join(ROOT, "blog.html"), list_page(approved, Ctx("", "live", articles, prices), chrome))
    write(os.path.join(ROOT, "drafts", "index.html"),
          list_page(sorted(drafts, key=lambda a: a["slug"]), draft_ctx, chrome, draft=True))
    update_sitemap(approved)
    update_llms(approved)
    print("\n".join(report))
    print("опубликовано %d, черновиков %d" % (len(approved), len(drafts)))


if __name__ == "__main__":
    main()
