import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A minimal zip writer for the data export (S3-11): deflated entries with UTF-8 names, no zip64.
 * Written here instead of adding a dependency; exports are text and stay far below 4 GB.
 */
export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

function dosTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
    date: ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

export function zip(entries: readonly ZipEntry[], at: Date = new Date()): Uint8Array {
  if (entries.length > MAX_ENTRIES) throw new Error('zip: too many entries');
  const { time, date } = dosTime(at);
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const deflated = deflateRawSync(entry.data);
    // Store when deflate does not help (tiny or already compressed).
    const stored = deflated.length >= entry.data.length;
    const body = stored ? Buffer.from(entry.data) : deflated;
    const crc = crc32(entry.data);
    if (offset + body.length + 30 + name.length > MAX_BYTES) throw new Error('zip: too large');

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(stored ? 0 : 8, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, body);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4); // made by
    record.writeUInt16LE(20, 6); // needed
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(stored ? 0 : 8, 10);
    record.writeUInt16LE(time, 12);
    record.writeUInt16LE(date, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42); // the rest (extra, comment, disk, attributes) stays 0
    central.push(record, name);

    offset += header.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}
