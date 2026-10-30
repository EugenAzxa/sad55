#!/usr/bin/env python3
"""Проверка исходников статей и услуг до сборки: тире, эмодзи, токены цен, запретные слова.
    python3 notes/check-src.py blog-src/slug.md uslugi-src/slug.md ...
"""
import json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(ROOT, "admin/data/prices.json"), encoding="utf-8"))
rows = {}
for g in d["groups"]:
    for r in g["rows"]:
        rows.setdefault(g["title"], []).append((r["name"], r["time"]))
BAD = [("—", "длинное тире"), ("–", "среднее тире"), ("стационар", "стационар"), ("гарантир", "гарантия"),
       ("навсегда", "навсегда"), ("100%", "100%"), ("только у нас", "только у нас"), ("заявк", "заявка"),
       ("палат", "палата")]
ok = True
for path in sys.argv[1:]:
    t = open(path, encoding="utf-8").read()
    for ch, name in BAD:
        for m in re.finditer(re.escape(ch), t, re.I):
            line = t[:m.start()].count("\n") + 1
            print("%s:%d: %s" % (path, line, name)); ok = False
    if re.search("[\U0001F300-\U0001FAFF☀-➿]", t):
        print("%s: эмодзи" % path); ok = False
    for m in re.finditer(r"\{\{price:(.+?)\}\}", t):
        p = [x.strip() for x in m.group(1).split("|")]
        if p[0] not in rows or not any(n == p[1] and (len(p) < 3 or tm == p[2]) for n, tm in rows[p[0]]):
            print("%s: нет такой цены: %s" % (path, m.group(1))); ok = False
    for m in re.finditer(r"\{\{prices:(.+?)\}\}", t):
        if m.group(1).strip() not in rows:
            print("%s: нет группы: %s" % (path, m.group(1))); ok = False
    m = re.search(r"^price:\s*(.+)$", t, re.M)
    if m:
        p = [x.strip() for x in m.group(1).split("|")]
        if p[0] not in rows or not any(n == p[1] and (len(p) < 3 or tm == p[2]) for n, tm in rows[p[0]]):
            print("%s: поле price не найдено в прайсе" % path); ok = False
    if re.search(r"\d[\d ]{2,}\s*(руб|₽)", re.sub(r"\{\{.*?\}\}", "", t)):
        print("%s: цена цифрами руками" % path); ok = False
print("OK" if ok else "есть замечания")
