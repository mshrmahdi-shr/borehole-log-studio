# Windows Build Instructions

## Simplest method: GitHub Actions

Push the project to GitHub and run the included workflow. GitHub creates both NSIS `.exe` and MSI installers. The generated application has no Python dependency.

## Local Windows build

Install Node.js 20, Rust, Microsoft C++ Build Tools, and WebView2. Then run:

```powershell
npm ci
npm run desktop:build
```

These tools are needed only by the developer who compiles the program. They are not required on the end user's machine.
