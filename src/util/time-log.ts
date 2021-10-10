export function log(message: string, ...args: any[]): void {
	const date = new Date();
	console.log(`[${date.getUTCHours().toString().padStart(2, "0")}:${date.getUTCMinutes().toString().padStart(2, "0")}:${date.getUTCSeconds().toString().padStart(2, "0")}] ${message}`, ...args);
}
