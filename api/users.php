<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$pdo = db();
ensure_users_schema($pdo);
$me = session_user_payload($pdo);
if (!$me) {
  json_error('Log in to manage accounts.', 401);
}
$actor = $me['role'];
if (!account_actor_can_manage($actor)) {
  json_error('Only Super Admin or Admin can manage accounts.', 403);
}
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
  json_ok([
    'users' => list_users($pdo, $actor),
    'roles' => creatable_roles($actor),
  ]);
}

if ($method === 'POST') {
  $body = json_input();
  $action = (string) ($body['action'] ?? '');
  try {
    $pdo->beginTransaction();
    if ($action === 'create') {
      $user = save_user($pdo, $actor, $body, null);
      $pdo->commit();
      json_ok(['user' => $user, 'users' => list_users($pdo, $actor)]);
    }
    if ($action === 'update') {
      $id = parse_id((string) ($body['id'] ?? ''), 'u');
      if (!$id) {
        throw new RuntimeException('Pick a user to edit.');
      }
      $user = save_user($pdo, $actor, $body, $id);
      $pdo->commit();
      json_ok(['user' => $user, 'users' => list_users($pdo, $actor)]);
    }
    $pdo->rollBack();
    json_error('Unknown account action');
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) {
      $pdo->rollBack();
    }
    json_error($e->getMessage(), 400);
  }
}

json_error('Unsupported method', 405);

function normalize_account_actor(string $actor): string
{
  $a = strtolower(str_replace('-', '_', trim($actor)));
  if ($a === 'program_head') {
    $a = 'program_chair';
  }
  $ok = ['super_admin', 'admin', 'vpaa', 'dean', 'program_chair'];
  return in_array($a, $ok, true) ? $a : '';
}

function account_actor_can_manage(string $actor): bool
{
  return $actor === 'super_admin' || $actor === 'admin';
}

function creatable_roles(string $actor): array
{
  if ($actor === 'super_admin') {
    return ['admin', 'vpaa', 'dean', 'program_chair'];
  }
  if ($actor === 'admin') {
    return ['dean', 'program_chair'];
  }
  return [];
}

function role_label(string $role): string
{
  return account_role_label($role);
}

function list_users(PDO $pdo, string $actor): array
{
  $sql = 'SELECT u.user_id, u.full_name, u.email, u.role, u.is_active, u.college_id, u.created_at,
                 c.college_name
          FROM users u
          LEFT JOIN colleges c ON c.college_id = u.college_id';
  $params = [];
  if ($actor === 'admin') {
    $sql .= " WHERE u.role IN ('dean','program_chair')";
  }
  $sql .= ' ORDER BY u.is_active DESC, u.full_name';
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();
  $ids = array_map(static fn ($r) => (int) $r['user_id'], $rows);
  $programsByUser = programs_by_user($pdo, $ids);
  $out = [];
  foreach ($rows as $row) {
    $out[] = present_user($row, $programsByUser[(int) $row['user_id']] ?? []);
  }
  return $out;
}

function programs_by_user(PDO $pdo, array $userIds): array
{
  if (!$userIds) {
    return [];
  }
  $placeholders = implode(',', array_fill(0, count($userIds), '?'));
  $stmt = $pdo->prepare(
    "SELECT u.user_id, p.program_id, p.program_name, d.department_id, d.department_name
     FROM users u
     LEFT JOIN departments d ON d.department_id = u.department_id
     LEFT JOIN programs p ON p.department_id = u.department_id AND p.is_active = 1
     WHERE u.user_id IN ({$placeholders})
     ORDER BY p.program_name"
  );
  $stmt->execute(array_values($userIds));
  $map = [];
  foreach ($stmt->fetchAll() as $row) {
    $map[(int) $row['user_id']][] = $row;
  }
  return $map;
}

function present_user(array $row, array $programs): array
{
  $role = (string) $row['role'];
  $programIds = [];
  $programNames = [];
  $departmentId = null;
  $departmentName = null;
  foreach ($programs as $p) {
    if ($departmentId === null && !empty($p['department_id'])) {
      $departmentId = public_id('dept', (int) $p['department_id']);
      $departmentName = (string) ($p['department_name'] ?? '');
    }
    if (empty($p['program_id'])) {
      continue;
    }
    $programIds[] = public_id('d', (int) $p['program_id']);
    $programNames[] = (string) $p['program_name'];
  }
  $collegeId = !empty($row['college_id']) ? public_id('c', (int) $row['college_id']) : null;
  $collegeName = $row['college_name'] ?? null;
  $scope = '';
  if ($role === 'dean' && $collegeName) {
    $scope = $collegeName;
  } elseif ($role === 'program_chair') {
    $bits = [];
    if ($collegeName) {
      $bits[] = $collegeName;
    }
    if ($departmentName) {
      $bits[] = $departmentName;
    } elseif ($programNames) {
      $bits[] = implode(', ', $programNames);
    }
    $scope = implode(' · ', $bits);
  }
  return [
    'id' => public_id('u', (int) $row['user_id']),
    'name' => $row['full_name'],
    'email' => $row['email'],
    'role' => $role,
    'roleLabel' => role_label($role),
    'isActive' => (int) $row['is_active'] === 1,
    'collegeId' => $collegeId,
    'collegeName' => $collegeName,
    'departmentId' => $departmentId,
    'departmentName' => $departmentName,
    'programIds' => $programIds,
    'programNames' => $programNames,
    'scopeLabel' => $scope,
    'createdAt' => $row['created_at'] ? date('c', strtotime((string) $row['created_at'])) : null,
  ];
}

function save_user(PDO $pdo, string $actor, array $body, ?int $existingId): array
{
  $existing = null;
  if ($existingId) {
    $existing = load_user_row($pdo, $existingId);
    if (!$existing) {
      throw new RuntimeException('That account was not found.');
    }
    if ($actor === 'admin' && !in_array($existing['role'], ['dean', 'program_chair'], true)) {
      throw new RuntimeException('Admin can only edit Dean and Program Chair accounts.');
    }
    $confirm = (string) ($body['confirmPassword'] ?? '');
    verify_actor_password($pdo, $actor, $confirm);
  }

  $name = trim(preg_replace('/\s+/', ' ', (string) ($body['name'] ?? '')) ?? '');
  if ($name === '') {
    throw new RuntimeException('Enter a name.');
  }
  $email = strtolower(trim((string) ($body['email'] ?? '')));
  if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    throw new RuntimeException('Enter a valid email address.');
  }

  $role = strtolower(str_replace('-', '_', trim((string) ($body['role'] ?? ''))));
  if ($role === 'program_head') {
    $role = 'program_chair';
  }
  $allowed = creatable_roles($actor);
  if ($existing && $existing['role'] === 'super_admin') {
    $role = 'super_admin';
  } elseif (!in_array($role, $allowed, true)) {
    throw new RuntimeException(
      $existingId
        ? 'Pick a role this page is allowed to assign.'
        : 'Super Admin can create Admin, VPAA, Dean, or Program Chair accounts — not another Super Admin.'
    );
  }

  $dup = $pdo->prepare('SELECT user_id FROM users WHERE email = ? AND user_id <> ? LIMIT 1');
  $dup->execute([$email, $existingId ?? 0]);
  if ($dup->fetch()) {
    throw new RuntimeException('An account already uses that email.');
  }

  $collegeId = null;
  $programIds = [];
  $departmentId = null;
  if ($role === 'dean' || $role === 'program_chair') {
    $collegeId = parse_id((string) ($body['collegeId'] ?? ''), 'c');
    if (!$collegeId) {
      throw new RuntimeException('Pick a college for this ' . role_label($role) . '.');
    }
    $college = load_college($pdo, $collegeId);
    if (!$college) {
      throw new RuntimeException('Pick a college that still exists.');
    }
    if ((int) $college['is_active'] !== 1) {
      throw new RuntimeException('That college is archived.');
    }
    if ($role === 'program_chair') {
      $departmentId = resolve_chair_department($pdo, $college, (string) ($body['departmentId'] ?? ''), $existingId);
      $programIds = program_ids_in_department($pdo, $departmentId);
    }
  }

  $password = (string) ($body['password'] ?? '');
  $passwordConfirm = (string) ($body['passwordConfirm'] ?? $password);
  $hash = null;
  if (!$existingId || $password !== '') {
    if (strlen($password) < 5) {
      throw new RuntimeException('Use a password of at least 5 characters.');
    }
    if ($password !== $passwordConfirm) {
      throw new RuntimeException('Password and confirmation do not match.');
    }
    $hash = password_hash($password, PASSWORD_DEFAULT);
  }

  $isActive = array_key_exists('isActive', $body) ? (int) !!$body['isActive'] : 1;
  if ($existing && $existing['role'] === 'super_admin' && !$isActive) {
    $activeSa = (int) $pdo->query(
      "SELECT COUNT(*) FROM users WHERE role = 'super_admin' AND is_active = 1"
    )->fetchColumn();
    if ($activeSa <= 1) {
      throw new RuntimeException('Keep at least one active Super Admin account.');
    }
  }

  if ($existingId) {
    if ($hash) {
      $upd = $pdo->prepare(
        'UPDATE users SET full_name = ?, email = ?, role = ?, is_active = ?, college_id = ?, department_id = ?, password_hash = ?
         WHERE user_id = ?'
      );
      $upd->execute([$name, $email, $role, $isActive, $collegeId, $departmentId, $hash, $existingId]);
    } else {
      $upd = $pdo->prepare(
        'UPDATE users SET full_name = ?, email = ?, role = ?, is_active = ?, college_id = ?, department_id = ?
         WHERE user_id = ?'
      );
      $upd->execute([$name, $email, $role, $isActive, $collegeId, $departmentId, $existingId]);
    }
    $uid = $existingId;
  } else {
    $ins = $pdo->prepare(
    'INSERT INTO users (full_name, email, password_hash, role, is_active, college_id, department_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  $ins->execute([$name, $email, $hash, $role, $isActive, $collegeId, $departmentId]);
    $uid = (int) $pdo->lastInsertId();
  }

  $pdo->prepare('DELETE FROM user_programs WHERE user_id = ?')->execute([$uid]);
  if ($role === 'program_chair') {
    $link = $pdo->prepare('INSERT INTO user_programs (user_id, program_id) VALUES (?, ?)');
    foreach ($programIds as $pid) {
      $link->execute([$uid, $pid]);
    }
  }

  $row = load_user_row($pdo, $uid);
  $programs = programs_by_user($pdo, [$uid]);
  return present_user($row, $programs[$uid] ?? []);
}

function load_user_row(PDO $pdo, int $id): ?array
{
  $stmt = $pdo->prepare(
    'SELECT u.user_id, u.full_name, u.email, u.role, u.is_active, u.college_id, u.created_at,
            c.college_name
     FROM users u
     LEFT JOIN colleges c ON c.college_id = u.college_id
     WHERE u.user_id = ?'
  );
  $stmt->execute([$id]);
  $row = $stmt->fetch();
  return $row ?: null;
}

function load_college(PDO $pdo, int $id): ?array
{
  $stmt = $pdo->prepare(
    'SELECT college_id, college_name, use_departments, is_active FROM colleges WHERE college_id = ?'
  );
  $stmt->execute([$id]);
  $row = $stmt->fetch();
  return $row ?: null;
}

function resolve_chair_department(PDO $pdo, array $college, string $rawId, ?int $existingUserId): int
{
  $did = parse_id($rawId, 'dept');
  if (!$did) {
    throw new RuntimeException('Pick the department this Program Chair leads.');
  }
  $stmt = $pdo->prepare(
    'SELECT department_id FROM departments
     WHERE department_id = ? AND college_id = ? AND is_active = 1'
  );
  $stmt->execute([$did, (int) $college['college_id']]);
  if (!$stmt->fetch()) {
    throw new RuntimeException('That department is not in the selected college.');
  }
  $taken = $pdo->prepare(
    "SELECT full_name FROM users
     WHERE role = 'program_chair' AND department_id = ? AND is_active = 1 AND user_id <> ?
     LIMIT 1"
  );
  $taken->execute([$did, $existingUserId ?? 0]);
  $other = $taken->fetch();
  if ($other) {
    throw new RuntimeException('That department already has a Program Chair (' . $other['full_name'] . ').');
  }
  $count = $pdo->prepare('SELECT COUNT(*) FROM programs WHERE department_id = ? AND is_active = 1');
  $count->execute([$did]);
  if ((int) $count->fetchColumn() < 1) {
    throw new RuntimeException('Add at least one program under that department first.');
  }
  return $did;
}

function program_ids_in_department(PDO $pdo, int $departmentId): array
{
  $stmt = $pdo->prepare('SELECT program_id FROM programs WHERE department_id = ? AND is_active = 1');
  $stmt->execute([$departmentId]);
  return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}

function verify_actor_password(PDO $pdo, string $actor, string $password): void
{
  if ($password === '') {
    throw new RuntimeException('Enter your password to confirm these changes.');
  }
  $id = current_session_user_id();
  if (!$id) {
    throw new RuntimeException('Log in again, then confirm with your password.');
  }
  $stmt = $pdo->prepare('SELECT password_hash, role FROM users WHERE user_id = ? AND is_active = 1');
  $stmt->execute([$id]);
  $row = $stmt->fetch();
  if (!$row || (string) $row['role'] !== $actor) {
    throw new RuntimeException('Log in again, then confirm with your password.');
  }
  if (!password_verify($password, (string) $row['password_hash'])) {
    throw new RuntimeException('That password does not match your account.');
  }
}
