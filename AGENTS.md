# Relay

- Read `docs/DEVELOPMENT.md` before implementation. It takes precedence over the exploratory HTML prototype.
- Build a general-purpose, low-input workflow platform for sales and other roles.
- Require TypeScript for production code and calculations.
- Verify the latest stable, compatible dependencies at implementation time and pin them with a lockfile.
- Centralize UI text in locale resources and styles in design tokens. Do not copy hardcoded styles or text from the prototype into production.
- Use synthetic fixtures only. Never commit customer conversations, personal data, credentials, or local environment files.
- Keep CI efficient with path filters, caching and concurrency cancellation when workflows are introduced.
