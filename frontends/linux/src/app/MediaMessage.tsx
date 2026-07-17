import { useEffect, useMemo, useState } from "react";
import { downloadMedia } from "../lib/api";
import type { MediaMessagePayload } from "../lib/types";
import type { Translation } from "../lib/preferences";

export function parseMediaMessage(body: string): MediaMessagePayload | null {
  try {
    const value = JSON.parse(body) as Partial<MediaMessagePayload>;
    if (
      typeof value.object_id !== "string" ||
      typeof value.media_kind !== "string" ||
      typeof value.file_name !== "string" ||
      typeof value.content_type !== "string" ||
      typeof value.byte_len !== "number"
    ) {
      return null;
    }
    if (!["image", "video", "voice", "sticker", "file"].includes(value.media_kind)) {
      return null;
    }
    return value as MediaMessagePayload;
  } catch {
    return null;
  }
}

export function MediaMessage({
  accessToken,
  payload,
  t,
  sticker = false,
}: {
  accessToken: string;
  payload: MediaMessagePayload;
  t: Translation;
  sticker?: boolean;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setObjectUrl(null);
    setFailed(false);
    void downloadMedia(accessToken, payload.object_id)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [accessToken, payload.object_id]);

  const duration = useMemo(() => {
    if (!payload.duration_ms) return null;
    const seconds = Math.max(1, Math.round(payload.duration_ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }, [payload.duration_ms]);

  if (failed) return <span className="media-message-error">{t.uploadFailed}</span>;
  if (!objectUrl) return <span className="media-message-loading">…</span>;

  if (payload.media_kind === "image" || payload.media_kind === "sticker") {
    return (
      <>
        <button
          className={sticker || payload.media_kind === "sticker" ? "sticker-message" : "image-message"}
          type="button"
          onClick={() => setViewerOpen(true)}
          title={payload.file_name}
        >
          <img src={objectUrl} alt={payload.file_name} draggable={false} />
        </button>
        {viewerOpen && (
          <div className="media-viewer" role="presentation" onMouseDown={() => setViewerOpen(false)}>
            <button type="button" className="media-viewer-close" onClick={() => setViewerOpen(false)}>×</button>
            <img src={objectUrl} alt={payload.file_name} onMouseDown={(event) => event.stopPropagation()} />
          </div>
        )}
      </>
    );
  }

  if (payload.media_kind === "video") {
    return (
      <video className="video-message" controls preload="metadata" src={objectUrl}>
        {payload.file_name}
      </video>
    );
  }

  if (payload.media_kind === "voice") {
    return (
      <div className="voice-message">
        <span aria-hidden="true">◖)))</span>
        <audio controls preload="metadata" src={objectUrl} />
        {duration && <small>{duration}</small>}
      </div>
    );
  }

  return (
    <a className="file-message" href={objectUrl} download={payload.file_name}>
      <span aria-hidden="true">▤</span>
      <span>
        <strong>{payload.file_name}</strong>
        <small>{formatBytes(payload.byte_len)}</small>
      </span>
    </a>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
