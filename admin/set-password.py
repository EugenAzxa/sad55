#!/usr/bin/env python3
"""Задать пароль админки цен (/admin/).

    python3 admin/set-password.py            придумать случайный пароль
    python3 admin/set-password.py ПАРОЛЬ     поставить свой

Пишет admin/data/config.php (только хеш PBKDF2, сам пароль там не лежит)
и копию пароля в .admin-password в корне репозитория, чтобы не потерять.
Оба файла в .gitignore: репозиторий открытый. На сервер config.php уедет
обычным python3 deploy.py.
"""
import hashlib, os, secrets, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ITER = 200000

# без похожих друг на друга символов: пароль будут перепечатывать с бумажки
ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

pw = sys.argv[1] if len(sys.argv) > 1 else '-'.join(
    ''.join(secrets.choice(ALPHABET) for _ in range(4)) for _ in range(4))
if len(pw) < 10:
    sys.exit('Пароль короче 10 символов, придумайте длиннее.')
salt = secrets.token_hex(16)
h = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), salt.encode('ascii'), ITER).hex()

with open(os.path.join(HERE, 'data', 'config.php'), 'w') as f:
    f.write("<?php\n// пароль админки: python3 admin/set-password.py\n"
            "return array('salt' => '%s', 'iter' => %d, 'hash' => '%s');\n" % (salt, ITER, h))
with open(os.path.join(os.path.dirname(HERE), '.admin-password'), 'w') as f:
    f.write(pw + '\n')
print('Пароль админки:', pw)
print('Залейте на сервер: python3 deploy.py')
