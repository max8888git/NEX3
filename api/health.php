<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$cfg = load_config();
if (!$cfg) {
  json_ok(['configured' => false, 'installed' => false]);
}

try {
  $pdo = pdo_from_config($cfg, true);
  $tables = $pdo->query("SHOW TABLES LIKE 'colleges'")->fetch();
  json_ok([
    'configured' => true,
    'installed' => (bool) $tables,
    'database' => $cfg['name'] ?? '',
  ]);
} catch (Throwable $e) {
  json_ok([
    'configured' => true,
    'installed' => false,
    'error' => $e->getMessage(),
  ]);
}
