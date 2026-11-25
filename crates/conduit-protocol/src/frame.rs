use crate::session::{FrameOpcode, SessionId};
use bytes::{Buf, BufMut, Bytes, BytesMut};

pub const FRAME_HEADER_LEN: usize = 5;

/// Encodes `[u32 session_id BE][u8 opcode][payload]`
pub fn encode_frame(session_id: SessionId, opcode: FrameOpcode, payload: &[u8]) -> Bytes {
    let mut buf = BytesMut::with_capacity(FRAME_HEADER_LEN + payload.len());
    buf.put_u32(session_id);
    buf.put_u8(opcode as u8);
    buf.put_slice(payload);
    buf.freeze()
}

/// Decodes `[u32 session_id BE][u8 opcode][payload]`
pub fn decode_frame(mut raw: Bytes) -> Option<(SessionId, FrameOpcode, Bytes)> {
    if raw.len() < FRAME_HEADER_LEN {
        return None;
    }
    let session_id = raw.get_u32();
    let opcode = FrameOpcode::try_from(raw.get_u8()).ok()?;
    Some((session_id, opcode, raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_binary_frame() {
        let encoded = encode_frame(42, FrameOpcode::Data, b"hello conduit");
        assert_eq!(encoded.len(), 5 + 13);
        let (sid, op, payload) = decode_frame(encoded).expect("valid frame");
        assert_eq!(sid, 42);
        assert_eq!(op, FrameOpcode::Data);
        assert_eq!(&payload[..], b"hello conduit");
    }

    #[test]
    fn reject_short_or_invalid_opcode() {
        assert!(decode_frame(Bytes::from_static(b"123")).is_none());
        let mut bad = BytesMut::from(&[0, 0, 0, 1, 0x7f][..]);
        assert!(decode_frame(bad.split().freeze()).is_none());
    }
}
