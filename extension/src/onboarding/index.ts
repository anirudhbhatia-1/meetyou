const button = document.querySelector<HTMLButtonElement>('#request-microphone');
const status = document.querySelector<HTMLElement>('#permission-status');

button?.addEventListener('click', async () => {
  if (status !== null) {
    status.textContent = 'Requesting microphone permission…';
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());

    if (status !== null) {
      status.textContent = 'Microphone permission granted.';
    }
  } catch (error: unknown) {
    if (status !== null) {
      const reason = error instanceof DOMException ? error.name : 'UnknownError';
      status.textContent = `Microphone permission was not granted (${reason}). You can still record the meeting tab when capture is available.`;
    }
  }
});

export {};
