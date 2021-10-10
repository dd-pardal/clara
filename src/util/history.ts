/**
 * A data structure similar to a FIFO queue, in which a newly added item overrides the oldest one if it's full.
 */
export default class History<T> {
	public readonly array: T[];
	public pointer = -1;
	public full = false;

	constructor(public maxSize: number) {
		this.array = new Array(maxSize);
	}

	add(item: T): void {
		this.pointer++;
		if (this.pointer >= this.maxSize) {
			this.pointer -= this.maxSize;
			this.full = true;
		}
		this.array[this.pointer] = item;
	}

	getNewest(): T {
		return this.array[this.pointer];
	}

	/**
	 * Returns an iterator that iterates through all of the items, from the newest to the oldest.
	 * @returns The iterator
	 */
	[Symbol.iterator](): Iterator<T, void> {
		let i = this.pointer;
		let firstTime = true;
		return {
			next: () => {
				if (!(i in this.array) || i === this.pointer && !firstTime) {
					return { done: true, value: undefined };
				} else {
					firstTime = false;

					const value = this.array[i];
					i = i>0 ? i-1 : this.maxSize-1;
					return { done: false, value };
				}
			}
		};
	}
}
