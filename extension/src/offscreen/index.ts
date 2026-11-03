chrome.runtime.onMessage.addListener((message) => {
  if (message === 'capture.status') {
    return false;
  }

  return false;
});
