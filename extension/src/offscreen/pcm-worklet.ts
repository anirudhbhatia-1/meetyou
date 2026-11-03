import { PcmFramer } from './pcm-framer.ts';

// AudioWorkletGlobalScope members; TypeScript's DOM lib does not declare them.
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

/** Posts `{ pcm, startFrame, levelDbfs }` per 100 ms frame; the PCM buffer is transferred. */
class PcmFramerProcessor extends AudioWorkletProcessor {
  readonly #framer = new PcmFramer();

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0] ?? [];
    const length = channels[0]?.length ?? 128;
    for (const frame of this.#framer.push(channels, currentFrame, length)) {
      this.port.postMessage(
        { pcm: frame.pcm.buffer, startFrame: frame.startFrame, levelDbfs: frame.levelDbfs },
        [frame.pcm.buffer],
      );
    }
    return true;
  }
}

registerProcessor('pcm-framer', PcmFramerProcessor);
