import { describe, expect, it, vi, beforeEach } from "vitest";

// Each test gets a fresh module so the extension's module-level `enabled` flag
// (toggled by the /branch-cost command) doesn't leak between tests.
beforeEach(() => {
	vi.resetModules();
});

type Entry = {
	type: "message";
	message: { role: "assistant"; usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } } };
};

type Model = { id: string; provider: string; contextWindow: number };

type FooterObj = {
	render(width: number): string[];
	invalidate(): void;
	dispose?: () => void;
};

interface MountOpts {
	branch?: Entry[];
	model?: Model | null;
	sessionName?: string | null;
	gitBranch?: string | null;
	providerCount?: number;
	contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null } | null;
	statuses?: [string, string][];
	usingOAuth?: boolean;
}

// Mutable harness state, returned by reference so tests observe live changes
// (e.g. requestRender calls after firing onBranchChange).
interface HarnessState {
	requestRender: ReturnType<typeof vi.fn>;
	onBranchChangeCb: (() => void) | null;
	setFooterCalls: any[];
}

interface MountResult {
	footer: FooterObj;
	ctx: any;
	command: { name: string; description: string; handler: (args: any, ctx: any) => Promise<void> | void };
	state: HarnessState;
	dispose: () => void;
}

// A plain theme: returns text as-is so widths equal string lengths and substring
// assertions are straightforward. The real extension colors each segment; the
// stub mirrors the visible layout exactly.
const theme = { fg: (_c: string, t: string) => t, bg: (_c: string, t: string) => t, bold: (t: string) => t };

async function mount(opts: MountOpts = {}): Promise<MountResult> {
	const mod = await import("../index");
	const factory = mod.default;

	const sessionStartHandlers: ((e: any, ctx: any) => void)[] = [];
	let command: any = null;
	const pi: any = {
		on: (ev: string, fn: any) => {
			if (ev === "session_start") sessionStartHandlers.push(fn);
		},
		registerCommand: (name: string, def: any) => {
			command = { name, ...def };
		},
	};
	factory(pi);

	const state: HarnessState = {
		requestRender: vi.fn(),
		onBranchChangeCb: null,
		setFooterCalls: [],
	};
	const tui = { requestRender: state.requestRender };
	const footerData = {
		getGitBranch: () => opts.gitBranch ?? null,
		getExtensionStatuses: () => new Map(opts.statuses ?? []),
		getAvailableProviderCount: () => opts.providerCount ?? 1,
		onBranchChange: (cb: () => void) => {
			state.onBranchChangeCb = cb;
			return () => {
				if (state.onBranchChangeCb === cb) state.onBranchChangeCb = null;
			};
		},
	};

	const ctx: any = {
		mode: "tui",
		model:
			opts.model === undefined
				? { id: "anthropic/claude-3-5-sonnet", provider: "anthropic", contextWindow: 200000 }
				: opts.model,
		modelRegistry: { isUsingOAuth: () => opts.usingOAuth ?? false },
		sessionManager: {
			getBranch: () => opts.branch ?? [],
			getCwd: () => "/home/user/projects/my-app",
			getSessionName: () => opts.sessionName ?? null,
		},
		getContextUsage: () =>
			opts.contextUsage === undefined ? { tokens: 16600, contextWindow: 200000, percent: 8.3 } : opts.contextUsage,
		ui: {
			setFooter: (factory: any) => {
				state.setFooterCalls.push(factory);
			},
			notify: () => {},
		},
	};

	// Drive session_start, capturing the factory pi receives and invoking it the
	// way the TUI would (with stub tui/theme/footerData) to get the footer object.
	let footer: FooterObj = { render: () => [], invalidate: () => {} };
	ctx.ui.setFooter = (factory: any) => {
		state.setFooterCalls.push(factory);
		footer = factory(tui, theme, footerData);
	};

	for (const h of sessionStartHandlers) h({ type: "session_start" }, ctx);

	return { footer, ctx, command, state, dispose: () => footer.dispose?.() };
}

function assistant(
	u: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number; total: number }> = {},
): Entry {
	return {
		type: "message",
		message: {
			role: "assistant",
			usage: {
				input: u.input ?? 100,
				output: u.output ?? 50,
				cacheRead: u.cacheRead ?? 0,
				cacheWrite: u.cacheWrite ?? 0,
				cost: { total: u.total ?? 0.001 },
			},
		},
	};
}

describe("pi-branch-cost-footer", () => {
	it("sums token usage and cost from the current branch only", async () => {
		const { footer } = await mount({
			branch: [
				assistant({ input: 1200, output: 800, cacheRead: 5000, cacheWrite: 3000, total: 0.012 }),
				assistant({ input: 3000, output: 1200, cacheRead: 9000, cacheWrite: 1000, total: 0.045 }),
			],
			sessionName: "cost-test",
			gitBranch: "feature/x",
		});

		const lines = footer.render(120);
		expect(lines.length).toBeGreaterThanOrEqual(2);

		// Branch-scoped cost: 0.012 + 0.045 = 0.057
		expect(lines[1]).toContain("$0.057");
		// Token totals: input 4200, output 2000, cacheRead 14000, cacheWrite 4000
		expect(lines[1]).toContain("↑4.2k");
		expect(lines[1]).toContain("↓2.0k");
		expect(lines[1]).toContain("R14k");
		expect(lines[1]).toContain("W4.0k");
		// Latest hit rate: cacheRead 9000 / (input 3000 + read 9000 + write 1000) = 69.2%
		expect(lines[1]).toContain("CH69.2%");
	});

	it("marks the branch-scoped footer with ↳ and shows git branch + session name on line 1", async () => {
		const { footer } = await mount({ sessionName: "cost-test", gitBranch: "feature/x" });
		const lines = footer.render(120);
		expect(lines[1]).toContain("↳");
		expect(lines[0]).toContain("feature/x");
		expect(lines[0]).toContain("cost-test");
	});

	it("prefixes the model with (provider) when multiple providers are available", async () => {
		const { footer } = await mount({ providerCount: 2 });
		const lines = footer.render(140);
		expect(lines[1]).toContain("(anthropic) anthropic/claude-3-5-sonnet");
	});

	it("omits the provider prefix when only one provider is available", async () => {
		const { footer } = await mount({ providerCount: 1 });
		const lines = footer.render(140);
		expect(lines[1]).not.toContain("(anthropic)");
		expect(lines[1]).toContain("anthropic/claude-3-5-sonnet");
	});

	it("hides the cost segment on an empty branch and never throws", async () => {
		const { footer } = await mount({ branch: [], sessionName: null, gitBranch: null });
		const lines = footer.render(80);
		expect(lines.length).toBeGreaterThanOrEqual(2);
		expect(lines[1]).not.toContain("$");
		expect(lines[1]).not.toMatch(/↑|↓/);
	});

	it("renders context usage as percent/window, and ?/window when unknown", async () => {
		const known = await mount({ contextUsage: { tokens: 180000, contextWindow: 200000, percent: 90.0 } });
		expect(known.footer.render(120)[1]).toContain("90.0%/200k");

		const unknown = await mount({ contextUsage: { tokens: null, contextWindow: 200000, percent: null } });
		expect(unknown.footer.render(120)[1]).toContain("?/200k");
	});

	it("renders extension statuses on line 3, sorted by key", async () => {
		const { footer } = await mount({ statuses: [["zeta", "z!"], ["alpha", "a!"]] });
		const lines = footer.render(120);
		expect(lines.length).toBe(3);
		expect(lines[2]).toBe("a! z!");
	});

	it("never exceeds the terminal width, even when very narrow", async () => {
		const { footer } = await mount({
			branch: [
				assistant({ input: 1200, output: 800, cacheRead: 5000, cacheWrite: 3000, total: 0.012 }),
				assistant({ input: 3000, output: 1200, cacheRead: 9000, cacheWrite: 1000, total: 0.045 }),
			],
			sessionName: "a-very-long-session-name-that-takes-space",
			gitBranch: "feature/a-really-long-branch-name",
		});
		for (const w of [120, 80, 60, 40, 20, 10, 5, 1]) {
			const lines = footer.render(w);
			for (const line of lines) {
				// Plain theme ⇒ string length == visible width.
				expect(line.length).toBeLessThanOrEqual(w);
			}
		}
	});

	it("subscribes to git branch changes and disposes the subscription", async () => {
		const { state, dispose } = await mount();
		expect(state.onBranchChangeCb).not.toBeNull();
		state.onBranchChangeCb!();
		expect(state.requestRender).toHaveBeenCalledTimes(1);

		dispose();
		// After dispose, the callback is cleared — firing it again is a no-op.
		const before = state.requestRender.mock.calls.length;
		state.onBranchChangeCb?.();
		expect(state.requestRender.mock.calls.length).toBe(before);
		expect(state.onBranchChangeCb).toBeNull();
	});

	it("toggles off via /branch-cost (setFooter(undefined)) and back on", async () => {
		const { ctx, command } = await mount();
		// session_start already installed the footer once.
		expect(command.name).toBe("branch-cost");

		const offCalls: any[] = [];
		ctx.ui.setFooter = (arg: any) => offCalls.push(arg);
		await command.handler([], ctx);
		expect(offCalls).toEqual([undefined]);

		const onCalls: any[] = [];
		ctx.ui.setFooter = (arg: any) => onCalls.push(arg);
		await command.handler([], ctx);
		expect(onCalls).toHaveLength(1);
		expect(typeof onCalls[0]).toBe("function");
	});

	it("does not install the footer outside TUI mode", async () => {
		const mod = await import("../index");
		const factory = mod.default;
		const handlers: ((e: any, ctx: any) => void)[] = [];
		factory({ on: (_ev: string, fn: any) => handlers.push(fn), registerCommand: () => {} } as any);
		const setFooter = vi.fn();
		await handlers[0]({ type: "session_start" }, { mode: "json", ui: { setFooter } } as any);
		expect(setFooter).not.toHaveBeenCalled();
	});

	it("appends (sub) to cost when the active model is an OAuth subscription", async () => {
		const { footer } = await mount({ branch: [assistant({ total: 0.01 })], usingOAuth: true });
		expect(footer.render(120)[1]).toContain("$0.010 (sub)");
	});
});
