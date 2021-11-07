function pad(n: number) {
	return n.toString().padStart(2, "0");
}

export function formatDateTimeAsISO8601Basic(date: Date): string {
	return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function formatUTCTimeDownToSeconds(date: Date): string {
	return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}
