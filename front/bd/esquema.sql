-- ARES-TWIN · catálogo de objetos de JARVIS (MySQL / MariaDB de XAMPP).
-- api.php crea todo esto solo en la primera llamada; este archivo es la referencia
-- (o para importarlo a mano en phpMyAdmin).
--
-- Posiciones en el marco local ENU del contrato (CLAUDE.md §5): x = Este, y = Norte, metros,
-- origen en la esquina SO de la ventana de terreno.

CREATE DATABASE IF NOT EXISTS ares_twin CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ares_twin;

-- Lo que la base de datos conoce: el relevamiento orbital (simulado) y lo que registra la EVA.
CREATE TABLE IF NOT EXISTS objetos (
  escenario   VARCHAR(40)  NOT NULL,             -- 'real-480' (paquete terreno/) o 'procedural'
  id          VARCHAR(24)  NOT NULL,             -- R-0001, S3, H, A-1…
  clase       VARCHAR(16)  NOT NULL,             -- roca, bloque, meteorito, veta, concrecion, sitio, habitat
  litologia   VARCHAR(32)  NULL,                 -- ver front/src/jarvis/lithology.ts
  x           DOUBLE       NOT NULL,
  y           DOUBLE       NOT NULL,
  radio_m     DOUBLE       NOT NULL,
  forma       DOUBLE       NOT NULL,             -- alto / ancho
  fuente      ENUM('orbital','eva') NOT NULL,   -- orbital = relevamiento HiRISE simulado; eva = registrado por el traje
  confianza   DOUBLE       NOT NULL DEFAULT 1,   -- de la clasificación litológica (0..1)
  interes     DOUBLE       NOT NULL DEFAULT 0,   -- vale la pena documentar (0..1)
  nota        VARCHAR(200) NULL,
  creado      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (escenario, id),
  KEY por_fuente (escenario, fuente)
) ENGINE=InnoDB;

-- Cada identificación del traje (una por objeto y sesión; se actualiza si mejora la confianza).
CREATE TABLE IF NOT EXISTS observaciones (
  num                 INT AUTO_INCREMENT PRIMARY KEY,
  escenario           VARCHAR(40) NOT NULL,
  sesion              VARCHAR(40) NOT NULL,
  objeto_id           VARCHAR(24) NOT NULL,
  clase               VARCHAR(16) NOT NULL,
  estado              ENUM('catalogado','similar','nuevo') NOT NULL,
  ref_id              VARCHAR(24) NULL,          -- entrada de la BD con la que se comparó
  similitud           DOUBLE      NOT NULL,
  litologia_estimada  VARCHAR(32) NULL,
  confianza           DOUBLE      NOT NULL,
  distancia_m         DOUBLE      NOT NULL,
  radio_medido_m      DOUBLE      NOT NULL,
  x                   DOUBLE      NOT NULL,
  y                   DOUBLE      NOT NULL,
  t_mision_s          DOUBLE      NULL,
  creado              TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado         TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY una_por_sesion (escenario, sesion, objeto_id)
) ENGINE=InnoDB;

-- Destinos marcados en el mapa del visor.
CREATE TABLE IF NOT EXISTS destinos (
  num        INT AUTO_INCREMENT PRIMARY KEY,
  escenario  VARCHAR(40) NOT NULL,
  sesion     VARCHAR(40) NOT NULL,
  x          DOUBLE      NOT NULL,
  y          DOUBLE      NOT NULL,
  creado     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
