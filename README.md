<div align="center">

# ↳ pi-branch-cost-footer

**Branch-scoped cost & token usage in the [pi](https://github.com/earendil-works/pi-coding-agent) footer**

_The footer that follows you down the branch — not the whole session._

[![pi extension](https://img.shields.io/badge/pi-extension-blueviolet)](https://github.com/earendil-works/pi-coding-agent)
[![pi package](https://img.shields.io/badge/pi-package-ff69b4)](https://github.com/earendil-works/pi-coding-agent)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

</div>

---

pi's built-in footer shows **whole-session** token usage and cost — it sums every entry in the JSONL tree, including the sibling branches you forked away from in `/tree`. If you explore three approaches from the same turn, the footer keeps quietly adding all three into one ballooning `$` figure.

This extension replaces that footer with one that sums **only the current branch** — `ctx.sessionManager.getBranch()` walks the active leaf up to the root — so the cost reflects the path you're actually on. Jump between branches in `/tree` and the numbers update to match.

```
~/projects/my-app (feature/auth) • refactor-oauth
↳ ↑12.4k ↓3.1k R48k W2.0k CH94.2% $0.0421 8.3%/200k          (anthropic) anthropic/claude-3-5-sonnet
```

The leading `↳` marks this as the branch-scoped footer, so you can always tell it apart from the default at a glance. Toggle it off with `/branch-cost` to compare against the whole-session total.

## Why

pi sessions are a **tree**, not a list. Every `/fork` and every `/tree` jump leaves the old path intact in the file. The built-in footer is honest about that — it reports the whole tree — but when you're heads-down on one branch, "how much has *this* line of work cost?" is the question you actually want answered.

`pi-branch-cost-footer` answers it. It's a drop-in: zero config, on by default, and a faithful replica of the built-in footer — only the accounting scope changes.

```
# /tree — jump from feature/auth to feature/payments
~/projects/my-app (feature/payments) • refactor-oauth
↳ ↑5.1k ↓0.9k R22k W1.0k CH91.7% $0.0113 2.6%/200k          (anthropic) anthropic/claude-3-5-sonnet
```

Same session file — different branch, different cost.

## Features

- **Branch-scoped totals** — input, output, cache-read, cache-write, cache-hit rate, and `$` cost all sum from the active branch only.
- **Faithful layout** — matches the built-in footer: `pwd (git-branch) • session-name` on line 1, the stats line on line 2, extension statuses on line 3 when present.
- **Live on branch switches** — re-renders when you navigate in `/tree`; subscribes to out-of-band git branch changes too.
- **Context usage** — `ctx%/window` with the same warning/error color thresholds as the built-in footer; `?/window` while unknown (e.g. right after compaction).
- **Multi-provider aware** — prefixes the model with `(provider)` when more than one provider is available, like the built-in footer.
- **Subscription-aware** — appends `(sub)` to cost when the active model is an OAuth subscription.
- **Toggle** — `/branch-cost` switches between this footer and pi's default, so you can compare side by side.
- **Zero config** — on by default; nothing to set up.

## The footer line

| Segment | Meaning |
|---------|---------|
| `↳` | Marks this as the branch-scoped footer (accent-colored) |
| `↑` | Cumulative input tokens on this branch |
| `↓` | Cumulative output tokens on this branch |
| `R` | Cumulative cache-read tokens on this branch |
| `W` | Cumulative cache-write tokens on this branch |
| `CH` | Latest cache-hit rate |
| `$` | Cumulative cost on this branch (` (sub)` if on an OAuth subscription) |
| `x%/window` | Context usage, colored when high; `?/window` while unknown |
| `(provider) model` | Active model, prefixed with provider when several are available |

Segments are omitted when zero (matching the built-in footer), so a fresh branch with no assistant turns shows just `↳`, the context %, and the model.

## Installation

### Option 1: `pi install` (recommended)

```bash
pi install npm:pi-branch-cost-footer
```

Or install directly from GitHub:

```bash
pi install https://github.com/monotykamary/pi-branch-cost-footer
```

### Option 2: manual

```bash
git clone git@github.com:monotykamary/pi-branch-cost-footer.git
pi -e /path/to/pi-branch-cost-footer
```

### Option 3: project-local

To enable it for a single project (not globally), install it locally and trust the project:

```bash
pi install -l https://github.com/monotykamary/pi-branch-cost-footer
```

## Usage

Once installed and pi is running in a trusted project, the branch-scoped footer is active automatically.

- **Switch branches** — open `/tree`, navigate to any point, and continue. The footer recomputes from the new active branch on the next render.
- **Compare with the default** — run `/branch-cost` to restore pi's built-in whole-session footer; run it again to come back. A notification confirms each switch.

### How branch scope is computed

`ctx.sessionManager.getBranch()` returns the entries from the current leaf up to the root — the active path. The extension walks those entries and sums `usage.input`, `usage.output`, `usage.cacheRead`, `usage.cacheWrite`, and `usage.cost.total` from every assistant message. Entries on abandoned sibling branches are never counted.

Because `getBranch()` is root → leaf, **shared ancestors count toward every branch that descends from them**. If you branch off a turn that already cost `$5`, the new branch starts at `$5` — that's "cumulative on the branch," the same accounting `/session`-style tools usually intend.

## Compatibility

This is a near-perfect replica of the built-in footer with one deliberate difference (the scope) and two cosmetic omissions caused by what's reachable from the footer context:

- The model's `• thinking X` suffix is omitted — the active thinking level isn't exposed on `ctx` from inside `setFooter`.
- The ` (auto)` tag on context % is omitted — the auto-compact setting isn't reachable from the footer context.

The branch-scoped cost and token totals are exact.

## Development

```bash
pnpm install
pnpm test          # vitest
pnpm lint:dead     # knip
```

The extension is loaded by pi as TypeScript directly (no build step). Tests stub `@earendil-works/pi-tui` and drive the footer with a plain theme to exercise the layout and accounting logic. `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` are type-only imports, erased at runtime and provided by pi itself.

## License

MIT
