<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$pdo = db();
ensure_schedule_schema($pdo);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
  $actor = trim((string) ($_GET['actor'] ?? ''));
  try {
    json_ok([
      'records' => list_schedule_request_records($pdo, $actor),
      'textRequests' => list_text_schedule_requests($pdo),
      'classes' => request_class_choices($pdo),
    ]);
  } catch (Throwable $e) {
    json_error($e->getMessage(), 400);
  }
}

if ($method === 'POST') {
  $body = json_input();
  $action = (string) ($body['action'] ?? 'create');
  try {
    if ($action === 'create') {
      json_ok(create_text_schedule_request($pdo, $body));
    }
    if ($action === 'forward' || $action === 'hold') {
      json_ok(decide_text_schedule_request(
        $pdo,
        (int) ($body['id'] ?? 0),
        $action === 'forward',
        (string) ($body['note'] ?? '')
      ));
    }
    if ($action === 'done' || $action === 'send_back') {
      json_ok(reply_text_schedule_request(
        $pdo,
        (int) ($body['id'] ?? 0),
        $action === 'done',
        (string) ($body['note'] ?? '')
      ));
    }
    json_error('Unknown request action');
  } catch (Throwable $e) {
    json_error($e->getMessage(), 400);
  }
}

json_error('Unsupported method', 405);
