<?php
declare(strict_types=1);

// Partition limits, shared by the generator and the manual controls. They live
// here because schedule.php runs its request handling before its own top-level
// statements would be reached, so a const declared there is never defined.
const PARTITION_MIN_STUDENTS = 5;
const PARTITION_MAX_PARTS = 3;

function ensure_schedule_workspace_schema(PDO $pdo): void
{
  if (!schema_table_exists($pdo, 'terms')) {
    return;
  }
  $pdo->exec(
    "CREATE TABLE IF NOT EXISTS schedule_copies (
      copy_id INT PRIMARY KEY AUTO_INCREMENT,
      term_id INT NOT NULL,
      slot VARCHAR(40) NOT NULL,
      kind ENUM('workspace','save','archived_save') NOT NULL DEFAULT 'workspace',
      owner_role ENUM('admin','super_admin') NULL,
      title VARCHAR(120) NULL,
      payload LONGTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_sc_term_slot (term_id, slot, kind),
      KEY idx_sc_owner (owner_role, kind),
      CONSTRAINT fk_sc_term FOREIGN KEY (term_id) REFERENCES terms(term_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
  );
  $pdo->exec(
    "CREATE TABLE IF NOT EXISTS schedule_open_requests (
      request_id INT PRIMARY KEY AUTO_INCREMENT,
      copy_id INT NOT NULL,
      term_id INT NOT NULL,
      status ENUM('pending','granted','denied') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      decided_at DATETIME NULL,
      KEY idx_sor_status (status),
      CONSTRAINT fk_sor_copy FOREIGN KEY (copy_id) REFERENCES schedule_copies(copy_id) ON DELETE CASCADE,
      CONSTRAINT fk_sor_term FOREIGN KEY (term_id) REFERENCES terms(term_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
  );
  if (schema_table_exists($pdo, 'schedule_copies') && !schema_column_exists($pdo, 'schedule_copies', 'is_shared')) {
    $pdo->exec('ALTER TABLE schedule_copies ADD COLUMN is_shared TINYINT(1) NOT NULL DEFAULT 0 AFTER owner_role');
  }
  if (schema_table_exists($pdo, 'schedule_open_requests') && !schema_column_exists($pdo, 'schedule_open_requests', 'shared_fingerprint')) {
    $pdo->exec('ALTER TABLE schedule_open_requests ADD COLUMN shared_fingerprint VARCHAR(80) NULL AFTER status');
  }
  if (!schema_table_exists($pdo, 'schedule_generator_settings')) {
    $pdo->exec(
      "CREATE TABLE schedule_generator_settings (
        setting_id INT PRIMARY KEY AUTO_INCREMENT,
        term_id INT NOT NULL,
        slot VARCHAR(40) NOT NULL,
        merge_mode ENUM('auto','manual','off') NOT NULL DEFAULT 'auto',
        split_hours DECIMAL(3,1) NOT NULL DEFAULT 3.0,
        keep_lunch TINYINT(1) NOT NULL DEFAULT 1,
        partition_scope ENUM('off','small','medium','any') NOT NULL DEFAULT 'small',
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_sgs_term_slot (term_id, slot),
        CONSTRAINT fk_sgs_term FOREIGN KEY (term_id) REFERENCES terms(term_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
  }
  if (schema_table_exists($pdo, 'schedule_generator_settings')) {
    if (!schema_column_exists($pdo, 'schedule_generator_settings', 'partition_scope')) {
      $pdo->exec(
        "ALTER TABLE schedule_generator_settings
           ADD COLUMN partition_scope ENUM('off','small','medium','any') NOT NULL DEFAULT 'small' AFTER keep_lunch"
      );
    }
    if (schema_column_exists($pdo, 'schedule_generator_settings', 'allow_partition')) {
      $pdo->exec('ALTER TABLE schedule_generator_settings DROP COLUMN allow_partition');
    }
  }
  migrate_approval_json_into_copies($pdo);
}

function migrate_approval_json_into_copies(PDO $pdo): void
{
  if (!schema_table_exists($pdo, 'term_schedule_approvals') || !schema_table_exists($pdo, 'schedule_copies')) {
    return;
  }
  $rows = $pdo->query(
    'SELECT term_id, pending_sa_json, pending_vpaa_json, published_json
     FROM term_schedule_approvals'
  )->fetchAll();
  foreach ($rows as $row) {
    $termId = (int) $row['term_id'];
    $pairs = [
      'admin_submitted' => $row['pending_sa_json'] ?? null,
      'vpaa_pending' => $row['pending_vpaa_json'] ?? null,
      'vpaa_final' => $row['published_json'] ?? null,
    ];
    foreach ($pairs as $slot => $json) {
      if (!is_string($json) || trim($json) === '') {
        continue;
      }
      if (workspace_copy_exists($pdo, $termId, $slot)) {
        continue;
      }
      upsert_workspace_copy($pdo, $termId, $slot, json_decode($json, true) ?: ['classes' => []]);
    }
  }
}

function normalize_workspace(string $ws, string $actor, string $page = 'create'): string
{
  $ws = strtolower(trim($ws));
  $create = ['mine', 'submitted', 'saves', 'archives'];
  $report = ['final', 'awaiting'];
  if ($page === 'report') {
    if ($ws === '' || !in_array($ws, $report, true)) {
      return 'final';
    }
    return $ws;
  }
  if ($ws === 'shared') {
    return 'mine';
  }
  if ($ws === '' || !in_array($ws, $create, true)) {
    return 'mine';
  }
  return $ws;
}

function private_slot_for_actor(string $actor): string
{
  return $actor === 'super_admin' ? 'sa_private' : 'admin_private';
}

function generator_settings_slot(string $workspace, string $actor): string
{
  return private_slot_for_actor($actor);
}

function default_generator_settings(): array
{
  return [
    'mergeMode' => 'auto',
    'splitHours' => 3.0,
    'keepLunch' => true,
    'partitionScope' => 'small',
  ];
}

function normalize_generator_settings($raw): array
{
  $out = default_generator_settings();
  if (!is_array($raw)) {
    return $out;
  }
  $mode = strtolower(trim((string) ($raw['mergeMode'] ?? $raw['merge_mode'] ?? $out['mergeMode'])));
  $out['mergeMode'] = in_array($mode, ['auto', 'manual', 'off'], true) ? $mode : 'auto';
  $hours = (float) ($raw['splitHours'] ?? $raw['split_hours'] ?? $out['splitHours']);
  if ($hours < 1) {
    $hours = 1;
  }
  if ($hours > 6) {
    $hours = 6;
  }
  $out['splitHours'] = round($hours * 2) / 2;
  if (array_key_exists('keepLunch', $raw) || array_key_exists('keep_lunch', $raw)) {
    $keep = $raw['keepLunch'] ?? $raw['keep_lunch'];
    if (is_string($keep)) {
      $keep = !in_array(strtolower($keep), ['0', 'false', 'off', 'no'], true);
    }
    $out['keepLunch'] = !($keep === false || $keep === 0);
  }
  if (array_key_exists('partitionScope', $raw) || array_key_exists('partition_scope', $raw)) {
    $scope = strtolower(trim((string) ($raw['partitionScope'] ?? $raw['partition_scope'])));
    if (in_array($scope, ['off', 'small', 'medium', 'any'], true)) {
      $out['partitionScope'] = $scope;
    }
  }
  return $out;
}

function load_generator_settings(PDO $pdo, int $termId, string $slot): array
{
  $out = default_generator_settings();
  if ($termId < 1 || !schema_table_exists($pdo, 'schedule_generator_settings')) {
    return $out;
  }
  $hasScope = schema_column_exists($pdo, 'schedule_generator_settings', 'partition_scope');
  $stmt = $pdo->prepare(
    'SELECT merge_mode, split_hours, keep_lunch' . ($hasScope ? ', partition_scope' : '') . '
     FROM schedule_generator_settings
     WHERE term_id = ? AND slot = ?
     LIMIT 1'
  );
  $stmt->execute([$termId, $slot]);
  $row = $stmt->fetch();
  if (!$row) {
    return $out;
  }
  return normalize_generator_settings([
    'mergeMode' => (string) ($row['merge_mode'] ?? 'auto'),
    'splitHours' => (float) ($row['split_hours'] ?? 3),
    'keepLunch' => (int) ($row['keep_lunch'] ?? 1) === 1,
    'partitionScope' => (string) ($row['partition_scope'] ?? 'small'),
  ]);
}

function load_working_generator_settings(PDO $pdo, int $termId, string $actor): array
{
  $slot = private_slot_for_actor($actor);
  if ($termId < 1 || !schema_table_exists($pdo, 'schedule_generator_settings')) {
    return default_generator_settings();
  }
  $stmt = $pdo->prepare(
    'SELECT 1 FROM schedule_generator_settings WHERE term_id = ? AND slot = ? LIMIT 1'
  );
  $stmt->execute([$termId, $slot]);
  if ($stmt->fetchColumn()) {
    return load_generator_settings($pdo, $termId, $slot);
  }
  return load_generator_settings($pdo, $termId, 'shared');
}

function upsert_generator_settings(PDO $pdo, int $termId, string $slot, $raw): array
{
  $settings = normalize_generator_settings(
    array_merge(load_generator_settings($pdo, $termId, $slot), is_array($raw) ? $raw : [])
  );
  if ($termId < 1 || !schema_table_exists($pdo, 'schedule_generator_settings')) {
    return $settings;
  }
  if (!schema_column_exists($pdo, 'schedule_generator_settings', 'partition_scope')) {
    $sql = 'INSERT INTO schedule_generator_settings (term_id, slot, merge_mode, split_hours, keep_lunch)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              merge_mode = VALUES(merge_mode),
              split_hours = VALUES(split_hours),
              keep_lunch = VALUES(keep_lunch)';
    $pdo->prepare($sql)->execute([
      $termId,
      $slot,
      $settings['mergeMode'],
      $settings['splitHours'],
      $settings['keepLunch'] ? 1 : 0,
    ]);
    return $settings;
  }
  $sql = 'INSERT INTO schedule_generator_settings (term_id, slot, merge_mode, split_hours, keep_lunch, partition_scope)
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            merge_mode = VALUES(merge_mode),
            split_hours = VALUES(split_hours),
            keep_lunch = VALUES(keep_lunch),
            partition_scope = VALUES(partition_scope)';
  $pdo->prepare($sql)->execute([
    $termId,
    $slot,
    $settings['mergeMode'],
    $settings['splitHours'],
    $settings['keepLunch'] ? 1 : 0,
    $settings['partitionScope'],
  ]);
  return $settings;
}

function persist_request_generator_settings(PDO $pdo, array $body, int $termId): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  $workspace = normalize_workspace((string) ($body['workspace'] ?? 'mine'), $actor, 'create');
  if ($workspace !== 'mine') {
    $workspace = 'mine';
  }
  return upsert_generator_settings($pdo, $termId, generator_settings_slot($workspace, $actor), $body);
}

function save_generator_settings(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  if (!in_array($actor, ['admin', 'super_admin'], true)) {
    throw new RuntimeException('Only Admin or Super Admin can change generate settings.');
  }
  $workspace = normalize_workspace((string) ($body['workspace'] ?? 'mine'), $actor, 'create');
  if ($workspace !== 'mine') {
    throw new RuntimeException('Generate settings apply only to My schedule.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body, true);
  upsert_generator_settings($pdo, $termId, generator_settings_slot($workspace, $actor), $body);
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, $workspace, 'create');
}

function workspace_copy_exists(PDO $pdo, int $termId, string $slot): bool
{
  $stmt = $pdo->prepare(
    "SELECT 1 FROM schedule_copies WHERE term_id = ? AND slot = ? AND kind = 'workspace' LIMIT 1"
  );
  $stmt->execute([$termId, $slot]);
  return (bool) $stmt->fetchColumn();
}

function load_workspace_copy(PDO $pdo, int $termId, string $slot): ?array
{
  $stmt = $pdo->prepare(
    "SELECT payload FROM schedule_copies
     WHERE term_id = ? AND slot = ? AND kind = 'workspace'
     LIMIT 1"
  );
  $stmt->execute([$termId, $slot]);
  $raw = $stmt->fetchColumn();
  if (!$raw) {
    return null;
  }
  $decoded = json_decode((string) $raw, true);
  return is_array($decoded) ? $decoded : null;
}

function upsert_workspace_copy(PDO $pdo, int $termId, string $slot, array $snap): void
{
  if (!isset($snap['fingerprint']) && function_exists('schedule_fingerprint') && isset($snap['classes']) && is_array($snap['classes'])) {
    $snap['fingerprint'] = schedule_fingerprint($snap['classes']);
  }
  $json = json_encode($snap, JSON_UNESCAPED_UNICODE);
  $stmt = $pdo->prepare(
    "SELECT copy_id FROM schedule_copies WHERE term_id = ? AND slot = ? AND kind = 'workspace' LIMIT 1"
  );
  $stmt->execute([$termId, $slot]);
  $id = $stmt->fetchColumn();
  if ($id) {
    $pdo->prepare('UPDATE schedule_copies SET payload = ? WHERE copy_id = ?')->execute([$json, (int) $id]);
    return;
  }
  $pdo->prepare(
    "INSERT INTO schedule_copies (term_id, slot, kind, payload) VALUES (?, ?, 'workspace', ?)"
  )->execute([$termId, $slot, $json]);
}

function clear_workspace_copy(PDO $pdo, int $termId, string $slot): void
{
  $pdo->prepare(
    "DELETE FROM schedule_copies WHERE term_id = ? AND slot = ? AND kind = 'workspace'"
  )->execute([$termId, $slot]);
}

function empty_workspace_snapshot(): array
{
  $snap = ['classes' => []];
  if (function_exists('schedule_summary')) {
    $snap['summary'] = schedule_summary([]);
  }
  return $snap;
}

function seed_private_workspace_from_live_if_missing(PDO $pdo, int $termId, string $actor, string $year, string $sem): void
{
  $slot = private_slot_for_actor($actor);
  if ($termId < 1 || workspace_copy_exists($pdo, $termId, $slot)) {
    return;
  }
  $classes = function_exists('list_scheduled_classes') ? list_scheduled_classes($pdo, $termId) : [];
  if (!$classes) {
    return;
  }
  upsert_workspace_copy($pdo, $termId, $slot, schedule_live_snapshot($pdo, $year, $sem, $classes));
}

function workspace_has_classes(?array $snap): bool
{
  if (!$snap || empty($snap['classes']) || !is_array($snap['classes'])) {
    return false;
  }
  return count($snap['classes']) > 0;
}

function class_row_is_scheduled(array $class): bool
{
  $meetings = $class['meetings'] ?? [];
  return (string) ($class['status'] ?? '') === 'scheduled'
    && is_array($meetings)
    && $meetings !== [];
}

function snapshot_unscheduled_count(?array $snap): int
{
  $classes = is_array($snap) && isset($snap['classes']) && is_array($snap['classes']) ? $snap['classes'] : [];
  $n = 0;
  foreach ($classes as $class) {
    if (!is_array($class) || !class_row_is_scheduled($class)) {
      $n++;
    }
  }
  return $n;
}

function assert_complete_for_vpaa(?array $snap): void
{
  $classes = is_array($snap) && isset($snap['classes']) && is_array($snap['classes']) ? $snap['classes'] : [];
  if ($classes === []) {
    throw new RuntimeException(
      'There are no classes to send. Generate a timetable and place every class before submitting it to the VPAA.'
    );
  }
  $n = snapshot_unscheduled_count($snap);
  if ($n > 0) {
    throw new RuntimeException(
      $n === 1
        ? '1 class is still unscheduled. Place every class before submitting this timetable to the VPAA.'
        : $n . ' classes are still unscheduled. Place every class before submitting this timetable to the VPAA.'
    );
  }
}

function live_schedule_fingerprint(PDO $pdo, int $termId): string
{
  $classes = list_scheduled_classes($pdo, $termId);
  if (function_exists('schedule_fingerprint')) {
    return schedule_fingerprint($classes);
  }
  return hash('sha256', (string) json_encode($classes));
}

function stamp_copy_origin(array $snap, string $from, string $actor, string $action): array
{
  $from = 'mine';
  $snap['origin'] = [
    'from' => $from,
    'fromLabel' => 'My schedule',
    'actor' => $actor,
    'actorLabel' => $actor === 'super_admin' ? 'Super Admin' : 'Admin',
    'action' => $action,
    'at' => date('Y-m-d H:i:s'),
  ];
  if (!isset($snap['fingerprint']) && function_exists('schedule_fingerprint') && isset($snap['classes']) && is_array($snap['classes'])) {
    $snap['fingerprint'] = schedule_fingerprint($snap['classes']);
  }
  return $snap;
}

function copy_origin_public(?array $snap): ?array
{
  if (!$snap || empty($snap['origin']) || !is_array($snap['origin'])) {
    return null;
  }
  $o = $snap['origin'];
  return [
    'from' => (string) ($o['from'] ?? ''),
    'fromLabel' => (string) ($o['fromLabel'] ?? ''),
    'actor' => (string) ($o['actor'] ?? ''),
    'actorLabel' => (string) ($o['actorLabel'] ?? ''),
    'action' => (string) ($o['action'] ?? ''),
    'at' => (string) ($o['at'] ?? ''),
    'forwardedToVpaa' => !empty($o['forwardedToVpaa']),
    'forwardedAt' => (string) ($o['forwardedAt'] ?? ''),
    'returnedByVpaa' => !empty($o['returnedByVpaa']),
    'returnedAt' => (string) ($o['returnedAt'] ?? ''),
    'returnNote' => (string) ($o['returnNote'] ?? ''),
  ];
}

function format_origin_line(?array $origin): string
{
  if (!$origin) {
    return '';
  }
  $bits = [];
  $from = trim((string) ($origin['fromLabel'] ?? ''));
  $who = trim((string) ($origin['actorLabel'] ?? ''));
  $at = trim((string) ($origin['at'] ?? ''));
  if ($from !== '') {
    $bits[] = 'from ' . $from;
  }
  if ($who !== '') {
    $bits[] = $who;
  }
  if ($at !== '') {
    $bits[] = $at;
  }
  return implode(' · ', $bits);
}

function copy_is_forwarded(?array $snap): bool
{
  return is_array($snap) && !empty($snap['origin']['forwardedToVpaa']);
}

function list_report_terms(PDO $pdo): array
{
  if (!schema_table_exists($pdo, 'terms') || !schema_table_exists($pdo, 'school_years')) {
    return [];
  }
  ensure_term_archive_schema($pdo);
  $current = current_offering_term($pdo);
  $sql = 'SELECT t.term_id, t.term_code, t.is_active, sy.label AS school_year
          FROM terms t
          JOIN school_years sy ON sy.school_year_id = t.school_year_id
          ORDER BY sy.start_year DESC, FIELD(t.term_code, \'1\', \'2\', \'summer\')';
  $out = [];
  foreach ($pdo->query($sql)->fetchAll() as $row) {
    $termId = (int) $row['term_id'];
    $hasFinal = workspace_has_classes(load_workspace_copy($pdo, $termId, 'vpaa_final'));
    $hasAwaiting = workspace_has_classes(load_workspace_copy($pdo, $termId, 'vpaa_pending'));
    $isCurrent = $current && (int) $current['termId'] === $termId;
    if (!$hasFinal && !$hasAwaiting && !$isCurrent) {
      continue;
    }
    $out[] = [
      'schoolYear' => (string) $row['school_year'],
      'termCode' => (string) $row['term_code'],
      'archived' => (int) $row['is_active'] !== 1,
      'isCurrent' => $isCurrent,
      'hasFinal' => $hasFinal,
      'hasAwaiting' => $hasAwaiting,
    ];
  }
  return $out;
}

function vpaa_home_status(PDO $pdo): array
{
  $user = session_db_user($pdo);
  if (!$user || (string) ($user['role'] ?? '') !== 'vpaa') {
    throw new RuntimeException('Only the VPAA can open this.');
  }
  $term = current_offering_term($pdo);
  if (!$term) {
    return [
      'schoolYear' => '',
      'termCode' => '',
      'awaiting' => false,
      'published' => false,
    ];
  }
  $termId = (int) $term['termId'];
  return [
    'schoolYear' => (string) $term['schoolYear'],
    'termCode' => (string) $term['termCode'],
    'awaiting' => workspace_has_classes(load_workspace_copy($pdo, $termId, 'vpaa_pending')),
    'published' => workspace_has_classes(load_workspace_copy($pdo, $termId, 'vpaa_final')),
  ];
}

function workspace_tab_status(
  string $workspace,
  string $actor,
  bool $hasClasses,
  ?array $adminSubmitted,
  ?array $vpaaPending,
  ?array $vpaaFinal,
  ?array $vpaaReturned
): array {
  if ($workspace === 'saves') {
    return [
      'code' => 'saves',
      'label' => 'Named versions',
      'detail' => 'Your saves stay private until you share them. Shared saves are visible to both Admin and Super Admin.',
      'tone' => '',
    ];
  }
  if ($workspace === 'archives') {
    return [
      'code' => 'archives',
      'label' => 'Past terms and filed drafts',
      'detail' => 'Previous academic years and semesters, plus named versions moved out of Saves.',
      'tone' => '',
    ];
  }
  if ($workspace === 'submitted') {
    if (workspace_has_classes($vpaaReturned)) {
      $origin = copy_origin_public($vpaaReturned);
      $note = trim((string) ($origin['returnNote'] ?? ''));
      return [
        'code' => 'returned_by_vpaa',
        'label' => 'VPAA returned this copy',
        'detail' => trim('Frozen copy from the VPAA. ' . format_origin_line($origin) . ($note !== '' ? ' Note: ' . $note : '')),
        'tone' => 'warn',
        'origin' => $origin,
      ];
    }
    if (workspace_has_classes($adminSubmitted)) {
      $origin = copy_origin_public($adminSubmitted);
      if (copy_is_forwarded($adminSubmitted)) {
        return [
          'code' => 'sent_to_vpaa',
          'label' => 'Super Admin sent this copy to the VPAA',
          'detail' => trim('This snapshot stays here until the VPAA decides. ' . format_origin_line($origin)),
          'tone' => '',
          'origin' => $origin,
        ];
      }
      return [
        'code' => 'waiting_super_admin',
        'label' => 'Waiting for Super Admin',
        'detail' => trim('Submitted ' . format_origin_line($origin)),
        'tone' => '',
        'origin' => $origin,
      ];
    }
    return [
      'code' => 'empty',
      'label' => 'Empty',
      'detail' => $actor === 'super_admin'
        ? 'Admin has not submitted a timetable yet.'
        : 'Nothing is pending. Submit a copy from My schedule.',
      'tone' => '',
    ];
  }
  if ($workspace === 'awaiting') {
    if (workspace_has_classes($vpaaPending)) {
      $origin = copy_origin_public($vpaaPending);
      return [
        'code' => 'waiting_vpaa',
        'label' => $actor === 'vpaa' ? 'Ready for your decision' : 'Waiting for the VPAA',
        'detail' => $actor === 'vpaa'
          ? trim('Publish this for deans and program chairs, or send it back. ' . format_origin_line($origin))
          : trim('Sent to the VPAA ' . format_origin_line($origin)),
        'tone' => $actor === 'vpaa' ? 'warn' : '',
        'origin' => $origin,
      ];
    }
    return [
      'code' => 'empty',
      'label' => 'Empty',
      'detail' => $actor === 'vpaa'
        ? 'Nothing is waiting for your approval.'
        : 'No timetable is waiting for the VPAA.',
      'tone' => '',
    ];
  }
  if ($workspace === 'final') {
    if (workspace_has_classes($vpaaFinal)) {
      $origin = copy_origin_public($vpaaFinal);
      return [
        'code' => 'published',
        'label' => $actor === 'vpaa' ? 'Published' : 'VPAA published',
        'detail' => trim('Official copy. ' . format_origin_line($origin)),
        'tone' => 'ok',
        'origin' => $origin,
      ];
    }
    return [
      'code' => 'empty',
      'label' => 'Empty',
      'detail' => $actor === 'vpaa'
        ? 'You have not published a timetable for this term yet.'
        : 'The VPAA has not approved a timetable for this term yet.',
      'tone' => '',
    ];
  }
  if ($workspace === 'mine') {
    if (!$hasClasses) {
      return ['code' => 'empty', 'label' => 'Empty', 'detail' => 'Only you can see this tab. Generate a timetable or open a save.', 'tone' => ''];
    }
    $detail = 'Private draft.';
    if (workspace_has_classes($vpaaFinal)) {
      $detail .= ' The VPAA-published copy is on Reports.';
    }
    return ['code' => 'draft', 'label' => 'Draft', 'detail' => $detail, 'tone' => ''];
  }
  if (!$hasClasses) {
    return ['code' => 'empty', 'label' => 'Empty', 'detail' => 'My schedule is empty. Generate a timetable to start.', 'tone' => ''];
  }
  $detail = 'Working draft on My schedule.';
  if (workspace_has_classes($vpaaFinal)) {
    $detail .= ' The VPAA has published a copy on Reports; edits here are a new draft.';
  }
  if (workspace_has_classes($vpaaReturned) && $actor === 'super_admin') {
    $detail .= ' The VPAA also returned a frozen copy on Admin’s submitted schedule.';
  }
  return ['code' => 'draft', 'label' => 'Draft', 'detail' => $detail, 'tone' => workspace_has_classes($vpaaReturned) ? 'warn' : ''];
}

function resolve_offering_id_from_class(PDO $pdo, int $termId, array $cls): ?int
{
  $oid = parse_id((string) ($cls['id'] ?? ''), 'off');
  if ($oid) {
    $chk = $pdo->prepare('SELECT offering_id FROM class_offerings WHERE offering_id = ? AND term_id = ?');
    $chk->execute([$oid, $termId]);
    if ($chk->fetchColumn()) {
      return $oid;
    }
  }
  $sid = parse_id((string) ($cls['sectionId'] ?? ''), 's');
  $comp = (string) ($cls['component'] ?? '');
  $code = strtoupper(trim((string) ($cls['courseCode'] ?? '')));
  if (!$sid || !in_array($comp, ['lecture', 'laboratory'], true) || $code === '') {
    return null;
  }
  $stmt = $pdo->prepare(
    'SELECT o.offering_id
     FROM class_offerings o
     JOIN curriculum_courses cc ON cc.curriculum_course_id = o.curriculum_course_id
     WHERE o.term_id = ? AND o.section_id = ? AND o.component = ? AND UPPER(TRIM(cc.course_id)) = ?
     LIMIT 1'
  );
  $stmt->execute([$termId, $sid, $comp, $code]);
  $found = $stmt->fetchColumn();
  return $found ? (int) $found : null;
}

function clear_term_merges(PDO $pdo, int $termId): void
{
  if (schema_table_exists($pdo, 'merged_class_members') && schema_table_exists($pdo, 'class_offerings')) {
    $pdo->prepare(
      'DELETE mem FROM merged_class_members mem
       INNER JOIN class_offerings o ON o.offering_id = mem.offering_id
       WHERE o.term_id = ?'
    )->execute([$termId]);
  }
  if (schema_table_exists($pdo, 'merged_classes')) {
    $pdo->prepare('DELETE FROM merged_classes WHERE term_id = ?')->execute([$termId]);
  }
}

function rebuild_merges_from_classes(PDO $pdo, int $termId, array $classes, array $offeringMap): void
{
  if (!schema_table_exists($pdo, 'merged_classes') || !schema_table_exists($pdo, 'merged_class_members')) {
    return;
  }
  clear_term_merges($pdo, $termId);
  $groups = [];
  foreach ($classes as $cls) {
    if (!is_array($cls)) {
      continue;
    }
    $key = trim((string) ($cls['mergedClassId'] ?? ''));
    if ($key === '') {
      continue;
    }
    $oid = $offeringMap[(string) ($cls['id'] ?? '')] ?? parse_id((string) ($cls['id'] ?? ''), 'off');
    if ($oid) {
      $groups[$key][] = ['oid' => $oid, 'cls' => $cls];
    }
  }
  $insM = $pdo->prepare(
    'INSERT INTO merged_classes (term_id, course_code, component, room_id) VALUES (?, ?, ?, ?)'
  );
  $insMem = $pdo->prepare('INSERT INTO merged_class_members (merged_class_id, offering_id) VALUES (?, ?)');
  foreach ($groups as $members) {
    if (count($members) < 2) {
      continue;
    }
    $roomId = null;
    $course = (string) ($members[0]['cls']['courseCode'] ?? '');
    $comp = (string) ($members[0]['cls']['component'] ?? 'lecture');
    foreach ($members as $m) {
      foreach ($m['cls']['meetings'] ?? [] as $meet) {
        if (!is_array($meet)) {
          continue;
        }
        $rid = parse_id((string) ($meet['roomId'] ?? ''), 'r');
        if ($rid) {
          $roomId = $rid;
          break 2;
        }
      }
    }
    $insM->execute([$termId, $course, $comp, $roomId]);
    $mergedId = (int) $pdo->lastInsertId();
    foreach ($members as $m) {
      $insMem->execute([$mergedId, $m['oid']]);
    }
  }
}

function remap_workspace_request_ids(array &$body, array $maps): void
{
  $meetings = $maps['meetings'] ?? [];
  $offerings = $maps['offerings'] ?? [];
  foreach (['meetingId'] as $key) {
    $old = (string) ($body[$key] ?? '');
    if ($old !== '' && isset($meetings[$old])) {
      $body[$key] = public_id('mt', (int) $meetings[$old]);
    }
  }
  foreach (['offeringId', 'targetOfferingId'] as $key) {
    $old = (string) ($body[$key] ?? '');
    if ($old !== '' && isset($offerings[$old])) {
      $body[$key] = public_id('off', (int) $offerings[$old]);
    }
  }
}

function replace_term_meetings_from_classes(PDO $pdo, int $termId, array $classes): array
{
  if (schema_table_exists($pdo, 'meeting_slots')) {
    $pdo->prepare('DELETE FROM meeting_slots WHERE term_id = ?')->execute([$termId]);
  }
  $pdo->prepare('DELETE FROM class_meetings WHERE term_id = ?')->execute([$termId]);
  $ins = $pdo->prepare(
    'INSERT INTO class_meetings (offering_id, term_id, day_of_week, start_time, end_time, room_id)
     VALUES (?, ?, ?, ?, ?, ?)'
  );
  $updOff = $pdo->prepare('UPDATE class_offerings SET status = ? WHERE offering_id = ? AND term_id = ?');
  $offeringMap = [];
  $meetingMap = [];
  $claimedRooms = [];
  foreach ($classes as $cls) {
    if (!is_array($cls)) {
      continue;
    }
    $oid = resolve_offering_id_from_class($pdo, $termId, $cls);
    if (!$oid) {
      continue;
    }
    $offeringMap[(string) ($cls['id'] ?? '')] = $oid;
    $meetings = isset($cls['meetings']) && is_array($cls['meetings']) ? $cls['meetings'] : [];
    foreach ($meetings as $m) {
      if (!is_array($m)) {
        continue;
      }
      $day = (string) ($m['day'] ?? '');
      if (!in_array($day, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], true)) {
        continue;
      }
      $start = trim((string) ($m['start'] ?? ''));
      $end = trim((string) ($m['end'] ?? ''));
      if ($start === '' || $end === '') {
        continue;
      }
      if (strlen($start) === 5) {
        $start .= ':00';
      }
      if (strlen($end) === 5) {
        $end .= ':00';
      }
      $roomId = parse_id((string) ($m['roomId'] ?? ''), 'r');
      $mergeKey = trim((string) ($cls['mergedClassId'] ?? ''));
      if ($roomId && $mergeKey !== '') {
        $claim = $mergeKey . '|' . $day . '|' . substr($start, 0, 5);
        if (!empty($claimedRooms[$claim])) {
          $roomId = null;
        } else {
          $claimedRooms[$claim] = true;
        }
      }
      $ins->execute([$oid, $termId, $day, $start, $end, $roomId]);
      $oldId = trim((string) ($m['id'] ?? ''));
      if ($oldId !== '') {
        $meetingMap[$oldId] = (int) $pdo->lastInsertId();
      }
    }
    $updOff->execute([$meetings ? 'scheduled' : 'unscheduled', $oid, $termId]);
  }
  rebuild_merges_from_classes($pdo, $termId, $classes, $offeringMap);
  return ['offerings' => $offeringMap, 'meetings' => $meetingMap];
}

function snapshot_from_workspace_source(PDO $pdo, string $year, string $sem, int $termId, string $from, string $actor): array
{
  seed_private_workspace_from_live_if_missing($pdo, $termId, $actor, $year, $sem);
  $slot = private_slot_for_actor($actor);
  $snap = load_workspace_copy($pdo, $termId, $slot);
  if (!workspace_has_classes($snap)) {
    throw new RuntimeException('There is no personal schedule to submit. Generate one on My schedule first.');
  }
  return $snap;
}

function list_named_saves(PDO $pdo, int $termId, string $actor, string $kind = 'save', string $scope = 'mine'): array
{
  $role = $actor === 'super_admin' ? 'super_admin' : 'admin';
  $hasSharedCol = schema_column_exists($pdo, 'schedule_copies', 'is_shared');
  $sharedSelect = $hasSharedCol ? 'is_shared' : '0 AS is_shared';
  if ($scope === 'shared') {
    if (!$hasSharedCol) {
      return [];
    }
    $stmt = $pdo->prepare(
      "SELECT copy_id, title, created_at, updated_at, payload, owner_role, $sharedSelect
       FROM schedule_copies
       WHERE term_id = ? AND kind = ? AND is_shared = 1 AND owner_role <> ?
       ORDER BY updated_at DESC, copy_id DESC"
    );
    $stmt->execute([$termId, $kind, $role]);
  } else {
    $stmt = $pdo->prepare(
      "SELECT copy_id, title, created_at, updated_at, payload, owner_role, $sharedSelect
       FROM schedule_copies
       WHERE term_id = ? AND kind = ? AND owner_role = ?
       ORDER BY updated_at DESC, copy_id DESC"
    );
    $stmt->execute([$termId, $kind, $role]);
  }
  $out = [];
  foreach ($stmt->fetchAll() as $row) {
    $payload = json_decode((string) $row['payload'], true);
    $classes = is_array($payload) && isset($payload['classes']) && is_array($payload['classes']) ? $payload['classes'] : [];
    $owner = (string) ($row['owner_role'] ?? '');
    $out[] = [
      'id' => public_id('sv', (int) $row['copy_id']),
      'title' => (string) $row['title'],
      'createdAt' => $row['created_at'],
      'updatedAt' => $row['updated_at'],
      'summary' => schedule_summary($classes),
      'isShared' => (int) ($row['is_shared'] ?? 0) === 1,
      'ownerRole' => $owner,
      'ownerLabel' => $owner === 'super_admin' ? 'Super Admin' : 'Admin',
      'canManage' => $owner === $role,
    ];
  }
  return $out;
}

function list_open_requests_for_term(PDO $pdo, int $termId): array
{
  if (!schema_table_exists($pdo, 'schedule_open_requests')) {
    return [];
  }
  $hasFp = schema_column_exists($pdo, 'schedule_open_requests', 'shared_fingerprint');
  $fpSelect = $hasFp ? 'r.shared_fingerprint' : 'NULL AS shared_fingerprint';
  $liveFp = live_schedule_fingerprint($pdo, $termId);
  $stmt = $pdo->prepare(
    "SELECT r.request_id, r.status, r.created_at, $fpSelect, c.copy_id, c.title
     FROM schedule_open_requests r
     JOIN schedule_copies c ON c.copy_id = r.copy_id
     WHERE r.term_id = ? AND r.status = 'pending'
     ORDER BY r.created_at DESC"
  );
  $stmt->execute([$termId]);
  $out = [];
  foreach ($stmt->fetchAll() as $row) {
    $stored = trim((string) ($row['shared_fingerprint'] ?? ''));
    $out[] = [
      'id' => public_id('or', (int) $row['request_id']),
      'saveId' => public_id('sv', (int) $row['copy_id']),
      'title' => (string) $row['title'],
      'status' => $row['status'],
      'createdAt' => $row['created_at'],
      'stale' => $stored !== '' && $liveFp !== '' && $stored !== $liveFp,
    ];
  }
  return $out;
}

function workspace_state_payload(PDO $pdo, int $termId, string $actor, string $workspace, string $page): array
{
  $adminSubmitted = $termId ? load_workspace_copy($pdo, $termId, 'admin_submitted') : null;
  $vpaaPending = $termId ? load_workspace_copy($pdo, $termId, 'vpaa_pending') : null;
  $vpaaFinal = $termId ? load_workspace_copy($pdo, $termId, 'vpaa_final') : null;
  $vpaaReturned = $termId ? load_workspace_copy($pdo, $termId, 'vpaa_returned') : null;
  $mine = $termId ? load_workspace_copy($pdo, $termId, private_slot_for_actor($actor)) : null;
  $viewingReturned = $workspace === 'submitted' && workspace_has_classes($vpaaReturned);
  $forwarded = copy_is_forwarded($adminSubmitted);
  $editable = $page === 'create' && $workspace === 'mine';
  $canSubmitSa = $actor === 'admin' && $page === 'create' && $workspace === 'mine';
  $canSubmitVpaa = $actor === 'super_admin' && $page === 'create' && $workspace === 'mine';
  $canApproveAdmin = $actor === 'super_admin' && $workspace === 'submitted' && workspace_has_classes($adminSubmitted) && !$forwarded && !$viewingReturned;
  $canRetractSa = $actor === 'admin' && $workspace === 'submitted' && workspace_has_classes($adminSubmitted) && !$forwarded;
  $canRetractVpaa = $actor === 'super_admin' && $page === 'report' && $workspace === 'awaiting' && workspace_has_classes($vpaaPending);
  $canDecideVpaa = $actor === 'vpaa' && $page === 'report' && $workspace === 'awaiting' && workspace_has_classes($vpaaPending);
  $hasClasses = workspace_has_classes($mine);
  if ($workspace === 'submitted') {
    $hasClasses = $viewingReturned ? true : workspace_has_classes($adminSubmitted);
  } elseif ($workspace === 'awaiting') {
    $hasClasses = workspace_has_classes($vpaaPending);
  } elseif ($workspace === 'final') {
    $hasClasses = workspace_has_classes($vpaaFinal);
  }
  return [
    'id' => $workspace,
    'page' => $page,
    'canEdit' => $editable,
    'canGenerate' => $editable,
    'canSaveAs' => $editable,
    'canClear' => $editable,
    'canSubmitToSuperAdmin' => $canSubmitSa,
    'canSubmitToVpaa' => $canSubmitVpaa,
    'canApproveAdminSubmit' => $canApproveAdmin,
    'canRejectAdminSubmit' => $canApproveAdmin,
    'canRetractSubmitted' => $canRetractSa,
    'canRetractAwaiting' => $canRetractVpaa,
    'canDecideVpaa' => $canDecideVpaa,
    'canArchivePublished' => in_array($actor, ['admin', 'super_admin'], true)
      && $page === 'report'
      && $workspace === 'final'
      && $termId
      && offering_term_is_live($pdo, $termId)
      && workspace_has_classes($vpaaFinal)
      && !workspace_has_classes($vpaaPending),
    'canSendReturnedToAdmin' => $actor === 'super_admin' && $workspace === 'submitted' && $viewingReturned,
    'canOpenReturned' => $actor === 'super_admin' && $workspace === 'submitted' && $viewingReturned,
    'hasAdminSubmitted' => workspace_has_classes($adminSubmitted),
    'adminSubmittedForwarded' => $forwarded,
    'hasVpaaPending' => workspace_has_classes($vpaaPending),
    'hasVpaaFinal' => workspace_has_classes($vpaaFinal),
    'hasVpaaReturned' => workspace_has_classes($vpaaReturned),
    'hasMine' => workspace_has_classes($mine),
    'tabStatus' => workspace_tab_status(
      $workspace,
      $actor,
      $hasClasses,
      $adminSubmitted,
      $vpaaPending,
      $vpaaFinal,
      $vpaaReturned
    ),
    'copyOrigin' => copy_origin_public(
      $workspace === 'submitted'
        ? ($viewingReturned ? $vpaaReturned : $adminSubmitted)
        : ($workspace === 'awaiting' ? $vpaaPending : ($workspace === 'final' ? $vpaaFinal : null))
    ),
    'saves' => $termId ? list_named_saves($pdo, $termId, $actor, 'save', 'mine') : [],
    'sharedSaves' => $termId ? list_named_saves($pdo, $termId, $actor, 'save', 'shared') : [],
    'archivedSaves' => $termId ? list_named_saves($pdo, $termId, $actor, 'archived_save', 'mine') : [],
    'openRequests' => [],
    'reportTerms' => $page === 'report' ? list_report_terms($pdo) : [],
  ];
}

function apply_workspace_to_payload(array $payload, PDO $pdo, int $termId, string $actor, string $workspace, string $page): array
{
  $year = is_array($payload['schoolYear'] ?? null) ? (string) ($payload['schoolYear']['label'] ?? '') : '';
  $sem = (string) ($payload['termCode'] ?? '1');
  if ($workspace === 'mine' && $termId > 0 && $year !== '') {
    seed_private_workspace_from_live_if_missing($pdo, $termId, $actor, $year, $sem);
  }
  $state = workspace_state_payload($pdo, $termId, $actor, $workspace, $page);
  $payload['workspace'] = $state;
  $rooms = $payload['rooms'] ?? [];
  if ($workspace === 'mine') {
    $snap = load_workspace_copy($pdo, $termId, private_slot_for_actor($actor));
    $payload['classes'] = $snap['classes'] ?? [];
    $payload['summary'] = isset($snap['summary']) ? $snap['summary'] : schedule_summary($payload['classes']);
    if (!empty($snap['rooms'])) {
      $payload['rooms'] = $snap['rooms'];
    }
  } elseif ($workspace === 'submitted') {
    $returned = load_workspace_copy($pdo, $termId, 'vpaa_returned');
    $snap = workspace_has_classes($returned) ? $returned : load_workspace_copy($pdo, $termId, 'admin_submitted');
    $payload['classes'] = $snap['classes'] ?? [];
    $payload['summary'] = isset($snap['summary']) ? $snap['summary'] : schedule_summary($payload['classes']);
    if (!empty($snap['rooms'])) {
      $payload['rooms'] = $snap['rooms'];
    }
  } elseif ($workspace === 'awaiting') {
    $snap = load_workspace_copy($pdo, $termId, 'vpaa_pending');
    $payload['classes'] = $snap['classes'] ?? [];
    $payload['summary'] = isset($snap['summary']) ? $snap['summary'] : schedule_summary($payload['classes']);
    if (!empty($snap['rooms'])) {
      $payload['rooms'] = $snap['rooms'];
    }
  } elseif ($workspace === 'final') {
    $snap = load_workspace_copy($pdo, $termId, 'vpaa_final');
    $payload['classes'] = $snap['classes'] ?? [];
    $payload['summary'] = isset($snap['summary']) ? $snap['summary'] : schedule_summary($payload['classes']);
    if (!empty($snap['rooms'])) {
      $payload['rooms'] = $snap['rooms'];
    }
  } elseif ($workspace === 'saves') {
    $payload['classes'] = [];
    $payload['summary'] = schedule_summary([]);
  }
  $payload['rooms'] = $payload['rooms'] ?? $rooms;
  if ($workspace !== 'saves') {
    $payload['classes'] = refresh_private_room_labels(
      $pdo,
      is_array($payload['classes'] ?? null) ? $payload['classes'] : []
    );
  }
  $payload['reportTerms'] = $state['reportTerms'] ?? [];
  if ($page === 'create' && $workspace === 'mine') {
    $payload['generatorSettings'] = $termId > 0
      ? load_working_generator_settings($pdo, $termId, $actor)
      : default_generator_settings();
  }
  return $payload;
}

function save_named_schedule(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  if (!in_array($actor, ['admin', 'super_admin'], true)) {
    throw new RuntimeException('Only Admin or Super Admin can save a schedule.');
  }
  $title = trim((string) ($body['title'] ?? $body['name'] ?? ''));
  if ($title === '') {
    throw new RuntimeException('Give this save a name.');
  }
  if (strlen($title) > 120) {
    throw new RuntimeException('Keep the save name under 120 characters.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body);
  $from = 'mine';
  $snap = stamp_copy_origin(snapshot_from_workspace_source($pdo, $year, $sem, $termId, $from, $actor), $from, $actor, 'save_as');
  $json = json_encode($snap, JSON_UNESCAPED_UNICODE);
  $pdo->prepare(
    "INSERT INTO schedule_copies (term_id, slot, kind, owner_role, title, payload)
     VALUES (?, 'save', 'save', ?, ?, ?)"
  )->execute([$termId, $actor, $title, $json]);
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, 'saves', 'create');
}

function clear_active_workspace_schedule(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  if (!in_array($actor, ['admin', 'super_admin'], true)) {
    throw new RuntimeException('Only Admin or Super Admin can clear a timetable.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body);
  upsert_workspace_copy($pdo, $termId, private_slot_for_actor($actor), empty_workspace_snapshot());
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, 'mine', 'create');
}

function submit_to_super_admin_copy(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? 'admin'));
  if ($actor !== 'admin') {
    throw new RuntimeException('Only Admin can submit a timetable to Super Admin.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body);
  if (workspace_has_classes(load_workspace_copy($pdo, $termId, 'admin_submitted'))) {
    $existing = load_workspace_copy($pdo, $termId, 'admin_submitted');
    if (copy_is_forwarded($existing) || workspace_has_classes(load_workspace_copy($pdo, $termId, 'vpaa_pending'))) {
      throw new RuntimeException(
        'A copy of this term is still with Super Admin or the VPAA. Wait for that decision, or ask Super Admin to send it back, before submitting another.'
      );
    }
    throw new RuntimeException(
      'A timetable is already waiting for Super Admin. Retract that submission first if you want to send a different copy.'
    );
  }
  $from = 'mine';
  $snap = stamp_copy_origin(snapshot_from_workspace_source($pdo, $year, $sem, $termId, $from, $actor), $from, $actor, 'submit');
  upsert_workspace_copy($pdo, $termId, 'admin_submitted', $snap);
  $json = json_encode($snap, JSON_UNESCAPED_UNICODE);
  $pdo->prepare(
    "UPDATE term_schedule_approvals
     SET status = 'pending_super_admin',
         pending_sa_json = ?,
         pending_sa_at = NOW(),
         last_reject_from = NULL,
         last_reject_note = NULL,
         last_reject_at = NULL
     WHERE term_id = ?"
  )->execute([$json, $termId]);
  record_schedule_handoff($pdo, $termId, 'send', 'admin', 'super_admin', '', $from === 'mine' ? 'mine' : 'live');
  $term = term_offering_label($year, $sem);
  notify_roles(
    $pdo,
    ['super_admin'],
    'timetable_send',
    'Admin submitted a timetable',
    'Admin submitted the ' . $term . ' timetable for Super Admin review.',
    'create-schedule.html?ws=submitted',
    'Timetable'
  );
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, 'submitted', 'create');
}

function retract_admin_submission(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? 'admin'));
  if ($actor !== 'admin') {
    throw new RuntimeException('Only Admin can retract a submission to Super Admin.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body, false);
  $existing = load_workspace_copy($pdo, $termId, 'admin_submitted');
  if (!workspace_has_classes($existing)) {
    throw new RuntimeException('There is no Super Admin submission to retract.');
  }
  if (copy_is_forwarded($existing) || workspace_has_classes(load_workspace_copy($pdo, $termId, 'vpaa_pending'))) {
    throw new RuntimeException('Super Admin has already sent this copy to the VPAA. It cannot be retracted from here.');
  }
  clear_workspace_copy($pdo, $termId, 'admin_submitted');
  $next = trim((string) (approval_row($pdo, $termId)['published_json'] ?? '')) !== '' ? 'published' : 'draft';
  $pdo->prepare(
    "UPDATE term_schedule_approvals
     SET status = ?, pending_sa_json = NULL, pending_sa_at = NULL
     WHERE term_id = ? AND status = 'pending_super_admin'"
  )->execute([$next, $termId]);
  record_schedule_handoff($pdo, $termId, 'send_back', 'admin', 'super_admin', 'Retracted the pending submission.');
  notify_roles(
    $pdo,
    ['super_admin'],
    'timetable_return',
    'Admin retracted a timetable',
    'Admin retracted the pending ' . term_offering_label($year, $sem) . ' submission.',
    'create-schedule.html?ws=submitted',
    'Timetable'
  );
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, 'submitted', 'create');
}

function approve_admin_submission_to_vpaa(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  if ($actor !== 'super_admin') {
    throw new RuntimeException('Only Super Admin can send Admin’s submission to the VPAA.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body, false);
  $snap = load_workspace_copy($pdo, $termId, 'admin_submitted');
  if (!workspace_has_classes($snap)) {
    throw new RuntimeException('Admin has not submitted a timetable yet.');
  }
  assert_complete_for_vpaa($snap);
  if (workspace_has_classes(load_workspace_copy($pdo, $termId, 'vpaa_pending'))) {
    throw new RuntimeException(
      'A timetable is already waiting for the VPAA. Retract that copy on Reports first if you want to send a different one.'
    );
  }
  if (!isset($snap['origin']) || !is_array($snap['origin'])) {
    $snap['origin'] = [];
  }
  $snap['origin']['forwardedToVpaa'] = true;
  $snap['origin']['forwardedAt'] = date('Y-m-d H:i:s');
  $snap['origin']['forwardedBy'] = 'super_admin';
  $pending = stamp_copy_origin($snap, (string) ($snap['origin']['from'] ?? 'mine'), 'super_admin', 'submit_to_vpaa');
  $pending['origin']['from'] = $snap['origin']['from'] ?? 'mine';
  $pending['origin']['fromLabel'] = $snap['origin']['fromLabel'] ?? 'My schedule';
  $pending['origin']['actor'] = 'super_admin';
  $pending['origin']['actorLabel'] = 'Super Admin';
  $pending['origin']['source'] = 'admin_submitted';
  upsert_workspace_copy($pdo, $termId, 'vpaa_pending', $pending);
  upsert_workspace_copy($pdo, $termId, 'admin_submitted', $snap);
  $json = json_encode($pending, JSON_UNESCAPED_UNICODE);
  $pdo->prepare(
    "UPDATE term_schedule_approvals
     SET status = 'pending_vpaa',
         pending_vpaa_json = ?,
         pending_vpaa_at = NOW(),
         pending_sa_json = NULL,
         pending_sa_at = NULL,
         last_reject_from = NULL,
         last_reject_note = NULL,
         last_reject_at = NULL
     WHERE term_id = ?"
  )->execute([$json, $termId]);
  record_schedule_handoff($pdo, $termId, 'send', 'super_admin', 'vpaa', '', 'snapshot');
  $term = term_offering_label($year, $sem);
  notify_roles(
    $pdo,
    ['vpaa'],
    'timetable_send',
    'Super Admin sent a timetable for approval',
    'Super Admin sent the ' . $term . ' timetable to the VPAA.',
    'final-report.html?ws=awaiting',
    'Timetable'
  );
  notify_roles(
    $pdo,
    ['admin'],
    'timetable_send',
    'Super Admin sent your timetable to the VPAA',
    'Super Admin approved the ' . $term . ' timetable you submitted and sent it to the VPAA.',
    'final-report.html?ws=awaiting',
    'Timetable'
  );
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, 'submitted', 'create');
}

function reject_admin_submission(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  if ($actor !== 'super_admin') {
    throw new RuntimeException('Only Super Admin can send Admin’s submission back.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body, false);
  $existing = load_workspace_copy($pdo, $termId, 'admin_submitted');
  $returned = load_workspace_copy($pdo, $termId, 'vpaa_returned');
  if (!workspace_has_classes($existing) && !workspace_has_classes($returned)) {
    throw new RuntimeException('There is no Admin submission or VPAA-returned copy to send back.');
  }
  if (copy_is_forwarded($existing) && workspace_has_classes(load_workspace_copy($pdo, $termId, 'vpaa_pending'))) {
    throw new RuntimeException('Retract the copy waiting for the VPAA on Reports before sending this back to Admin.');
  }
  $note = trim((string) ($body['note'] ?? ''));
  if ($note === '') {
    throw new RuntimeException('Say what the Admin should revise before sending this back.');
  }
  clear_workspace_copy($pdo, $termId, 'admin_submitted');
  clear_workspace_copy($pdo, $termId, 'vpaa_returned');
  $next = trim((string) (approval_row($pdo, $termId)['published_json'] ?? '')) !== '' ? 'published' : 'draft';
  $pdo->prepare(
    "UPDATE term_schedule_approvals
     SET status = ?,
         pending_sa_json = NULL,
         pending_sa_at = NULL,
         last_reject_from = 'super_admin',
         last_reject_note = ?,
         last_reject_at = NOW()
     WHERE term_id = ?"
  )->execute([$next, $note, $termId]);
  record_schedule_handoff($pdo, $termId, 'send_back', 'super_admin', 'admin', $note);
  $term = term_offering_label($year, $sem);
  $msg = 'Super Admin sent the ' . $term . ' timetable back to Admin.';
  $snip = notify_note_snippet($note);
  if ($snip !== '') {
    $msg .= ' ' . $snip;
  }
  notify_roles($pdo, ['admin'], 'timetable_return', 'Super Admin sent a timetable back', $msg, 'create-schedule.html?ws=mine', 'Timetable');
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, 'submitted', 'create');
}

function submit_to_vpaa_from_workspace(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  if ($actor !== 'super_admin') {
    throw new RuntimeException('Only Super Admin can submit a timetable to the VPAA.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body);
  if (workspace_has_classes(load_workspace_copy($pdo, $termId, 'vpaa_pending'))) {
    throw new RuntimeException(
      'A timetable is already waiting for the VPAA. Retract that copy on Reports first if you want to send a different one.'
    );
  }
  $from = 'mine';
  $snap = stamp_copy_origin(snapshot_from_workspace_source($pdo, $year, $sem, $termId, $from, $actor), $from, $actor, 'submit_to_vpaa');
  assert_complete_for_vpaa($snap);
  upsert_workspace_copy($pdo, $termId, 'vpaa_pending', $snap);
  $json = json_encode($snap, JSON_UNESCAPED_UNICODE);
  $pdo->prepare(
    "UPDATE term_schedule_approvals
     SET status = 'pending_vpaa',
         pending_vpaa_json = ?,
         pending_vpaa_at = NOW(),
         last_reject_from = NULL,
         last_reject_note = NULL,
         last_reject_at = NULL
     WHERE term_id = ?"
  )->execute([$json, $termId]);
  record_schedule_handoff($pdo, $termId, 'send', 'super_admin', 'vpaa', '', $from === 'mine' ? 'mine' : 'live');
  $term = term_offering_label($year, $sem);
  notify_roles(
    $pdo,
    ['vpaa'],
    'timetable_send',
    'Super Admin sent a timetable for approval',
    'Super Admin sent the ' . $term . ' timetable to the VPAA.',
    'final-report.html?ws=awaiting',
    'Timetable'
  );
  notify_roles(
    $pdo,
    ['admin'],
    'timetable_send',
    'Super Admin sent a timetable to the VPAA',
    'Super Admin sent a copy of ' . $term . ' to the VPAA from My schedule.',
    'final-report.html?ws=awaiting',
    'Timetable'
  );
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, 'mine', 'create');
}

function retract_vpaa_pending(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  if ($actor !== 'super_admin') {
    throw new RuntimeException('Only Super Admin can retract a timetable waiting for the VPAA.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body, false);
  if (!workspace_has_classes(load_workspace_copy($pdo, $termId, 'vpaa_pending'))) {
    throw new RuntimeException('There is no timetable waiting for the VPAA to retract.');
  }
  clear_workspace_copy($pdo, $termId, 'vpaa_pending');
  $admin = load_workspace_copy($pdo, $termId, 'admin_submitted');
  if (copy_is_forwarded($admin)) {
    unset($admin['origin']['forwardedToVpaa'], $admin['origin']['forwardedAt'], $admin['origin']['forwardedBy']);
    upsert_workspace_copy($pdo, $termId, 'admin_submitted', $admin);
  }
  $next = trim((string) (approval_row($pdo, $termId)['published_json'] ?? '')) !== '' ? 'published' : 'draft';
  $pdo->prepare(
    "UPDATE term_schedule_approvals
     SET status = ?, pending_vpaa_json = NULL, pending_vpaa_at = NULL
     WHERE term_id = ? AND status = 'pending_vpaa'"
  )->execute([$next, $termId]);
  record_schedule_handoff($pdo, $termId, 'send_back', 'super_admin', 'vpaa', 'Retracted the pending VPAA copy.');
  notify_roles(
    $pdo,
    ['vpaa'],
    'timetable_return',
    'A timetable was retracted',
    'Super Admin retracted the ' . term_offering_label($year, $sem) . ' timetable that was waiting for VPAA approval.',
    'final-report.html?ws=awaiting',
    'Timetable'
  );
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, 'awaiting', 'report');
}

function find_save_row(PDO $pdo, string $savePublicId, string $actor): array
{
  $id = parse_id($savePublicId, 'sv');
  if (!$id) {
    throw new RuntimeException('That save was not found.');
  }
  $stmt = $pdo->prepare('SELECT * FROM schedule_copies WHERE copy_id = ? LIMIT 1');
  $stmt->execute([$id]);
  $row = $stmt->fetch();
  if (!$row) {
    throw new RuntimeException('That save was not found.');
  }
  $role = $actor === 'super_admin' ? 'super_admin' : 'admin';
  $owner = (string) ($row['owner_role'] ?? '');
  $shared = (int) ($row['is_shared'] ?? 0) === 1;
  if ($owner !== $role && !$shared) {
    throw new RuntimeException('That save belongs to another role.');
  }
  $row['_canManage'] = $owner === $role;
  return $row;
}

function open_save_into_workspace(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  if (!in_array($actor, ['admin', 'super_admin'], true)) {
    throw new RuntimeException('Only Admin or Super Admin can open a saved schedule.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body);
  $row = find_save_row($pdo, (string) ($body['saveId'] ?? ''), $actor);
  $payload = json_decode((string) $row['payload'], true);
  if (!is_array($payload) || empty($payload['classes'])) {
    throw new RuntimeException('That save has no timetable to open.');
  }
  upsert_workspace_copy($pdo, $termId, private_slot_for_actor($actor), $payload);
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, 'mine', 'create');
}

function request_open_save_shared(PDO $pdo, array $body): array
{
  throw new RuntimeException('Shared schedule is no longer used. Open the save in My schedule instead.');
}

function decide_open_save_shared(PDO $pdo, array $body): array
{
  throw new RuntimeException('Shared schedule is no longer used. Open the save in My schedule instead.');
}

function delete_named_save(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body, false);
  $row = find_save_row($pdo, (string) ($body['saveId'] ?? ''), $actor);
  if (empty($row['_canManage'])) {
    throw new RuntimeException('Only the owner can delete this save.');
  }
  $pdo->prepare('DELETE FROM schedule_copies WHERE copy_id = ?')->execute([(int) $row['copy_id']]);
  $ws = (string) ($row['kind'] ?? 'save') === 'archived_save' ? 'archives' : 'saves';
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, $ws, 'create');
}

function archive_named_save(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body, false);
  $row = find_save_row($pdo, (string) ($body['saveId'] ?? ''), $actor);
  if (empty($row['_canManage'])) {
    throw new RuntimeException('Only the owner can archive this save.');
  }
  if ((string) $row['kind'] === 'archived_save') {
    throw new RuntimeException('That save is already in Archives.');
  }
  $pdo->prepare("UPDATE schedule_copies SET kind = 'archived_save', slot = 'archived_save' WHERE copy_id = ?")
    ->execute([(int) $row['copy_id']]);
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, 'saves', 'create');
}

function archive_published_offering(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  if (!in_array($actor, ['admin', 'super_admin'], true)) {
    throw new RuntimeException('Only Admin or Super Admin can archive a published timetable.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body, true);
  if (!workspace_has_classes(load_workspace_copy($pdo, $termId, 'vpaa_final'))) {
    throw new RuntimeException('Archive only after the VPAA publishes this term. That copy lives on Final report.');
  }
  if (workspace_has_classes(load_workspace_copy($pdo, $termId, 'vpaa_pending'))) {
    throw new RuntimeException(
      'A copy is still waiting for the VPAA. Retract it or wait for their decision before archiving this term.'
    );
  }
  $pdo->prepare('UPDATE terms SET is_active = 0, archived_label = ? WHERE term_id = ?')
    ->execute([offering_archive_label(), $termId]);
  $who = $actor === 'super_admin' ? 'Super Admin' : 'Admin';
  $other = $actor === 'super_admin' ? 'admin' : 'super_admin';
  notify_roles(
    $pdo,
    [$other],
    'timetable_published',
    'A term was archived',
    $who . ' archived the VPAA-published ' . term_offering_label($year, $sem) . ' timetable.',
    'final-report.html?ws=final',
    'Timetable'
  );
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, 'final', 'report');
}

function share_named_save(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  if (!in_array($actor, ['admin', 'super_admin'], true)) {
    throw new RuntimeException('Only Admin or Super Admin can share a save.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body, false);
  $row = find_save_row($pdo, (string) ($body['saveId'] ?? ''), $actor);
  if (empty($row['_canManage'])) {
    throw new RuntimeException('Only the owner can share this save.');
  }
  $share = !isset($body['share']) || !empty($body['share']);
  if (!schema_column_exists($pdo, 'schedule_copies', 'is_shared')) {
    throw new RuntimeException('Sharing is not available until the database is updated.');
  }
  $pdo->prepare('UPDATE schedule_copies SET is_shared = ? WHERE copy_id = ?')->execute([$share ? 1 : 0, (int) $row['copy_id']]);
  $other = $actor === 'super_admin' ? 'admin' : 'super_admin';
  notify_roles(
    $pdo,
    [$other],
    $share ? 'timetable_send' : 'timetable_return',
    $share ? 'A saved timetable was shared with you' : 'A shared timetable was unshared',
    $share
      ? ($actor === 'super_admin' ? 'Super Admin' : 'Admin') . ' shared “' . (string) $row['title'] . '” on Saves.'
      : ($actor === 'super_admin' ? 'Super Admin' : 'Admin') . ' stopped sharing “' . (string) $row['title'] . '”.',
    'create-schedule.html?ws=saves',
    'Timetable'
  );
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, 'saves', 'create');
}

function open_returned_into_workspace(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  if ($actor !== 'super_admin') {
    throw new RuntimeException('Only Super Admin can open the VPAA-returned copy.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body, false);
  $snap = load_workspace_copy($pdo, $termId, 'vpaa_returned');
  if (!workspace_has_classes($snap)) {
    throw new RuntimeException('There is no VPAA-returned timetable to open.');
  }
  upsert_workspace_copy($pdo, $termId, private_slot_for_actor($actor), $snap);
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, 'mine', 'create');
}

function park_vpaa_returned_copy(PDO $pdo, int $termId, string $note): void
{
  $pending = load_workspace_copy($pdo, $termId, 'vpaa_pending');
  if (!workspace_has_classes($pending)) {
    return;
  }
  if (!isset($pending['origin']) || !is_array($pending['origin'])) {
    $pending['origin'] = [];
  }
  $pending['origin']['returnedByVpaa'] = true;
  $pending['origin']['returnedAt'] = date('Y-m-d H:i:s');
  $pending['origin']['returnNote'] = $note;
  upsert_workspace_copy($pdo, $termId, 'vpaa_returned', $pending);
  clear_workspace_copy($pdo, $termId, 'vpaa_pending');
  $admin = load_workspace_copy($pdo, $termId, 'admin_submitted');
  if (workspace_has_classes($admin)) {
    if (!isset($admin['origin']) || !is_array($admin['origin'])) {
      $admin['origin'] = [];
    }
    $admin['origin']['returnedByVpaa'] = true;
    $admin['origin']['returnedAt'] = date('Y-m-d H:i:s');
    $admin['origin']['returnNote'] = $note;
    upsert_workspace_copy($pdo, $termId, 'admin_submitted', $admin);
  }
}

function clear_pipeline_after_vpaa_decision(PDO $pdo, int $termId): void
{
  clear_workspace_copy($pdo, $termId, 'admin_submitted');
  clear_workspace_copy($pdo, $termId, 'vpaa_returned');
}

function private_new_id(string $prefix): string
{
  return $prefix . '-tmp-' . str_replace('.', '', uniqid('', true));
}

function private_find_class_index(array $classes, string $id): int
{
  foreach ($classes as $i => $c) {
    if (is_array($c) && (string) ($c['id'] ?? '') === $id) {
      return $i;
    }
  }
  throw new RuntimeException('That class is missing.');
}

function private_find_meeting(array $classes, string $meetingId): array
{
  foreach ($classes as $ci => $c) {
    if (!is_array($c)) {
      continue;
    }
    foreach ($c['meetings'] ?? [] as $mi => $m) {
      if (is_array($m) && (string) ($m['id'] ?? '') === $meetingId) {
        return [$ci, $mi];
      }
    }
  }
  throw new RuntimeException('That meeting is missing.');
}

function private_merge_indexes(array $classes, array $cls): array
{
  $mid = trim((string) ($cls['mergedClassId'] ?? ''));
  if ($mid === '') {
    return [];
  }
  $out = [];
  foreach ($classes as $i => $c) {
    if (is_array($c) && trim((string) ($c['mergedClassId'] ?? '')) === $mid) {
      $out[] = $i;
    }
  }
  return $out;
}

function private_sibling_refs(array $classes, int $ci, int $mi): array
{
  $meet = $classes[$ci]['meetings'][$mi] ?? [];
  $day = (string) ($meet['day'] ?? '');
  $start = substr((string) ($meet['start'] ?? ''), 0, 5);
  $indexes = private_merge_indexes($classes, $classes[$ci]);
  if (!$indexes) {
    $indexes = [$ci];
  }
  $refs = [];
  foreach ($indexes as $i) {
    foreach ($classes[$i]['meetings'] ?? [] as $j => $m) {
      if (!is_array($m)) {
        continue;
      }
      if ((string) ($m['day'] ?? '') === $day && substr((string) ($m['start'] ?? ''), 0, 5) === $start) {
        $refs[] = [$i, $j];
      }
    }
  }
  return $refs ?: [[$ci, $mi]];
}

function private_section_ids_for_indexes(array $classes, array $indexes): array
{
  $ids = [];
  foreach ($indexes as $i) {
    $sid = (string) ($classes[$i]['sectionId'] ?? '');
    if ($sid !== '') {
      $ids[$sid] = true;
    }
  }
  return array_keys($ids);
}

// Partitions of one section and subject are different students, so they may
// share a slot with each other but with nothing else the section takes. The
// lane token names that group; a whole class has no lane and clashes with all.
function private_class_lane(array $cls): string
{
  if ((int) ($cls['partitionCount'] ?? 1) < 2) {
    return '';
  }
  return 'p:' . (string) ($cls['sectionId'] ?? '')
    . ':' . (string) ($cls['courseCode'] ?? '')
    . ':' . (string) ($cls['component'] ?? '');
}

function private_lanes_for_indexes(array $classes, array $indexes): array
{
  $lanes = [];
  foreach ($indexes as $i) {
    $lane = private_class_lane($classes[$i] ?? []);
    if ($lane !== '') {
      $lanes[(string) ($classes[$i]['sectionId'] ?? '')] = $lane;
    }
  }
  return $lanes;
}

function private_partition_siblings(array $classes, array $cls): array
{
  $lane = private_class_lane($cls);
  if ($lane === '') {
    return [];
  }
  $out = [];
  foreach ($classes as $i => $c) {
    if (is_array($c) && private_class_lane($c) === $lane) {
      $out[] = $i;
    }
  }
  return $out;
}

function private_student_count_for_indexes(array $classes, array $indexes): int
{
  $n = 0;
  foreach ($indexes as $i) {
    $n += (int) ($classes[$i]['studentCount'] ?? 0);
  }
  return $n;
}

function private_slot_minutes(string $start, string $end): array
{
  $start = strlen($start) === 5 ? $start . ':00' : $start;
  $end = strlen($end) === 5 ? $end . ':00' : $end;
  $a = clock_minutes($start);
  $b = clock_minutes($end);
  $out = [];
  for ($m = $a; $m < $b; $m += 30) {
    $out[] = $m;
  }
  return $out;
}

function private_meetings_overlap(array $a, array $b): bool
{
  if ((string) ($a['day'] ?? '') !== (string) ($b['day'] ?? '')) {
    return false;
  }
  $x = private_slot_minutes((string) ($a['start'] ?? ''), (string) ($a['end'] ?? ''));
  $y = private_slot_minutes((string) ($b['start'] ?? ''), (string) ($b['end'] ?? ''));
  return (bool) array_intersect($x, $y);
}

function private_assert_no_conflicts(
  array $classes,
  string $day,
  string $start,
  string $end,
  array $sectionIds,
  string $roomId,
  array $ignoreMeetingIds,
  array $lanes = []
): void {
  $probe = ['day' => $day, 'start' => $start, 'end' => $end];
  $ignore = [];
  foreach ($ignoreMeetingIds as $id) {
    $ignore[(string) $id] = true;
  }
  $sections = [];
  foreach ($sectionIds as $sid) {
    $sections[(string) $sid] = true;
  }
  foreach ($classes as $c) {
    if (!is_array($c)) {
      continue;
    }
    $sameSection = !empty($sections[(string) ($c['sectionId'] ?? '')]);
    foreach ($c['meetings'] ?? [] as $m) {
      if (!is_array($m)) {
        continue;
      }
      $mid = (string) ($m['id'] ?? '');
      if ($mid !== '' && !empty($ignore[$mid])) {
        continue;
      }
      if (!private_meetings_overlap($probe, $m)) {
        continue;
      }
      if ($sameSection) {
        $lane = (string) ($lanes[(string) ($c['sectionId'] ?? '')] ?? '');
        if ($lane === '' || private_class_lane($c) !== $lane) {
          throw new RuntimeException('That time overlaps another class for this section.');
        }
      }
      $otherRoom = (string) ($m['roomId'] ?? '');
      if ($roomId !== '' && $otherRoom !== '' && $otherRoom === $roomId) {
        throw new RuntimeException('That time overlaps another class or room booking.');
      }
    }
  }
}

function private_copy_meeting(array $m, bool $withRoom, ?string $forceId = null): array
{
  $out = $m;
  $out['id'] = $forceId ?: private_new_id('mt');
  if (!$withRoom) {
    $out['roomId'] = null;
    $out['roomCode'] = $m['roomCode'] ?? '';
  }
  return $out;
}

function private_room_fields(PDO $pdo, string $roomKey): array
{
  $empty = [
    'roomId' => null,
    'roomCode' => '',
    'buildingId' => null,
    'buildingName' => '',
    'roomCapacity' => null,
  ];
  if ($roomKey === '') {
    return $empty;
  }
  foreach (list_campus_rooms($pdo) as $room) {
    if ((string) ($room['id'] ?? '') !== $roomKey) {
      continue;
    }
    return [
      'roomId' => $roomKey,
      'roomCode' => (string) ($room['label'] ?? $room['code'] ?? ''),
      'buildingId' => $room['buildingId'] ?? null,
      'buildingName' => (string) ($room['buildingName'] ?? ''),
      'roomCapacity' => isset($room['capacity']) ? (int) $room['capacity'] : null,
    ];
  }
  return [
    'roomId' => $roomKey,
    'roomCode' => '',
    'buildingId' => null,
    'buildingName' => '',
    'roomCapacity' => null,
  ];
}

function private_stamp_meeting_room(array &$meeting, array $fields, bool $withRoomId): void
{
  $meeting['roomId'] = $withRoomId ? ($fields['roomId'] ?? null) : null;
  $meeting['roomCode'] = (string) ($fields['roomCode'] ?? '');
  $meeting['buildingId'] = $fields['buildingId'] ?? null;
  $meeting['buildingName'] = (string) ($fields['buildingName'] ?? '');
  $meeting['roomCapacity'] = $fields['roomCapacity'] ?? null;
}

function private_new_meeting(string $id, string $day, string $start, string $end, array $fields, bool $withRoomId): array
{
  $meeting = [
    'id' => $id,
    'day' => $day,
    'start' => $start,
    'end' => $end,
  ];
  private_stamp_meeting_room($meeting, $fields, $withRoomId);
  return $meeting;
}

function refresh_private_room_labels(PDO $pdo, array $classes): array
{
  $byId = [];
  foreach (list_campus_rooms($pdo) as $room) {
    $id = (string) ($room['id'] ?? '');
    if ($id === '') {
      continue;
    }
    $byId[$id] = [
      'roomId' => $id,
      'roomCode' => (string) ($room['label'] ?? $room['code'] ?? ''),
      'buildingId' => $room['buildingId'] ?? null,
      'buildingName' => (string) ($room['buildingName'] ?? ''),
      'roomCapacity' => isset($room['capacity']) ? (int) $room['capacity'] : null,
    ];
  }
  foreach ($classes as $i => $c) {
    if (!is_array($c)) {
      continue;
    }
    foreach ($c['meetings'] ?? [] as $j => $m) {
      if (!is_array($m)) {
        continue;
      }
      $rid = (string) ($m['roomId'] ?? '');
      if ($rid !== '' && isset($byId[$rid])) {
        private_stamp_meeting_room($classes[$i]['meetings'][$j], $byId[$rid], true);
      }
    }
  }
  $slotRoom = [];
  foreach ($classes as $c) {
    if (!is_array($c)) {
      continue;
    }
    $merge = (string) ($c['mergedClassId'] ?? '');
    if ($merge === '') {
      continue;
    }
    foreach ($c['meetings'] ?? [] as $m) {
      if (!is_array($m)) {
        continue;
      }
      $rid = (string) ($m['roomId'] ?? '');
      if ($rid === '' || !isset($byId[$rid])) {
        continue;
      }
      $key = $merge . '|' . ($m['day'] ?? '') . '|' . substr((string) ($m['start'] ?? ''), 0, 5);
      $slotRoom[$key] = $byId[$rid];
    }
  }
  foreach ($classes as $i => $c) {
    if (!is_array($c)) {
      continue;
    }
    $merge = (string) ($c['mergedClassId'] ?? '');
    if ($merge === '') {
      continue;
    }
    foreach ($c['meetings'] ?? [] as $j => $m) {
      if (!is_array($m) || (string) ($m['roomId'] ?? '') !== '') {
        continue;
      }
      $key = $merge . '|' . ($m['day'] ?? '') . '|' . substr((string) ($m['start'] ?? ''), 0, 5);
      if (isset($slotRoom[$key])) {
        private_stamp_meeting_room($classes[$i]['meetings'][$j], $slotRoom[$key], false);
      }
    }
  }
  return $classes;
}

// Splitting by hand mirrors the generator: the first partition keeps the slot
// and the rest come out unscheduled, ready to be merged into other classes of
// the same subject with the existing "Merge into" control.
function private_partition_section(array $classes, string $offeringId, int $parts): array
{
  $ci = private_find_class_index($classes, $offeringId);
  $cls = $classes[$ci];
  if (private_class_lane($cls) !== '') {
    throw new RuntimeException('This section is already partitioned for this subject. Recombine it first.');
  }
  $total = (int) ($cls['sectionStudentCount'] ?? 0) ?: (int) ($cls['studentCount'] ?? 0);
  $maxParts = min(PARTITION_MAX_PARTS, intdiv($total, PARTITION_MIN_STUDENTS));
  if ($maxParts < 2) {
    throw new RuntimeException(
      'A section needs at least ' . (PARTITION_MIN_STUDENTS * 2) . ' students to be partitioned.'
    );
  }
  if ($parts < 2 || $parts > $maxParts) {
    throw new RuntimeException(
      'This section can be split into 2 to ' . $maxParts . ' partitions of at least '
      . PARTITION_MIN_STUDENTS . ' students each.'
    );
  }
  $base = intdiv($total, $parts);
  $extra = $total % $parts;
  $sizes = [];
  for ($i = 0; $i < $parts; $i++) {
    $sizes[] = $base + ($i < $extra ? 1 : 0);
  }
  $classes[$ci]['studentCount'] = $sizes[0];
  $classes[$ci]['partitionIndex'] = 1;
  $classes[$ci]['partitionCount'] = $parts;
  $classes[$ci]['partitionStudents'] = $sizes[0];
  $classes[$ci]['sectionStudentCount'] = $total;
  $extras = [];
  for ($i = 1; $i < $parts; $i++) {
    $row = $cls;
    $row['id'] = private_new_id('off');
    $row['studentCount'] = $sizes[$i];
    $row['partitionIndex'] = $i + 1;
    $row['partitionCount'] = $parts;
    $row['partitionStudents'] = $sizes[$i];
    $row['sectionStudentCount'] = $total;
    $row['mergedClassId'] = null;
    $row['meetings'] = [];
    $extras[] = $row;
  }
  array_splice($classes, $ci + 1, 0, $extras);
  return private_drop_lone_merges($classes);
}

function private_recombine_section(PDO $pdo, array $classes, string $offeringId): array
{
  $ci = private_find_class_index($classes, $offeringId);
  $lane = private_class_lane($classes[$ci]);
  if ($lane === '') {
    throw new RuntimeException('This class is not partitioned.');
  }
  $siblings = private_partition_siblings($classes, $classes[$ci]);
  $keep = private_recombine_survivor($classes, $siblings);
  $total = (int) ($classes[$keep]['sectionStudentCount'] ?? 0)
    ?: private_student_count_for_indexes($classes, $siblings);
  $drop = [];
  foreach ($siblings as $i) {
    if ($i !== $keep) {
      $drop[$i] = true;
    }
  }
  if (!empty($classes[$keep]['meetings'])) {
    $mergeIdx = private_merge_indexes($classes, $classes[$keep]) ?: [$keep];
    $seats = private_student_count_for_indexes($classes, $mergeIdx)
      - (int) ($classes[$keep]['studentCount'] ?? 0)
      + $total;
    $roomKey = '';
    foreach ($mergeIdx as $i) {
      foreach ($classes[$i]['meetings'] ?? [] as $m) {
        if (!empty($m['roomId'])) {
          $roomKey = (string) $m['roomId'];
          break 2;
        }
      }
    }
    assert_room_holds($pdo, $roomKey !== '' ? parse_id($roomKey, 'r') : null, $seats);
    $ignore = [];
    foreach ($siblings as $i) {
      foreach ($classes[$i]['meetings'] ?? [] as $m) {
        $ignore[] = (string) ($m['id'] ?? '');
      }
    }
    foreach ($classes[$keep]['meetings'] as $m) {
      private_assert_no_conflicts(
        $classes,
        (string) ($m['day'] ?? ''),
        substr((string) ($m['start'] ?? ''), 0, 5),
        substr((string) ($m['end'] ?? ''), 0, 5),
        [(string) ($classes[$keep]['sectionId'] ?? '')],
        $roomKey,
        $ignore,
      );
    }
  }
  $classes[$keep]['studentCount'] = $total;
  $classes[$keep]['partitionIndex'] = 1;
  $classes[$keep]['partitionCount'] = 1;
  $classes[$keep]['partitionStudents'] = null;
  $classes[$keep]['sectionStudentCount'] = $total;
  $out = [];
  foreach ($classes as $i => $c) {
    if (empty($drop[$i])) {
      $out[] = $c;
    }
  }
  return private_drop_lone_merges($out);
}

// The partition that keeps the section's slot: a scheduled one if there is
// one, and among those the largest, since it needs the fewest extra seats.
function private_recombine_survivor(array $classes, array $siblings): int
{
  $keep = $siblings[0];
  foreach ($siblings as $i) {
    $hasNow = !empty($classes[$keep]['meetings']);
    $has = !empty($classes[$i]['meetings']);
    if ($has !== $hasNow) {
      if ($has) {
        $keep = $i;
      }
      continue;
    }
    if ((int) ($classes[$i]['studentCount'] ?? 0) > (int) ($classes[$keep]['studentCount'] ?? 0)) {
      $keep = $i;
    }
  }
  return $keep;
}

function private_drop_lone_merges(array $classes): array
{
  $counts = [];
  foreach ($classes as $c) {
    $mid = is_array($c) ? trim((string) ($c['mergedClassId'] ?? '')) : '';
    if ($mid !== '') {
      $counts[$mid] = ($counts[$mid] ?? 0) + 1;
    }
  }
  foreach ($classes as $i => $c) {
    $mid = is_array($c) ? trim((string) ($c['mergedClassId'] ?? '')) : '';
    if ($mid !== '' && ($counts[$mid] ?? 0) <= 1) {
      $classes[$i]['mergedClassId'] = null;
    }
  }
  return $classes;
}

function apply_private_schedule_edit(PDO $pdo, array $body, array $classes): array
{
  $action = (string) ($body['action'] ?? '');
  $needsSlot = in_array($action, ['move_meeting', 'add_meeting', 'split_meeting', 'combine_meetings'], true);
  $day = '';
  $start = '';
  $end = '';
  $roomKey = '';
  $roomIdInt = null;
  $roomFields = private_room_fields($pdo, '');
  if ($needsSlot) {
    $day = normalize_day((string) ($body['day'] ?? ''));
    $start = $body['start'] ?? '';
    $end = $body['end'] ?? '';
    if ($start !== '') {
      $start = substr(normalize_clock((string) $start), 0, 5);
    }
    if ($end !== '') {
      $end = substr(normalize_clock((string) $end), 0, 5);
    }
    $roomKey = trim((string) ($body['roomId'] ?? ''));
    $roomIdInt = $roomKey === '' ? null : parse_id($roomKey, 'r');
    if ($roomKey !== '' && !$roomIdInt) {
      throw new RuntimeException('That room is not valid.');
    }
    $roomFields = private_room_fields($pdo, $roomKey);
  }
  $meetingIdOut = null;

  if ($action === 'move_meeting') {
    [$ci, $mi] = private_find_meeting($classes, (string) ($body['meetingId'] ?? ''));
    assert_meeting_window($start . ':00', $end . ':00');
    $siblings = private_sibling_refs($classes, $ci, $mi);
    $mergeIdx = private_merge_indexes($classes, $classes[$ci]) ?: [$ci];
    $ignore = [];
    foreach ($siblings as $ref) {
      $ignore[] = (string) ($classes[$ref[0]]['meetings'][$ref[1]]['id'] ?? '');
    }
    $count = private_student_count_for_indexes($classes, $mergeIdx);
    assert_room_holds($pdo, $roomIdInt, $count);
    private_assert_no_conflicts(
      $classes,
      $day,
      $start,
      $end,
      private_section_ids_for_indexes($classes, $mergeIdx),
      $roomKey,
      $ignore,
      private_lanes_for_indexes($classes, $mergeIdx),
    );
    $roomOwner = $siblings[0][0];
    foreach ($siblings as $k => $ref) {
      [$i, $j] = $ref;
      $classes[$i]['meetings'][$j]['day'] = $day;
      $classes[$i]['meetings'][$j]['start'] = $start;
      $classes[$i]['meetings'][$j]['end'] = $end;
      private_stamp_meeting_room(
        $classes[$i]['meetings'][$j],
        $roomFields,
        $k === 0 || $i === $roomOwner
      );
    }
  } elseif ($action === 'add_meeting') {
    $ci = private_find_class_index($classes, (string) ($body['offeringId'] ?? ''));
    assert_meeting_window($start . ':00', $end . ':00');
    $mergeIdx = private_merge_indexes($classes, $classes[$ci]) ?: [$ci];
    $count = private_student_count_for_indexes($classes, $mergeIdx);
    assert_room_holds($pdo, $roomIdInt, $count);
    private_assert_no_conflicts(
      $classes,
      $day,
      $start,
      $end,
      private_section_ids_for_indexes($classes, $mergeIdx),
      $roomKey,
      [],
      private_lanes_for_indexes($classes, $mergeIdx),
    );
    foreach ($mergeIdx as $k => $i) {
      $id = private_new_id('mt');
      if ($k === 0) {
        $meetingIdOut = $id;
      }
      $classes[$i]['meetings'][] = private_new_meeting($id, $day, $start, $end, $roomFields, $k === 0);
    }
  } elseif ($action === 'remove_meeting') {
    [$ci, $mi] = private_find_meeting($classes, (string) ($body['meetingId'] ?? ''));
    if (count($classes[$ci]['meetings'] ?? []) <= 1) {
      throw new RuntimeException('Keep at least one meeting. Combine or change times instead.');
    }
    $siblings = private_sibling_refs($classes, $ci, $mi);
    $remove = [];
    foreach ($siblings as $ref) {
      $remove[$ref[0]][$ref[1]] = true;
    }
    foreach ($remove as $i => $js) {
      $kept = [];
      foreach ($classes[$i]['meetings'] ?? [] as $j => $m) {
        if (empty($js[$j])) {
          $kept[] = $m;
        }
      }
      $classes[$i]['meetings'] = $kept;
    }
  } elseif ($action === 'split_meeting') {
    [$ci, $mi] = private_find_meeting($classes, (string) ($body['meetingId'] ?? ''));
    $firstEnd = substr(normalize_clock((string) ($body['firstEnd'] ?? '')), 0, 5);
    $origEnd = (string) ($classes[$ci]['meetings'][$mi]['end'] ?? '');
    assert_meeting_window((string) $classes[$ci]['meetings'][$mi]['start'] . ':00', $firstEnd . ':00');
    if (clock_minutes($firstEnd . ':00') >= clock_minutes($origEnd . ':00')) {
      throw new RuntimeException('The first half must end before the original meeting ends.');
    }
    assert_meeting_window($start . ':00', $end . ':00');
    $siblings = private_sibling_refs($classes, $ci, $mi);
    $mergeIdx = private_merge_indexes($classes, $classes[$ci]) ?: [$ci];
    $ignore = [];
    foreach ($siblings as $ref) {
      $ignore[] = (string) ($classes[$ref[0]]['meetings'][$ref[1]]['id'] ?? '');
    }
    $count = private_student_count_for_indexes($classes, $mergeIdx);
    assert_room_holds($pdo, $roomIdInt, $count);
    private_assert_no_conflicts(
      $classes,
      $day,
      $start,
      $end,
      private_section_ids_for_indexes($classes, $mergeIdx),
      $roomKey,
      $ignore,
      private_lanes_for_indexes($classes, $mergeIdx),
    );
    foreach ($siblings as $ref) {
      $classes[$ref[0]]['meetings'][$ref[1]]['end'] = $firstEnd;
    }
    foreach ($mergeIdx as $k => $i) {
      $id = private_new_id('mt');
      if ($k === 0) {
        $meetingIdOut = $id;
      }
      $classes[$i]['meetings'][] = private_new_meeting($id, $day, $start, $end, $roomFields, $k === 0);
    }
  } elseif ($action === 'combine_meetings') {
    $ci = private_find_class_index($classes, (string) ($body['offeringId'] ?? ''));
    assert_meeting_window($start . ':00', $end . ':00');
    $mergeIdx = private_merge_indexes($classes, $classes[$ci]) ?: [$ci];
    $ignore = [];
    $nMeet = 0;
    foreach ($mergeIdx as $i) {
      foreach ($classes[$i]['meetings'] ?? [] as $m) {
        $nMeet++;
        $ignore[] = (string) ($m['id'] ?? '');
      }
    }
    if (count($classes[$ci]['meetings'] ?? []) < 2) {
      throw new RuntimeException('There is only one meeting to keep.');
    }
    $count = private_student_count_for_indexes($classes, $mergeIdx);
    assert_room_holds($pdo, $roomIdInt, $count);
    private_assert_no_conflicts(
      $classes,
      $day,
      $start,
      $end,
      private_section_ids_for_indexes($classes, $mergeIdx),
      $roomKey,
      $ignore,
      private_lanes_for_indexes($classes, $mergeIdx),
    );
    foreach ($mergeIdx as $k => $i) {
      $id = private_new_id('mt');
      if ($k === 0) {
        $meetingIdOut = $id;
      }
      $classes[$i]['meetings'] = [private_new_meeting($id, $day, $start, $end, $roomFields, $k === 0)];
    }
  } elseif ($action === 'partition_section') {
    $classes = private_partition_section(
      $classes,
      (string) ($body['offeringId'] ?? ''),
      (int) ($body['parts'] ?? 2)
    );
  } elseif ($action === 'recombine_section') {
    $classes = private_recombine_section($pdo, $classes, (string) ($body['offeringId'] ?? ''));
  } elseif ($action === 'reassign_section') {
    $srcId = (string) ($body['offeringId'] ?? '');
    $tgtId = trim((string) ($body['targetOfferingId'] ?? ''));
    $si = private_find_class_index($classes, $srcId);
    $src = $classes[$si];
    if ($tgtId !== '') {
      if ($tgtId === $srcId) {
        throw new RuntimeException('Choose a different class.');
      }
      $ti = private_find_class_index($classes, $tgtId);
      $tgt = $classes[$ti];
      if (($tgt['sectionId'] ?? '') === ($src['sectionId'] ?? '')) {
        throw new RuntimeException('That section is already in this class.');
      }
      $srcMerge = trim((string) ($src['mergedClassId'] ?? ''));
      $tgtMerge = trim((string) ($tgt['mergedClassId'] ?? ''));
      if ($srcMerge !== '' && $srcMerge === $tgtMerge) {
        throw new RuntimeException('That section is already in this class.');
      }
      if (empty($tgt['meetings'])) {
        throw new RuntimeException('Choose a class that is already scheduled.');
      }
      if (
        (string) ($src['courseCode'] ?? '') !== (string) ($tgt['courseCode'] ?? '')
        || (string) ($src['component'] ?? '') !== (string) ($tgt['component'] ?? '')
      ) {
        throw new RuntimeException('Only classes with the same course code and component can be merged.');
      }
      $tgtIdx = private_merge_indexes($classes, $tgt) ?: [$ti];
      // A partition cannot join a class that already holds one of its siblings.
      foreach ($tgtIdx as $i) {
        if ((string) ($classes[$i]['sectionId'] ?? '') === (string) ($src['sectionId'] ?? '')) {
          throw new RuntimeException('That section is already in this class.');
        }
      }
      $roomKeyT = '';
      foreach ($tgtIdx as $i) {
        foreach ($classes[$i]['meetings'] ?? [] as $m) {
          if (!empty($m['roomId'])) {
            $roomKeyT = (string) $m['roomId'];
            break 2;
          }
        }
      }
      $count = private_student_count_for_indexes($classes, $tgtIdx) + (int) ($src['studentCount'] ?? 0);
      $roomInt = $roomKeyT !== '' ? parse_id($roomKeyT, 'r') : null;
      assert_room_holds($pdo, $roomInt, $count);
      $ignore = [];
      foreach ($src['meetings'] ?? [] as $m) {
        $ignore[] = (string) ($m['id'] ?? '');
      }
      foreach ($tgtIdx as $i) {
        foreach ($classes[$i]['meetings'] ?? [] as $m) {
          $ignore[] = (string) ($m['id'] ?? '');
        }
      }
      foreach ($tgt['meetings'] ?? [] as $m) {
        private_assert_no_conflicts(
          $classes,
          (string) ($m['day'] ?? ''),
          substr((string) ($m['start'] ?? ''), 0, 5),
          substr((string) ($m['end'] ?? ''), 0, 5),
          [],
          $roomKeyT,
          $ignore,
        );
      }
      $oldMerge = $srcMerge;
      $newMerge = $tgtMerge !== '' ? $tgtMerge : private_new_id('mc');
      if ($tgtMerge === '') {
        $classes[$ti]['mergedClassId'] = $newMerge;
      }
      $classes[$si]['mergedClassId'] = $newMerge;
      $classes[$si]['meetings'] = [];
      foreach ($tgt['meetings'] ?? [] as $k => $m) {
        $classes[$si]['meetings'][] = private_copy_meeting($m, false);
      }
      if ($oldMerge !== '') {
        $left = [];
        foreach ($classes as $i => $c) {
          if (trim((string) ($c['mergedClassId'] ?? '')) === $oldMerge) {
            $left[] = $i;
          }
        }
        if (count($left) <= 1) {
          foreach ($left as $i) {
            $classes[$i]['mergedClassId'] = null;
          }
        }
      }
    } else {
      $merge = trim((string) ($src['mergedClassId'] ?? ''));
      if ($merge === '') {
        throw new RuntimeException('This section is already in its own class.');
      }
      $hadRoom = false;
      $roomFrom = null;
      foreach ($src['meetings'] ?? [] as $m) {
        if (!empty($m['roomId'])) {
          $hadRoom = true;
          $roomFrom = $m;
          break;
        }
      }
      if (!$hadRoom) {
        foreach ($classes as $c) {
          if (!is_array($c) || trim((string) ($c['mergedClassId'] ?? '')) !== $merge) {
            continue;
          }
          foreach ($c['meetings'] ?? [] as $m) {
            if (!empty($m['roomId'])) {
              $roomFrom = $m;
              break 2;
            }
          }
        }
      }
      $classes[$si]['mergedClassId'] = null;
      if ($hadRoom && $roomFrom) {
        $keepFields = private_room_fields($pdo, (string) ($roomFrom['roomId'] ?? ''));
        foreach ($classes as $i => $c) {
          if ($i === $si || !is_array($c) || trim((string) ($c['mergedClassId'] ?? '')) !== $merge) {
            continue;
          }
          foreach ($c['meetings'] ?? [] as $j => $m) {
            if (!empty($m['roomId'])) {
              continue;
            }
            if ((string) ($m['day'] ?? '') !== (string) ($roomFrom['day'] ?? '')) {
              continue;
            }
            if (substr((string) ($m['start'] ?? ''), 0, 5) !== substr((string) ($roomFrom['start'] ?? ''), 0, 5)) {
              continue;
            }
            private_stamp_meeting_room($classes[$i]['meetings'][$j], $keepFields, true);
          }
        }
      }
      $classes[$si]['meetings'] = [];
      $left = [];
      foreach ($classes as $i => $c) {
        if (is_array($c) && trim((string) ($c['mergedClassId'] ?? '')) === $merge) {
          $left[] = $i;
        }
      }
      if (count($left) <= 1) {
        foreach ($left as $i) {
          $classes[$i]['mergedClassId'] = null;
        }
      }
    }
  } elseif ($action === 'unschedule_class') {
    $srcId = (string) ($body['offeringId'] ?? '');
    $si = private_find_class_index($classes, $srcId);
    $src = $classes[$si];
    if (empty($src['meetings']) && trim((string) ($src['mergedClassId'] ?? '')) === '') {
      throw new RuntimeException('This class is already unscheduled.');
    }
    $merge = trim((string) ($src['mergedClassId'] ?? ''));
    if ($merge !== '') {
      $hadRoom = false;
      $roomFrom = null;
      foreach ($src['meetings'] ?? [] as $m) {
        if (!empty($m['roomId'])) {
          $hadRoom = true;
          $roomFrom = $m;
          break;
        }
      }
      if (!$hadRoom) {
        foreach ($classes as $c) {
          if (!is_array($c) || trim((string) ($c['mergedClassId'] ?? '')) !== $merge) {
            continue;
          }
          foreach ($c['meetings'] ?? [] as $m) {
            if (!empty($m['roomId'])) {
              $roomFrom = $m;
              break 2;
            }
          }
        }
      }
      $classes[$si]['mergedClassId'] = null;
      if ($hadRoom && $roomFrom) {
        $keepFields = private_room_fields($pdo, (string) ($roomFrom['roomId'] ?? ''));
        foreach ($classes as $i => $c) {
          if ($i === $si || !is_array($c) || trim((string) ($c['mergedClassId'] ?? '')) !== $merge) {
            continue;
          }
          foreach ($c['meetings'] ?? [] as $j => $m) {
            if (!empty($m['roomId'])) {
              continue;
            }
            if ((string) ($m['day'] ?? '') !== (string) ($roomFrom['day'] ?? '')) {
              continue;
            }
            if (substr((string) ($m['start'] ?? ''), 0, 5) !== substr((string) ($roomFrom['start'] ?? ''), 0, 5)) {
              continue;
            }
            private_stamp_meeting_room($classes[$i]['meetings'][$j], $keepFields, true);
          }
        }
      }
      $classes[$si]['meetings'] = [];
      $left = [];
      foreach ($classes as $i => $c) {
        if (is_array($c) && trim((string) ($c['mergedClassId'] ?? '')) === $merge) {
          $left[] = $i;
        }
      }
      if (count($left) <= 1) {
        foreach ($left as $i) {
          $classes[$i]['mergedClassId'] = null;
        }
      }
    } else {
      $classes[$si]['meetings'] = [];
    }
  } else {
    throw new RuntimeException('That edit is not available on My schedule.');
  }

  foreach ($classes as $i => $c) {
    if (!is_array($c)) {
      continue;
    }
    $has = !empty($c['meetings']);
    $classes[$i]['status'] = $has ? 'scheduled' : 'unscheduled';
  }

  return ['classes' => refresh_private_room_labels($pdo, $classes), 'meetingId' => $meetingIdOut];
}

function private_subject_key_from_class(array $c): string
{
  return (string) ($c['sectionId'] ?? '')
    . '|'
    . (string) ($c['courseCode'] ?? '')
    . '|'
    . (string) ($c['component'] ?? '');
}

function private_merge_room_public_ids(array $classes, array $indexes): array
{
  $rooms = [];
  foreach ($indexes as $i) {
    if (!isset($classes[$i]) || !is_array($classes[$i])) {
      continue;
    }
    foreach ($classes[$i]['meetings'] ?? [] as $m) {
      if (!is_array($m)) {
        continue;
      }
      $rid = trim((string) ($m['roomId'] ?? ''));
      if ($rid !== '') {
        $rooms[$rid] = true;
      }
    }
  }
  return array_keys($rooms);
}

/**
 * Clear every class (and its merge group) that uses any of the blocked rooms.
 * Returns [classes, clearedClassCount].
 */
function private_unschedule_classes_using_rooms(array $classes, array $blockedPublicRoomIds): array
{
  if (!$blockedPublicRoomIds) {
    return [$classes, 0];
  }
  $blocked = [];
  foreach ($blockedPublicRoomIds as $id) {
    $id = trim((string) $id);
    if ($id !== '') {
      $blocked[$id] = true;
    }
  }
  if (!$blocked) {
    return [$classes, 0];
  }
  $toClear = [];
  foreach ($classes as $i => $c) {
    if (!is_array($c) || empty($c['meetings'])) {
      continue;
    }
    $indexes = private_merge_indexes($classes, $c) ?: [$i];
    foreach (private_merge_room_public_ids($classes, $indexes) as $rid) {
      if (isset($blocked[$rid])) {
        foreach ($indexes as $j) {
          $toClear[$j] = true;
        }
        break;
      }
    }
  }
  $cleared = 0;
  foreach (array_keys($toClear) as $i) {
    if (!empty($classes[$i]['meetings'])) {
      $cleared++;
    }
    $classes[$i]['meetings'] = [];
    $classes[$i]['status'] = 'unscheduled';
    $classes[$i]['mergedClassId'] = null;
    $classes[$i]['notes'] = null;
  }
  return [$classes, $cleared];
}

function private_refresh_snapshot_meta(array $snap, array $classes): array
{
  $scheduled = 0;
  $unscheduled = 0;
  foreach ($classes as $c) {
    if (!is_array($c)) {
      continue;
    }
    if (!empty($c['meetings'])) {
      $scheduled++;
    } else {
      $unscheduled++;
    }
  }
  $snap['classes'] = $classes;
  $snap['summary'] = [
    'offerings' => $scheduled + $unscheduled,
    'scheduled' => $scheduled,
    'unscheduled' => $unscheduled,
  ];
  $snap['capturedAt'] = date('c');
  if (function_exists('schedule_fingerprint')) {
    $snap['fingerprint'] = schedule_fingerprint($classes);
  }
  return $snap;
}

/**
 * After facilities mark rooms/buildings unavailable, drop those bookings from
 * Admin and Super Admin My schedule copies. Submitted / Saves / Archives stay.
 */
function clear_private_schedules_for_blocked_rooms(PDO $pdo, array $blockedPublicRoomIds): array
{
  $blockedPublicRoomIds = array_values(array_unique(array_filter(array_map('strval', $blockedPublicRoomIds))));
  if (!$blockedPublicRoomIds || !schema_table_exists($pdo, 'schedule_copies')) {
    return ['clearedClasses' => 0, 'bySlot' => []];
  }
  ensure_schedule_workspace_schema($pdo);
  $stmt = $pdo->query(
    "SELECT copy_id, term_id, slot, payload
     FROM schedule_copies
     WHERE kind = 'workspace' AND slot IN ('admin_private', 'sa_private')"
  );
  $total = 0;
  $bySlot = ['admin_private' => 0, 'sa_private' => 0];
  foreach ($stmt->fetchAll() as $row) {
    $snap = json_decode((string) ($row['payload'] ?? ''), true);
    if (!is_array($snap) || empty($snap['classes']) || !is_array($snap['classes'])) {
      continue;
    }
    [$classes, $n] = private_unschedule_classes_using_rooms($snap['classes'], $blockedPublicRoomIds);
    if ($n < 1) {
      continue;
    }
    $slot = (string) $row['slot'];
    $year = (string) (($snap['schoolYear']['label'] ?? '') ?: '');
    $sem = normalize_term_code((string) ($snap['termCode'] ?? '1'));
    if (function_exists('schedule_live_snapshot') && $year !== '') {
      $newSnap = schedule_live_snapshot($pdo, $year, $sem, $classes);
    } else {
      $newSnap = private_refresh_snapshot_meta($snap, $classes);
    }
    $pdo->prepare('UPDATE schedule_copies SET payload = ? WHERE copy_id = ?')
      ->execute([json_encode($newSnap, JSON_UNESCAPED_UNICODE), (int) $row['copy_id']]);
    $total += $n;
    $bySlot[$slot] = ($bySlot[$slot] ?? 0) + $n;
  }
  return ['clearedClasses' => $total, 'bySlot' => $bySlot];
}

function merge_remaining_private_classes(array $existing, array $generated, array $jobSubjectKeys): array
{
  $jobKeys = [];
  foreach ($jobSubjectKeys as $key) {
    $jobKeys[(string) $key] = true;
  }
  $out = [];
  foreach ($existing as $c) {
    if (!is_array($c)) {
      continue;
    }
    $key = private_subject_key_from_class($c);
    if (!empty($c['meetings'])) {
      $out[] = $c;
      continue;
    }
    if ($jobKeys && empty($jobKeys[$key])) {
      $out[] = $c;
    }
  }
  foreach ($generated as $c) {
    if (is_array($c)) {
      $out[] = $c;
    }
  }
  return $out;
}

function run_private_workspace_mutation(PDO $pdo, array &$body, callable $fn): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  if (!in_array($actor, ['admin', 'super_admin'], true)) {
    throw new RuntimeException('Only Admin or Super Admin can edit a personal schedule.');
  }
  $action = (string) ($body['action'] ?? 'generate');
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body, $action !== 'decide');
  $slot = private_slot_for_actor($actor);
  seed_private_workspace_from_live_if_missing($pdo, $termId, $actor, $year, $sem);
  if ($action === 'generate' || $action === 'decide') {
    $body['privateWorkspace'] = true;
    if ($action === 'generate' && !empty($body['onlyUnscheduled'])) {
      $private = load_workspace_copy($pdo, $termId, $slot);
      if (workspace_has_classes($private)) {
        $body['seedPrivateClasses'] = is_array($private['classes'] ?? null) ? $private['classes'] : [];
      } else {
        unset($body['onlyUnscheduled'], $body['seedPrivateClasses']);
      }
    }
    $out = $fn();
    if (($out['status'] ?? '') === 'needs_merge') {
      return apply_workspace_to_payload($out, $pdo, $termId, $actor, 'mine', 'create');
    }
    $classes = isset($out['privateClasses']) && is_array($out['privateClasses']) ? $out['privateClasses'] : [];
    unset($out['privateClasses']);
    upsert_workspace_copy($pdo, $termId, $slot, schedule_live_snapshot($pdo, $year, $sem, $classes));
    return apply_workspace_to_payload($out, $pdo, $termId, $actor, 'mine', 'create');
  }
  $private = load_workspace_copy($pdo, $termId, $slot);
  if (!workspace_has_classes($private)) {
    throw new RuntimeException('There is no personal schedule to edit. Generate one here or open a save.');
  }
  $edited = apply_private_schedule_edit($pdo, $body, $private['classes'] ?? []);
  $newSnap = schedule_live_snapshot($pdo, $year, $sem, $edited['classes']);
  upsert_workspace_copy($pdo, $termId, $slot, $newSnap);
  $out = ['status' => 'updated'];
  if (!empty($edited['meetingId'])) {
    $out['meetingId'] = $edited['meetingId'];
  }
  return apply_workspace_to_payload($out, $pdo, $termId, $actor, 'mine', 'create');
}

function merge_workspace_into_result(PDO $pdo, array $body, string $workspace, string $page, array $out): array
{
  $rawActor = strtolower(str_replace('-', '_', trim((string) ($body['actor'] ?? ''))));
  if (!in_array($rawActor, ['admin', 'super_admin'], true)) {
    return $out;
  }
  $year = parse_school_year_label(trim((string) ($body['schoolYear'] ?? $body['year'] ?? '')));
  $sem = normalize_term_code((string) ($body['termCode'] ?? $body['sem'] ?? '1'));
  if ($year === '') {
    return $out;
  }
  $keep = [];
  foreach (['status', 'runId', 'proposal', 'remaining', 'meetingId', 'remainingOnly'] as $k) {
    if (array_key_exists($k, $out)) {
      $keep[$k] = $out[$k];
    }
  }
  return load_schedule_payload($pdo, $year, $sem, '', $rawActor, false, $workspace, $page) + $keep;
}
