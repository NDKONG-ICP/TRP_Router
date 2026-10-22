//! Placeholder on-chain Raven art compositor (procedural PNG). Replace with blob_store trait layers when art ships.

use sha2::{Digest, Sha256};

fn seed_from_prompt(prompt: &str, seed_override: Option<u64>) -> u64 {
    if let Some(s) = seed_override {
        return s;
    }
    let h = Sha256::digest(prompt.as_bytes());
    u64::from_le_bytes(h[0..8].try_into().unwrap())
}

fn crc32(data: &[u8]) -> u32 {
    let mut c = !0u32;
    for &b in data {
        c ^= b as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 {
                0xedb8_8320 ^ (c >> 1)
            } else {
                c >> 1
            };
        }
    }
    !c
}

fn chunk(tag: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let len = (data.len() as u32).to_be_bytes();
    let mut raw = Vec::new();
    raw.extend_from_slice(&len);
    raw.extend_from_slice(tag);
    raw.extend_from_slice(data);
    let crc = crc32(&raw);
    raw.extend_from_slice(&crc.to_be_bytes());
    raw
}

/// 64×64 RGBA PNG — layered-style bands + simple “raven” silhouette from seed (placeholder engine).
pub fn compose_png(prompt: &str, seed_override: Option<u64>) -> Vec<u8> {
    const W: usize = 64;
    const H: usize = 64;
    let seed = seed_from_prompt(prompt, seed_override);
    let mut rgba = vec![0u8; W * H * 4];
    for y in 0..H {
        for x in 0..W {
            let i = (y * W + x) * 4;
            let layer_bg = ((seed >> 0) % 360) as u8;
            let layer_body = ((seed >> 8) % 200) as u8;
            let layer_accent = ((seed >> 16) % 255) as u8;
            let (r, g, b) = if y < H / 3 {
                (20 + layer_bg / 2, 10, 40 + layer_accent / 3)
            } else if y < 2 * H / 3 {
                (30 + layer_body / 3, 20 + layer_accent / 4, 60 + layer_bg / 2)
            } else {
                (layer_accent, 180 + layer_body / 4, 40 + layer_bg / 3)
            };
            let dx = x as i32 - 32;
            let dy = y as i32 - 28;
            let bird = dx * dx + dy * dy < 180;
            let (r, g, b) = if bird {
                (10, 10, 12)
            } else {
                (r, g, b)
            };
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
            rgba[i + 3] = 255;
        }
    }
    let mut raw = Vec::new();
    raw.extend_from_slice(&[0, H as u8, 0, 0, W as u8, 0, 0, 8, 6, 0, 0, 0]); // filter none, 8-bit RGBA
    raw.extend_from_slice(&rgba);
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&(W as u32).to_be_bytes());
    ihdr[4..8].copy_from_slice(&(H as u32).to_be_bytes());
    ihdr[8] = 8;
    ihdr[9] = 6;
    out.extend_from_slice(&chunk(b"IHDR", &ihdr));
    out.extend_from_slice(&chunk(b"IDAT", &deflate_store(&raw)));
    out.extend_from_slice(&chunk(b"IEND", &[]));
    out
}

fn deflate_store(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut pos = 0;
    while pos < data.len() {
        let block_len = (data.len() - pos).min(65535);
        let bfinal = pos + block_len >= data.len();
        out.push(if bfinal { 1 } else { 0 });
        out.extend_from_slice(&(block_len as u16).to_le_bytes());
        out.extend_from_slice(&(!block_len as u16).to_le_bytes());
        out.extend_from_slice(&data[pos..pos + block_len]);
        pos += block_len;
    }
    let adler = adler32(data);
    out.extend_from_slice(&adler.to_be_bytes());
    out
}

fn adler32(data: &[u8]) -> u32 {
    let mut a = 1u32;
    let mut b = 0u32;
    for &byte in data {
        a = (a + byte as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}
