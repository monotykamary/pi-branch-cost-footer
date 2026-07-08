/**
 * pi-branch-cost-footer
 *
 * A pi footer extension that computes token usage and cost from the CURRENT
 * BRANCH only — ctx.sessionManager.getBranch() walks the active leaf up to the
 * root — instead of the whole session (the built-in footer sums getEntries(),
 * which includes abandoned sibling branches you forked away from in /tree).
 *
 * The layout matches the built-in footer:
 *   line 1: pwd (git-branch) • session-name
 *   line 2: ↳ ↑in ↓out R cacheRead W cacheWrite CH hit% $cost   ctx%   model
 *   line 3: extension statuses (if any)
 *
 * A leading accent "↳" marks this as the branch-scoped footer so it's easy to
 * tell apart from the default. Switch branches in /tree and watch the cost
 * change; toggle off with /branch-cost to compare with the whole-session total.
 *
 * It is on by default. /branch-cost toggles between this footer and pi's
 * built-in footer.
 *
 * Install:
 *   pi install npm:pi-branch-cost-footer
 *   pi install https://github.com/monotykamary/pi-branch-cost-footer
 *
 * Or load directly:
 *   pi -e /path/to/pi-branch-cost-footer
 *
 * @see https://github.com/monotykamary/pi-branch-cost-footer
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isAbsolute, relative, resolve, sep } from "node:path";

export default function (pi: ExtensionAPI) {
	let enabled = true;

	pi.on("session_start", (_event, ctx) => {
		if (enabled && ctx.mode === "tui") installFooter(ctx);
	});

	pi.registerCommand("branch-cost", {
		description: "Toggle branch-scoped cost footer (↳) vs default whole-session footer",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("Branch-cost footer only applies in TUI mode", "info");
				return;
			}
			enabled = !enabled;
			if (enabled) {
				installFooter(ctx);
				ctx.ui.notify("Branch-scoped footer on (↳)", "info");
			} else {
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Default footer restored", "info");
			}
		},
	});

	function installFooter(ctx: ExtensionContext) {
		ctx.ui.setFooter((tui, theme, footerData) => {
			// Re-render when the git branch changes out-of-band (e.g. `git checkout`
			// in another terminal). Session-branch switches via /tree already trigger
			// a full UI re-render, which repaints the footer reading getBranch() fresh.
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					const sm = ctx.sessionManager;

					// Branch-scoped totals: only entries on the current active branch.
					let input = 0;
					let output = 0;
					let cacheRead = 0;
					let cacheWrite = 0;
					let cost = 0;
					let latestHitRate: number | undefined;
					for (const e of sm.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const u = (e.message as AssistantMessage).usage;
							input += u.input;
							output += u.output;
							cacheRead += u.cacheRead;
							cacheWrite += u.cacheWrite;
							cost += u.cost.total;
							const prompt = u.input + u.cacheRead + u.cacheWrite;
							latestHitRate = prompt > 0 ? (u.cacheRead / prompt) * 100 : latestHitRate;
						}
					}

					// Line 1: pwd (git-branch) • session-name
					let pwd = formatCwd(sm.getCwd(), process.env.HOME || process.env.USERPROFILE);
					const gitBranch = footerData.getGitBranch();
					if (gitBranch) pwd = `${pwd} (${gitBranch})`;
					const sessionName = sm.getSessionName();
					if (sessionName) pwd = `${pwd} • ${sessionName}`;
					const line1 = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));

					// Line 2 left: ↳ ↑in ↓out R W CH% $cost   ctx%
					const statsParts: string[] = [];
					if (input) statsParts.push(`↑${formatTokens(input)}`);
					if (output) statsParts.push(`↓${formatTokens(output)}`);
					if (cacheRead) statsParts.push(`R${formatTokens(cacheRead)}`);
					if (cacheWrite) statsParts.push(`W${formatTokens(cacheWrite)}`);
					if ((cacheRead > 0 || cacheWrite > 0) && latestHitRate !== undefined) {
						statsParts.push(`CH${latestHitRate.toFixed(1)}%`);
					}
					const usingSub = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
					if (cost || usingSub) {
						statsParts.push(`$${cost.toFixed(3)}${usingSub ? " (sub)" : ""}`);
					}
					const statsText = statsParts.join(" ");

					const cu = ctx.getContextUsage();
					const window = cu?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const pct = cu?.percent;
					const ctxDisplay =
						pct === null || pct === undefined
							? `?/${formatTokens(window)}`
							: `${pct.toFixed(1)}%/${formatTokens(window)}`;
					const ctxStr =
						pct != null && pct > 90
							? theme.fg("error", ctxDisplay)
							: pct != null && pct > 70
								? theme.fg("warning", ctxDisplay)
								: theme.fg("dim", ctxDisplay);

					// Each segment themed independently (no outer dim wrap) so ANSI
					// resets don't clear neighboring colors.
					const leftParts: string[] = [theme.fg("accent", "↳")];
					if (statsText) leftParts.push(theme.fg("dim", statsText));
					leftParts.push(ctxStr);
					const left = leftParts.join(" ");
					const leftVis = visibleWidth(left);

					// Line 2 right: model with a thinking-level suffix when the model
					// supports reasoning, prefixed with (provider) when several
					// providers are available. The active thinking level lives on the
					// ExtensionAPI (pi.getThinkingLevel()), not on ctx, so read it
					// fresh per render. The TUI already re-renders on thinking/model
					// changes (its editor-border update calls requestRender), so this
					// keeps the suffix live without an extra event subscription.
					const minPad = 2;
					let rightSide = ctx.model?.id || "no-model";
					if (ctx.model?.reasoning) {
						const thinkingLevel = pi.getThinkingLevel() || "off";
						rightSide =
							thinkingLevel === "off"
								? `${rightSide} • thinking off`
								: `${rightSide} • ${thinkingLevel}`;
					}
					if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
						const withProvider = `(${ctx.model.provider}) ${rightSide}`;
						if (leftVis + minPad + visibleWidth(withProvider) <= width) rightSide = withProvider;
					}
					const right = theme.fg("dim", rightSide);
					const rightVis = visibleWidth(right);

					let line2: string;
					if (leftVis > width) {
						line2 = truncateToWidth(left, width, "...");
					} else if (leftVis + minPad + rightVis <= width) {
						line2 = left + " ".repeat(width - leftVis - rightVis) + right;
					} else {
						const availRight = width - leftVis - minPad;
						if (availRight > 0) {
							const right2 = truncateToWidth(right, availRight, "");
							line2 = left + " ".repeat(Math.max(0, width - leftVis - visibleWidth(right2))) + right2;
						} else {
							line2 = left;
						}
					}

					const lines = [line1, line2];

					// Line 3: extension statuses, sorted by key.
					const statuses = footerData.getExtensionStatuses();
					if (statuses.size > 0) {
						const statusLine = Array.from(statuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, t]) => sanitizeStatusText(t))
							.join(" ");
						lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
					}

					return lines;
				},
			};
		});
	}
}

// Replicated from pi's built-in footer so this stays a faithful replacement.

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function formatCwd(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const rel = relative(resolvedHome, resolvedCwd);
	const inside =
		rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
	if (!inside) return cwd;
	return rel === "" ? "~" : `~${sep}${rel}`;
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}
