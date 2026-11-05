import { decodeAudioFrame, type Lane } from '@meetyou/contracts';
import { describe, expect, it } from 'vitest';

import type { StreamLink } from '../messages.ts';
import { MemoryFrameStore } from './frame-store.ts';
import {
  StreamClient,
  SUBPROTOCOL,
  TOKEN_PROTOCOL_PREFIX,
  type SocketLike,
  type Timers,
} from './stream-client.ts';

const LANES: Lane[] = ['me', 'them'];
const CHUNK = 10;

/** Manual timers: tests decide when pending callbacks fire. */
class FakeTimers implements Timers {
  pending = new Map<number, () => void>();
  #next = 1;
  setTimeout(callback: () => void): unknown {
    const id = this.#next++;
    this.pending.set(id, callback);
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  runPending(): void {
    const due = [...this.pending.entries()];
    this.pending.clear();
    for (const [, cb] of due) cb();
  }
}

/**
 * Gateway double with the real durability rule: frames become durable (and acked) in chunks of
 * 10; a dropped connection loses whatever was received but not yet durable.
 */
class FakeGateway {
  durable: Record<Lane, number[]> = { me: [], them: [] };
  pending: Record<Lane, number[]> = { me: [], them: [] };
  protocols: string[][] = [];
  socket: FakeSocket | null = null;

  open(protocols: string[]): FakeSocket {
    this.protocols.push(protocols);
    this.socket = new FakeSocket(this);
    const socket = this.socket;
    queueMicrotask(() => socket.onopen?.({} as Event));
    return socket;
  }

  lastDurable(lane: Lane): number {
    return this.durable[lane].at(-1) ?? -1;
  }

  receiveText(socket: FakeSocket, text: string): void {
    const msg = JSON.parse(text) as { type: string };
    if (msg.type === 'hello') {
      socket.reply({
        type: 'ready',
        sessionId: 's1',
        acceptedFormat: { codec: 'pcm16', sampleRate: 16000, channels: 1, frameMs: 100 },
        durableUpTo: { me: this.lastDurable('me'), them: this.lastDurable('them') },
      });
    }
  }

  receiveBinary(socket: FakeSocket, bytes: Uint8Array): void {
    const frame = decodeAudioFrame(bytes);
    const expected = Math.max(this.lastDurable(frame.lane), this.pending[frame.lane].at(-1) ?? -1);
    if (frame.seq <= expected) return; // duplicate
    expect(frame.seq).toBe(expected + 1); // no gaps
    this.pending[frame.lane].push(frame.seq);
    if (this.pending[frame.lane].length === CHUNK) this.flush(socket, frame.lane);
  }

  flush(socket: FakeSocket, lane: Lane): void {
    if (this.pending[lane].length === 0) return;
    this.durable[lane].push(...this.pending[lane]);
    this.pending[lane] = [];
    socket.reply({ type: 'ack', lane, upToSeq: this.lastDurable(lane) });
  }

  drop(): void {
    const socket = this.socket;
    this.socket = null;
    this.pending = { me: [], them: [] };
    socket?.onclose?.({} as CloseEvent);
  }
}

class FakeSocket implements SocketLike {
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly #gateway: FakeGateway;

  constructor(gateway: FakeGateway) {
    this.#gateway = gateway;
  }

  send(data: string | Uint8Array<ArrayBuffer>): void {
    if (this.#gateway.socket !== this) return;
    if (typeof data === 'string') this.#gateway.receiveText(this, data);
    else this.#gateway.receiveBinary(this, data);
  }

  close(): void {
    if (this.#gateway.socket === this) this.#gateway.socket = null;
  }

  reply(message: unknown): void {
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent));
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

function setup() {
  const store = new MemoryFrameStore();
  const gateway = new FakeGateway();
  const timers = new FakeTimers();
  const links: StreamLink[] = [];
  let tokens = 0;
  const client = new StreamClient({
    sessionId: 's1',
    streamUrl: 'ws://localhost:8787/v1/stream',
    getToken: () => Promise.resolve(`t${tokens++}`),
    store,
    openSocket: (_url, protocols) => gateway.open(protocols),
    onLink: (link) => links.push(link),
    onServerMessage: () => undefined,
    timers,
    random: () => 0.5,
  });
  const next: Record<Lane, number> = { me: 0, them: 0 };
  const write = async (count: number) => {
    for (let i = 0; i < count; i++) {
      for (const lane of LANES) {
        const seq = next[lane]++;
        await store.put({ lane, seq, captureMs: seq * 100, payload: new Uint8Array(4) });
        client.frameWritten(lane, seq);
      }
    }
    await settle();
  };
  return { store, gateway, timers, links, client, write };
}

describe('StreamClient', () => {
  it('sends the token as a subprotocol and asks for a fresh one per connection', async () => {
    const { gateway, timers, client } = setup();
    client.start();
    await settle();
    gateway.drop();
    timers.runPending();
    await settle();
    expect(gateway.protocols).toEqual([
      [SUBPROTOCOL, `${TOKEN_PROTOCOL_PREFIX}t0`],
      [SUBPROTOCOL, `${TOKEN_PROTOCOL_PREFIX}t1`],
    ]);
  });

  it('loses no frames across a network drop and prunes the buffer on ack', async () => {
    const { store, gateway, timers, links, client, write } = setup();
    client.start();
    await settle();
    expect(links.at(-1)).toBe('online');

    await write(25); // durable 0..19, 20..24 only received
    expect(gateway.lastDurable('me')).toBe(19);
    expect(client.acked).toEqual({ me: 19, them: 19 });

    gateway.drop(); // 20..24 are lost on the gateway side
    expect(links.at(-1)).toBe('reconnecting');
    await write(25); // 25..49 recorded while offline
    expect(await store.count()).toBe(60); // 20..49 per lane still buffered

    timers.runPending(); // reconnect
    await settle();
    expect(links.at(-1)).toBe('online');
    for (const lane of LANES) {
      gateway.flush(gateway.socket as FakeSocket, lane);
    }
    await settle();

    for (const lane of LANES) {
      expect(gateway.durable[lane]).toEqual(Array.from({ length: 50 }, (_, i) => i));
    }
    expect(client.acked).toEqual({ me: 49, them: 49 });
    expect(await store.count()).toBe(0);

    const { unacked } = await client.stop(5000, 0);
    expect(unacked).toBe(0);
    expect(links.at(-1)).toBe('off');
  });

  it('reports unsent audio as backlog, which holds back video uploads', async () => {
    const { gateway, timers, client, write } = setup();
    client.start();
    await settle();
    await write(3);
    expect(client.backlogMs()).toBe(0);
    gateway.drop();
    await write(60); // 6 s recorded while offline
    expect(client.backlogMs()).toBe(6000);
    timers.runPending();
    await settle();
    expect(client.backlogMs()).toBe(0);
  });

  it('keeps unacknowledged frames when the stream ends without acks', async () => {
    const { store, gateway, timers, client, write } = setup();
    client.start();
    await settle();
    await write(5);
    gateway.drop();
    const stopped = client.stop(500, 0);
    await settle();
    timers.runPending(); // reconnect attempt and the stop timeout
    await settle();
    expect((await stopped).unacked).toBe(10);
    expect(await store.count()).toBe(10);
  });
});
