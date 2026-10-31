<?php
/* Вход в админку и её API. Страница редактора - admin.js + admin.css.

   Пароль хранится только в виде PBKDF2 в data/config.php (файл не в git:
   репозиторий открытый). Новый пароль: python3 admin/set-password.py */

define('ADMIN', 1);
require __DIR__ . '/lib.php';

header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');

const SESSION_HOURS = 12;
const MAX_FAILS = 5;          // столько неверных паролей подряд
const LOCK_MINUTES = 15;      // и вход закрыт на столько минут

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
  || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_name('amc_admin');
if (PHP_VERSION_ID >= 70300) {
  session_set_cookie_params(array('lifetime' => 0, 'path' => '/admin/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict'));
} else {
  session_set_cookie_params(0, '/admin/; samesite=Strict', '', $https, true);
}
session_start();

function json_out($data, $code = 200) {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function logged_in() {
  return !empty($_SESSION['ok']) && time() - ($_SESSION['t'] ?? 0) < SESSION_HOURS * 3600;
}

// перед Apache стоит nginx: настоящий адрес посетителя приходит в заголовке
function client_ip() {
  $ip = $_SERVER['REMOTE_ADDR'] ?? '';
  $real = $_SERVER['HTTP_X_REAL_IP'] ?? '';
  if ($real !== '' && filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) $ip = $real;
  return substr($ip, 0, 45);
}

function fails_file() { return DATA_DIR . '/attempts.json'; }
function fails_read() {
  $a = json_decode((string)@file_get_contents(fails_file()), true);
  $a = is_array($a) ? $a : array();
  foreach ($a as $k => $v) if (time() - ($v['t'] ?? 0) > LOCK_MINUTES * 60) unset($a[$k]);
  return $a;
}

function check_password($pw) {
  $cfg = is_file(DATA_DIR . '/config.php') ? include DATA_DIR . '/config.php' : null;
  if (!is_array($cfg) || empty($cfg['hash'])) return false;
  $h = hash_pbkdf2('sha256', $pw, $cfg['salt'], (int)$cfg['iter'], 64);
  return hash_equals($cfg['hash'], $h);
}

$action = $_GET['a'] ?? '';
$post = $_SERVER['REQUEST_METHOD'] === 'POST';

/* ---------- вход и выход ---------- */

if ($action === 'login' && $post) {
  $ip = client_ip();
  $fails = fails_read();
  $mine = $fails[$ip] ?? array('n' => 0, 't' => 0);
  $error = '';
  if ($mine['n'] >= MAX_FAILS) {
    $error = 'Слишком много попыток. Попробуйте через ' . LOCK_MINUTES . ' минут.';
  } elseif (check_password((string)($_POST['password'] ?? ''))) {
    unset($fails[$ip]);
    @file_put_contents(fails_file(), json_encode($fails), LOCK_EX);
    session_regenerate_id(true);
    $_SESSION = array('ok' => 1, 't' => time(), 'csrf' => bin2hex(random_bytes(32)));
    header('Location: ./', true, 303);
    exit;
  } else {
    $fails[$ip] = array('n' => $mine['n'] + 1, 't' => time());
    @file_put_contents(fails_file(), json_encode($fails), LOCK_EX);
    sleep(1);
    $error = 'Неверный пароль.';
  }
  $_SESSION['login_error'] = $error;
  header('Location: ./', true, 303);
  exit;
}

if ($action === 'logout' && $post) {
  $_SESSION = array();
  session_destroy();
  header('Location: ./', true, 303);
  exit;
}

/* ---------- API редактора ---------- */

if ($action !== '') {
  if (!logged_in()) json_out(array('error' => 'Сессия закончилась. Обновите страницу и войдите снова.'), 401);
  if ($post && !hash_equals($_SESSION['csrf'], (string)($_SERVER['HTTP_X_CSRF'] ?? ''))) {
    json_out(array('error' => 'Страница устарела. Обновите её и повторите.'), 403);
  }
  $_SESSION['t'] = time();
  try {
    if ($action === 'save' && $post) {
      $in = json_decode((string)file_get_contents('php://input'), true);
      json_out(array('ok' => true, 'data' => save_all(validate($in))));
    }
    if ($action === 'history') json_out(array('items' => list_backups()));
    if ($action === 'backup') json_out(array('data' => read_backup($_GET['id'] ?? '')));
    json_out(array('error' => 'Неизвестная команда'), 404);
  } catch (InvalidArgumentException $ex) {
    json_out(array('error' => $ex->getMessage()), 422);
  } catch (Throwable $ex) {
    error_log('amc admin: ' . $ex->getMessage());
    json_out(array('error' => 'Не сохранилось: ' . $ex->getMessage()), 500);
  }
}

/* ---------- страницы ---------- */

$v = @filemtime(__DIR__ . '/admin.js') . '-' . @filemtime(__DIR__ . '/admin.css');
?><!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Управление ценами | АМЦ</title>
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<link rel="preload" href="../assets/fonts/raleway-cyrillic-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="../assets/fonts/raleway-cyrillic-800-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="admin.css?v=<?= e($v) ?>">
</head>
<?php if (!logged_in()):
  $err = $_SESSION['login_error'] ?? '';
  unset($_SESSION['login_error']); ?>
<body class="login-page">
  <form class="login" method="post" action="?a=login">
    <img src="../assets/logo.svg" alt="Академический Медицинский Центр" width="192" height="44">
    <h1>Вход для администратора</h1>
    <p class="login-sub">Здесь меняются цены, услуги и акции на сайте.</p>
    <label for="pw">Пароль</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
    <?php if ($err !== ''): ?><p class="login-err" role="alert"><?= e($err) ?></p><?php endif; ?>
    <button class="btn btn-primary" type="submit">Войти</button>
    <a class="login-back" href="../">Вернуться на сайт</a>
  </form>
</body>
<?php else:
  try { $data = load_data(); } catch (Throwable $ex) { $data = null; } ?>
<body>
  <script id="initial" type="application/json"><?= json_encode($data, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) ?></script>
  <script>window.CSRF = <?= json_encode($_SESSION['csrf']) ?>;</script>
  <div id="app"></div>
  <script src="admin.js?v=<?= e($v) ?>"></script>
</body>
<?php endif; ?>
</html>
