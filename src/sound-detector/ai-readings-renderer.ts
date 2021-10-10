/**
 * @fileoverview Renders a visual representation of the history of raw readings from the sound detection algorithm
 */

import { Readable } from "stream";

import Canvas from "canvas";
import * as AI from "./ai.js";

export function renderAIReadings(history: import("../util/history.js").default<AI.Data>): Readable {
	const canvas = Canvas.createCanvas(750, 20);
	const ctx = canvas.getContext("2d", { alpha: false });

	let x = 750 - 1;

	for (const { scores } of history) {
		ctx.fillStyle = "#e0ca00";
		const a = Math.round(scores[AI.Class.THIS_IS_NORMAL] * 20);
		ctx.fillRect(x, 0, 1, a);

		ctx.fillStyle = "#ff0000";
		const b = Math.round((scores[AI.Class.THIS_IS_NORMAL] + scores[AI.Class.SOUND]) * 20);
		ctx.fillRect(x, a, 1, b - a);

		ctx.fillStyle = "#00ff00";
		ctx.fillRect(x, b, 1, 20 - b);
		x--;
		if (x < 0)
			break;
	}

	return canvas.createPNGStream();
}
