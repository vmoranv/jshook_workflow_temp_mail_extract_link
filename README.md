# temp-mail-extract-link workflow

Declarative workflow for extracting activation / verification links from a temporary-mail detail page. It is generic and driven by selectors plus href/text filters rather than any Qwen-specific assumptions.

## Entry File

- `workflow.ts`

## Workflow ID

- `workflow.temp-mail-extract-link.v1`

## Structure

This workflow wraps generic browser primitives into a reusable mail-detail routine:

- Optional `page_navigate` to a mail detail page
- Initial wait after navigation
- Retry-aware `page_evaluate` extraction step that:
  - waits through redirect/challenge style titles
  - checks optional `readySelector` / `readyText`
  - extracts matched links
  - optionally returns fallback link dumps
  - optionally auto-opens the first matched link
- Optional post-open wait step
- `console_execute` summary step for downstream orchestration

## Tools Used

- `page_navigate`
- `page_evaluate`
- `console_execute`

## Config

Prefix: `workflows.tempMailExtractLink.*`

- `detailUrl`
- `waitUntil`
- `initialWaitMs`
- `retryWaitMs`
- `maxWaitAttempts`
- `readySelector`
- `readyText`
- `titleBlocklist`
- `linkSelector`
- `hrefIncludes`
- `textIncludes`
- `regexPattern`
- `regexFlags`
- `maxLinks`
- `includeFallbackLinks`
- `fallbackMaxLinks`
- `openFirstMatch`
- `waitAfterOpenMs`

## Example Use Cases

- Extract `/api/v1/auths/activate` links from a temporary mailbox
- Extract generic `/verify` or `/confirm` links from a magic-link email
- Run on a page that briefly shows `Redirecting` before actual content loads
- Return fallback link dumps when no verification link is found yet

## Local Validation

1. Run `pnpm install`.
2. Run `pnpm typecheck`.
3. Put this repo under a configured `workflows/` extension root.
4. Run `extensions_reload` in `jshookmcp`.
5. Confirm the workflow appears in `list_extension_workflows`.
6. Execute the workflow on a mail detail page and verify that the extraction result includes either matched links or fallback links.
