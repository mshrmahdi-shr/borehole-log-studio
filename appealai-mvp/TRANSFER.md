# Move AppealAI into its own repository

AppealAI is intentionally self-contained under `appealai-mvp/` and has no imports from the Borehole application.

## Simple copy
Copy the entire `appealai-mvp` folder into the root of the new repository, then run:

```bash
npm install
npm run build
npm run dev
```

## Preserve only AppealAI history with Git subtree
From a clone of `borehole-log-studio`:

```bash
git fetch origin
git checkout appealai-mvp
git subtree split --prefix=appealai-mvp -b appealai-export
git remote add appealai-new <NEW_REPOSITORY_URL>
git push appealai-new appealai-export:main
```

This produces a clean repository whose root is the current `appealai-mvp/` folder while preserving the relevant commit history.

## Isolation rule
Until the move happens, keep all AppealAI code under `appealai-mvp/` and all active work on branch `appealai-mvp`.
