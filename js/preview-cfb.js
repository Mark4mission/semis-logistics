/* 첨부 미리보기 — 복합 문서(CFB: 엑셀 97-2003 · 한글 · 암호 걸린 오피스 문서의 겉 포장) 읽기와 문서 암호 풀기.
   해시(MD5 · SHA-1/256/384/512) · AES · RC4 는 이 파일 안에서 계산한다(외부 라이브러리 없음).
   암호는 호출하는 동안만 쓰고 어디에도 남기지 않는다. */
"use strict";

(() => {
  const SP = window.SemisPreview;
  if (!SP) return;

  /* ── 해시 ── */
  const be32 = (u8, i) => ((u8[i] << 24) | (u8[i + 1] << 16) | (u8[i + 2] << 8) | u8[i + 3]) | 0;
  function pad(u8, blk, lenBytes, little) {
    const l = u8.length, n = Math.ceil((l + 1 + lenBytes) / blk) * blk;
    const b = new Uint8Array(n); b.set(u8); b[l] = 0x80;
    const bits = l * 8, hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
    if (little) { for (let i = 0; i < 4; i++) { b[n - lenBytes + i] = (lo >>> (8 * i)) & 255; b[n - lenBytes + 4 + i] = (hi >>> (8 * i)) & 255; } }
    else { for (let i = 0; i < 4; i++) { b[n - 1 - i] = (lo >>> (8 * i)) & 255; b[n - 5 - i] = (hi >>> (8 * i)) & 255; } }
    return b;
  }
  const outBE = (H, n) => { const o = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { o[4 * i] = H[i] >>> 24; o[4 * i + 1] = (H[i] >>> 16) & 255; o[4 * i + 2] = (H[i] >>> 8) & 255; o[4 * i + 3] = H[i] & 255; } return o; };

  let MD5K = null;
  const MD5S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  function md5(u8) {
    if (!MD5K) { MD5K = new Int32Array(64); for (let i = 0; i < 64; i++) MD5K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0; }
    const b = pad(u8, 64, 8, true);
    let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    const M = new Int32Array(16);
    for (let o = 0; o < b.length; o += 64) {
      for (let i = 0; i < 16; i++) M[i] = b[o + 4 * i] | (b[o + 4 * i + 1] << 8) | (b[o + 4 * i + 2] << 16) | (b[o + 4 * i + 3] << 24);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
        else { F = C ^ (B | ~D); g = (7 * i) & 15; }
        const s = MD5S[(i >> 4) * 4 + (i & 3)];
        const x = (A + F + MD5K[i] + M[g]) | 0;
        A = D; D = C; C = B; B = (B + ((x << s) | (x >>> (32 - s)))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    const o = new Uint8Array(16);
    [a0, b0, c0, d0].forEach((v, k) => { for (let i = 0; i < 4; i++) o[4 * k + i] = (v >>> (8 * i)) & 255; });
    return o;
  }
  function sha1(u8) {
    const b = pad(u8, 64, 8, false);
    const H = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476, 0xc3d2e1f0 | 0];
    const W = new Int32Array(80);
    for (let o = 0; o < b.length; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = be32(b, o + 4 * i);
      for (let i = 16; i < 80; i++) { const x = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]; W[i] = (x << 1) | (x >>> 31); }
      let [a, bb, c, d, e] = H;
      for (let i = 0; i < 80; i++) {
        const f = i < 20 ? (bb & c) | (~bb & d) : i < 40 ? bb ^ c ^ d : i < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
        const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc | 0 : 0xca62c1d6 | 0;
        const t = (((a << 5) | (a >>> 27)) + f + e + k + W[i]) | 0;
        e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = t;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0;
    }
    return outBE(H, 5);
  }
  const K256 = new Int32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(u8) {
    const b = pad(u8, 64, 8, false);
    const H = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Int32Array(64);
    const r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < b.length; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = be32(b, o + 4 * i);
      for (let i = 16; i < 64; i++) {
        const s0 = r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) | 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return outBE(H, 8);
  }
  /* SHA-512 / 384 — 64비트 값을 (위 32, 아래 32) 두 칸으로 */
  const K512 = new Int32Array([
    0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc, 0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
    0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe, 0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2, 0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
    0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65, 0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
    0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4, 0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725, 0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
    0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df, 0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
    0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30, 0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
    0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53, 0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8, 0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
    0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec, 0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
    0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178, 0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6, 0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
    0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c, 0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817]);
  const IV512 = [0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1, 0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179];
  const IV384 = [0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507, 0x9159015a, 0x3070dd17, 0x152fecd8, 0xf70e5939, 0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511, 0xdb0c2e0d, 0x64f98fa7, 0x47b5481d, 0xbefa4fa4];
  const W512 = new Int32Array(160), B128 = new Uint8Array(128);
  const C32 = 4294967296;
  function sha512(u8, is384) {
    let b;
    if (u8.length <= 111) {                                     // 한 블록(암호 반복 계산의 대부분) — 버퍼 재사용
      b = B128; b.fill(0); b.set(u8); b[u8.length] = 0x80;
      const bits = u8.length * 8; b[127] = bits & 255; b[126] = (bits >>> 8) & 255;
    } else b = pad(u8, 128, 16, false);
    const H = new Int32Array(is384 ? IV384 : IV512);
    const W = W512;
    for (let o = 0; o < b.length; o += 128) {
      for (let i = 0; i < 32; i++) W[i] = be32(b, o + 4 * i);
      for (let i = 16; i < 80; i++) {
        const xh = W[2 * i - 30], xl = W[2 * i - 29], yh = W[2 * i - 4], yl = W[2 * i - 3];
        const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
        const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
        const s1h = ((yh >>> 19) | (yl << 13)) ^ ((yl >>> 29) | (yh << 3)) ^ (yh >>> 6);
        const s1l = ((yl >>> 19) | (yh << 13)) ^ ((yh >>> 29) | (yl << 3)) ^ ((yl >>> 6) | (yh << 26));
        const lo = (s1l >>> 0) + (W[2 * i - 13] >>> 0) + (s0l >>> 0) + (W[2 * i - 31] >>> 0);
        W[2 * i] = (s1h + W[2 * i - 14] + s0h + W[2 * i - 32] + ((lo / C32) | 0)) | 0;
        W[2 * i + 1] = lo | 0;
      }
      let ah = H[0], al = H[1], bh = H[2], bl = H[3], ch = H[4], cl = H[5], dh = H[6], dl = H[7], eh = H[8], el = H[9], fh = H[10], fl = H[11], gh = H[12], gl = H[13], hh = H[14], hl = H[15];
      for (let i = 0; i < 80; i++) {
        const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
        const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
        const chh = (eh & fh) ^ (~eh & gh), chl = (el & fl) ^ (~el & gl);
        const t1l = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K512[2 * i + 1] >>> 0) + (W[2 * i + 1] >>> 0);
        const t1h = (hh + S1h + chh + K512[2 * i] + W[2 * i] + ((t1l / C32) | 0)) | 0;
        const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
        const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
        const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch), mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
        const t2l = (S0l >>> 0) + (mjl >>> 0), t2h = (S0h + mjh + ((t2l / C32) | 0)) | 0;
        hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
        const el2 = (dl >>> 0) + (t1l >>> 0);
        eh = (dh + t1h + ((el2 / C32) | 0)) | 0; el = el2 | 0;
        dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
        const al2 = (t1l >>> 0) + (t2l >>> 0);
        ah = (t1h + t2h + ((al2 / C32) | 0)) | 0; al = al2 | 0;
      }
      const add = (k, h, l) => { const lo = (H[k + 1] >>> 0) + (l >>> 0); H[k] = (H[k] + h + ((lo / C32) | 0)) | 0; H[k + 1] = lo | 0; };
      add(0, ah, al); add(2, bh, bl); add(4, ch, cl); add(6, dh, dl); add(8, eh, el); add(10, fh, fl); add(12, gh, gl); add(14, hh, hl);
    }
    return outBE(H, is384 ? 12 : 16);
  }
  const HASH = { SHA1: sha1, "SHA-1": sha1, SHA256: sha256, "SHA-256": sha256, SHA384: (u) => sha512(u, true), "SHA-384": (u) => sha512(u, true), SHA512: (u) => sha512(u, false), "SHA-512": (u) => sha512(u, false), MD5: md5 };

  /* ── AES 풀기(표 방식, 128/192/256비트 키) ── */
  let AES = null;
  function aesTables() {
    const enc = [[], [], [], [], []], dec = [[], [], [], [], []];
    const sbox = enc[4], inv = dec[4], d = [], th = [];
    for (let i = 0; i < 256; i++) th[(d[i] = (i << 1) ^ ((i >> 7) * 283)) ^ i] = i;
    /* S-box · 혼합 표 생성(곱셈 생성원 3 으로 255개 원소를 한 바퀴) */
    let x = 0, xInv = 0, x2, x4, x8;
    for (let guard = 0; !sbox[x] && guard < 300; guard++) {
      let s = xInv ^ (xInv << 1) ^ (xInv << 2) ^ (xInv << 3) ^ (xInv << 4);
      s = (s >> 8) ^ (s & 255) ^ 99;
      sbox[x] = s; inv[s] = x;
      x8 = d[x4 = d[x2 = d[x]]];
      let tDec = (x8 * 0x1010101) ^ (x4 * 0x10001) ^ (x2 * 0x101) ^ (x * 0x1010100);
      let tEnc = (d[s] * 0x101) ^ (s * 0x1010100);
      for (let i = 0; i < 4; i++) { enc[i][x] = tEnc = (tEnc << 24) ^ (tEnc >>> 8); dec[i][s] = tDec = (tDec << 24) ^ (tDec >>> 8); }
      x ^= x2 || 1; xInv = th[xInv] || 1;
    }
    return { enc: enc.map(a => Int32Array.from(a, v => v | 0)), dec: dec.map(a => Int32Array.from(a, v => v | 0)) };
  }
  function aesKey(key) {
    if (!AES) AES = aesTables();
    const sbox = AES.enc[4], dt = AES.dec;
    const kl = key.length / 4;
    if (kl !== 4 && kl !== 6 && kl !== 8) throw new Error("aes-key");
    const ek = [];
    for (let i = 0; i < kl; i++) ek[i] = be32(key, 4 * i);
    let rcon = 1, i;
    for (i = kl; i < 4 * kl + 28; i++) {
      let t = ek[i - 1];
      if (i % kl === 0 || (kl === 8 && i % kl === 4)) {
        t = (sbox[t >>> 24] << 24) ^ (sbox[(t >> 16) & 255] << 16) ^ (sbox[(t >> 8) & 255] << 8) ^ sbox[t & 255];
        if (i % kl === 0) { t = (t << 8) ^ (t >>> 24) ^ (rcon << 24); rcon = (rcon << 1) ^ ((rcon >> 7) * 283); }
      }
      ek[i] = ek[i - kl] ^ t;
    }
    const dk = [];
    for (let j = 0; i; j++, i--) {
      const t = ek[j & 3 ? i : i - 4];
      dk[j] = i <= 4 || j < 4 ? t : dt[0][sbox[t >>> 24]] ^ dt[1][sbox[(t >> 16) & 255]] ^ dt[2][sbox[(t >> 8) & 255]] ^ dt[3][sbox[t & 255]];
    }
    return Int32Array.from(dk, v => v | 0);
  }
  /* 블록 하나 풀기: in[o..o+16) → out[p..p+16) */
  function aesBlock(dk, src, o, dst, p) {
    const t = AES.dec, t0 = t[0], t1 = t[1], t2 = t[2], t3 = t[3], sb = t[4];
    let a = be32(src, o) ^ dk[0], b = be32(src, o + 12) ^ dk[1], c = be32(src, o + 8) ^ dk[2], d = be32(src, o + 4) ^ dk[3];
    const nr = dk.length / 4 - 2;
    let k = 4;
    for (let i = 0; i < nr; i++) {
      const a2 = t0[a >>> 24] ^ t1[(b >> 16) & 255] ^ t2[(c >> 8) & 255] ^ t3[d & 255] ^ dk[k];
      const b2 = t0[b >>> 24] ^ t1[(c >> 16) & 255] ^ t2[(d >> 8) & 255] ^ t3[a & 255] ^ dk[k + 1];
      const c2 = t0[c >>> 24] ^ t1[(d >> 16) & 255] ^ t2[(a >> 8) & 255] ^ t3[b & 255] ^ dk[k + 2];
      d = t0[d >>> 24] ^ t1[(a >> 16) & 255] ^ t2[(b >> 8) & 255] ^ t3[c & 255] ^ dk[k + 3];
      k += 4; a = a2; b = b2; c = c2;
    }
    const out = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      out[3 & -i] = (sb[a >>> 24] << 24) ^ (sb[(b >> 16) & 255] << 16) ^ (sb[(c >> 8) & 255] << 8) ^ sb[d & 255] ^ dk[k++];
      const x = a; a = b; b = c; c = d; d = x;
    }
    for (let i = 0; i < 4; i++) { const v = out[i]; dst[p + 4 * i] = v >>> 24; dst[p + 4 * i + 1] = (v >>> 16) & 255; dst[p + 4 * i + 2] = (v >>> 8) & 255; dst[p + 4 * i + 3] = v & 255; }
  }
  /* CBC(iv 있음) · ECB(iv 없음) 풀기 — 덧붙임 제거는 하지 않는다(길이는 호출 쪽이 안다) */
  function aesDecrypt(key, data, iv) {
    const dk = aesKey(key);
    const n = data.length - (data.length % 16), out = new Uint8Array(n);
    for (let o = 0; o < n; o += 16) {
      aesBlock(dk, data, o, out, o);
      if (iv) { const prev = o ? data : iv, q = o ? o - 16 : 0; for (let i = 0; i < 16; i++) out[o + i] ^= prev[q + i]; }
    }
    return out;
  }

  /* ── RC4 ── */
  function rc4(key) {
    const S = new Uint8Array(256);
    for (let i = 0; i < 256; i++) S[i] = i;
    for (let i = 0, j = 0; i < 256; i++) { j = (j + S[i] + key[i % key.length]) & 255; const t = S[i]; S[i] = S[j]; S[j] = t; }
    let i = 0, j = 0;
    return (n) => { const o = new Uint8Array(n); for (let k = 0; k < n; k++) { i = (i + 1) & 255; j = (j + S[i]) & 255; const t = S[i]; S[i] = S[j]; S[j] = t; o[k] = S[(S[i] + S[j]) & 255]; } return o; };
  }

  /* ── 공통 ── */
  const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let p = 0; a.forEach(x => { o.set(x, p); p += x.length; }); return o; };
  const le32 = (v) => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
  const u16 = (u8, i) => u8[i] | (u8[i + 1] << 8);
  const u32 = (u8, i) => (u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16) | (u8[i + 3] << 24)) >>> 0;
  const utf16 = (s) => { const o = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); o[2 * i] = c & 255; o[2 * i + 1] = c >> 8; } return o; };
  const same = (a, b, n) => { if (a.length < n || b.length < n) return false; let d = 0; for (let i = 0; i < n; i++) d |= a[i] ^ b[i]; return d === 0; };
  const fail = (code) => Object.assign(new Error(code), { code });
  const b64d = (s) => { const t = atob(String(s || "").replace(/\s+/g, "")); const o = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) o[i] = t.charCodeAt(i); return o; };
  const fit = (h, n, fill) => { if (h.length >= n) return h.slice(0, n); const o = new Uint8Array(n).fill(fill); o.set(h); return o; };

  /* ── CFB(복합 문서) 읽기 ── */
  const isCFB = (u8) => u8 && u8.length >= 512 && u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0 && u8[4] === 0xA1 && u8[5] === 0xB1 && u8[6] === 0x1A && u8[7] === 0xE1;
  function cfb(u8) {
    if (!isCFB(u8)) throw fail("cfb");
    const ss = 1 << u16(u8, 30), ms = 1 << u16(u8, 32);
    if (ss !== 512 && ss !== 4096) throw fail("cfb");
    const nSec = Math.floor((u8.length - ss) / ss) + 1;
    const ok = (n) => n < 0xFFFFFFFA && n < nSec + 1;
    const fatSecs = [];
    for (let i = 0; i < 109; i++) { const v = u32(u8, 76 + 4 * i); if (ok(v)) fatSecs.push(v); }
    let dif = u32(u8, 68);
    for (let g = 0; ok(dif) && g < 10000; g++) {
      const base = (dif + 1) * ss;
      if (base + ss > u8.length) break;
      for (let i = 0; i < ss / 4 - 1; i++) { const v = u32(u8, base + 4 * i); if (ok(v)) fatSecs.push(v); }
      dif = u32(u8, base + ss - 4);
    }
    const per = ss / 4, fat = new Uint32Array(fatSecs.length * per);
    fatSecs.forEach((s, k) => { const base = (s + 1) * ss; for (let i = 0; i < per && base + 4 * i + 4 <= u8.length; i++) fat[k * per + i] = u32(u8, base + 4 * i); });
    function chain(start, table, limit) {
      const out = [], seen = new Set();
      for (let s = start; s < 0xFFFFFFFA && s < table.length && !seen.has(s) && out.length < limit; s = table[s]) { seen.add(s); out.push(s); }
      return out;
    }
    function readBig(start, size) {
      const secs = chain(start, fat, Math.ceil(Math.min(size, u8.length) / ss) + 1);
      const o = new Uint8Array(Math.min(size, secs.length * ss));
      secs.forEach((s, k) => { const base = (s + 1) * ss, len = Math.min(ss, o.length - k * ss); if (len > 0) o.set(u8.subarray(base, Math.min(u8.length, base + len)), k * ss); });
      return o;
    }
    const dirBytes = readBig(u32(u8, 48), u8.length);
    const ents = [];
    for (let p = 0; p + 128 <= dirBytes.length; p += 128) {
      const nl = Math.min(64, u16(dirBytes, p + 64));
      let name = ""; for (let i = 0; i + 1 < nl - 1; i += 2) name += String.fromCharCode(u16(dirBytes, p + i));
      ents.push({ name, type: dirBytes[p + 66], left: u32(dirBytes, p + 68), right: u32(dirBytes, p + 72), child: u32(dirBytes, p + 76),
        start: u32(dirBytes, p + 116), size: ss === 512 ? u32(dirBytes, p + 120) : u32(dirBytes, p + 120) + u32(dirBytes, p + 124) * 4294967296 });
    }
    if (!ents.length || ents[0].type !== 5) throw fail("cfb");
    const cutoff = u32(u8, 56) || 4096;
    let mini = null, mfat = null;
    const miniRead = (start, size) => {
      if (!mini) { mini = readBig(ents[0].start, ents[0].size); const mb = readBig(u32(u8, 60), u32(u8, 64) * ss); mfat = new Uint32Array(mb.length / 4); for (let i = 0; i < mfat.length; i++) mfat[i] = u32(mb, 4 * i); }
      const secs = chain(start, mfat, Math.ceil(size / ms) + 1), o = new Uint8Array(Math.min(size, secs.length * ms));
      secs.forEach((s, k) => { const len = Math.min(ms, o.length - k * ms); if (len > 0) o.set(mini.subarray(s * ms, s * ms + len), k * ms); });
      return o;
    };
    const paths = new Map();
    const seen = new Set();
    (function walk(id, prefix, depth) {
      if (id >= ents.length || seen.has(id) || depth > 64) return;
      seen.add(id);
      const e = ents[id];
      walk(e.left, prefix, depth + 1);
      const p = prefix + e.name;
      if (e.type === 2) paths.set(p.toLowerCase(), e);
      else if (e.type === 1) walk(e.child, p + "/", depth + 1);
      walk(e.right, prefix, depth + 1);
    })(ents[0].child, "", 0);
    const cache = new Map();
    function get(path) {
      const k = String(path).toLowerCase();
      if (cache.has(k)) return cache.get(k);
      const e = paths.get(k);
      const v = !e ? null : e.size < cutoff ? miniRead(e.start, e.size) : readBig(e.start, e.size);
      cache.set(k, v);
      return v;
    }
    return { get, has: (p) => paths.has(String(p).toLowerCase()), list: () => Array.from(paths.keys()) };
  }

  /* ── 오피스 문서 암호(ECMA-376: Agile · Standard) ── */
  const BK_VIN = new Uint8Array([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]);
  const BK_VHV = new Uint8Array([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]);
  const BK_KEY = new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);
  function spin(H, salt, pw, count) {
    let h = H(cat(salt, utf16(pw)));
    const buf = new Uint8Array(4 + h.length);
    for (let i = 0; i < count; i++) { buf[0] = i & 255; buf[1] = (i >>> 8) & 255; buf[2] = (i >>> 16) & 255; buf[3] = (i >>> 24) & 255; buf.set(h, 4); h = H(buf); }
    return h;
  }
  function agileInfo(info) {
    const txt = new TextDecoder("utf-8").decode(info.subarray(8));
    const doc = new DOMParser().parseFromString(txt.replace(/^﻿/, ""), "application/xml");
    const el = (n) => Array.from(doc.getElementsByTagName("*")).find(x => (x.localName || x.nodeName.replace(/^.*:/, "")) === n);
    const kd = el("keyData"), ek = el("encryptedKey");
    if (!kd || !ek) throw fail("enc");
    const A = (e, n) => e.getAttribute(n) || "";
    return {
      kd: { salt: b64d(A(kd, "saltValue")), hash: A(kd, "hashAlgorithm"), block: Number(A(kd, "blockSize")) || 16, bits: Number(A(kd, "keyBits")) || 256, cipher: A(kd, "cipherAlgorithm"), chain: A(kd, "cipherChaining") },
      ek: { spin: Number(A(ek, "spinCount")) || 100000, salt: b64d(A(ek, "saltValue")), hash: A(ek, "hashAlgorithm"), bits: Number(A(ek, "keyBits")) || 256, hsize: Number(A(ek, "hashSize")) || 64,
        cipher: A(ek, "cipherAlgorithm"), chain: A(ek, "cipherChaining"),
        vin: b64d(A(ek, "encryptedVerifierHashInput")), vhv: b64d(A(ek, "encryptedVerifierHashValue")), key: b64d(A(ek, "encryptedKeyValue")) }
    };
  }
  function agileKey(I, pw) {
    const { ek } = I;
    const H = HASH[ek.hash.toUpperCase()];
    if (!H || ek.cipher !== "AES" || !/CBC/i.test(ek.chain) || ek.spin > 10000000) throw fail("enc");
    const base = spin(H, ek.salt, pw, ek.spin);
    const k = (blk) => fit(H(cat(base, blk)), ek.bits / 8, 0x36);
    const iv = fit(ek.salt, 16, 0x36);
    const vin = aesDecrypt(k(BK_VIN), ek.vin, iv).slice(0, ek.salt.length);
    const vhv = aesDecrypt(k(BK_VHV), ek.vhv, iv);
    if (!same(H(vin), vhv, H(vin).length)) return null;
    return aesDecrypt(k(BK_KEY), ek.key, iv).slice(0, I.kd.bits / 8);
  }
  function agilePackage(I, secret, pkg) {
    const H = HASH[I.kd.hash.toUpperCase()];
    if (!H || I.kd.cipher !== "AES") throw fail("enc");
    const size = u32(pkg, 0) + u32(pkg, 4) * 4294967296;
    const data = pkg.subarray(8), out = new Uint8Array(Math.min(size, data.length));
    for (let i = 0, o = 0; o < out.length; i++, o += 4096) {
      const iv = fit(H(cat(I.kd.salt, le32(i))), I.kd.block, 0x36);
      const seg = aesDecrypt(secret, data.subarray(o, Math.min(data.length, o + 4096)), iv);
      out.set(seg.subarray(0, Math.min(seg.length, out.length - o)), o);
    }
    return out;
  }
  function standardInfo(info) {
    const hsz = u32(info, 8), h = 12;
    const alg = u32(info, h + 8), algHash = u32(info, h + 12), bits = u32(info, h + 16);
    const v = h + hsz;
    const saltSize = u32(info, v);
    return { alg, algHash, bits: bits || 128, salt: info.slice(v + 4, v + 4 + saltSize), ever: info.slice(v + 4 + saltSize, v + 20 + saltSize),
      evh: info.slice(v + 24 + saltSize, v + 24 + saltSize + 32) };
  }
  function standardKey(I, pw) {
    if (I.alg !== 0x660E && I.alg !== 0x660F && I.alg !== 0x6610) throw fail("enc");
    const h = spin(sha1, I.salt, pw, 50000);
    const hf = sha1(cat(h, le32(0)));
    const x = (c) => { const b = new Uint8Array(64).fill(c); for (let i = 0; i < 20; i++) b[i] ^= hf[i]; return sha1(b); };
    const key = cat(x(0x36), x(0x5c)).slice(0, I.bits / 8);
    const ver = aesDecrypt(key, I.ever), vh = aesDecrypt(key, I.evh);
    return same(sha1(ver), vh, 20) ? key : null;
  }
  /* 암호 걸린 OOXML(겉은 CFB) → 속 ZIP 바이트. 암호가 없으면 VelvetSweatshop(읽기 전용 기본 암호)부터 */
  function officeDecrypt(doc, pw) {
    const info = doc.get("EncryptionInfo"), pkg = doc.get("EncryptedPackage");
    if (!info || !pkg) throw fail("enc");
    const vMaj = u16(info, 0), vMin = u16(info, 2);
    const tries = pw == null || pw === "" ? ["VelvetSweatshop"] : [String(pw)];
    if (vMaj === 4 && vMin === 4) {
      const I = agileInfo(info);
      for (const p of tries) { const k = agileKey(I, p); if (k) return agilePackage(I, k, pkg); }
    } else if ((vMaj === 3 || vMaj === 4 || vMaj === 2) && vMin === 2) {
      const I = standardInfo(info);
      for (const p of tries) {
        const k = standardKey(I, p);
        if (k) { const size = u32(pkg, 0) + u32(pkg, 4) * 4294967296; return aesDecrypt(k, pkg.subarray(8)).slice(0, size); }
      }
    } else throw fail("enc");
    throw fail(pw ? "badpw" : "pw");
  }

  SP.register = SP.register || {};
  SP.register.cfb = { cfb, isCFB, officeDecrypt, md5, sha1, sha256, sha512, aesDecrypt, rc4, utf16, cat, le32, u16, u32, same, fail };
})();
