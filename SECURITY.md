# Security

ContextPatrol reads source only. It does not execute repository code, use a shell,
write to the analyzed repository, access a network, or read environment credentials.

The workspace must be a Git root. Symbolic links, traversal paths, dependency and
metadata directories, likely credential files, binary files, and oversized files
are not analyzed. Credential-shaped material is redacted before excerpts enter a
report. Reports are advisory and must not be treated as authorization decisions.
