<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$pdo = db();
ensure_users_schema($pdo);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
  json_ok(['user' => session_user_payload($pdo)]);
}

if ($method === 'POST') {
  $body = json_input();
  $action = (string) ($body['action'] ?? 'login');
  if ($action === 'logout') {
    logout_session();
    json_ok(['user' => null]);
  }
  if ($action === 'lookup') {
    json_ok(['found' => email_has_active_account($pdo, (string) ($body['email'] ?? ''))]);
  }
  if ($action === 'login') {
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    $password = (string) ($body['password'] ?? '');
    if ($email === '' || $password === '') {
      json_error('Enter your email and password.', 400);
    }
    $stmt = $pdo->prepare(
      'SELECT user_id, password_hash, is_active FROM users WHERE email = ? LIMIT 1'
    );
    $stmt->execute([$email]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($password, (string) $row['password_hash'])) {
      json_error('Invalid email or password.', 401);
    }
    if ((int) $row['is_active'] !== 1) {
      json_error('This account is inactive. Ask Super Admin to turn it back on.', 403);
    }
    login_session((int) $row['user_id']);
    $user = session_user_payload($pdo);
    if (!$user) {
      json_error('Could not start a session for this account.', 500);
    }
    json_ok(['user' => $user]);
  }
  json_error('Unknown auth action');
}

json_error('Unsupported method', 405);

function email_has_active_account(PDO $pdo, string $email): bool
{
  $email = strtolower(trim($email));
  if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    return false;
  }
  $stmt = $pdo->prepare('SELECT 1 FROM users WHERE email = ? AND is_active = 1 LIMIT 1');
  $stmt->execute([$email]);
  return (bool) $stmt->fetchColumn();
}
