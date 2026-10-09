<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$pdo = db();
ensure_facilities_ui_state($pdo);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
  json_ok(['snapshot' => facilities_snapshot($pdo)]);
}

if ($method === 'PUT' || $method === 'POST') {
  $body = json_input();
  try {
    if (is_file(__DIR__ . '/schedule-workspaces.php')) {
      require_once __DIR__ . '/schedule-workspaces.php';
    }
    $pdo->beginTransaction();
    $beforeBlocked = facilities_room_block_flags($pdo);
    $beforeBuildings = facilities_building_active_flags($pdo);
    sync_facilities($pdo, $body);
    $newlyBlocked = facilities_newly_blocked_public_room_ids($pdo, $beforeBlocked, $beforeBuildings);
    $scheduleImpact = ['clearedClasses' => 0, 'bySlot' => []];
    if ($newlyBlocked && function_exists('clear_private_schedules_for_blocked_rooms')) {
      $scheduleImpact = clear_private_schedules_for_blocked_rooms($pdo, $newlyBlocked);
    }
    $pdo->commit();
    json_ok([
      'snapshot' => facilities_snapshot($pdo),
      'scheduleImpact' => $scheduleImpact,
      'blockedRooms' => $newlyBlocked,
    ]);
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) {
      $pdo->rollBack();
    }
    json_error($e->getMessage(), 400);
  }
}

json_error('Unsupported method', 405);

function ensure_facilities_ui_state(PDO $pdo): void
{
  $pdo->exec(
    "CREATE TABLE IF NOT EXISTS facilities_ui_state (
      state_id   TINYINT PRIMARY KEY,
      extras     JSON NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
  );
  ensure_room_code_per_building($pdo);
}

function ensure_room_code_per_building(PDO $pdo): void
{
  if (!schema_table_exists($pdo, 'rooms')) {
    return;
  }
  $indexes = $pdo->query(
    "SELECT INDEX_NAME,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols,
            MAX(NON_UNIQUE) AS non_unique
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rooms'
     GROUP BY INDEX_NAME"
  )->fetchAll();
  foreach ($indexes as $idx) {
    if ((int) $idx['non_unique'] !== 0) {
      continue;
    }
    if (strcasecmp((string) $idx['cols'], 'room_code') !== 0) {
      continue;
    }
    $name = str_replace('`', '``', (string) $idx['INDEX_NAME']);
    $pdo->exec('ALTER TABLE rooms DROP INDEX `' . $name . '`');
  }
  if (!schema_index_exists($pdo, 'rooms', 'uq_rooms_floor_code')) {
    $pdo->exec('ALTER TABLE rooms ADD UNIQUE KEY uq_rooms_floor_code (floor_id, room_code)');
  }
}

function room_map_get(array $map, string $bkey, string $rid, mixed $default = null): mixed
{
  $k = $bkey . '::' . $rid;
  if (array_key_exists($k, $map)) {
    return $map[$k];
  }
  if (array_key_exists($rid, $map)) {
    return $map[$rid];
  }
  return $default;
}

function as_object(array $arr): object|array
{
  return $arr === [] ? new stdClass() : $arr;
}

function load_extras(PDO $pdo): array
{
  $raw = $pdo->query('SELECT extras FROM facilities_ui_state WHERE state_id = 1')->fetchColumn();
  if (!$raw) {
    return [];
  }
  $decoded = json_decode((string) $raw, true);
  return is_array($decoded) ? $decoded : [];
}

function save_extras(PDO $pdo, array $extras): void
{
  $json = json_encode($extras, JSON_UNESCAPED_UNICODE);
  $stmt = $pdo->prepare(
    'INSERT INTO facilities_ui_state (state_id, extras) VALUES (1, ?)
     ON DUPLICATE KEY UPDATE extras = VALUES(extras)'
  );
  $stmt->execute([$json]);
}

function resolve_college_id(PDO $pdo, mixed $public): ?int
{
  if ($public === null || $public === '' || $public === false) {
    return null;
  }
  $value = trim((string) $public);
  if ($value === '' || $value === '__multi__') {
    return null;
  }
  $id = parse_id($value, 'c');
  if ($id !== null) {
    $stmt = $pdo->prepare('SELECT college_id FROM colleges WHERE college_id = ? LIMIT 1');
    $stmt->execute([$id]);
    return $stmt->fetchColumn() ? $id : null;
  }
  $stmt = $pdo->prepare('SELECT college_id FROM colleges WHERE college_code = ? LIMIT 1');
  $stmt->execute([strtoupper($value)]);
  $found = $stmt->fetchColumn();
  return $found ? (int) $found : null;
}

function clamp_building_code(string $code): string
{
  $code = strtolower(trim($code));
  $code = preg_replace('/[^a-z0-9-]+/', '-', $code) ?? 'building';
  $code = trim($code, '-');
  if ($code === '') {
    $code = 'building';
  }
  return substr($code, 0, 20);
}

function facilities_snapshot(PDO $pdo): array
{
  $extras = load_extras($pdo);
  $buildings = $pdo->query(
    'SELECT building_id, building_code, building_name, uses_floors, exclusive_college_id, is_active
     FROM buildings'
  )->fetchAll();

  $codeById = [];
  $buildingNames = [];
  $buildingUsesFloors = [];
  $buildingDeptOnly = [];
  $buildingAvailable = [];

  foreach ($buildings as $b) {
    $code = (string) $b['building_code'];
    $codeById[(int) $b['building_id']] = $code;
    $buildingNames[$code] = $b['building_name'];
    $buildingUsesFloors[$code] = ((int) $b['uses_floors'] === 1);
    $buildingAvailable[$code] = ((int) $b['is_active'] === 1);
    if ($b['exclusive_college_id']) {
      $buildingDeptOnly[$code] = public_id('c', (int) $b['exclusive_college_id']);
    }
  }

  $buildingOrder = [];
  $savedOrder = $extras['buildingOrder'] ?? [];
  if (is_array($savedOrder)) {
    foreach ($savedOrder as $c) {
      $c = (string) $c;
      if (isset($buildingNames[$c]) && !in_array($c, $buildingOrder, true)) {
        $buildingOrder[] = $c;
      }
    }
  }
  foreach (array_keys($buildingNames) as $c) {
    if (!in_array($c, $buildingOrder, true)) {
      $buildingOrder[] = $c;
    }
  }

  $floors = $pdo->query(
    'SELECT floor_id, building_id, floor_number FROM floors'
  )->fetchAll();
  $floorMeta = [];
  foreach ($floors as $f) {
    $bid = (int) $f['building_id'];
    $num = (int) $f['floor_number'];
    $floorMeta[(int) $f['floor_id']] = ['building_id' => $bid, 'floor_number' => $num];
  }

  $rooms = $pdo->query(
    'SELECT r.room_code, r.capacity, r.status, r.owner_college_id, r.floor_id, rt.room_type_name
     FROM rooms r
     JOIN room_types rt ON rt.room_type_id = r.room_type_id'
  )->fetchAll();

  $roomsByBuilding = [];
  $roomFloorById = [];
  $roomStatus = [];
  $roomAllocation = is_array($extras['roomAllocation'] ?? null) ? $extras['roomAllocation'] : [];
  $roomsOnFloor = [];

  foreach ($rooms as $r) {
    $fid = (int) $r['floor_id'];
    if (!isset($floorMeta[$fid])) {
      continue;
    }
    $code = $codeById[$floorMeta[$fid]['building_id']] ?? null;
    if ($code === null) {
      continue;
    }
    $rid = (string) $r['room_code'];
    $mapKey = $code . '::' . $rid;
    $roomsByBuilding[$code][] = $rid;
    $roomFloorById[$mapKey] = $floorMeta[$fid]['floor_number'];
    $roomStatus[$mapKey] = (string) $r['status'];
    $roomsOnFloor[$fid] = true;
    $prev = is_array($roomAllocation[$mapKey] ?? null)
      ? $roomAllocation[$mapKey]
      : (is_array($roomAllocation[$rid] ?? null) ? $roomAllocation[$rid] : []);
    $multi = !empty($prev['multiCollege']);
    $owner = $r['owner_college_id'] ? public_id('c', (int) $r['owner_college_id']) : '';
    $colleges = [];
    if ($multi && isset($prev['colleges']) && is_array($prev['colleges'])) {
      $colleges = array_values(array_filter($prev['colleges'], static fn ($v) => $v !== '' && $v !== null));
    }
    $roomAllocation[$mapKey] = [
      'type' => (string) $r['room_type_name'],
      'capacity' => (string) (int) $r['capacity'],
      'multiCollege' => $multi,
      'college' => $multi ? '' : $owner,
      'colleges' => $multi ? $colleges : [],
    ];
  }

  $extraFloorsByBuilding = [];
  foreach ($floors as $f) {
    $bid = (int) $f['building_id'];
    $code = $codeById[$bid] ?? null;
    if ($code === null) {
      continue;
    }
    $fid = (int) $f['floor_id'];
    $num = (int) $f['floor_number'];
    $uses = $buildingUsesFloors[$code] ?? true;
    if (!$uses) {
      continue;
    }
    if (!isset($roomsOnFloor[$fid])) {
      $extraFloorsByBuilding[$code][] = $num;
    }
  }

  $floorDepartmentsByBuilding = [];
  $fca = $pdo->query('SELECT floor_id, college_id FROM floor_college_access')->fetchAll();
  $collegesByFloor = [];
  foreach ($fca as $row) {
    $collegesByFloor[(int) $row['floor_id']][] = public_id('c', (int) $row['college_id']);
  }
  foreach ($floors as $f) {
    $fid = (int) $f['floor_id'];
    if (empty($collegesByFloor[$fid])) {
      continue;
    }
    $bid = (int) $f['building_id'];
    $code = $codeById[$bid] ?? null;
    if ($code === null) {
      continue;
    }
    if (empty($floorDepartmentsByBuilding[$code])) {
      $floorDepartmentsByBuilding[$code] = [];
    }
    $uses = $buildingUsesFloors[$code] ?? true;
    $key = $uses ? (string) (int) $f['floor_number'] : '_flat';
    $floorDepartmentsByBuilding[$code][$key] = $collegesByFloor[$fid];
  }

  $buildingProximity = [];
  $prox = $pdo->query(
    'SELECT building_id, near_building_id, rank_order
     FROM building_proximity
     ORDER BY rank_order, near_building_id'
  )->fetchAll();
  foreach ($prox as $row) {
    $from = $codeById[(int) $row['building_id']] ?? null;
    $to = $codeById[(int) $row['near_building_id']] ?? null;
    if ($from === null || $to === null) {
      continue;
    }
    $buildingProximity[$from][] = $to;
  }

  $roomTimetables = is_array($extras['roomTimetables'] ?? null) ? $extras['roomTimetables'] : [];

  return [
    'buildingOrder' => $buildingOrder,
    'buildingNames' => as_object($buildingNames),
    'roomsByBuilding' => as_object($roomsByBuilding),
    'roomFloorById' => as_object($roomFloorById),
    'roomStatus' => as_object($roomStatus),
    'buildingUsesFloors' => as_object($buildingUsesFloors),
    'extraFloorsByBuilding' => as_object($extraFloorsByBuilding),
    'roomAllocation' => as_object($roomAllocation),
    'roomTimetables' => as_object($roomTimetables),
    'buildingProximity' => as_object($buildingProximity),
    'floorDepartmentsByBuilding' => as_object($floorDepartmentsByBuilding),
    'buildingDeptOnly' => as_object($buildingDeptOnly),
    'buildingAvailable' => as_object($buildingAvailable),
  ];
}

function map_or_empty(mixed $value): array
{
  return is_array($value) ? $value : [];
}

function remap_building_keys(array $map): array
{
  $out = [];
  foreach ($map as $k => $v) {
    $out[clamp_building_code((string) $k)] = $v;
  }
  return $out;
}

function sync_facilities(PDO $pdo, array $snap): void
{
  $orderRaw = $snap['buildingOrder'] ?? [];
  $names = remap_building_keys(map_or_empty($snap['buildingNames'] ?? []));
  $roomsByBuilding = remap_building_keys(map_or_empty($snap['roomsByBuilding'] ?? []));
  $roomFloorById = map_or_empty($snap['roomFloorById'] ?? []);
  $roomStatus = map_or_empty($snap['roomStatus'] ?? []);
  $usesFloors = remap_building_keys(map_or_empty($snap['buildingUsesFloors'] ?? []));
  $extraFloors = remap_building_keys(map_or_empty($snap['extraFloorsByBuilding'] ?? []));
  $allocation = map_or_empty($snap['roomAllocation'] ?? []);
  $timetables = map_or_empty($snap['roomTimetables'] ?? []);
  $proximity = remap_building_keys(map_or_empty($snap['buildingProximity'] ?? []));
  $floorDepts = remap_building_keys(map_or_empty($snap['floorDepartmentsByBuilding'] ?? []));
  $deptOnly = remap_building_keys(map_or_empty($snap['buildingDeptOnly'] ?? []));
  $available = remap_building_keys(map_or_empty($snap['buildingAvailable'] ?? []));

  $buildingOrder = [];
  if (is_array($orderRaw)) {
    foreach ($orderRaw as $code) {
      $code = clamp_building_code((string) $code);
      if ($code !== '' && !in_array($code, $buildingOrder, true)) {
        $buildingOrder[] = $code;
      }
    }
  }
  foreach (array_keys($names) as $code) {
    $code = clamp_building_code((string) $code);
    if (!in_array($code, $buildingOrder, true)) {
      $buildingOrder[] = $code;
    }
  }

  $existing = $pdo->query('SELECT building_id, building_code FROM buildings')->fetchAll();
  $idByCode = [];
  foreach ($existing as $row) {
    $idByCode[(string) $row['building_code']] = (int) $row['building_id'];
  }

  $keepIds = [];
  $updB = $pdo->prepare(
    'UPDATE buildings
     SET building_name = ?, uses_floors = ?, exclusive_college_id = ?, is_active = ?
     WHERE building_id = ?'
  );
  $insB = $pdo->prepare(
    'INSERT INTO buildings (building_code, building_name, uses_floors, exclusive_college_id, is_active)
     VALUES (?, ?, ?, ?, ?)'
  );

  foreach ($buildingOrder as $code) {
    $name = trim((string) ($names[$code] ?? $code));
    if ($name === '') {
      $name = $code;
    }
    $uses = !empty($usesFloors[$code]);
    if (!array_key_exists($code, $usesFloors)) {
      $uses = true;
    } else {
      $uses = (bool) $usesFloors[$code];
    }
    $isActive = array_key_exists($code, $available) ? (!empty($available[$code]) ? 1 : 0) : 1;
    $exclusive = resolve_college_id($pdo, $deptOnly[$code] ?? null);
    if (isset($idByCode[$code])) {
      $updB->execute([$name, $uses ? 1 : 0, $exclusive, $isActive, $idByCode[$code]]);
      $keepIds[$code] = $idByCode[$code];
    } else {
      $insB->execute([$code, $name, $uses ? 1 : 0, $exclusive, $isActive]);
      $idByCode[$code] = (int) $pdo->lastInsertId();
      $keepIds[$code] = $idByCode[$code];
    }
  }

  $selFloor = $pdo->prepare('SELECT floor_id FROM floors WHERE building_id = ? AND floor_number = ?');
  $insFloor = $pdo->prepare('INSERT INTO floors (building_id, floor_number) VALUES (?, ?)');
  $neededFloorIds = [];
  $floorIdByBuildingNum = [];

  foreach ($keepIds as $code => $bid) {
    $uses = !empty($usesFloors[$code]);
    if (!array_key_exists($code, $usesFloors)) {
      $uses = true;
    } else {
      $uses = (bool) $usesFloors[$code];
    }
    $nums = [];
    if ($uses) {
      foreach (($extraFloors[$code] ?? []) as $n) {
        $n = (int) $n;
        if ($n >= 1 && $n <= 40) {
          $nums[$n] = true;
        }
      }
      foreach (($roomsByBuilding[$code] ?? []) as $rid) {
        $n = (int) room_map_get($roomFloorById, (string) $code, (string) $rid, 1);
        if ($n < 1) {
          $n = 1;
        }
        if ($n > 40) {
          $n = 40;
        }
        $nums[$n] = true;
      }
    }
    if (!$nums) {
      $nums[1] = true;
    }
    foreach (array_keys($nums) as $n) {
      $n = (int) $n;
      $selFloor->execute([$bid, $n]);
      $fid = $selFloor->fetchColumn();
      if ($fid) {
        $fid = (int) $fid;
      } else {
        $insFloor->execute([$bid, $n]);
        $fid = (int) $pdo->lastInsertId();
      }
      $neededFloorIds[$fid] = true;
      $floorIdByBuildingNum[$bid][$n] = $fid;
    }
  }

  $selRoom = $pdo->prepare(
    'SELECT r.room_id FROM rooms r
     JOIN floors f ON f.floor_id = r.floor_id
     WHERE f.building_id = ? AND r.room_code = ?'
  );
  $updRoom = $pdo->prepare(
    'UPDATE rooms
     SET floor_id = ?, room_type_id = ?, capacity = ?, status = ?, owner_college_id = ?
     WHERE room_id = ?'
  );
  $insRoom = $pdo->prepare(
    'INSERT INTO rooms (floor_id, room_type_id, room_code, capacity, status, owner_college_id)
     VALUES (?, ?, ?, ?, ?, ?)'
  );

  $keepRoomIds = [];
  foreach ($keepIds as $code => $bid) {
    $uses = !empty($usesFloors[$code]);
    if (!array_key_exists($code, $usesFloors)) {
      $uses = true;
    } else {
      $uses = (bool) $usesFloors[$code];
    }
    foreach (($roomsByBuilding[$code] ?? []) as $rid) {
      $rid = trim((string) $rid);
      if ($rid === '') {
        continue;
      }
      $rid = substr($rid, 0, 30);
      $floorNum = $uses ? (int) room_map_get($roomFloorById, (string) $code, $rid, 1) : 1;
      if ($floorNum < 1) {
        $floorNum = 1;
      }
      if ($floorNum > 40) {
        $floorNum = 40;
      }
      $fid = $floorIdByBuildingNum[$bid][$floorNum] ?? ($floorIdByBuildingNum[$bid][1] ?? null);
      if ($fid === null) {
        throw new RuntimeException('Building "' . $code . '" is missing a floor for room ' . $rid . '.');
      }
      $alloc = room_map_get($allocation, (string) $code, $rid, []);
      $alloc = is_array($alloc) ? $alloc : [];
      $typeName = trim((string) ($alloc['type'] ?? ''));
      if ($typeName === '') {
        $typeId = find_room_type_id($pdo, 'Lecture') ?: ensure_room_type($pdo, 'Lecture');
      } else {
        $typeId = find_room_type_id($pdo, $typeName);
        if ($typeId === null) {
          throw new RuntimeException(
            'Room type "' . $typeName . '" is not in the list. Add it under Facilities → Room types first.'
          );
        }
      }
      $capacity = (int) ($alloc['capacity'] ?? 0);
      if ($capacity < 1) {
        $capacity = 40;
      }
      $status = (string) room_map_get($roomStatus, (string) $code, $rid, 'active');
      if (!in_array($status, ['active', 'vacant', 'under_maintenance'], true)) {
        $status = 'active';
      }
      $owner = null;
      if (empty($alloc['multiCollege'])) {
        $owner = resolve_college_id($pdo, $alloc['college'] ?? null);
      }
      $selRoom->execute([$bid, $rid]);
      $roomId = $selRoom->fetchColumn();
      if ($roomId) {
        $updRoom->execute([$fid, $typeId, $capacity, $status, $owner, (int) $roomId]);
        $keepRoomIds[] = (int) $roomId;
      } else {
        $insRoom->execute([$fid, $typeId, $rid, $capacity, $status, $owner]);
        $keepRoomIds[] = (int) $pdo->lastInsertId();
      }
    }
  }

  if ($keepRoomIds) {
    $ids = array_map('intval', $keepRoomIds);
    $in = implode(',', $ids);
    $pdo->exec("DELETE FROM rooms WHERE room_id NOT IN ({$in})");
  } else {
    $pdo->exec('DELETE FROM rooms');
  }

  if ($neededFloorIds) {
    $ids = array_map('intval', array_keys($neededFloorIds));
    $in = implode(',', $ids);
    $pdo->exec("DELETE FROM floors WHERE floor_id NOT IN ({$in})");
  } else {
    $pdo->exec('DELETE FROM floors');
  }

  $pdo->exec('DELETE FROM building_proximity');
  $insProx = $pdo->prepare(
    'INSERT INTO building_proximity (building_id, near_building_id, rank_order) VALUES (?, ?, ?)'
  );
  foreach ($keepIds as $code => $bid) {
    $rank = 1;
    $seen = [];
    foreach (($proximity[$code] ?? []) as $near) {
      $near = clamp_building_code((string) $near);
      if ($near === '' || $near === $code || isset($seen[$near]) || !isset($keepIds[$near])) {
        continue;
      }
      $seen[$near] = true;
      $insProx->execute([$bid, $keepIds[$near], $rank]);
      $rank++;
      if ($rank > 2) {
        break;
      }
    }
  }

  $pdo->exec('DELETE FROM floor_college_access');
  $insFca = $pdo->prepare('INSERT INTO floor_college_access (floor_id, college_id) VALUES (?, ?)');
  foreach ($keepIds as $code => $bid) {
    $uses = !empty($usesFloors[$code]);
    if (!array_key_exists($code, $usesFloors)) {
      $uses = true;
    } else {
      $uses = (bool) $usesFloors[$code];
    }
    $fd = is_array($floorDepts[$code] ?? null) ? $floorDepts[$code] : [];
    foreach ($fd as $key => $list) {
      if (!is_array($list)) {
        continue;
      }
      $floorNum = ($key === '_flat' || !$uses) ? 1 : (int) $key;
      $fid = $floorIdByBuildingNum[$bid][$floorNum] ?? null;
      if ($fid === null) {
        continue;
      }
      $seenC = [];
      foreach ($list as $cid) {
        $collegeId = resolve_college_id($pdo, $cid);
        if ($collegeId === null || isset($seenC[$collegeId])) {
          continue;
        }
        $seenC[$collegeId] = true;
        $insFca->execute([$fid, $collegeId]);
      }
    }
  }

  $keepIdList = array_values($keepIds);
  if ($keepIdList) {
    $in = implode(',', array_map('intval', $keepIdList));
    $pdo->exec("DELETE FROM buildings WHERE building_id NOT IN ({$in})");
  } else {
    $pdo->exec('DELETE FROM buildings');
  }

  $allocOut = [];
  foreach ($allocation as $rid => $row) {
    if (!isset($keepRoomCodes[(string) $rid]) || !is_array($row)) {
      continue;
    }
    $allocOut[(string) $rid] = [
      'type' => (string) ($row['type'] ?? ''),
      'capacity' => (string) ($row['capacity'] ?? ''),
      'multiCollege' => !empty($row['multiCollege']),
      'college' => (string) ($row['college'] ?? ''),
      'colleges' => isset($row['colleges']) && is_array($row['colleges']) ? array_values($row['colleges']) : [],
    ];
  }

  $timesOut = [];
  foreach ($timetables as $rid => $row) {
    if (!isset($keepRoomCodes[(string) $rid])) {
      continue;
    }
    $timesOut[(string) $rid] = $row;
  }

  save_extras($pdo, [
    'buildingOrder' => array_keys($keepIds),
    'roomAllocation' => $allocOut,
    'roomTimetables' => $timesOut,
  ]);
}

/** room_id => true when the room cannot be used for scheduling. */
function facilities_room_block_flags(PDO $pdo): array
{
  if (!schema_table_exists($pdo, 'rooms')) {
    return [];
  }
  $sql = "SELECT r.room_id, r.status, b.is_active
          FROM rooms r
          LEFT JOIN floors f ON f.floor_id = r.floor_id
          LEFT JOIN buildings b ON b.building_id = f.building_id";
  $out = [];
  foreach ($pdo->query($sql) as $row) {
    $buildingOk = $row['is_active'] === null || (int) $row['is_active'] === 1;
    $blocked = ((string) ($row['status'] ?? '') === 'under_maintenance') || !$buildingOk;
    $out[(int) $row['room_id']] = $blocked;
  }
  return $out;
}

/** building_id => true when the building is available for scheduling. */
function facilities_building_active_flags(PDO $pdo): array
{
  if (!schema_table_exists($pdo, 'buildings')) {
    return [];
  }
  $out = [];
  foreach ($pdo->query('SELECT building_id, is_active FROM buildings') as $row) {
    $out[(int) $row['building_id']] = ((int) ($row['is_active'] ?? 1) === 1);
  }
  return $out;
}

function facilities_newly_blocked_public_room_ids(PDO $pdo, array $beforeBlocked, array $beforeBuildings = []): array
{
  $after = facilities_room_block_flags($pdo);
  $ids = [];
  foreach ($after as $roomId => $blocked) {
    if (!$blocked) {
      continue;
    }
    if (!empty($beforeBlocked[(int) $roomId])) {
      continue;
    }
    $ids[(int) $roomId] = public_id('r', (int) $roomId);
  }
  // Building turned unavailable: clear every room in it, even ones already
  // under maintenance, so leftover My schedule bookings cannot linger.
  if (schema_table_exists($pdo, 'rooms') && schema_table_exists($pdo, 'buildings')) {
    $afterBuildings = facilities_building_active_flags($pdo);
    $flipped = [];
    foreach ($afterBuildings as $bid => $active) {
      if ($active) {
        continue;
      }
      if (!array_key_exists((int) $bid, $beforeBuildings) || !empty($beforeBuildings[(int) $bid])) {
        $flipped[(int) $bid] = true;
      }
    }
    if ($flipped) {
      $sql = "SELECT r.room_id, f.building_id
              FROM rooms r
              JOIN floors f ON f.floor_id = r.floor_id";
      foreach ($pdo->query($sql) as $row) {
        $bid = (int) ($row['building_id'] ?? 0);
        if ($bid && !empty($flipped[$bid])) {
          $rid = (int) $row['room_id'];
          $ids[$rid] = public_id('r', $rid);
        }
      }
    }
  }
  return array_values($ids);
}
