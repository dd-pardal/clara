export function formatBigInterval(totalMinutes: number): string {
	const minutes = totalMinutes % 60;
	const totalHours = Math.floor(totalMinutes / 60);
	const hours = totalHours % 24;
	const totalDays = Math.floor(totalHours / 24);

	return `${totalDays} days, ${hours} hours and ${minutes} minutes`;
}
