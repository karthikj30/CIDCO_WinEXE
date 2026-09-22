-- The address a file came from is no longer recorded.
--
-- A CSV dropped into a plain SFTP folder is delivered by the operating
-- system's own sshd, so the portal never saw that connection and these columns
-- held null for every real delivery. An IP check that can only be skipped is
-- worse than no check: it reads like a control that is working.
--
-- The API channel's own IP whitelist (architect_handshakes.whitelistedIp,
-- validation_requests.presentedIp) is a different feature and is untouched.
ALTER TABLE "data_files"   DROP COLUMN IF EXISTS "sourceIp";
ALTER TABLE "sftp_uploads" DROP COLUMN IF EXISTS "sourceIp";
ALTER TABLE "sftp_uploads" DROP COLUMN IF EXISTS "presentedIp";
ALTER TABLE "sftp_uploads" DROP COLUMN IF EXISTS "ipMatch";
