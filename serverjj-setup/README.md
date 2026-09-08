# Chutima SERVERJJ database setup

Dedicated installer for SERVERJJ. This stage prepares the new PostgreSQL database; it does not import business data or modify any other application's databases/services.

PostgreSQL 18.6, loopback port 5433, service `ChutimaPostgreSQL`, virtual account `NT SERVICE\ChutimaPostgreSQL`. Program files: `C:\ChutimaServer`. Database: `E:\ChutimaData\PostgreSQL18`.

The installer generates database credentials locally and keeps them in private Windows folders. No shop credentials or business data are embedded. Administrator consent is required.

This revision reuses the verified downloaded runtime after an initialization failure, preserves the generated administrative connection, refuses a nonempty existing cluster, and displays errors with generated secrets removed. No automatic deletion/rollback of existing data is performed.

SHA256: `4F50B654AC31FDB269EF1E31E26ACA8C1AC588136C9061AA5AF8944AB3C34E9A`

Source and schema are in `source/`.
