# AppealAI MVP

Temporary, self-contained staging folder for the AppealAI project.

## Isolation / transfer rule
Everything belonging to AppealAI lives under `appealai-mvp/`. Do not add dependencies on the borehole-log-studio application and do not modify its existing files for AppealAI.

This folder is intentionally portable so it can later be copied/moved into its own repository without disentangling it from borehole-log-studio.

## MVP scope
- Gaming-style responsive appeal dashboard
- Evidence intake: screenshots/images, PDF documents, pasted text
- Evidence Vault
- Ban/case classification
- Adaptive questions
- Appeal drafting flow
- Case timeline/readiness UI

## Intended architecture
Next.js + TypeScript frontend, with later integrations for AI document/vision analysis, persistent storage/auth, payments, and approved email workflows.

## Important
This is an independent project temporarily staged in this repository only because the current GitHub connector cannot create a brand-new repository. The existing borehole project should remain untouched.
