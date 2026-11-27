use bytes::{Bytes, BytesMut};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Notify};

pub const MAX_BATCH_BYTES: usize = 64 * 1024;
pub const COALESCE_WINDOW: Duration = Duration::from_millis(4);
pub const HIGH_WATERMARK: usize = 512 * 1024;

/// Tracks unacknowledged bytes in flight to `xterm.js` and pauses the
/// backend output pump once `HIGH_WATERMARK` is reached.
#[derive(Default)]
pub struct FlowController {
    in_flight: AtomicUsize,
    notify: Notify,
}

impl FlowController {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn in_flight(&self) -> usize {
        self.in_flight.load(Ordering::Acquire)
    }

    pub async fn wait_for_credit(&self) {
        while self.in_flight.load(Ordering::Acquire) >= HIGH_WATERMARK {
            self.notify.notified().await;
        }
    }

    pub fn consume(&self, len: usize) {
        self.in_flight.fetch_add(len, Ordering::Release);
    }

    pub fn ack(&self, len: usize) {
        let mut cur = self.in_flight.load(Ordering::Acquire);
        loop {
            let next = cur.saturating_sub(len);
            match self.in_flight.compare_exchange_weak(
                cur,
                next,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(prev) => {
                    if prev >= HIGH_WATERMARK && next < HIGH_WATERMARK {
                        self.notify.notify_waiters();
                    }
                    break;
                }
                Err(actual) => cur = actual,
            }
        }
    }
}

/// Adaptive output coalescer:
/// - In idle/interactive typing mode, flushes immediately (<1ms latency).
/// - In burst flood mode, coalesces up to `MAX_BATCH_BYTES` or `COALESCE_WINDOW`.
pub async fn run_output_pump<F>(
    mut raw_rx: mpsc::Receiver<Bytes>,
    flow: Arc<FlowController>,
    mut on_chunk: F,
) where
    F: FnMut(Bytes) -> bool + Send + 'static,
{
    let mut buf = BytesMut::with_capacity(MAX_BATCH_BYTES);
    let mut last_flush = Instant::now() - COALESCE_WINDOW;

    while let Some(first) = raw_rx.recv().await {
        flow.wait_for_credit().await;
        buf.extend_from_slice(&first);

        while buf.len() < MAX_BATCH_BYTES {
            match raw_rx.try_recv() {
                Ok(chunk) => buf.extend_from_slice(&chunk),
                Err(_) => break,
            }
        }

        if last_flush.elapsed() < COALESCE_WINDOW && buf.len() < MAX_BATCH_BYTES {
            let deadline = tokio::time::Instant::now() + COALESCE_WINDOW;
            while buf.len() < MAX_BATCH_BYTES {
                match tokio::time::timeout_at(deadline, raw_rx.recv()).await {
                    Ok(Some(chunk)) => buf.extend_from_slice(&chunk),
                    Ok(None) | Err(_) => break,
                }
            }
        }

        let payload = buf.split().freeze();
        flow.consume(payload.len());
        last_flush = Instant::now();

        if !on_chunk(payload) {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[tokio::test]
    async fn idle_single_chunk_flushes_immediately() {
        let (tx, rx) = mpsc::channel(16);
        let flow = FlowController::new();
        let received = Arc::new(Mutex::new(Vec::<Bytes>::new()));
        let rec_clone = Arc::clone(&received);

        let handle = tokio::spawn(run_output_pump(rx, flow, move |chunk| {
            rec_clone.lock().unwrap().push(chunk);
            true
        }));

        let start = Instant::now();
        tx.send(Bytes::from_static(b"a")).await.unwrap();
        drop(tx);
        handle.await.unwrap();

        assert!(start.elapsed() < Duration::from_millis(100));
        let chunks = received.lock().unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(&chunks[0][..], b"a");
    }

    #[tokio::test]
    async fn burst_chunks_coalesce() {
        let (tx, rx) = mpsc::channel(128);
        let flow = FlowController::new();
        let received = Arc::new(Mutex::new(Vec::<Bytes>::new()));
        let rec_clone = Arc::clone(&received);

        for i in 0..20 {
            tx.send(Bytes::from(format!("line-{i}\n"))).await.unwrap();
        }
        drop(tx);

        run_output_pump(rx, flow, move |chunk| {
            rec_clone.lock().unwrap().push(chunk);
            true
        })
        .await;

        let chunks = received.lock().unwrap();
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].len() > 100);
    }

    #[tokio::test]
    async fn flow_controller_blocks_and_resumes_on_ack() {
        let flow = FlowController::new();
        flow.consume(HIGH_WATERMARK);
        assert_eq!(flow.in_flight(), HIGH_WATERMARK);

        let flow2 = Arc::clone(&flow);
        let waiter = tokio::spawn(async move {
            flow2.wait_for_credit().await;
        });

        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!waiter.is_finished());

        flow.ack(HIGH_WATERMARK / 2);
        tokio::time::timeout(Duration::from_millis(200), waiter)
            .await
            .expect("waiter should resume after ack")
            .unwrap();
    }
}
