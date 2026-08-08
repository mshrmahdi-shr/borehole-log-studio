# Borehole Log Studio Desktop

Windows desktop source for an offline-first borehole log editor.

## Runtime privacy

- No application API key.
- No cloud OCR.
- No CDN at runtime.
- PDF, image, spreadsheet, CSV, and project files are processed locally.
- The application UI is English-only.

## Supported imports

- PDF: embedded text first; local OCR fallback for scanned pages
- Images: PNG, JPG, JPEG, WEBP
- Spreadsheets: XLSX, XLS, CSV
- Project files: JSON

## Local development

Required only for developers building the application:

- Node.js 20+
- Rust stable
- Tauri prerequisites for the operating system

```bash
npm install
npm run desktop:dev
```

End users do not install Python, Node.js, or Rust. They run the generated Windows installer.

## Build a Windows installer

On Windows:

```bash
npm ci
npm run test:source
npm run desktop:build
```

Installer output:

```text
src-tauri/target/release/bundle/nsis/*.exe
src-tauri/target/release/bundle/msi/*.msi
```

## Build through GitHub Actions

1. Create a GitHub repository.
2. Upload this project.
3. Open **Actions > Build Windows Desktop**.
4. Select **Run workflow**.
5. Download the `Borehole-Log-Studio-Windows` artifact.

## Current engineering limitation

OCR extracts text locally, but handwritten field logs and irregular layouts still require human review. Automatic depth-to-column mapping should not be treated as engineering verification.
