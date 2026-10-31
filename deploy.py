#!/usr/bin/env python3
"""Залить сайт на SpaceWeb по SFTP, отправив только изменившиеся файлы.

Ничего ставить не нужно: скрипт пользуется системным sftp и стандартной
библиотекой Python.

Почему SFTP, а не FTP. Обычный FTP на этот хостинг с нашего канала не идёт:
сервер здоровается и обрывает соединение на первой же команде (VPN с
европейским выходом). SSH на порту 22 проходит нормально, и пароль по нему
не передаётся открытым текстом.

Важно: в панели cp.sweb.ru SSH-доступ включается тумблером и сам гаснет
через 24 часа. Если скрипт не может войти, первым делом включи его заново
в разделе «Инструменты - SSH».

Настройка - один раз. Создай файл .ftp-credentials рядом с этим скриптом
(он в .gitignore, пароль в репозиторий не попадёт):

    host = 77.222.62.219
    user = bkulkayand
    password = ВАШ_ПАРОЛЬ
    remote = /sad56spb/public_html

Запуск:
    python3 deploy.py           залить изменившееся
    python3 deploy.py --dry     только показать, что будет залито
    python3 deploy.py --all     залить всё заново, игнорируя слепок
    python3 deploy.py --only a,b      залить только эти файлы, остальные изменения подождут
    python3 deploy.py --indexnow-all   отправить в IndexNow все адреса из sitemap.xml
                                       (после обычной заливки залитые .html уходят туда сами)

Скрипт помнит sha1 каждого залитого файла в .deploy-state.json и в
следующий раз трогает только то, что действительно поменялось.

Цены и акции меняют в админке прямо на сервере (/admin/). Поэтому перед
заливкой скрипт забирает оттуда admin/data/prices.json и блоки цен со
страниц и вписывает их в локальные файлы (и коммитит, если в этих файлах
не было своих правок). Иначе заливка с Mac вернула бы на сайт старые цены.
Менять цены руками в HTML бесполезно: следующая заливка их перезапишет.
"""
import hashlib, json, os, pty, re, select, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, '.deploy-state.json')
CREDS = os.path.join(HERE, '.ftp-credentials')

# то же, что исключает make-zip.sh: на сервер уезжает только то,
# что сайт реально отдаёт посетителю
SKIP_DIRS = {'.git', '.vercel', 'brag-output', '_probe', '__pycache__', '.tmb', 'notes', '.logs', 'drafts', 'blog-src',
             'uslugi-src', 'backups'}
SKIP_FILES = {'.gitignore', '.vercelignore', '.DS_Store', '.ftp-credentials',
              'README.md', 'CLAUDE.md', 'deploy-sweb.sh', 'make-zip.sh', 'deploy.py', 'logs.py', 'blog.py', 'autopublish.sh',
              '.deploy-state.json', '.admin-password', 'set-password.py', 'attempts.json', '.lock'}

PROMPT = b'sftp>'
# по этим словам в ответе sftp понятно, что команда не прошла
BAD = re.compile(r"No such file|Couldn't|Permission denied|not found", re.I)


def creds():
    if not os.path.exists(CREDS):
        sys.exit('Нет файла .ftp-credentials. Смотри комментарий в начале deploy.py.')
    d = {}
    for line in open(CREDS, encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        d[k.strip()] = v.strip()
    for k in ('host', 'user', 'password', 'remote'):
        if not d.get(k):
            sys.exit('В .ftp-credentials не хватает строки: ' + k)
    return d


def local_files():
    out = {}
    for root, dirs, files in os.walk(HERE):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.git')]
        for f in files:
            if f in SKIP_FILES or f.endswith('.zip'):
                continue
            full = os.path.join(root, f)
            rel = os.path.relpath(full, HERE).replace(os.sep, '/')
            h = hashlib.sha1()
            with open(full, 'rb') as fh:
                for chunk in iter(lambda: fh.read(65536), b''):
                    h.update(chunk)
            out[rel] = h.hexdigest()
    return out


# Что админка пишет на сервере сама (см. PAGES в admin/lib.php)
ADMIN_DATA = 'admin/data/prices.json'
ADMIN_PAGES = ('price-and-services.html', 'index.html', 'smoke.html')
BLOCK = re.compile(r'(<!-- admin:([\w-]+) -->)(.*?)(<!-- /admin:\2 -->)', re.S)


def splice(local, server):
    """Переложить блоки admin:* из серверной копии страницы в локальную."""
    theirs = {m.group(2): m.group(3) for m in BLOCK.finditer(server)}
    def put(m):
        return m.group(1) + theirs.get(m.group(2), m.group(3)) + m.group(4)
    return BLOCK.sub(put, local)


def git(*args):
    import subprocess
    return subprocess.run(('git',) + args, cwd=HERE, capture_output=True, text=True)


def pull_admin(s):
    """Забрать с сервера то, что поменяли в админке. Вернуть список файлов,
    которые пришлось обновить локально."""
    import tempfile
    tmp = tempfile.mkdtemp(prefix='sad55-pull-')
    got = os.path.join(tmp, 'prices.json')
    out = s.cmd('get "%s" "%s"' % (ADMIN_DATA, got))
    if BAD.search(out) or not os.path.exists(got):
        return []          # админку ещё не заливали
    mine = os.path.join(HERE, ADMIN_DATA)
    if os.path.exists(mine) and open(mine, 'rb').read() == open(got, 'rb').read():
        return []
    try:
        json.load(open(got, encoding='utf-8'))
    except ValueError:
        sys.exit('На сервере испорчен %s, остановился. Открой /admin/ и сохрани '
                 'цены заново или почини файл руками.' % ADMIN_DATA)
    news = {}
    for page in ADMIN_PAGES:
        dst = os.path.join(tmp, page)
        out = s.cmd('get "%s" "%s"' % (page, dst))
        if BAD.search(out) or not os.path.exists(dst):
            sys.exit('Не скачалась с сервера %s, остановился, чтобы не затереть '
                     'цены из админки.' % page)
        news[page] = splice(open(os.path.join(HERE, page), encoding='utf-8').read(),
                            open(dst, encoding='utf-8').read())
    files = [ADMIN_DATA] + list(ADMIN_PAGES)
    # свои незакоммиченные правки в этих файлах коммитить заодно нельзя
    clean = git('status', '--porcelain', '--', *files).stdout.strip() == ''
    open(mine, 'wb').write(open(got, 'rb').read())
    for page, text in news.items():
        open(os.path.join(HERE, page), 'w', encoding='utf-8').write(text)
    print('Подтянул с сервера цены из админки: %s' % ', '.join(files))
    if clean:
        git('add', '--', *files)
        r = git('commit', '-qm', 'Prices: synced from /admin/', '--', *files)
        print('   закоммичено' if r.returncode == 0 else '   не закоммитилось: ' + r.stderr.strip())
    else:
        print('   в этих файлах были свои правки, закоммить сам')
    return files


INDEXNOW_KEY = '5aba21da6648ee7d9161d52d6ba2bde3'   # файл <ключ>.txt лежит в корне сайта и уезжает при заливке
SITE = 'https://sad56.spb.ru/'


def sitemap_urls():
    return re.findall(r'<loc>([^<]+)</loc>', open(os.path.join(HERE, 'sitemap.xml'), encoding='utf-8').read())


def indexnow(urls):
    """Сообщить Яндексу (и Bing через протокол IndexNow) о новых и изменённых
    страницах. Ошибка здесь заливку не ломает: печатаем код ответа и всё."""
    if not urls:
        return
    import urllib.request
    body = json.dumps({'host': 'sad56.spb.ru', 'key': INDEXNOW_KEY,
                       'keyLocation': SITE + INDEXNOW_KEY + '.txt', 'urlList': urls}).encode('utf-8')
    req = urllib.request.Request('https://yandex.com/indexnow', data=body, method='POST',
                                 headers={'Content-Type': 'application/json; charset=utf-8'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            code = r.status
    except Exception as e:
        code = getattr(e, 'code', None) or str(e)
    print('IndexNow: отправлено адресов %d, ответ %s' % (len(urls), code))


def page_urls(files):
    """Залитые .html как адреса из sitemap.xml; чего нет в sitemap, не шлём."""
    known = set(sitemap_urls())
    urls = []
    for rel in files:
        if not rel.endswith('.html'):
            continue
        u = SITE if rel == 'index.html' else SITE + rel
        if u in known:
            urls.append(u)
    return urls


def rebuild_blog():
    """Цены в статьях и услугах берутся из прайса при сборке: после свежих цен
    из админки пересобрать, чтобы на сервер не уехали старые."""
    import subprocess
    out = ['blog', 'uslugi', 'blog.html', 'index.html', 'price-and-services.html', 'sitemap.xml', 'llms.txt']
    # свои незакоммиченные правки в этих файлах коммитить заодно нельзя
    clean = git('status', '--porcelain', '--', *out).stdout.strip() == ''
    r = subprocess.run([sys.executable, os.path.join(HERE, 'blog.py')], cwd=HERE,
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('blog.py не собрался после свежих цен, остановился:\n' + (r.stderr or r.stdout))
    if not clean:
        print('Пересобрал статьи и услуги под новые цены, в этих файлах были свои правки, закоммить сам')
    elif git('status', '--porcelain', '--', *out).stdout.strip():
        git('add', '--', *out)
        r = git('commit', '-qm', 'Blog and services: prices from /admin/', '--', *out)
        print('Пересобрал статьи и услуги под новые цены' + ('' if r.returncode == 0 else
              ' (не закоммитилось: %s)' % r.stderr.strip()))


class LoginFailed(Exception):
    pass


class Sftp(object):
    """Сессия sftp на псевдотерминале.

    sftp просит пароль только у настоящего терминала, а свой пакетный режим
    (-b) пароль вообще не спрашивает. Поэтому поднимаем pty и разговариваем
    с программой так же, как это делал бы человек.
    """

    def __init__(self, host, user, password, port='22', timeout=90):
        self.timeout = timeout
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.execvp('sftp', ['sftp', '-P', str(port),
                               '-o', 'StrictHostKeyChecking=accept-new',
                               '-o', 'PubkeyAuthentication=no',
                               '-o', 'NumberOfPasswordPrompts=1',
                               '%s@%s' % (user, host)])
            os._exit(127)
        head = self._until(re.compile(rb'(?i)password[^\r\n]*:\s*$'), PROMPT)
        try:
            if PROMPT not in head:
                os.write(self.fd, password.encode() + b'\n')
                head = self._until(PROMPT)
        except OSError:
            # sftp уже умер: канал оборвался раньше, чем спросили пароль
            head = b''
        if PROMPT not in head:
            self.close()
            raise LoginFailed()

    def _until(self, *stops):
        buf = b''
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            r = select.select([self.fd], [], [], 1.0)[0]
            if r:
                try:
                    chunk = os.read(self.fd, 8192)
                except OSError:
                    break
                if not chunk:
                    break
                buf += chunk
            tail = buf[-4096:]
            for s in stops:
                if hasattr(s, 'search'):
                    if s.search(tail.rstrip()):
                        return buf
                elif tail.rstrip().endswith(s):
                    return buf
        return buf

    def cmd(self, line):
        os.write(self.fd, line.encode('utf-8') + b'\n')
        out = self._until(PROMPT).decode('utf-8', 'replace')
        # первой строкой sftp повторяет то, что мы ввели - это не ответ
        return out.split('\n', 1)[1] if '\n' in out else ''

    def close(self):
        try:
            os.write(self.fd, b'quit\n')
        except OSError:
            pass
        try:
            os.close(self.fd)
        except OSError:
            pass
        try:
            os.waitpid(self.pid, 0)
        except OSError:
            pass


def connect():
    c = creds()
    # Канал до хостинга идёт через VPN и иногда рвётся прямо на входе,
    # хотя со второй попытки всё проходит. Три захода, потом сдаёмся.
    for attempt in range(1, 4):
        try:
            return c, Sftp(c['host'], c['user'], c['password'], c.get('port', '22'))
        except LoginFailed:
            if attempt < 3:
                print('Не вошёл с попытки %d, пробую ещё раз...' % attempt)
                time.sleep(3)
    return c, None


def main():
    dry = '--dry' in sys.argv
    force = '--all' in sys.argv
    if '--indexnow-all' in sys.argv:
        indexnow(sitemap_urls())
        return

    c, s = connect()
    if s is None:
        msg = ('Не пускает на сервер. Проверь пароль, и включён ли SSH-доступ '
               'в панели (он гаснет сам через 24 часа).')
        if not dry:
            sys.exit(msg)
        print(msg + '\nЦены из админки не сверены, список ниже может быть неполным.\n')
    else:
        root = c['remote'].rstrip('/')
        # Убедиться, что папка та самая, ПРЕЖДЕ чем что-то писать. Промах здесь
        # означает файлы сайта, рассыпанные мимо цели, или того хуже - поверх
        # чужого сайта в соседней папке.
        out = s.cmd('cd ' + root)
        if BAD.search(out):
            s.close()
            sys.exit('На сервере нет папки %s. Проверь строку remote в '
                     '.ftp-credentials.\n%s' % (root, out.strip()))
        here = s.cmd('pwd').strip()
        if 'public_html' not in here:
            s.close()
            sys.exit('Папка %s не похожа на корень сайта. Остановился, ничего не '
                     'отправив.' % here)
        if pull_admin(s):
            rebuild_blog()

    now = local_files()
    was = {} if force else (json.load(open(STATE)) if os.path.exists(STATE) else {})
    changed = sorted(k for k, v in now.items() if was.get(k) != v)
    gone = sorted(k for k in was if k not in now)
    only = None
    if '--only' in sys.argv:
        only = set(x.strip() for x in sys.argv[sys.argv.index('--only') + 1].split(',') if x.strip())
        missing = only - set(now)
        if missing:
            sys.exit('Нет таких файлов: %s' % ', '.join(sorted(missing)))
        changed = sorted(k for k in changed if k in only)
        gone = []

    if not changed and not gone:
        if s:
            s.close()
        print('Изменений нет, заливать нечего.')
        return

    print('Изменилось файлов: %d' % len(changed))
    for k in changed:
        print('   +', k)
    if gone:
        print('Исчезло локально (на сервере останутся, удали руками): %d' % len(gone))
        for k in gone:
            print('   -', k)
    if dry:
        if s:
            s.close()
        print('\n--dry: ничего не отправлено.')
        return

    print('Сервер: %s, заливаю в %s' % (c['host'], here))

    made, bad = set(), []
    for i, rel in enumerate(changed, 1):
        d = os.path.dirname(rel)
        if d and d not in made:
            cur = ''
            for part in d.split('/'):
                cur = cur + '/' + part if cur else part
                s.cmd('mkdir ' + cur)   # уже существует - sftp просто поворчит
            made.add(d)
        out = s.cmd('put "%s" "%s"' % (os.path.join(HERE, rel), rel))
        ok = not BAD.search(out)
        if not ok:
            bad.append(rel)
        print('   [%d/%d] %s%s' % (i, len(changed), rel, '' if ok else '   ОШИБКА'))

    s.close()

    if bad:
        print('\nНе залилось файлов: %d' % len(bad))
        for k in bad:
            print('   !', k)
        print('Слепок не обновляю, при следующем запуске попробует их снова.')
        sys.exit(1)

    if only is not None:
        # в слепок только залитое, остальные изменения поедут следующей заливкой
        for k in changed:
            was[k] = now[k]
        now = was
    json.dump(now, open(STATE, 'w'), indent=1, sort_keys=True)
    print('\nГотово. Залито файлов: %d' % len(changed))
    indexnow(page_urls(changed))


if __name__ == '__main__':
    main()
