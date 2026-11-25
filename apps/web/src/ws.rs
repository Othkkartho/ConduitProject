use crate::WebState;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use bytes::{Buf, Bytes};
use conduit_protocol::{decode_frame, encode_frame, FrameOpcode, SessionConfig, SessionId, TerminalSize};
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum WsClientControl {
    Create {
        #[serde(rename = "requestId")]
        request_id: u32,
        config: SessionConfig,
    },
    Broadcast {
        #[serde(rename = "sessionIds")]
        session_ids: Vec<SessionId>,
        data: Vec<u8>,
    },
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<WebState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: WebState) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(256);

    let send_task = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => {
                if let Ok(ctrl) = serde_json::from_str::<WsClientControl>(&text) {
                    match ctrl {
                        WsClientControl::Create { request_id, config } => {
                            let tx_clone = out_tx.clone();
                            let sid_holder = Arc::new(AtomicU32::new(0));
                            let sid_ref = Arc::clone(&sid_holder);

                            match state
                                .sessions
                                .create_session(config, move |chunk| {
                                    let sid = sid_ref.load(Ordering::Acquire);
                                    if sid == 0 {
                                        return true;
                                    }
                                    let frame = encode_frame(sid, FrameOpcode::Data, &chunk);
                                    tx_clone.try_send(Message::Binary(frame)).is_ok()
                                })
                                .await
                            {
                                Ok(id) => {
                                    sid_holder.store(id, Ordering::Release);
                                    let ack = serde_json::json!({
                                        "type": "created",
                                        "requestId": request_id,
                                        "sessionId": id
                                    });
                                    let _ = out_tx
                                        .send(Message::Text(ack.to_string().into()))
                                        .await;
                                }
                                Err(err) => {
                                    let fail = serde_json::json!({
                                        "type": "error",
                                        "requestId": request_id,
                                        "error": err.to_string()
                                    });
                                    let _ = out_tx
                                        .send(Message::Text(fail.to_string().into()))
                                        .await;
                                }
                            }
                        }
                        WsClientControl::Broadcast { session_ids, data } => {
                            state
                                .sessions
                                .broadcast(&session_ids, Bytes::from(data))
                                .await;
                        }
                    }
                }
            }
            Message::Binary(raw) => {
                if let Some((session_id, opcode, mut payload)) = decode_frame(raw) {
                    match opcode {
                        FrameOpcode::Data => {
                            let _ = state.sessions.write(session_id, payload).await;
                        }
                        FrameOpcode::Resize if payload.len() >= 4 => {
                            let cols = payload.get_u16();
                            let rows = payload.get_u16();
                            let _ = state
                                .sessions
                                .resize(session_id, TerminalSize { cols, rows })
                                .await;
                        }
                        FrameOpcode::Ack if payload.len() >= 4 => {
                            let bytes = payload.get_u32() as usize;
                            state.sessions.ack(session_id, bytes);
                        }
                        FrameOpcode::Close => {
                            let _ = state.sessions.close(session_id).await;
                        }
                        _ => {}
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    send_task.abort();
}
