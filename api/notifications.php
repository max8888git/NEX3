<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$pdo = db();
ensure_notifications_schema($pdo);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
  json_ok(list_user_notifications($pdo));
}

if ($method === 'POST') {
  $body = json_input();
  $action = (string) ($body['action'] ?? 'mark_read');
  try {
    if ($action === 'mark_all') {
      json_ok(mark_user_notification_read($pdo, 0));
    }
    if ($action === 'mark_read') {
      json_ok(mark_user_notification_read($pdo, (int) ($body['id'] ?? 0)));
    }
    json_error('Unknown notification action');
  } catch (Throwable $e) {
    json_error($e->getMessage(), 400);
  }
}

json_error('Unsupported method', 405);
