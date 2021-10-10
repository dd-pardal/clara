async function init() {
	const usp = new URLSearchParams(location.search);
	const headless = "_pptr_sendData" in globalThis;
	const inputDeviceLabel = usp.get("inputDeviceLabel");

	let inputDeviceId;
	if (inputDeviceLabel !== undefined) {
		const devices = await navigator.mediaDevices.enumerateDevices();
		console.log(devices);
		inputDeviceId = devices.find((d) => d.kind === "audioinput" && d.label === inputDeviceLabel)?.deviceId;
		if (inputDeviceId === undefined)
			throw new TypeError("No input audio device found.");
	}

	let sendData = false;

	if (headless) {
		console.log("Headless mode");
		navigator.mediaDevices.getUserMedia({ audio: true, video: false });
		sendData = true;
	} else {
		document.getElementById("start-btn").addEventListener("click", () => {
			sendData = true;
		});
	}

	const labelContainer = document.getElementById("label-container");

	// More documentation available at
	// <https://github.com/tensorflow/tfjs-models/tree/master/speech-commands>

	// The link to this model provided by the Teachable Machine export panel
	const url = new URL("./ai-model/", window.location.href).href;

	async function createModel() {
		const checkpointURL = url + "model.json"; // Model topology
		const metadataURL = url + "metadata.json"; // Model metadata

		const recognizer = speechCommands.create(
			"BROWSER_FFT", // Fourier transform type, not useful to change
			undefined, // Speech commands vocabulary feature, not useful for this model
			checkpointURL,
			metadataURL);

		// Check that model and metadata are loaded via HTTPS requests.
		await recognizer.ensureModelLoaded();

		return recognizer;
	}

	const recognizer = await createModel();
	const classLabels = recognizer.wordLabels(); // Get class labels
	for (let i = 0; i < classLabels.length; i++) {
		labelContainer.appendChild(document.createElement("div"));
	}

	// listen() takes two arguments:
	// 1. A callback function that is invoked anytime a word is recognized
	// 2. A configuration object with adjustable fields
	recognizer.listen(result => {
		let scores = result.scores; // Probability of prediction for each class
		scores = [scores[0], scores[1], scores[2]];
	
		// Render the probability scores per class.
		for (let i = 0; i < classLabels.length; i++) {
			const classPrediction = classLabels[i] + ": " + scores[i].toFixed(2);
			labelContainer.childNodes[i].innerHTML = classPrediction;
		}

		if (sendData) {
			const data = {
				timestamp: Date.now(),
				scores
			};
			if (headless) {
				_pptr_sendData(data);
			}
		}

	}, {
		includeSpectrogram: false,
		probabilityThreshold: 0,
		invokeCallbackOnNoiseAndUnknown: true,
		overlapFactor: 0.75,
		audioTrackConstraints: inputDeviceId !== undefined ? {
			deviceId: {
				exact: inputDeviceId
			}
		} : true
	});
}
init();
