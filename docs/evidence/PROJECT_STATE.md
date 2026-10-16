# PROJECT STATE

_Single source of truth. Update with str_replace as work progresses. Keep it short._

## Goal
Build a small Python script, "greeting-cli", that takes a name and prints a greeting, e.g. `Hello, Emman!`.

## Status
In progress.

## Done
- greeting/cli.py with greet(name) and argparse main() (commit 2ec6454)
- Error handling: greet() raises TypeError for non-strings and ValueError for empty/whitespace names; main() reports them via parser.error (clean message, exit code 2)

## Next
- Run `python greeting/cli.py Emman` and confirm "Hello, Emman!" (still unverified, no run tool)
- Run with an empty name (`python greeting/cli.py ""`) and confirm the error message
- Add greeting/__init__.py if it should be importable as a package

## Open questions
- 
