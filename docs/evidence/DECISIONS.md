# DECISIONS

_Append-only. Why we chose X over Y. Use the record_decision tool._

## 2026-10-16T19:16:29Z · reviewer
- DECISION: Use argparse for argument parsing instead of sys.argv
- WHY: argparse provides automatic --help generation, clean error messages, and proper exit codes (2 for argument errors) without manual handling. sys.argv requires manual parsing, error formatting, and exit code management, making it more error-prone and harder to maintain. argparse is the Python standard library best practice for CLI argument handling.

## 2026-10-16T19:16:33Z · reviewer
- DECISION: Use str_replace with version pinning instead of write_file for code edits
- WHY: In a multi-agent workspace, write_file can overwrite concurrent edits from other sessions. str_replace with version pinning (if_version parameter) prevents lost edits by failing gracefully when the file has changed since last read, allowing the agent to re-read and merge conflicts. This ensures collaborative workflows stay safe and no work is silently overwritten.
