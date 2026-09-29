/*
 * A tiny .zip writer and reader for the learning export (Settings ›
 * Developer). Stored entries only (no compression): the files are small
 * JSON, and a zip any tool can open needs nothing more. Pure: bytes in,
 * bytes out; the page does the download.
 */

const ZIP_CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

export function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = ZIP_CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function zipDosTime(date) {
    const d = new Date(date);
    const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
    const day = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
    return { time, day };
}

/**
 * @param {{name:string, data:string|Uint8Array}[]} files
 * @param {number} [at] - the time stamped on every entry (ms)
 * @returns {Uint8Array}
 */
export function makeZip(files, at = Date.now()) {
    const enc = new TextEncoder();
    const { time, day } = zipDosTime(at);
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const f of files) {
        const name = enc.encode(f.name);
        const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
        const crc = crc32(data);
        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true);
        lh.setUint16(4, 20, true);
        lh.setUint16(6, 0x0800, true); // UTF-8 names
        lh.setUint16(8, 0, true); // stored
        lh.setUint16(10, time, true);
        lh.setUint16(12, day, true);
        lh.setUint32(14, crc, true);
        lh.setUint32(18, data.length, true);
        lh.setUint32(22, data.length, true);
        lh.setUint16(26, name.length, true);
        lh.setUint16(28, 0, true);
        locals.push(new Uint8Array(lh.buffer), name, data);
        const ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true);
        ch.setUint16(4, 20, true);
        ch.setUint16(6, 20, true);
        ch.setUint16(8, 0x0800, true);
        ch.setUint16(10, 0, true);
        ch.setUint16(12, time, true);
        ch.setUint16(14, day, true);
        ch.setUint32(16, crc, true);
        ch.setUint32(20, data.length, true);
        ch.setUint32(24, data.length, true);
        ch.setUint16(28, name.length, true);
        ch.setUint32(42, offset, true);
        centrals.push(new Uint8Array(ch.buffer), name);
        offset += 30 + name.length + data.length;
    }
    const cdSize = centrals.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
    let p = 0;
    for (const part of parts) {
        out.set(part, p);
        p += part.length;
    }
    return out;
}

/**
 * Read a zip made by makeZip (stored entries). Compressed entries are
 * skipped and named in `skipped`.
 * @param {Uint8Array} bytes
 * @returns {{files:{[name:string]: string}, skipped:string[]}}
 */
export function readZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dec = new TextDecoder();
    let e = bytes.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Not a zip file');
    const count = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const files = {};
    const skipped = [];
    for (let i = 0; i < count; i++) {
        if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Broken zip directory');
        const method = dv.getUint16(p + 10, true);
        const size = dv.getUint32(p + 20, true);
        const nameLen = dv.getUint16(p + 28, true);
        const extra = dv.getUint16(p + 30, true);
        const comment = dv.getUint16(p + 32, true);
        const local = dv.getUint32(p + 42, true);
        const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
        const lName = dv.getUint16(local + 26, true);
        const lExtra = dv.getUint16(local + 28, true);
        const start = local + 30 + lName + lExtra;
        if (method === 0) files[name] = dec.decode(bytes.subarray(start, start + size));
        else skipped.push(name);
        p += 46 + nameLen + extra + comment;
    }
    return { files, skipped };
}
