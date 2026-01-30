# PR 标题（复制到 GitHub Title）

```
feat: colorful agent report + README highlight + AGENT_SKILLS_SPEC link
```

---

# PR 描述（整段复制到 GitHub Description）

## Summary

- **Agent Run Report** — Colorful HTML report template and README highlight with Report/Debug screenshots.
- README restructure: "What we support" table, Install, stock research example, report screenshots, and link to AGENT_SKILLS_SPEC.
- SkillMdParser and AGENT_SKILLS_SPEC/doc updates; example and package tweaks as needed.

## Changes

### Report (highlight)

- **`src/report/agent-report-template.ts`** — More colorful styling: blue/emerald accent palette, gradient header, colored tabs and table header, alternating table rows, clearer headings and labels.
- **`README.md`** — Added "Agent Run Report" section with Report and Debug screenshots (`examples/report-1.png`, `examples/report-2.png`) so the HTML report is clearly a highlight.

### README

- New "What we support" table (SKILL, LangChain, MCP, n8n) with folder/spec links.
- Link to [docs/AGENT_SKILLS_SPEC.md](docs/AGENT_SKILLS_SPEC.md) in SKILL row and in Code reference → SKILL.
- Install, "Run the stock research example", and Use (LangChain embed + tracking/reports) sections.
- Code reference for SKILL, LangChain, MCP, n8n.

### CI

- **`.github/workflows/ci.yml`** & **`release.yml`** — Use `npm ci --legacy-peer-deps` so install succeeds despite LangChain/n8n peer conflicts.
- **`.npmrc`** — `legacy-peer-deps=true` for consistent installs.

### Other

- `src/discovery/loaders/SkillMdParser.ts` and tests.
- `docs/AGENT_SKILLS_SPEC.md` updates.
- `examples/agent-toolhub-react-stock.mjs` and `package.json` (if any).
- README code block cleanup; `.gitignore` for `.pr-body-gh.txt`.

## How to verify

1. `npm run build && npm run example:agent-toolhub-react-stock`
2. Open `AAPL-research-report.html` — confirm new colors and layout.
3. README: confirm "Agent Run Report" section and screenshots render on GitHub.

## Checklist

- [x] Build passes
- [x] Tests pass
- [x] Report screenshots included (`examples/report-1.png`, `examples/report-2.png`)
- [x] CI passes (npm ci --legacy-peer-deps)
