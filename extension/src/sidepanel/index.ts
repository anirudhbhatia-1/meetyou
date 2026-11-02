const status = document.querySelector<HTMLElement>('#connection-status');

if (status !== null) {
  status.textContent = 'Extension shell is ready. Capture is introduced in S1-02.';
}

export {};
