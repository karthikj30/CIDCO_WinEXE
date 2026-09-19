# Project brief

CIDCO AQI dual codebase: Windows architect agent (architect_WINexe) and Next.js portal (CIDCO_WEB).
Agent renames CSV to companyId_timestamp_AQI.csv, checks remote path exists, never creates folders.
Server poll1 files company/month/date/timestamp; poll2 ingests with 10-step fileStatus and archives.
