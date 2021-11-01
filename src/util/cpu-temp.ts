/**
 * @fileoverview Gets the CPU temperature.
 */

import { execFile } from "child_process";

const getCPUTempFunctionPromise: Promise<() => Promise<number>> = new Promise((res, rej) => {
	if (process.platform === "linux") {
		// Check for Raspberry Pi OS
		execFile("which", ["vcgencmd"], (err, stdout) => {
			if (err) {
				if (err.killed === false && err.code === 1) {
					rej(new TypeError("Unsupported OS."));
				} else {
					rej(err);
				}
			} else {
				const vcgencmdPath = stdout.slice(0, -1);
				res(() => new Promise((res, rej) => {
					execFile(vcgencmdPath, ["measure_temp"], (err, stdout) => {
						if (err) {
							rej(err);
						} else {
							const temp = Number.parseFloat(stdout.slice(5, -3));
							if (isNaN(temp)) {
								rej(new Error("It wasn't possible to get the temperature."));
							} else {
								res(temp);
							}
						}
					});
				}));
			}
		});
	} else {
		rej(new TypeError("Unsupported OS."));
	}
});

export async function getCPUTemp(): Promise<number> {
	return (await getCPUTempFunctionPromise)();
}
