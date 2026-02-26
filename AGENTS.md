# Repository Guidelines

## Project Structure & Module Organization
- `src/index.ts`: server entrypoint, CLI argument parsing, MCP tool registration.
- `src/lib/`: core modules split by concern:
  - `connection-manager.ts` for multi-database pool setup and aliasing.
  - `transaction-manager.ts` for pending transaction lifecycle.
  - `tool-handlers.ts` for SQL execution behavior.
  - `tool-help.ts`, `types.ts`, `utils.ts`, `config.ts` for shared support.
- `dist/`: compiled output from TypeScript (`tsc`); publish/run target.
- Root config: `package.json`, `tsconfig.json`, `Dockerfile`, `README.md`.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run build`: compile TypeScript to `dist/` and mark `dist/index.js` executable.
- `npm run dev`: run TypeScript compiler in watch mode while editing.
- `npm start`: run compiled server (`node dist/index.js`).
- Example local run with multiple DBs:
  - `node dist/index.js "postgresql://user:pass@host:5432/app_db" "postgresql://user:pass@host:5432/log_db"`

## Coding Style & Naming Conventions
- Language: TypeScript (`strict` mode enabled in `tsconfig.json`).
- Indentation: 2 spaces; keep line length readable and avoid dense nesting.
- Modules/files: kebab-case filenames in `src/lib/` (for example, `tool-handlers.ts`).
- Identifiers: `camelCase` for functions/variables, `PascalCase` for classes.
- Preserve existing ESM import style (`.js` extension in TS imports for NodeNext).
- Prefer small focused functions and explicit error messages for tool responses.

## Testing Guidelines
- No test framework is currently configured in `package.json`.
- Before submitting changes, run at minimum:
  - `npm run build`
  - `npm start` (or a targeted manual MCP client flow) against a non-production database.
- If adding tests, place them under `src/__tests__/` or `tests/` and add an `npm test` script in the same PR.

## Commit & Pull Request Guidelines
- Follow the existing commit style: conventional prefixes like `feat:` and `chore:` with concise scope.
- Keep commits focused (one logical change per commit).
- PRs should include:
  - what changed and why,
  - any config/env updates (for example `PG_*`, transaction settings),
  - manual verification steps and sample commands,
  - linked issue(s) when applicable.

## Security & Configuration Tips
- Never commit raw database credentials or full connection URIs.
- Use disposable/dev databases for DML/DDL testing.
- Validate timeout/concurrency env vars (`TRANSACTION_TIMEOUT_MS`, `MAX_CONCURRENT_TRANSACTIONS`, `PG_STATEMENT_TIMEOUT_MS`) before production use.
