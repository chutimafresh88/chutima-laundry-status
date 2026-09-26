# Staff passwords: minimum 4 characters

Requested on 2026-09-26. The staff editor accepts 4–128 characters for new accounts and password changes; blank edits retain the existing password.

Deploy the matching backend validation change from chutima-fresh-laundry commit 8d7d439aac35351bf1e9176314e46be6183f4d46 before using this frontend. Owner setup still requires 12 characters. Hashing, login rate limits and role checks remain unchanged.

The archive contains only app.js and index.html for SERVERJJ's web/office directory. It is based on the deployed image-upload fix, preserving that fix and the direct SERVERJJ API.

SHA-256:
- app.js: 29f1db694f700889246c5eec4efc44c33dbfa82a8699cd2665aaf243b8a6cdd0
- index.html: f9f8695a78bc1da09bbf6988aa059e3b20e201cd7cb13d9dc23f48f2dbda95de

Validation: source and staged bundles pass Node syntax checks. In-memory staff service tests cover create/update/login at 4 characters, rejection at 3 and 129, acceptance at 128, retaining passwords when editing with blank fields, role protection, wrong passwords and disabled users. No production accounts were used or changed for testing.
