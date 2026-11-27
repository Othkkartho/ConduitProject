use bytes::Bytes;
use encoding_rs::{CoderResult, Decoder, Encoding, UTF_8};

/// Resolves an IANA/WHATWG encoding label (e.g., `"utf-8"`, `"euc-kr"`, `"shift_jis"`)
/// into a static `encoding_rs::Encoding`, falling back to UTF-8 if unknown.
pub fn resolve_encoding(label: &str) -> &'static Encoding {
    Encoding::for_label(label.trim().as_bytes()).unwrap_or(UTF_8)
}

/// Stateful incremental decoder that transcodes session output bytes into UTF-8
/// for `xterm.js` while preserving incomplete multi-byte sequences across chunks.
pub struct StreamDecoder {
    encoding: &'static Encoding,
    decoder: Decoder,
}

impl StreamDecoder {
    pub fn new(encoding: &'static Encoding) -> Self {
        Self {
            encoding,
            decoder: encoding.new_decoder(),
        }
    }

    pub fn set_encoding(&mut self, encoding: &'static Encoding) {
        if !std::ptr::eq(self.encoding, encoding) {
            self.encoding = encoding;
            self.decoder = encoding.new_decoder();
        }
    }

    pub fn decode_chunk(&mut self, chunk: Bytes) -> Bytes {
        if std::ptr::eq(self.encoding, UTF_8) {
            return chunk;
        }
        let cap = self
            .decoder
            .max_utf8_buffer_length(chunk.len())
            .unwrap_or_else(|| chunk.len().saturating_mul(3).saturating_add(16));
        let mut out = String::with_capacity(cap);
        let mut offset = 0;
        while offset < chunk.len() {
            let (res, read, _) = self.decoder.decode_to_string(&chunk[offset..], &mut out, false);
            offset += read;
            if matches!(res, CoderResult::OutputFull) {
                out.reserve(
                    chunk
                        .len()
                        .saturating_sub(offset)
                        .saturating_mul(3)
                        .saturating_add(32),
                );
            } else {
                break;
            }
        }
        Bytes::from(out.into_bytes())
    }
}

/// Encodes UTF-8 terminal input bytes from `xterm.js` into the target session encoding.
pub fn encode_input(encoding: &'static Encoding, utf8_bytes: Bytes) -> Bytes {
    if std::ptr::eq(encoding, UTF_8) {
        return utf8_bytes;
    }
    match std::str::from_utf8(&utf8_bytes) {
        Ok(text) => {
            let (encoded, _, _) = encoding.encode(text);
            Bytes::from(encoded.into_owned())
        }
        Err(_) => utf8_bytes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_passthrough_is_zero_copy() {
        let enc = resolve_encoding("utf-8");
        let raw = Bytes::from_static(b"hello ptyloom");
        let ptr = raw.as_ptr();
        let mut dec = StreamDecoder::new(enc);
        let out = dec.decode_chunk(raw.clone());
        assert_eq!(out.as_ptr(), ptr);
        let inp = encode_input(enc, raw);
        assert_eq!(inp.as_ptr(), ptr);
    }

    #[test]
    fn euc_kr_roundtrip_and_split_chunk_decoding() {
        let enc = resolve_encoding("euc-kr");
        let input = Bytes::from("안녕하세요\r\n");
        let wire = encode_input(enc, input);
        assert_ne!(&wire[..], "안녕하세요\r\n".as_bytes());

        let mut dec = StreamDecoder::new(enc);
        let mut reconstructed = Vec::new();
        for b in wire.iter() {
            let part = dec.decode_chunk(Bytes::copy_from_slice(&[*b]));
            reconstructed.extend_from_slice(&part);
        }
        assert_eq!(String::from_utf8(reconstructed).unwrap(), "안녕하세요\r\n");
    }
}
