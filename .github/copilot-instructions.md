# Copilot instructions for UNikom

## Git safety requirement

- Never run a git commit, git add, git push, or any GitHub sync command without explicit approval from the user.
- Before any commit or push, ask the user for confirmation and show a short summary of the pending changes.
- If the user does not explicitly approve, do not commit or push anything.
- Never silently stage, commit, or push files on behalf of the user.
- If a commit message is needed, propose it to the user first and wait for approval.

## Default behavior

- Prefer asking before modifying or finalizing repo state.
- Keep the user in the loop before any operation that changes repository history or remote state.
