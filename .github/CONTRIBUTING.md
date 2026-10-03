# Contributing to Vaneza

Thanks for wanting to help. This project values small, clear changes.

## Ways to contribute

- Report mistakes in documents or on the website
- Improve accessibility, performance or copy
- Review the architecture and challenge its assumptions
- Suggest tests for the quality gates

## Ground rules

1. **Facts need a record.** Anything external (addresses, accounts, dates) is one record with a state: `stated`, `absent` or `unconfirmed`. Do not hard-code them elsewhere.
2. **Links come from URLs.** Store the URL and derive any handle. No link for a record that is not stated.
3. **Colours come from tokens.** Palette values are sampled from brand assets and live only in `src/tokens.css`.
4. **No invented claims.** Do not add figures, partners, audits or dates that the project has not stated.
5. **Respect motion preferences.** Every animation needs an instant fallback.

## Workflow

```bash
npm install
npm run build
npm run gates
```

Open a pull request with a short description of what changed and why. Both commands should pass before review.

## Style

Match the surrounding code. Keep comments for reasons, not restatements. Write copy in plain, original language.

## Conduct

Be direct and kind. Critique the work, not the person.
