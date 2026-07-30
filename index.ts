/**
 * pi-branch-cost-footer
 *
 * Makes pi's built-in footer calculate cumulative usage from the current branch
 * instead of the whole session. The built-in FooterComponent still owns all
 * rendering, formatting, state, and future footer features.
 */

import { FooterComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

type FooterRender = typeof FooterComponent.prototype.render;

type FooterInternals = {
	session: {
		sessionManager: {
			getBranch(): unknown[];
			getEntries(): unknown[];
		};
	};
};

type PatchState = {
	enabled: boolean;
	owner: symbol;
	originalRender: FooterRender;
};

const patchKey = Symbol.for("pi-branch-cost-footer.patch");
const patchRegistry = globalThis as typeof globalThis & {
	[key: symbol]: PatchState | undefined;
};

export default function (pi: ExtensionAPI) {
	const owner = Symbol("pi-branch-cost-footer.owner");
	let enabled = true;

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode === "tui") installPatch(owner);
	});

	pi.on("session_shutdown", () => {
		uninstallPatch(owner);
	});

	pi.registerCommand("branch-cost", {
		description: "Toggle branch-scoped vs whole-session footer usage",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("Branch-cost footer only applies in TUI mode", "info");
				return;
			}

			enabled = !enabled;
			const patch = installPatch(owner);
			patch.enabled = enabled;

			// The built-in footer is already mounted. Re-setting it asks pi to render
			// immediately, without introducing a custom footer implementation.
			ctx.ui.setFooter(undefined);
			ctx.ui.notify(enabled ? "Branch-scoped footer on" : "Whole-session footer restored", "info");
		},
	});
}

function installPatch(owner: symbol): PatchState {
	const installed = patchRegistry[patchKey];
	if (installed) {
		installed.owner = owner;
		return installed;
	}

	const originalRender = FooterComponent.prototype.render;
	const patch: PatchState = { enabled: true, owner, originalRender };

	FooterComponent.prototype.render = function renderBranchScoped(width: number): string[] {
		const current = patchRegistry[patchKey];
		if (!current?.enabled) return originalRender.call(this, width);

		const footer = this as unknown as FooterInternals;
		const sessionManager = footer.session.sessionManager;
		const getEntries = sessionManager.getEntries;

		// Core's footer reads getEntries() only while calculating cumulative usage.
		// Swap that source for the synchronous duration of render(), then restore it
		// so no other pi behavior becomes branch-scoped.
		sessionManager.getEntries = sessionManager.getBranch.bind(sessionManager);
		try {
			return originalRender.call(this, width);
		} finally {
			sessionManager.getEntries = getEntries;
		}
	};

	patchRegistry[patchKey] = patch;
	return patch;
}

function uninstallPatch(owner: symbol): void {
	const patch = patchRegistry[patchKey];
	if (!patch || patch.owner !== owner) return;

	FooterComponent.prototype.render = patch.originalRender;
	delete patchRegistry[patchKey];
}
