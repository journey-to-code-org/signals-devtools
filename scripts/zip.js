// A small zip writer in Node alone (no `zip` program), so packing works the same on Windows,
// macOS and Linux. Deflated, with a fixed date so the same files always give the same bytes.
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

/** Every file under `dir`, as zip paths (forward slashes), sorted; dotfiles left out. */
export function filesIn(dir, root = dir) {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...filesIn(path, root));
    else found.push(relative(root, path).split(sep).join('/'));
  }
  return found;
}

/** A zip archive of `entries` ({ name, data }). */
export function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  const time = 0;
  const date = (0 << 9) | (1 << 5) | 1; // 1980-01-01, the earliest DOS date
  for (const { name, data } of entries) {
    const path = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(deflated.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(path.length, 26);
    local.push(header, path, deflated);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(time, 12);
    record.writeUInt16LE(date, 14);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(deflated.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(path.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, path);
    offset += header.length + path.length + deflated.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
