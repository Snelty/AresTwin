<?php
// ARES-TWIN · API del catálogo de JARVIS sobre el MySQL de XAMPP.
// Apache la sirve en http://localhost/PersonalProjects/NasaSpaceApps/front/bd/api.php;
// el servidor de Vite la expone como /bd/api.php (proxy) para la laptop y el celular.
//
//   GET  ?accion=estado                       conexión y cantidades
//   GET  ?accion=catalogo&escenario=E         objetos conocidos (orbital + eva)
//   POST ?accion=sembrar     {escenario, objetos[]}   relevamiento orbital (sólo si no hay)
//   POST ?accion=registrar   {escenario, objetos[]}   objetos nuevos que registró la EVA
//   POST ?accion=observar    {escenario, sesion, items[]}  identificaciones del traje
//   POST ?accion=destino     {escenario, sesion, x, y}
//   POST ?accion=reiniciar_eva {escenario}    borra lo registrado por la EVA y las observaciones
//
// Credenciales de XAMPP por defecto (root sin contraseña); cambiarlas con variables de entorno.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$HOST = getenv('ARES_BD_HOST') ?: '127.0.0.1';
$USER = getenv('ARES_BD_USER') ?: 'root';
$PASS = getenv('ARES_BD_PASS') ?: '';
$NAME = 'ares_twin';

function out($data, $code = 200) {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

try {
  $pdo = new PDO("mysql:host=$HOST;charset=utf8mb4", $USER, $PASS, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);
  // Primera vez: crea la base y las tablas (esquema.sql).
  $sql = file_get_contents(__DIR__ . '/esquema.sql');
  $sql = preg_replace('/--\s.*$/m', '', $sql); // comentarios fuera (algunos llevan ';')
  foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) $pdo->exec($stmt);
  $pdo->exec("USE $NAME");
} catch (Throwable $e) {
  out(['ok' => false, 'error' => 'No se pudo conectar a MySQL: ' . $e->getMessage()], 503);
}

$accion = $_GET['accion'] ?? 'estado';
$body = json_decode(file_get_contents('php://input') ?: 'null', true) ?: [];
$esc = substr((string)($body['escenario'] ?? $_GET['escenario'] ?? 'real-480'), 0, 40);
$num = fn($v, $d = 0.0) => is_numeric($v) ? (float)$v : $d;
$str = fn($v, $n) => $v === null ? null : mb_substr((string)$v, 0, $n);

function rev(PDO $pdo, string $esc) {
  $q = $pdo->prepare("SELECT COUNT(*) n, COALESCE(UNIX_TIMESTAMP(MAX(actualizado)), 0) t FROM objetos WHERE escenario = ?");
  $q->execute([$esc]);
  $r = $q->fetch();
  return $r['n'] . '-' . $r['t'];
}

switch ($accion) {
  case 'estado':
    $q = $pdo->prepare("SELECT fuente, COUNT(*) n FROM objetos WHERE escenario = ? GROUP BY fuente");
    $q->execute([$esc]);
    $por = ['orbital' => 0, 'eva' => 0];
    foreach ($q as $r) $por[$r['fuente']] = (int)$r['n'];
    $o = $pdo->prepare("SELECT COUNT(*) FROM observaciones WHERE escenario = ?");
    $o->execute([$esc]);
    out(['ok' => true, 'bd' => $NAME, 'escenario' => $esc, 'objetos' => $por, 'observaciones' => (int)$o->fetchColumn(), 'rev' => rev($pdo, $esc)]);

  case 'catalogo':
    $q = $pdo->prepare("SELECT id, clase, litologia, x, y, radio_m, forma, fuente, confianza, interes, nota FROM objetos WHERE escenario = ?");
    $q->execute([$esc]);
    $rows = $q->fetchAll();
    foreach ($rows as &$r) foreach (['x', 'y', 'radio_m', 'forma', 'confianza', 'interes'] as $k) $r[$k] = (float)$r[$k];
    out(['ok' => true, 'escenario' => $esc, 'rev' => rev($pdo, $esc), 'objetos' => $rows]);

  case 'sembrar':
  case 'registrar':
    $fuente = $accion === 'sembrar' ? 'orbital' : 'eva';
    if ($fuente === 'orbital') {
      $c = $pdo->prepare("SELECT COUNT(*) FROM objetos WHERE escenario = ? AND fuente = 'orbital'");
      $c->execute([$esc]);
      if ((int)$c->fetchColumn() > 0) out(['ok' => true, 'insertados' => 0, 'nota' => 'el relevamiento orbital ya estaba', 'rev' => rev($pdo, $esc)]);
    }
    $ins = $pdo->prepare("INSERT IGNORE INTO objetos (escenario, id, clase, litologia, x, y, radio_m, forma, fuente, confianza, interes, nota)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $n = 0;
    $pdo->beginTransaction();
    foreach (array_slice($body['objetos'] ?? [], 0, 5000) as $o) {
      if (!isset($o['id'], $o['clase'])) continue;
      $ins->execute([$esc, $str($o['id'], 24), $str($o['clase'], 16), $str($o['litologia'] ?? null, 32), $num($o['x'] ?? 0), $num($o['y'] ?? 0),
        $num($o['radio_m'] ?? 0.5), $num($o['forma'] ?? 1), $fuente, $num($o['confianza'] ?? 1, 1), $num($o['interes'] ?? 0), $str($o['nota'] ?? null, 200)]);
      $n += $ins->rowCount();
    }
    $pdo->commit();
    out(['ok' => true, 'insertados' => $n, 'rev' => rev($pdo, $esc)]);

  case 'observar':
    $ses = $str($body['sesion'] ?? 'sin-sesion', 40);
    // Una fila por objeto y sesión: se actualiza sólo si la nueva identificación es más confiable.
    $up = $pdo->prepare("INSERT INTO observaciones (escenario, sesion, objeto_id, clase, estado, ref_id, similitud, litologia_estimada, confianza, distancia_m, radio_medido_m, x, y, t_mision_s)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        estado = IF(VALUES(confianza) > confianza, VALUES(estado), estado),
        ref_id = IF(VALUES(confianza) > confianza, VALUES(ref_id), ref_id),
        similitud = IF(VALUES(confianza) > confianza, VALUES(similitud), similitud),
        litologia_estimada = IF(VALUES(confianza) > confianza, VALUES(litologia_estimada), litologia_estimada),
        distancia_m = IF(VALUES(confianza) > confianza, VALUES(distancia_m), distancia_m),
        radio_medido_m = IF(VALUES(confianza) > confianza, VALUES(radio_medido_m), radio_medido_m),
        confianza = GREATEST(confianza, VALUES(confianza))");
    $n = 0;
    $pdo->beginTransaction();
    foreach (array_slice($body['items'] ?? [], 0, 500) as $o) {
      if (!isset($o['objeto_id'], $o['estado'])) continue;
      if (!in_array($o['estado'], ['catalogado', 'similar', 'nuevo'], true)) continue;
      $up->execute([$esc, $ses, $str($o['objeto_id'], 24), $str($o['clase'] ?? '', 16), $o['estado'], $str($o['ref_id'] ?? null, 24), $num($o['similitud'] ?? 0),
        $str($o['litologia_estimada'] ?? null, 32), $num($o['confianza'] ?? 0), $num($o['distancia_m'] ?? 0), $num($o['radio_medido_m'] ?? 0),
        $num($o['x'] ?? 0), $num($o['y'] ?? 0), isset($o['t_mision_s']) ? $num($o['t_mision_s']) : null]);
      $n++;
    }
    $pdo->commit();
    out(['ok' => true, 'procesadas' => $n]);

  case 'destino':
    $q = $pdo->prepare("INSERT INTO destinos (escenario, sesion, x, y) VALUES (?, ?, ?, ?)");
    $q->execute([$esc, $str($body['sesion'] ?? 'sin-sesion', 40), $num($body['x'] ?? 0), $num($body['y'] ?? 0)]);
    out(['ok' => true]);

  case 'reiniciar_eva':
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') out(['ok' => false, 'error' => 'usar POST'], 405);
    $a = $pdo->prepare("DELETE FROM objetos WHERE escenario = ? AND fuente = 'eva'");
    $a->execute([$esc]);
    $b = $pdo->prepare("DELETE FROM observaciones WHERE escenario = ?");
    $b->execute([$esc]);
    out(['ok' => true, 'borrados' => $a->rowCount(), 'observaciones' => $b->rowCount(), 'rev' => rev($pdo, $esc)]);

  default:
    out(['ok' => false, 'error' => "acción desconocida: $accion"], 400);
}
