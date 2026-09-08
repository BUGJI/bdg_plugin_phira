module.exports = function activate(ctx) {
  var fs = require("fs");
  var path = require("path");
  var zlib = require("zlib");

  // ---- minimal ZIP writer (local + central + end records, UTF-8 names) ----
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xffffffff;
    for (var i = 0; i < buf.length; i++) {
      c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  // entries: [{ name: string, data: Buffer, deflate?: boolean }]
  function buildZip(entries) {
    var chunks = [];
    var centralChunks = [];
    var cdSize = 0;
    var localOffset = 0;

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var nameBuf = Buffer.from(e.name, "utf8");
      var raw = e.data;
      var comp = raw;
      var method = 0;
      if (e.deflate) {
        comp = zlib.deflateRawSync(raw);
        method = 8;
      }
      var crc = crc32(raw);

      // local file header (30 bytes)
      var lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4); // version needed
      lh.writeUInt16LE(0x0800, 6); // flags: UTF-8 name
      lh.writeUInt16LE(method, 8);
      lh.writeUInt16LE(0, 10); // mod time
      lh.writeUInt16LE(0, 12); // mod date
      lh.writeUInt32LE(crc, 14);
      lh.writeUInt32LE(comp.length, 18);
      lh.writeUInt32LE(raw.length, 22);
      lh.writeUInt16LE(nameBuf.length, 26);
      lh.writeUInt16LE(0, 28); // extra len
      chunks.push(lh, nameBuf, comp);
      localOffset += lh.length + nameBuf.length + comp.length;

      // central directory header (46 bytes)
      var cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4); // version made by
      cd.writeUInt16LE(20, 6); // version needed
      cd.writeUInt16LE(0x0800, 8); // flags
      cd.writeUInt16LE(method, 10);
      cd.writeUInt16LE(0, 12); // mod time
      cd.writeUInt16LE(0, 14); // mod date
      cd.writeUInt32LE(crc, 16);
      cd.writeUInt32LE(comp.length, 20);
      cd.writeUInt32LE(raw.length, 24);
      cd.writeUInt16LE(nameBuf.length, 28);
      cd.writeUInt16LE(0, 30); // extra len
      cd.writeUInt16LE(0, 32); // comment len
      cd.writeUInt16LE(0, 34); // disk start
      cd.writeUInt16LE(0, 36); // internal attrs
      cd.writeUInt32LE(0, 38); // external attrs
      cd.writeUInt32LE(localOffset - (lh.length + nameBuf.length + comp.length), 42);
      centralChunks.push(cd, nameBuf);
      cdSize += cd.length + nameBuf.length;
    }

    // end of central directory record (22 bytes)
    var end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4); // disk num
    end.writeUInt16LE(0, 6); // disk with cd
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(localOffset, 16);
    end.writeUInt16LE(0, 20); // comment len

    return Buffer.concat(chunks.concat(centralChunks).concat([end]));
  }

  ctx.registerHandler("package", function () {
    // 兼容两种调用：处理器直接收到对象；或宿主把参数以数组形式包一层：
    //   1) fn(object)            -> arguments[0] = object
    //   2) fn([object])          -> arguments[0] = [object]
    //   3) fn.apply(null, [object]) -> arguments[0] = object
    var first = arguments[0];
    var ARG_AS_ARRAY = Array.isArray(first) && first.length === 1 && typeof first[0] === "object";
    var opts = ARG_AS_ARRAY ? first[0] : first;
    ctx.log("package receive opts keys:", opts ? Object.keys(opts) : null);
    try {
      var outPath = opts && opts.outPath;
      var audioPath = opts && opts.audioPath;
      var audioName = opts && opts.audioName;
      var illustrationPath = opts && opts.illustrationPath;
      var illustrationName = opts && opts.illustrationName;
      var chartName = (opts && opts.chartName) || "chart.json";
      if (!outPath) {
        ctx.log("package: no outPath received, received:", opts);
        throw new Error("outPath 未到达 main，宿主可能改动 callMain 的传参方式");
      }

      // IPC 传参若丢失 json，回退为可读诊断串并继续，便于看出缺哪个字段
      var jsonStr = typeof (opts && opts.json) === "string"
        ? opts.json
        : JSON.stringify({ WARN: "json not received (opts.json=" + (opts && opts.json) + ")" });

      var entries = [{ name: chartName, data: Buffer.from(jsonStr, "utf8"), deflate: true }];

      if (opts && typeof opts.infoTxt === "string") {
        entries.push({ name: "info.txt", data: Buffer.from(opts.infoTxt, "utf8"), deflate: true });
      } else {
        ctx.log("package: no info.txt");
      }

      if (audioPath && audioName) {
        ctx.log("package: reading audio from", audioPath);
        var data = fs.readFileSync(audioPath); // throws if path invalid
        entries.push({ name: audioName, data: data, deflate: true });
      } else {
        ctx.log("package: no audio (audioPath=" + audioPath + ", audioName=" + audioName + ")");
      }

      if (illustrationPath && illustrationName) {
        ctx.log("package: reading illustration from", illustrationPath);
        var illData = fs.readFileSync(illustrationPath); // throws if path invalid
        entries.push({ name: illustrationName, data: illData, deflate: true });
      } else {
        ctx.log("package: no illustration (illustrationPath=" + illustrationPath + ", illustrationName=" + illustrationName + ")");
      }

      var zip = buildZip(entries);
      ctx.log("package: built zip, entries:", entries.length);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, zip);
      return { ok: true, entries: entries.map(function (e) { return e.name; }) };
    } catch (e) {
      ctx.log("package error", e && e.message);
      throw e;
    }
  });

  ctx.onDispose(function () {
    ctx.log("phira-converter main disposed");
  });
};
