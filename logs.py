#!/usr/bin/env python3
"""Скачать журналы посещений сайта с SpaceWeb и показать, кто заходил.

Входит так же, как deploy.py (SFTP, доступы из .ftp-credentials), и так же
требует включённого SSH-доступа в панели.

    python3 logs.py ls [ПАПКА]    показать, что лежит на сервере
    python3 logs.py get ФАЙЛ      скачать файл в ./.logs/
"""
import os, sys
import deploy

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '.logs')


def session():
    c = deploy.creds()
    for attempt in range(3):
        try:
            return deploy.Sftp(c['host'], c['user'], c['password'], c.get('port', '22'))
        except deploy.LoginFailed:
            pass
    sys.exit('Не пускает на сервер. Включён ли SSH-доступ в панели?')


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ('ls', 'get'):
        sys.exit(__doc__)
    s = session()
    if sys.argv[1] == 'ls':
        for d in (sys.argv[2:] or ['.']):
            print('== %s ==' % d)
            print(s.cmd('ls -la ' + d).strip())
    else:
        os.makedirs(OUT, exist_ok=True)
        for f in sys.argv[2:]:
            print(s.cmd('get "%s" "%s"' % (f, os.path.join(OUT, os.path.basename(f)))).strip())
    s.close()


if __name__ == '__main__':
    main()
