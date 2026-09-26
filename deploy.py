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

Скрипт помнит sha1 каждого залитого файла в .deploy-state.json и в
следующий раз трогает только то, что действительно поменялось.
"""
import hashlib, json, os, pty, re, select, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, '.deploy-state.json')
CREDS = os.path.join(HERE, '.ftp-credentials')

# то же, что исключает make-zip.sh: на сервер уезжает только то,
# что сайт реально отдаёт посетителю
SKIP_DIRS = {'.git', '.vercel', 'brag-output', '_probe', '__pycache__', '.tmb'}
SKIP_FILES = {'.gitignore', '.vercelignore', '.DS_Store', '.ftp-credentials',
              'README.md', 'deploy-sweb.sh', 'make-zip.sh', 'deploy.py',
              '.deploy-state.json'}

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
        if PROMPT not in head:
            os.write(self.fd, password.encode() + b'\n')
            head = self._until(PROMPT)
        if PROMPT not in head:
            self.close()
            sys.exit('Не пускает на сервер. Проверь пароль, и включён ли SSH-доступ '
                     'в панели (он гаснет сам через 24 часа).')

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
    root = c['remote'].rstrip('/')
    s = Sftp(c['host'], c['user'], c['password'], c.get('port', '22'))

    # Убедиться, что папка та самая, ПРЕЖДЕ чем что-то писать. Промах здесь
    # означает файлы сайта, рассыпанные мимо цели, или того хуже - поверх
    # чужого сайта в соседней папке.
    out = s.cmd('cd ' + root)
    if BAD.search(out):
        s.close()
        sys.exit('На сервере нет папки %s. Проверь строку remote в '
                 '.ftp-credentials.\n%s' % (root, out.strip()))
    here = s.cmd('pwd').strip()
    print('Сервер: %s, заливаю в %s' % (c['host'], here))
    if 'public_html' not in here:
        s.close()
        sys.exit('Папка %s не похожа на корень сайта. Остановился, ничего не '
                 'отправив.' % here)

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

    json.dump(now, open(STATE, 'w'), indent=1, sort_keys=True)
    print('\nГотово. Залито файлов: %d' % len(changed))


if __name__ == '__main__':
    main()
