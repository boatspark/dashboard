export function manageFullscreen(
	report: (message: string) => void,
	changed: (fullscreen: boolean) => void
) {
	let lock: WakeLockSentinel | null = null;
	let requesting = false;
	let stopped = false;
	let generation = 0;
	let retriedRelease = false;
	async function update() {
		const fullscreen = !!document.fullscreenElement;
		changed(fullscreen);
		if (!fullscreen || document.visibilityState !== 'visible' || stopped) {
			generation++;
			const prior = lock;
			lock = null;
			if (prior) {
				try {
					await prior.release();
				} catch {
					report('Screen Wake Lock could not be released');
				}
			}
			return;
		}
		if (!('wakeLock' in navigator)) {
			report('Screen Wake Lock is unavailable in this browser');
			return;
		}
		if (lock || requesting) return;
		requesting = true;
		const requestedGeneration = generation;
		try {
			const acquired = await navigator.wakeLock.request('screen');
			if (
				stopped ||
				!document.fullscreenElement ||
				document.visibilityState !== 'visible' ||
				requestedGeneration !== generation
			) {
				await acquired.release();
				return;
			}
			lock = acquired;
			report('');
			acquired.addEventListener('release', () => {
				if (lock !== acquired) return;
				lock = null;
				report('Screen Wake Lock was released');
				if (
					!retriedRelease &&
					!stopped &&
					document.fullscreenElement &&
					document.visibilityState === 'visible'
				) {
					retriedRelease = true;
					queueMicrotask(() => {
						void update();
					});
				}
			});
		} catch {
			report('Screen Wake Lock was denied or is unavailable');
		} finally {
			requesting = false;
		}
	}
	function resumed() {
		retriedRelease = false;
		void update();
	}
	document.addEventListener('fullscreenchange', resumed);
	document.addEventListener('visibilitychange', resumed);
	void update();
	return {
		async enter() {
			if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) {
				report('Fullscreen is unavailable in this browser');
				return;
			}
			try {
				await document.documentElement.requestFullscreen();
			} catch {
				report('Fullscreen request was denied');
			}
		},
		destroy() {
			stopped = true;
			document.removeEventListener('fullscreenchange', resumed);
			document.removeEventListener('visibilitychange', resumed);
			void update();
		}
	};
}
