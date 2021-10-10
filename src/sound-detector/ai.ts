/**
 * @fileoverview Definitions for the sound detector's machine learning model.
 */

export enum Class {
	THIS_IS_NORMAL = 0,
	SILENCE = 1,
	SOUND = 2
}
export const NUM_CLASSES = 3;
export type Scores = { [key in Class]: number };
export interface Data {
	timestamp: number;
	scores: Scores;
}

export function	getMaxScore(scores: Scores): { class: Class; score: number; } {
	let max = -Infinity, maxClass: Class;
	for (let i: Class = 0; i < NUM_CLASSES; i++) {
		const score = scores[i];
		if (score > max) {
			max = score;
			maxClass = i;
		}
	}
	// Each score is bigger than `-Infinity`, so `maxClass` can't be unitialized.
	return {
		class: maxClass!,
		score: max
	};
}
