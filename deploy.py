#!/usr/bin/env python3
"""Залить сайт на SpaceWeb по FTP, отправив только изменившиеся файлы.

Ничего ставить не нужно: ftplib входит в стандартную поставку Python.

Настройка - один раз. Создай файл .ftp-credentials рядом с этим скриптом
(он в .gitignore, пароль в репозиторий не попадёт):

    host = ftp.sad56.spb.ru
    user = bkulkayand
    password = ВАШ_ПАРОЛЬ
    remote = /sad56spb/public_html

Запуск:
    python3 deploy.py           залить изменившееся
    python3 deploy.py --dry     только показать, что будет залито
    python3 deploy.py --all     залить всё заново, игнорируя слепок

Скрипт помнит sha1 каждого залитого файла в .deploy-state.json и в
следующий раз трогает только то, что действительно поменялось.
"""
import ftplib, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, '.deploy-state.json')
CREDS = os.path.join(HERE, '.ftp-credentials')

# то же, что исключает make-zip.sh: на сервер уезжает только то,
# что сайт реально отдаёт посетителю
SKIP_DIRS = {'.git', '.vercel', 'brag-output', '_probe', '__pycache__', '.tmb'}
SKIP_FILES = {'.gitignore', '.vercelignore', '.DS_Store', '.ftp-credentials',
              'README.md', 'deploy-sweb.sh', 'make-zip.sh', 'deploy.py',
              '.deploy-state.json'}


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


def ensure_dir(ftp, path):
    """Создать каталог на сервере, если его ещё нет."""
    cur = ''
    for part in path.strip('/').split('/'):
        cur += '/' + part
        try:
            ftp.mkd(cur)
        except ftplib.error_perm:
            pass            # уже существует - это нормально


def main():
    dry = '--dry' in sys.argv
    force = '--all' in sys.argv

    now = local_files()
    was = {} if force else (json.load(open(STATE)) if os.path.exists(STATE) else {})
    changed = sorted(k for k, v in now.items() if was.get(k) != v)
    gone = sorted(k for k in was if k not in now)

    if not changed and not gone:
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
        print('\n--dry: ничего не отправлено.')
        return

    c = creds()
    ftp = ftplib.FTP(c['host'], timeout=60)
    ftp.login(c['user'], c['password'])
    ftp.set_pasv(True)
    home = ftp.pwd()
    root = c['remote'].rstrip('/')

    # Убедиться, что папка та самая, ПРЕЖДЕ чем что-то писать. Промах здесь
    # означает файлы сайта, рассыпанные мимо цели, или того хуже - поверх
    # чужого сайта в соседней папке.
    try:
        ftp.cwd(root)
    except ftplib.error_perm:
        ftp.quit()
        sys.exit('На сервере нет папки %s (зашли в %s). Проверь строку remote '
                 'в .ftp-credentials.' % (root, home))
    here = ftp.pwd()
    print('Сервер: %s, заливаю в %s' % (c['host'], here))
    if 'public_html' not in here:
        ftp.quit()
        sys.exit('Папка %s не похожа на корень сайта. Остановился, ничего не '
                 'отправив.' % here)
    made = set()

    for i, rel in enumerate(changed, 1):
        d = os.path.dirname(rel)
        if d and d not in made:
            ensure_dir(ftp, root + '/' + d)
            made.add(d)
        with open(os.path.join(HERE, rel), 'rb') as fh:
            ftp.storbinary('STOR ' + root + '/' + rel, fh)
        print('   [%d/%d] %s' % (i, len(changed), rel))

    ftp.quit()
    json.dump(now, open(STATE, 'w'), indent=1, sort_keys=True)
    print('\nГотово. Залито файлов: %d' % len(changed))


if __name__ == '__main__':
    main()
