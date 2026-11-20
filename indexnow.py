#!/usr/bin/env python3
"""Сообщить поисковикам о новых и изменённых страницах (протокол IndexNow).

IndexNow принимают Яндекс, Bing (а через него Copilot и ChatGPT-поиск), Seznam, Naver.
Google IndexNow не поддерживает: он сам читает sitemap.xml с честными датами lastmod.

    python3 indexnow.py                  адреса из живого sitemap.xml, изменённые за 3 дня
    python3 indexnow.py --days 7         то же за 7 дней
    python3 indexnow.py --all            все адреса из sitemap.xml
    python3 indexnow.py URL [URL ...]    только эти адреса

GitHub Actions запускает его раз в день (.github/workflows/indexnow.yml), поэтому
новая статья попадает в поисковики сама, как бы её ни залили на сервер.
"""
import datetime, json, re, sys, urllib.request

SITE = 'https://sad56.spb.ru/'
KEY = '5aba21da6648ee7d9161d52d6ba2bde3'   # файл <ключ>.txt лежит в корне сайта, не удалять
ENDPOINTS = ('https://yandex.com/indexnow', 'https://api.indexnow.org/indexnow')


def live_sitemap():
    req = urllib.request.Request(SITE + 'sitemap.xml', headers={'User-Agent': 'sad56-indexnow'})
    with urllib.request.urlopen(req, timeout=30) as r:
        xml = r.read().decode('utf-8')
    return re.findall(r'<loc>([^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>', xml)


def send(urls):
    """Ошибка здесь ничего не ломает: печатаем код ответа и всё. 200/202 = принято."""
    if not urls:
        print('IndexNow: новых адресов нет')
        return
    body = json.dumps({'host': 'sad56.spb.ru', 'key': KEY, 'keyLocation': SITE + KEY + '.txt',
                       'urlList': urls}).encode('utf-8')
    for ep in ENDPOINTS:
        req = urllib.request.Request(ep, data=body, method='POST',
                                     headers={'Content-Type': 'application/json; charset=utf-8'})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                code = r.status
        except Exception as e:
            code = getattr(e, 'code', None) or str(e)
        print('IndexNow %s: адресов %d, ответ %s' % (ep.split('/')[2], len(urls), code))


def main(argv):
    if argv and not argv[0].startswith('--'):
        return send(argv)
    pairs = live_sitemap()
    if '--all' in argv:
        return send([u for u, _ in pairs])
    days = int(argv[argv.index('--days') + 1]) if '--days' in argv else 3
    since = (datetime.date.today() - datetime.timedelta(days=days)).isoformat()
    fresh = [u for u, d in pairs if d >= since]
    for u in fresh:
        print('  ' + u)
    send(fresh)


if __name__ == '__main__':
    main(sys.argv[1:])
