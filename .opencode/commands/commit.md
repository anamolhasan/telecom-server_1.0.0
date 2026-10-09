---
description: Commit and push current changes
---

Run the following workflow:

1. Check git status.
2. Review changed files.
3. Do not commit `.env`, secrets, API keys, passwords, tokens, private keys, node_modules, build output, or temporary files.
4. Run `git add .`
5. Run `git diff --cached --stat`
6. Generate a meaningful Conventional Commit message based on the actual changes.
7. Run `git commit -m "<commit message>"`
8. Check the current branch with `git branch --show-current`
9. Run `git push`
10. Run `git status` again.

Rules:
- Never use `git reset --hard`
- Never use `git clean -fd`
- Never use `git push --force`
- Never force push
- Never amend commits
- Do not modify source code
- If there are no changes, report that there is nothing to commit
- If commit fails, stop and report the error
- If push fails, report the exact error

Finally report:
- Commit message
- Changed files
- Push result
- Final git status