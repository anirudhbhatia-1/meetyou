/** Floor reported for digital silence, so meters and later FR-CAP-10 checks get a finite number. */
export const SILENCE_DBFS = -100;

/** RMS level of one block of samples in dBFS (0 = full scale). */
export function rmsDbfs(samples: Float32Array): number {
  if (samples.length === 0) return SILENCE_DBFS;
  let sum = 0;
  for (const s of samples) sum += s * s;
  const rms = Math.sqrt(sum / samples.length);
  if (rms === 0) return SILENCE_DBFS;
  return Math.max(SILENCE_DBFS, 20 * Math.log10(rms));
}
