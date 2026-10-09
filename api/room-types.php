<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$pdo = db();
ensure_schedule_schema($pdo);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
  json_ok(['types' => list_room_types($pdo)]);
}

if ($method === 'POST' || $method === 'PUT' || $method === 'PATCH') {
  $body = json_input();
  $action = strtolower(trim((string) ($body['action'] ?? '')));
  if ($action === '' && isset($body['name']) && !isset($body['id']) && !isset($body['replaceId'])) {
    $action = 'add';
  }
  try {
    if ($action === 'add') {
      json_ok(add_room_type($pdo, $body));
    }
    if ($action === 'rename') {
      json_ok(rename_room_type($pdo, $body));
    }
    if ($action === 'delete' || $action === 'remove') {
      json_ok(delete_room_type($pdo, $body));
    }
    json_error('Unknown room type action.');
  } catch (InvalidArgumentException $e) {
    json_error($e->getMessage());
  } catch (PDOException $e) {
    json_error('That room type could not be saved: ' . $e->getMessage());
  }
}

json_error('Unsupported method', 405);

function clean_room_type_name($raw): string
{
  return trim(preg_replace('/\s+/', ' ', (string) $raw));
}

function is_protected_room_type_name(string $name): bool
{
  return strcasecmp(trim($name), 'Lecture') === 0 || is_off_campus_room_type_name($name);
}

function fetch_type_row(PDO $pdo, int $id): ?array
{
  $stmt = $pdo->prepare(
    'SELECT room_type_id, room_type_name, is_active, created_at, requires_campus_room
     FROM room_types WHERE room_type_id = ?'
  );
  $stmt->execute([$id]);
  $row = $stmt->fetch();
  return $row ?: null;
}

function resolve_room_type_id(PDO $pdo, $publicId): ?int
{
  $publicId = trim((string) $publicId);
  if ($publicId === '') {
    return null;
  }
  if ($publicId === 'baseline-lecture') {
    return find_room_type_id($pdo, 'Lecture');
  }
  return parse_id($publicId, 'rt');
}

function type_usage_map(PDO $pdo): array
{
  $map = [];
  $bump = static function (array &$map, int $id, string $key, int $n): void {
    if ($id < 1 || $n < 1) {
      return;
    }
    if (!isset($map[$id])) {
      $map[$id] = ['rooms' => 0, 'subjects' => 0, 'requirements' => 0];
    }
    $map[$id][$key] += $n;
  };

  if (schema_table_exists($pdo, 'rooms')) {
    $rows = $pdo->query('SELECT room_type_id, COUNT(*) AS c FROM rooms GROUP BY room_type_id')->fetchAll();
    foreach ($rows as $row) {
      $bump($map, (int) $row['room_type_id'], 'rooms', (int) $row['c']);
    }
  }

  if (schema_table_exists($pdo, 'course_room_requirements')) {
    $rows = $pdo->query(
      'SELECT room_type_id, COUNT(*) AS c FROM course_room_requirements GROUP BY room_type_id'
    )->fetchAll();
    foreach ($rows as $row) {
      $bump($map, (int) $row['room_type_id'], 'requirements', (int) $row['c']);
    }
  }

  if (schema_table_exists($pdo, 'curriculum_courses')) {
    $byName = [];
    foreach ($pdo->query('SELECT room_type_id, room_type_name FROM room_types')->fetchAll() as $row) {
      $byName[strtolower((string) $row['room_type_name'])] = (int) $row['room_type_id'];
    }
    $rows = $pdo->query(
      'SELECT n AS name, COUNT(DISTINCT cid) AS c FROM (
         SELECT lecture_room_type AS n, curriculum_course_id AS cid
           FROM curriculum_courses
          WHERE lecture_room_type IS NOT NULL AND lecture_room_type <> \'\'
         UNION ALL
         SELECT lab_room_type, curriculum_course_id
           FROM curriculum_courses
          WHERE lab_room_type IS NOT NULL AND lab_room_type <> \'\'
       ) tagged
       GROUP BY n'
    )->fetchAll();
    foreach ($rows as $row) {
      $key = strtolower(trim((string) $row['name']));
      if ($key === '' || !isset($byName[$key])) {
        continue;
      }
      $bump($map, $byName[$key], 'subjects', (int) $row['c']);
    }
  }

  return $map;
}

function present_type(array $row, array $usage = []): array
{
  $name = (string) $row['room_type_name'];
  $baseline = strcasecmp($name, 'Lecture') === 0;
  $id = (int) $row['room_type_id'];
  $u = $usage[$id] ?? ['rooms' => 0, 'subjects' => 0, 'requirements' => 0];
  $rooms = (int) $u['rooms'];
  $subjects = (int) $u['subjects'];
  $requirements = (int) ($u['requirements'] ?? 0);
  return [
    'id' => $baseline ? 'baseline-lecture' : public_id('rt', $id),
    'name' => $name,
    'isActive' => (int) $row['is_active'] === 1,
    'isBaseline' => $baseline,
    'isProtected' => is_protected_room_type_name($name),
    'requiresCampusRoom' => !isset($row['requires_campus_room']) || (int) $row['requires_campus_room'] === 1,
    'createdAt' => $row['created_at'] ? date('c', strtotime((string) $row['created_at'])) : null,
    'usage' => [
      'rooms' => $rooms,
      'subjects' => $subjects,
      'requirements' => $requirements,
      'inUse' => ($rooms + $subjects + $requirements) > 0,
    ],
  ];
}

function list_room_types(PDO $pdo): array
{
  $usage = type_usage_map($pdo);
  $rows = $pdo->query(
    'SELECT room_type_id, room_type_name, is_active, created_at, requires_campus_room
     FROM room_types ORDER BY room_type_name'
  )->fetchAll();
  $out = [];
  foreach ($rows as $row) {
    $out[] = present_type($row, $usage);
  }
  usort($out, static function ($a, $b) {
    $rank = static function ($t): int {
      if (!empty($t['isBaseline'])) {
        return 0;
      }
      if (!empty($t['isProtected'])) {
        return 1;
      }
      return 2;
    };
    $ra = $rank($a);
    $rb = $rank($b);
    if ($ra !== $rb) {
      return $ra <=> $rb;
    }
    return strcasecmp($a['name'], $b['name']);
  });
  return $out;
}

function retag_curriculum_type_names(PDO $pdo, string $oldName, string $newName): void
{
  if (!schema_table_exists($pdo, 'curriculum_courses') || $oldName === '' || strcasecmp($oldName, $newName) === 0) {
    return;
  }
  $lec = $pdo->prepare('UPDATE curriculum_courses SET lecture_room_type = ? WHERE lecture_room_type = ?');
  $lec->execute([$newName, $oldName]);
  $lab = $pdo->prepare('UPDATE curriculum_courses SET lab_room_type = ? WHERE lab_room_type = ?');
  $lab->execute([$newName, $oldName]);
}

function reassign_type_references(PDO $pdo, int $sourceId, int $replaceId): void
{
  if ($sourceId === $replaceId) {
    return;
  }
  if (schema_table_exists($pdo, 'rooms')) {
    $upd = $pdo->prepare('UPDATE rooms SET room_type_id = ? WHERE room_type_id = ?');
    $upd->execute([$replaceId, $sourceId]);
  }
  if (schema_table_exists($pdo, 'course_room_requirements')) {
    $pdo->prepare(
      'DELETE crr FROM course_room_requirements crr
       INNER JOIN course_room_requirements keep
         ON keep.curriculum_course_id = crr.curriculum_course_id
        AND keep.component = crr.component
        AND keep.room_type_id = ?
      WHERE crr.room_type_id = ?'
    )->execute([$replaceId, $sourceId]);
    $pdo->prepare('UPDATE course_room_requirements SET room_type_id = ? WHERE room_type_id = ?')
      ->execute([$replaceId, $sourceId]);
  }
}

function add_room_type(PDO $pdo, array $body): array
{
  $name = canonical_room_type_name(clean_room_type_name($body['name'] ?? ''));
  if ($name === '') {
    throw new InvalidArgumentException('Enter a name for the room type.');
  }
  if (strlen($name) > 120) {
    throw new InvalidArgumentException('Keep the name under 120 characters.');
  }
  $requires = array_key_exists('requiresCampusRoom', $body)
    ? (int) !!$body['requiresCampusRoom']
    : (campus_room_required_for_type_name($name) ? 1 : 0);
  if (!campus_room_required_for_type_name($name)) {
    $requires = 0;
  }

  $stmt = $pdo->prepare(
    'SELECT room_type_id, room_type_name, is_active, created_at, requires_campus_room
     FROM room_types WHERE room_type_name = ?'
  );
  $stmt->execute([$name]);
  $existing = $stmt->fetch();
  if ($existing) {
    $usage = type_usage_map($pdo);
    return [
      'conflict' => present_type($existing, $usage),
      'type' => present_type($existing, $usage),
      'types' => list_room_types($pdo),
    ];
  }

  $ins = $pdo->prepare(
    'INSERT INTO room_types (room_type_name, room_type_code, is_active, requires_campus_room) VALUES (?, NULL, 1, ?)'
  );
  $ins->execute([$name, $requires]);
  $id = (int) $pdo->lastInsertId();
  $row = fetch_type_row($pdo, $id);
  return [
    'type' => present_type($row ?: ['room_type_id' => $id, 'room_type_name' => $name, 'is_active' => 1, 'created_at' => null, 'requires_campus_room' => $requires]),
    'types' => list_room_types($pdo),
  ];
}

function rename_room_type(PDO $pdo, array $body): array
{
  $id = resolve_room_type_id($pdo, $body['id'] ?? '');
  $row = $id ? fetch_type_row($pdo, $id) : null;
  if (!$row) {
    throw new InvalidArgumentException('That room type was not found.');
  }
  if (is_protected_room_type_name((string) $row['room_type_name'])) {
    throw new InvalidArgumentException('Lecture and Off-campus cannot be renamed.');
  }
  $name = canonical_room_type_name(clean_room_type_name($body['name'] ?? ''));
  if ($name === '') {
    throw new InvalidArgumentException('Enter a name for the room type.');
  }
  if (strlen($name) > 120) {
    throw new InvalidArgumentException('Keep the name under 120 characters.');
  }
  if (is_protected_room_type_name($name)) {
    throw new InvalidArgumentException('That name is reserved. Choose a different room type name.');
  }

  $oldName = (string) $row['room_type_name'];
  if (strcasecmp($oldName, $name) === 0) {
    $usage = type_usage_map($pdo);
    return ['type' => present_type($row, $usage), 'types' => list_room_types($pdo)];
  }

  $dup = $pdo->prepare('SELECT room_type_id FROM room_types WHERE room_type_name = ? AND room_type_id <> ?');
  $dup->execute([$name, $id]);
  if ($dup->fetchColumn()) {
    throw new InvalidArgumentException('A room type named "' . $name . '" already exists.');
  }

  $pdo->beginTransaction();
  try {
    $campus = campus_room_required_for_type_name($name) ? (int) $row['requires_campus_room'] : 0;
    $upd = $pdo->prepare('UPDATE room_types SET room_type_name = ?, requires_campus_room = ? WHERE room_type_id = ?');
    $upd->execute([$name, $campus, $id]);
    retag_curriculum_type_names($pdo, $oldName, $name);
    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) {
      $pdo->rollBack();
    }
    throw $e;
  }

  $fresh = fetch_type_row($pdo, $id);
  return [
    'type' => present_type($fresh ?: $row, type_usage_map($pdo)),
    'types' => list_room_types($pdo),
  ];
}

function delete_room_type(PDO $pdo, array $body): array
{
  $id = resolve_room_type_id($pdo, $body['id'] ?? '');
  $row = $id ? fetch_type_row($pdo, $id) : null;
  if (!$row) {
    throw new InvalidArgumentException('That room type was not found.');
  }
  if (is_protected_room_type_name((string) $row['room_type_name'])) {
    throw new InvalidArgumentException('Lecture and Off-campus cannot be deleted.');
  }

  $usage = type_usage_map($pdo);
  $u = $usage[$id] ?? ['rooms' => 0, 'subjects' => 0, 'requirements' => 0];
  $inUse = ((int) $u['rooms'] + (int) $u['subjects'] + (int) ($u['requirements'] ?? 0)) > 0;
  $replaceId = resolve_room_type_id($pdo, $body['replaceId'] ?? '');

  if ($inUse) {
    if (!$replaceId) {
      throw new InvalidArgumentException('This room type is in use. Choose a replacement so rooms and subjects can be retagged.');
    }
    $replace = fetch_type_row($pdo, $replaceId);
    if (!$replace) {
      throw new InvalidArgumentException('Choose a replacement room type.');
    }
    if ($replaceId === $id) {
      throw new InvalidArgumentException('Choose a different room type as the replacement.');
    }
  }

  $pdo->beginTransaction();
  try {
    if ($inUse && $replaceId) {
      $replace = fetch_type_row($pdo, $replaceId);
      reassign_type_references($pdo, $id, $replaceId);
      retag_curriculum_type_names($pdo, (string) $row['room_type_name'], (string) $replace['room_type_name']);
    }
    $del = $pdo->prepare('DELETE FROM room_types WHERE room_type_id = ?');
    $del->execute([$id]);
    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) {
      $pdo->rollBack();
    }
    throw $e;
  }

  return ['deleted' => true, 'types' => list_room_types($pdo)];
}
