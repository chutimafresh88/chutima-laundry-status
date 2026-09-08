# Runtime repair R3

Responds to the SERVERJJ PostgreSQL initialization crash in the Windows Visual C++ runtime 14.36. This installer downloads a SHA-256 pinned Microsoft x64 redistributable directly from Microsoft, extracts its runtime DLLs into the dedicated Chutima PostgreSQL bin directory, and then continues initialization. It does not execute the Microsoft installer or change system DLLs, PATH, existing PostgreSQL instances, or SML. Existing mismatching Chutima DLLs are not overwritten. No shop data or credentials are included. Installation still needs to complete on SERVERJJ; a successful build does not establish that the observed crash is fixed.

Microsoft guidance: https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist and https://learn.microsoft.com/en-us/cpp/windows/determining-which-dlls-to-redistribute
