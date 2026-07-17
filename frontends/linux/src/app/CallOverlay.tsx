import { useEffect, useRef } from "react";
import type { Account } from "../lib/types";
import type { Translation } from "../lib/preferences";
import type { PeerCallState } from "../lib/usePeerCall";
import { UserAvatar } from "./UserAvatar";

export function CallOverlay({
  call,
  peer,
  localStream,
  remoteStream,
  microphoneMuted,
  cameraEnabled,
  t,
  onAccept,
  onReject,
  onHangUp,
  onToggleMicrophone,
  onToggleCamera,
}: {
  call: PeerCallState;
  peer: Account | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  microphoneMuted: boolean;
  cameraEnabled: boolean;
  t: Translation;
  onAccept(): void;
  onReject(): void;
  onHangUp(): void;
  onToggleMicrophone(): void;
  onToggleCamera(): void;
}) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);
  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  const peerName = peer?.remark_name?.trim() || peer?.display_name || peer?.username || "Unknown";
  const incoming = call.phase === "incoming";
  const status = incoming
    ? call.media === "video"
      ? t.incomingVideoCall
      : t.incomingAudioCall
    : call.phase === "outgoing"
      ? t.calling
      : call.phase === "active"
        ? t.callConnected
        : t.connectingCall;

  return (
    <div className={`call-overlay ${call.media}`} role="dialog" aria-modal="true">
      <section className="call-window">
        {call.media === "video" && !incoming ? (
          <div className="call-video-stage">
            <video ref={remoteVideoRef} className="call-remote-video" autoPlay playsInline />
            {!remoteStream && <div className="call-video-placeholder"><UserAvatar label={peerName} avatarUrl={peer?.avatar_data_url} /></div>}
            <video ref={localVideoRef} className="call-local-video" autoPlay playsInline muted />
          </div>
        ) : (
          <div className="call-audio-stage">
            <UserAvatar label={peerName} avatarUrl={peer?.avatar_data_url} />
            <h2>{peerName}</h2>
          </div>
        )}
        <p className="call-status">{status}</p>
        <audio ref={remoteAudioRef} autoPlay />
        <div className="call-actions">
          {incoming ? (
            <>
              <button className="call-action reject" type="button" onClick={onReject}>×<span>{t.rejectCall}</span></button>
              <button className="call-action accept" type="button" onClick={onAccept}>✓<span>{t.acceptCall}</span></button>
            </>
          ) : (
            <>
              <button className={`call-action secondary ${microphoneMuted ? "active" : ""}`} type="button" onClick={onToggleMicrophone}>
                {microphoneMuted ? "🔇" : "🎙"}<span>{microphoneMuted ? t.unmuteMicrophone : t.muteMicrophone}</span>
              </button>
              {call.media === "video" && (
                <button className={`call-action secondary ${!cameraEnabled ? "active" : ""}`} type="button" onClick={onToggleCamera}>
                  {cameraEnabled ? "▣" : "▧"}<span>{cameraEnabled ? t.disableCamera : t.enableCamera}</span>
                </button>
              )}
              <button className="call-action reject" type="button" onClick={onHangUp}>×<span>{t.endCall}</span></button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
