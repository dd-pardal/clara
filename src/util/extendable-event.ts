export function createExtendableEvent(): {
	waitUntil: (promise: Promise<void>) => void;
	done: () => Promise<void>;
} { // eslint-disable-line indent
	const promises: Promise<void>[] = [];
	let done = false;
	return {
		waitUntil: (promise: Promise<void>) => {
			if (done) {
				throw new Error("Caling `waitUntil()` outside of the event handler is not allowed.");
			}
			promises.push(promise);
		},
		done: async () => {
			done = true;
			await Promise.allSettled(promises);
		}
	};
}
