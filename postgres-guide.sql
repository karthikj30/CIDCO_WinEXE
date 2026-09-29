-- CIDCO AQI portal: see everything in PostgreSQL — master, SFTP and API tables.
--
-- Every query here was run against the portal database before it was written down.
-- Run the whole file on the server:
--   psql -h localhost -U cidco_sftp -d cidco_sftp -P pager=off -f postgres-guide.sql
-- or paste one query at a time into psql. Picture: postgres-guide.png

-- 1. how many rows each table holds (exact counts)
SELECT 'companies (MASTER)' AS table_name, COUNT(*) AS rows FROM companies
UNION ALL SELECT 'nodes (MASTER)',            COUNT(*) FROM nodes
UNION ALL SELECT 'departments (MASTER)',      COUNT(*) FROM departments
UNION ALL SELECT 'users',                     COUNT(*) FROM users
UNION ALL SELECT 'sftp_uploads (SFTP)',       COUNT(*) FROM sftp_uploads
UNION ALL SELECT 'data_files (SFTP DATA)',    COUNT(*) FROM data_files
UNION ALL SELECT 'sftp_readings (SFTP)',      COUNT(*) FROM sftp_readings
UNION ALL SELECT 'architect_handshakes',      COUNT(*) FROM architect_handshakes
UNION ALL SELECT 'integration_tokens (API)',  COUNT(*) FROM integration_tokens
UNION ALL SELECT 'communication_logs (API)',  COUNT(*) FROM communication_logs
UNION ALL SELECT 'api_readings (API)',        COUNT(*) FROM api_readings
UNION ALL SELECT 'reports (web form / CSV)',  COUNT(*) FROM reports;

-- 2. MASTER: the registered sites
SELECT c."siteName", n.name AS node, d.name AS department, c."architectName",
       c."registeredLatitude" AS lat, c."registeredLongitude" AS lon, c."permittedRadiusMetres" AS radius_m
FROM companies c
LEFT JOIN nodes n       ON n.id = c."nodeId"
LEFT JOIN departments d ON d.id = c."departmentId"
ORDER BY c."siteName";

-- 3. SFTP: the last 10 files delivered, and how ingestion went
SELECT "siteName", "deliveredName", "pollStatus",
       "importedCount" || '/' || "rowCount" AS stored, latitude, longitude, "receivedAt"
FROM data_files ORDER BY "receivedAt" DESC LIMIT 10;

-- 4. SFTP: the newest stored readings
SELECT c."siteName", r."referenceNo", r."measuredAt", r."aqiValue", r.pm25, r.pm10
FROM sftp_readings r LEFT JOIN companies c ON c.id = r."companyRecordId"
ORDER BY r."receivedAt" DESC LIMIT 10;

-- 5. API: every integration, and the site it reports for
SELECT h."clientId", u."firmName", u.email, c."siteName", h.status, h."credentialExpiresAt"
FROM architect_handshakes h
JOIN users u          ON u.id = h."architectId"
LEFT JOIN companies c ON c.id = h."companyRecordId"
WHERE h.channel = 'API' ORDER BY h."createdAt" DESC;

-- 6. API: the newest stored readings
SELECT r."referenceNo", COALESCE(c."siteName", '(not linked)') AS site,
       r."monitoringStationId", r."measuredAt", r."aqiValue", r."sourceIp"
FROM api_readings r LEFT JOIN companies c ON c.id = r."companyRecordId"
ORDER BY r."receivedAt" DESC LIMIT 10;

-- 7. BOTH: readings per site, per channel
SELECT COALESCE(c."siteName", '(API, not linked)') AS site, x.channel,
       COUNT(*) AS readings, ROUND(AVG(x."aqiValue")) AS avg_aqi, MAX(x."measuredAt") AS latest
FROM (
  SELECT 'SFTP' AS channel, "companyRecordId", "aqiValue", "measuredAt" FROM sftp_readings
  UNION ALL
  SELECT 'API',             "companyRecordId", "aqiValue", "measuredAt" FROM api_readings
) x LEFT JOIN companies c ON c.id = x."companyRecordId"
GROUP BY 1, 2 ORDER BY 1, 2;

-- 8. LEGIT CHECK: how far each SFTP file was sent from the site's registered position
SELECT c."siteName", f."deliveredName", f.latitude, f.longitude,
       CASE WHEN f.latitude IS NULL THEN 'no live position sent'
            WHEN c."registeredLatitude" IS NULL THEN 'site has no registered position'
            ELSE ROUND(6371008.8 * 2 * ASIN(SQRT(
                   POWER(SIN(RADIANS(f.latitude - c."registeredLatitude") / 2), 2) +
                   COS(RADIANS(c."registeredLatitude")) * COS(RADIANS(f.latitude)) *
                   POWER(SIN(RADIANS(f.longitude - c."registeredLongitude") / 2), 2))))::text || ' m'
       END AS distance_from_registered,
       c."permittedRadiusMetres" AS allowed_m
FROM data_files f JOIN companies c ON c.id = f."companyRecordId"
ORDER BY f."receivedAt" DESC LIMIT 10;
