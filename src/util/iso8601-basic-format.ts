function pad(n: number) {
	return n.toString().padStart(2, "0");
}

export function formatDateAsISO8601Basic(date: Date): string {
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${date.getMinutes()}${date.getSeconds()}Z`;
}
