# Chutima SERVERJJ database setup

Dedicated database installer for SERVERJJ only. This is the database preparation stage, not a POS release or a completed migration.

- PostgreSQL 18.6, loopback port 5433, database `chutima`
- Windows service `ChutimaPostgreSQL`, virtual account `NT SERVICE\ChutimaPostgreSQL`
- Program `C:\ChutimaServer`; database `E:\ChutimaData\PostgreSQL18`
- Generates new database credentials on the target server, stores them with private Windows folder permissions, and never displays them.
- Refuses existing Chutima cluster/service/credentials or an occupied 5433 port. Does not open or modify any other application's database, services, or backups.
- Windows administrator consent is required. No password is embedded in this file.
- No production business data is included or automatically imported.

Installer SHA256: `2848A3E1DAFB9A3810A14640D830B8337EE753A1073E34936F6DA85F69E5A83D`

PostgreSQL is downloaded from the official EDB binaries URL with SHA256 verification. Source and schema are included in `source/`.
