import { useCallback, useEffect, useRef, useState } from "react";
import { sendCallSignal } from "./api";
import type { CallMedia, CallSignal } from "./types";

export type CallPhase = "incoming" | "outgoing" | "connecting" | "active";

export interface PeerCallState {
  callId: string;
  conversationId: string;
  peerAccountId: string;
  media: CallMedia;
  phase: CallPhase;
}

interface UsePeerCallInput {
  accessToken: string | null;
  activeAccountId: string | null;
  onError(reason: unknown): void;
}

export function usePeerCall({
  accessToken,
  activeAccountId,
  onError,
}: UsePeerCallInput) {
  const [call, setCall] = useState<PeerCallState | null>(null);
  const callRef = useRef<PeerCallState | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingIceCallIdRef = useRef<string | null>(null);
  const ringingTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    callRef.current = call;
  }, [call]);

  const stopLocalTracks = useCallback(() => {
    setLocalStream((stream) => {
      stream?.getTracks().forEach((track) => track.stop());
      return null;
    });
  }, []);

  const clearRingingTimeout = useCallback(() => {
    if (ringingTimeoutRef.current !== null) {
      window.clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearRingingTimeout();
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    pendingOfferRef.current = null;
    pendingIceRef.current = [];
    pendingIceCallIdRef.current = null;
    stopLocalTracks();
    setRemoteStream(null);
    setMicrophoneMuted(false);
    setCameraEnabled(true);
    setCall(null);
  }, [clearRingingTimeout, stopLocalTracks]);

  useEffect(() => cleanup, [cleanup]);

  useEffect(() => {
    if (!accessToken) cleanup();
  }, [accessToken, cleanup]);

  const signal = useCallback(
    async (
      current: PeerCallState,
      signalType: "offer" | "answer" | "ice" | "hangup" | "reject" | "busy",
      payload?: unknown,
    ) => {
      if (!accessToken) return;
      await sendCallSignal(accessToken, {
        callId: current.callId,
        conversationId: current.conversationId,
        toAccountId: current.peerAccountId,
        media: current.media,
        signalType,
        payload,
      });
    },
    [accessToken],
  );

  const flushIce = useCallback(async (pc: RTCPeerConnection) => {
    const candidates = pendingIceRef.current.splice(0);
    pendingIceCallIdRef.current = null;
    for (const candidate of candidates) {
      await pc.addIceCandidate(candidate);
    }
  }, []);

  const buildPeerConnection = useCallback(
    (current: PeerCallState, stream: MediaStream) => {
      const PeerConnection = resolvePeerConnectionConstructor();
      const pc = new PeerConnection({ iceServers: rtcIceServers() });
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          void signal(current, "ice", event.candidate.toJSON()).catch(onError);
        }
      };
      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        setRemoteStream(stream);
        clearRingingTimeout();
        setCall((value) => (value ? { ...value, phase: "active" } : value));
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          clearRingingTimeout();
          setCall((value) => (value ? { ...value, phase: "active" } : value));
        }
        if (["failed", "closed"].includes(pc.connectionState)) {
          cleanup();
        }
      };
      peerConnectionRef.current = pc;
      return pc;
    },
    [cleanup, clearRingingTimeout, onError, signal],
  );

  const acquireMedia = useCallback(async (media: CallMedia) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException("Media capture is unavailable", "NotSupportedError");
    }

    // WebKitGTK can reject ideal width/height objects as an invalid constraint.
    // Let the engine choose its supported format instead.
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: media === "video",
    });
  }, []);

  const armRingingTimeout = useCallback(
    (current: PeerCallState) => {
      clearRingingTimeout();
      ringingTimeoutRef.current = window.setTimeout(() => {
        const active = callRef.current;
        if (!active || active.callId !== current.callId || active.phase === "active") return;
        const finalSignal = active.phase === "incoming" ? "reject" : "hangup";
        void signal(active, finalSignal).catch(() => undefined);
        cleanup();
      }, 45_000);
    },
    [cleanup, clearRingingTimeout, signal],
  );

  const startCall = useCallback(
    async (conversationId: string, peerAccountId: string, media: CallMedia) => {
      if (!accessToken || !activeAccountId || callRef.current) return;
      const current: PeerCallState = {
        callId: crypto.randomUUID(),
        conversationId,
        peerAccountId,
        media,
        phase: "outgoing",
      };
      try {
        const stream = await acquireMedia(media);
        setLocalStream(stream);
        setCall(current);
        armRingingTimeout(current);
        const pc = buildPeerConnection(current, stream);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await signal(current, "offer", offer);
      } catch (reason) {
        cleanup();
        onError(reason);
      }
    },
    [
      accessToken,
      acquireMedia,
      activeAccountId,
      armRingingTimeout,
      buildPeerConnection,
      cleanup,
      onError,
      signal,
    ],
  );

  const acceptCall = useCallback(async () => {
    const current = callRef.current;
    const offer = pendingOfferRef.current;
    if (!current || current.phase !== "incoming" || !offer) return;
    try {
      const stream = await acquireMedia(current.media);
      setLocalStream(stream);
      setCall({ ...current, phase: "connecting" });
      const pc = buildPeerConnection(current, stream);
      await pc.setRemoteDescription(offer);
      await flushIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await signal(current, "answer", answer);
    } catch (reason) {
      await signal(current, "reject").catch(() => undefined);
      cleanup();
      onError(reason);
    }
  }, [acquireMedia, buildPeerConnection, cleanup, flushIce, onError, signal]);

  const rejectCall = useCallback(async () => {
    const current = callRef.current;
    if (current) await signal(current, "reject").catch(() => undefined);
    cleanup();
  }, [cleanup, signal]);

  const hangUp = useCallback(async () => {
    const current = callRef.current;
    if (current) await signal(current, "hangup").catch(() => undefined);
    cleanup();
  }, [cleanup, signal]);

  const handleSignal = useCallback(
    async (incoming: CallSignal) => {
      if (!activeAccountId || incoming.to_account_id !== activeAccountId) return;
      const current = callRef.current;
      if (incoming.signal_type === "offer") {
        if (current) {
          const busyState: PeerCallState = {
            callId: incoming.call_id,
            conversationId: incoming.conversation_id,
            peerAccountId: incoming.from_account_id,
            media: incoming.media,
            phase: "incoming",
          };
          await signal(busyState, "busy").catch(() => undefined);
          return;
        }
        if (pendingIceCallIdRef.current && pendingIceCallIdRef.current !== incoming.call_id) {
          pendingIceRef.current = [];
        }
        pendingIceCallIdRef.current = incoming.call_id;
        pendingOfferRef.current = incoming.payload as RTCSessionDescriptionInit;
        const incomingCall: PeerCallState = {
          callId: incoming.call_id,
          conversationId: incoming.conversation_id,
          peerAccountId: incoming.from_account_id,
          media: incoming.media,
          phase: "incoming",
        };
        setCall(incomingCall);
        armRingingTimeout(incomingCall);
        return;
      }
      if (incoming.signal_type === "ice" && !current) {
        if (pendingIceCallIdRef.current && pendingIceCallIdRef.current !== incoming.call_id) {
          pendingIceRef.current = [];
        }
        pendingIceCallIdRef.current = incoming.call_id;
        pendingIceRef.current.push(incoming.payload as RTCIceCandidateInit);
        return;
      }
      if (!current || incoming.call_id !== current.callId) return;
      if (["hangup", "reject", "busy"].includes(incoming.signal_type)) {
        cleanup();
        return;
      }
      const pc = peerConnectionRef.current;
      if (incoming.signal_type === "answer" && pc) {
        await pc.setRemoteDescription(incoming.payload as RTCSessionDescriptionInit);
        await flushIce(pc);
        setCall({ ...current, phase: "connecting" });
        return;
      }
      if (incoming.signal_type === "ice") {
        const candidate = incoming.payload as RTCIceCandidateInit;
        if (pc?.remoteDescription) await pc.addIceCandidate(candidate);
        else pendingIceRef.current.push(candidate);
      }
    },
    [activeAccountId, armRingingTimeout, cleanup, flushIce, signal],
  );

  const toggleMicrophone = useCallback(() => {
    setMicrophoneMuted((muted) => {
      localStream?.getAudioTracks().forEach((track) => {
        track.enabled = muted;
      });
      return !muted;
    });
  }, [localStream]);

  const toggleCamera = useCallback(() => {
    setCameraEnabled((enabled) => {
      localStream?.getVideoTracks().forEach((track) => {
        track.enabled = !enabled;
      });
      return !enabled;
    });
  }, [localStream]);

  return {
    call,
    localStream,
    remoteStream,
    microphoneMuted,
    cameraEnabled,
    startCall,
    acceptCall,
    rejectCall,
    hangUp,
    handleSignal,
    toggleMicrophone,
    toggleCamera,
  };
}

function rtcIceServers(): RTCIceServer[] {
  const raw = import.meta.env.VITE_RTC_ICE_SERVERS?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is RTCIceServer => {
      if (!value || typeof value !== "object") return false;
      const urls = (value as RTCIceServer).urls;
      return typeof urls === "string" || (Array.isArray(urls) && urls.every((url) => typeof url === "string"));
    });
  } catch {
    return [];
  }
}

type PeerConnectionConstructor = new (
  configuration?: RTCConfiguration,
) => RTCPeerConnection;

function resolvePeerConnectionConstructor(): PeerConnectionConstructor {
  const scope = globalThis as typeof globalThis & {
    webkitRTCPeerConnection?: PeerConnectionConstructor;
  };
  const constructor = scope.RTCPeerConnection ?? scope.webkitRTCPeerConnection;
  if (!constructor) {
    throw new DOMException("RTCPeerConnection is unavailable", "NotSupportedError");
  }
  return constructor;
}
