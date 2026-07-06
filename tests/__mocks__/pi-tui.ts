const ANSI = /\x1b\][^\x07]*\x07|\x1b\[[0-9;?]*[a-zA-Z]/g;

function stripAnsi(str: string): string {
	return str.replace(ANSI, "");
}

export function visibleWidth(str: string): number {
	return stripAnsi(str).length;
}

export function truncateToWidth(str: string, width: number, ellipsis: string = ""): string {
	const visible = stripAnsi(str);
	if (visible.length <= width) return str;
	const e = ellipsis ?? "";
	// Match pi-tui: the result never exceeds `width`, even if the ellipsis
	// itself is longer than the available space (truncate the ellipsis too).
	if (e.length >= width) return e.slice(0, width);
	const keep = Math.max(0, width - e.length);
	return visible.slice(0, keep) + e;
}
