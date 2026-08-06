import { FooterComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const patchKey = Symbol.for("pi-branch-cost-footer.patch");

type UsageData = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } };
type Entry =
	| { type: "message"; message: { role: "assistant"; usage: UsageData } }
	| { type: "message"; message: { role: "toolResult"; usage?: UsageData } }
	| { type: "compaction" | "branch_summary"; usage?: UsageData };

type Model = { id: string; provider: string; contextWindow: number; reasoning?: boolean };
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface MountOpts {
	branch?: Entry[];
	entries?: Entry[];
	model?: Model | null;
	sessionName?: string | null;
	gitBranch?: string | null;
	providerCount?: number;
	contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
	statuses?: [string, string][];
	usingOAuth?: boolean;
	thinkingLevel?: ThinkingLevel;
	autoCompact?: boolean;
}

interface MountResult {
	footer: FooterComponent;
	ctx: any;
	command: { name: string; handler: (args: string, ctx: any) => Promise<void> };
	setThinkingLevel(level: ThinkingLevel): void;
	shutdown(): Promise<void>;
}

const mounted: MountResult[] = [];

beforeAll(() => {
	initTheme("dark", false);
});

beforeEach(() => {
	const registry = globalThis as any;
	const patch = registry[patchKey];
	if (patch) {
		FooterComponent.prototype.render = patch.originalRender;
		delete registry[patchKey];
	}
	vi.resetModules();
});

afterEach(async () => {
	await Promise.all(mounted.splice(0).map((item) => item.shutdown()));
});

async function mount(opts: MountOpts = {}): Promise<MountResult> {
	const { default: extension } = await import("../index");
	const sessionStartHandlers: Array<(event: any, ctx: any) => void | Promise<void>> = [];
	const sessionShutdownHandlers: Array<(event: any, ctx: any) => void | Promise<void>> = [];
	let command: MountResult["command"] | undefined;
	let thinkingLevel = opts.thinkingLevel ?? "off";

	const pi: any = {
		on: (event: string, handler: any) => {
			if (event === "session_start") sessionStartHandlers.push(handler);
			if (event === "session_shutdown") sessionShutdownHandlers.push(handler);
		},
		registerCommand: (name: string, definition: any) => {
			command = { name, ...definition };
		},
		getThinkingLevel: () => thinkingLevel,
	};
	extension(pi);

	const model =
		opts.model === undefined
			? { id: "anthropic/claude-sonnet-4", provider: "anthropic", contextWindow: 200000, reasoning: true }
			: opts.model;
	const branch = opts.branch ?? [];
	const entries = opts.entries ?? branch;
	const sessionManager = {
		getEntries: () => entries,
		getBranch: () => branch,
		getCwd: () => "/home/user/projects/my-app",
		getSessionName: () => opts.sessionName ?? null,
	};
	const footerData = {
		getGitBranch: () => opts.gitBranch ?? null,
		getExtensionStatuses: () => new Map(opts.statuses ?? []),
		getAvailableProviderCount: () => opts.providerCount ?? 1,
	};
	const session = {
		get state() {
			return { model, thinkingLevel };
		},
		sessionManager,
		getContextUsage: () =>
			opts.contextUsage ?? { tokens: 16600, contextWindow: model?.contextWindow ?? 0, percent: 8.3 },
		modelRuntime: {
			isUsingOAuth: () => opts.usingOAuth ?? false,
			isUsingSubscription: () => opts.usingOAuth ?? false,
		},
	};
	const footer = new FooterComponent(session as any, footerData as any);
	footer.setAutoCompactEnabled(opts.autoCompact ?? true);

	const setFooter = vi.fn();
	const ctx: any = {
		mode: "tui",
		model,
		modelRegistry: { isUsingOAuth: () => opts.usingOAuth ?? false },
		sessionManager,
		getContextUsage: session.getContextUsage,
		ui: { setFooter, notify: vi.fn() },
	};
	for (const handler of sessionStartHandlers) await handler({ type: "session_start" }, ctx);

	const result: MountResult = {
		footer,
		ctx,
		command: command!,
		setThinkingLevel: (level) => {
			thinkingLevel = level;
		},
		shutdown: async () => {
			for (const handler of sessionShutdownHandlers) await handler({ type: "session_shutdown" }, ctx);
		},
	};
	mounted.push(result);
	return result;
}

function usage(input: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number; total: number }> = {}): UsageData {
	return {
		input: input.input ?? 100,
		output: input.output ?? 50,
		cacheRead: input.cacheRead ?? 0,
		cacheWrite: input.cacheWrite ?? 0,
		cost: { total: input.total ?? 0.001 },
	};
}

function assistant(input: Parameters<typeof usage>[0] = {}): Entry {
	return { type: "message", message: { role: "assistant", usage: usage(input) } };
}

function toolResult(input: Parameters<typeof usage>[0] = {}): Entry {
	return { type: "message", message: { role: "toolResult", usage: usage(input) } };
}

function summary(type: "compaction" | "branch_summary", input: Parameters<typeof usage>[0] = {}): Entry {
	return { type, usage: usage(input) };
}

describe("pi-branch-cost-footer", () => {
	it("uses the current branch as the built-in footer's cumulative usage source", async () => {
		const shared = assistant({ input: 1200, output: 800, total: 0.012 });
		const active = assistant({ input: 3000, output: 1200, cacheRead: 9000, cacheWrite: 1000, total: 0.045 });
		const abandoned = assistant({ input: 50000, output: 20000, total: 4 });
		const { footer } = await mount({ branch: [shared, active], entries: [shared, abandoned, active] });

		const line = footer.render(140)[1];
		expect(line).toContain("↑4.2k");
		expect(line).toContain("↓2.0k");
		expect(line).toContain("$0.057");
		expect(line).not.toContain("$4.057");
	});

	it("lets pi core account for tools, compactions, and branch summaries", async () => {
		const { footer } = await mount({
			branch: [
				assistant({ input: 1000, output: 200, total: 0.01 }),
				toolResult({ input: 2000, output: 300, cacheRead: 4000, total: 0.02 }),
				summary("compaction", { input: 3000, output: 400, total: 0.03 }),
				summary("branch_summary", { input: 4000, output: 500, cacheWrite: 1000, total: 0.04 }),
			],
		});
		const line = footer.render(140)[1];
		expect(line).toContain("↑10k");
		expect(line).toContain("↓1.4k");
		expect(line).toContain("R4.0k");
		expect(line).toContain("W1.0k");
		expect(line).toContain("$0.100");
	});

	it("inherits pi's auto-compaction, cwd, git branch, and session-name rendering", async () => {
		const { footer } = await mount({ gitBranch: "feature/x", sessionName: "cost-test", autoCompact: true });
		const lines = footer.render(140);
		expect(lines[0]).toContain("feature/x");
		expect(lines[0]).toContain("cost-test");
		expect(lines[1]).toContain("8.3%/200k (auto)");
	});

	it("inherits provider, subscription, and thinking-level rendering", async () => {
		const { footer, setThinkingLevel } = await mount({
			branch: [assistant({ total: 0.01 })],
			providerCount: 2,
			usingOAuth: true,
			thinkingLevel: "high",
		});
		let line = footer.render(160)[1];
		expect(line).toContain("$0.010 (sub)");
		expect(line).toContain("(anthropic) anthropic/claude-sonnet-4 • high");
		setThinkingLevel("off");
		line = footer.render(160)[1];
		expect(line).toContain("• thinking off");
	});

	it("inherits extension-status ordering and sanitization", async () => {
		const { footer } = await mount({ statuses: [["zeta", "z!"], ["alpha", " a!\nnext "]] });
		expect(footer.render(140)[2]).toBe("a! next z!");
	});

	it("inherits core's width constraints", async () => {
		const { footer } = await mount({
			branch: [assistant({ input: 12000, output: 8000, cacheRead: 50000, cacheWrite: 3000, total: 0.12 })],
			sessionName: "a-very-long-session-name",
			gitBranch: "feature/a-really-long-branch-name",
		});
		for (const width of [120, 80, 40, 20, 5, 1]) {
			for (const line of footer.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("restores whole-session accounting when toggled off", async () => {
		const active = assistant({ total: 0.01 });
		const abandoned = assistant({ total: 1 });
		const { footer, command, ctx } = await mount({ branch: [active], entries: [active, abandoned] });
		expect(footer.render(140)[1]).toContain("$0.010");

		await command.handler("", ctx);
		expect(footer.render(140)[1]).toContain("$1.010");
		expect(ctx.ui.setFooter).toHaveBeenCalledWith(undefined);

		await command.handler("", ctx);
		expect(footer.render(140)[1]).toContain("$0.010");
	});

	it("does not patch the footer outside TUI mode", async () => {
		const { default: extension } = await import("../index");
		const handlers: Array<(event: any, ctx: any) => void> = [];
		extension({ on: (event: string, handler: any) => event === "session_start" && handlers.push(handler), registerCommand: () => {} } as any);
		const before = FooterComponent.prototype.render;
		handlers[0]({ type: "session_start" }, { mode: "json" });
		expect(FooterComponent.prototype.render).toBe(before);
	});

	it("restores FooterComponent on session shutdown", async () => {
		const before = FooterComponent.prototype.render;
		const result = await mount();
		expect(FooterComponent.prototype.render).not.toBe(before);
		await result.shutdown();
		expect(FooterComponent.prototype.render).toBe(before);
	});
});
