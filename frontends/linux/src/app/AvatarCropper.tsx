import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { Translation } from "../lib/preferences";

const STAGE_SIZE = 360;
const CROP_SIZE = 280;
const OUTPUT_SIZE = 512;

interface LoadedImage {
  element: HTMLImageElement;
  width: number;
  height: number;
}

export function AvatarCropper({
  source,
  busy,
  t,
  onCancel,
  onSave,
}: {
  source: string;
  busy: boolean;
  t: Translation;
  onCancel(): void;
  onSave(dataUrl: string): Promise<void>;
}) {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const element = new Image();
    element.onload = () => {
      setImage({ element, width: element.naturalWidth, height: element.naturalHeight });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    element.src = source;
  }, [source]);

  const baseScale = useMemo(() => {
    if (!image) return 1;
    return Math.max(CROP_SIZE / image.width, CROP_SIZE / image.height);
  }, [image]);
  const scale = baseScale * zoom;
  const rendered = image
    ? { width: image.width * scale, height: image.height * scale }
    : { width: CROP_SIZE, height: CROP_SIZE };

  function clampOffset(next: { x: number; y: number }) {
    const maxX = Math.max(0, (rendered.width - CROP_SIZE) / 2);
    const maxY = Math.max(0, (rendered.height - CROP_SIZE) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset(
      clampOffset({
        x: drag.ox + event.clientX - drag.x,
        y: drag.oy + event.clientY - drag.y,
      }),
    );
  }

  function endDrag() {
    dragRef.current = null;
  }

  async function save() {
    if (!image) return;
    const imageLeft = (STAGE_SIZE - rendered.width) / 2 + offset.x;
    const imageTop = (STAGE_SIZE - rendered.height) / 2 + offset.y;
    const cropLeft = (STAGE_SIZE - CROP_SIZE) / 2;
    const cropTop = (STAGE_SIZE - CROP_SIZE) / 2;
    const sourceX = (cropLeft - imageLeft) / scale;
    const sourceY = (cropTop - imageTop) / scale;
    const sourceSize = CROP_SIZE / scale;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image.element,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      OUTPUT_SIZE,
      OUTPUT_SIZE,
    );
    try {
      await onSave(canvas.toDataURL("image/jpeg", 0.88));
    } catch {
      // The parent reports the API error in the main window.
    }
  }

  return (
    <div className="avatar-crop-overlay" role="presentation" onMouseDown={onCancel}>
      <section
        className="avatar-crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t.cropAvatar}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2>{t.cropAvatar}</h2>
          <button type="button" onClick={onCancel}>×</button>
        </header>
        <div
          className="avatar-crop-stage"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {image && (
            <img
              src={source}
              alt=""
              draggable={false}
              style={{
                width: rendered.width,
                height: rendered.height,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          )}
          <div className="avatar-crop-window" />
        </div>
        <label className="avatar-zoom-row">
          <span>{t.zoom}</span>
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(event) => {
              setZoom(Number(event.target.value));
              setOffset({ x: 0, y: 0 });
            }}
          />
        </label>
        <p>{t.cropAvatarHint}</p>
        <footer>
          <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>
            {t.cancel}
          </button>
          <button className="primary-button" type="button" onClick={() => void save()} disabled={!image || busy}>
            {busy ? t.pleaseWait : t.saveAvatar}
          </button>
        </footer>
      </section>
    </div>
  );
}
