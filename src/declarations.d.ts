/**
 * @fileoverview Patches for TypeScript's built-in type declarations.
 */

declare namespace Intl {
	class ListFormat {
		constructor(locales?: string | string[], options?: { localeMatcher?: "best fit" | "lookup"; type?: "conjunction" | "disjunction"; style?: "long" | "short" | "c"; })
		public format: (items: string[]) => string;
	}
}

declare function clearTimeout(timeoutId: NodeJS.Timeout | null | undefined): void;
declare function clearInterval(intervalId: NodeJS.Timeout | null | undefined): void;
