"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { SubformRef } from "@/src/contracts/high-level/components";
import Spinner from "@/src/components/shared/Spinner";
import { resizeImage } from "@/src/lib/resize-image";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type {
  HumanFace,
  HumanInstance,
  HumanResult,
} from "@/systems/grex-id/src/contracts/high-level/human";
import type { FacialBiometricsSubformProps } from "@/systems/grex-id/src/contracts/high-level/component-props";

/* ------------------------------------------------------------------ */
/*  Human.js CDN loader (module-level, runs once)                      */
/* ------------------------------------------------------------------ */

const HUMAN_SCRIPT_ID = "human-browser-script";
const HUMAN_CDN = "https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6";

function loadHumanScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Browser-only"));
  }
  if (window.Human?.Human) return Promise.resolve();
  if (window.__humanScriptPromise) return window.__humanScriptPromise;

  window.__humanScriptPromise = new Promise<void>((resolve, reject) => {
    const finish = () => {
      if (window.Human?.Human) resolve();
      else {reject(
          new Error("Human script loaded but window.Human.Human missing"),
        );}
    };

    const existing = document.getElementById(HUMAN_SCRIPT_ID) as
      | HTMLScriptElement
      | null;
    if (existing) {
      if (existing.dataset.loaded === "true") finish();
      else {
        existing.addEventListener("load", finish, { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("Failed to load Human script")),
          { once: true },
        );
      }
      return;
    }

    const script = document.createElement("script");
    script.id = HUMAN_SCRIPT_ID;
    script.src = `${HUMAN_CDN}/dist/human.js`;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      finish();
    };
    script.onerror = () => {
      window.__humanScriptPromise = undefined;
      reject(new Error("Failed to load Human script"));
    };
    document.head.appendChild(script);
  });

  return window.__humanScriptPromise;
}

/* ------------------------------------------------------------------ */
/*  Human.js singleton                                                 */
/* ------------------------------------------------------------------ */

const humanConfig: Record<string, unknown> = {
  modelBasePath: `${HUMAN_CDN}/models/`,
  cacheSensitivity: 0,
  face: {
    enabled: true,
    detector: { enabled: true, maxDetected: 1, rotation: false },
    mesh: { enabled: true },
    description: { enabled: true, minConfidence: 0.5 },
    iris: { enabled: false },
    emotion: { enabled: false },
    antispoof: { enabled: false },
    liveness: { enabled: false },
  },
  body: { enabled: false },
  hand: { enabled: false },
  gesture: { enabled: false },
  segmentation: { enabled: false },
};

let humanSingleton: HumanInstance | null = null;
let humanInitPromise: Promise<HumanInstance> | null = null;

function getHumanInstance(): Promise<HumanInstance> {
  if (humanSingleton) return Promise.resolve(humanSingleton);
  if (humanInitPromise) return humanInitPromise;

  humanInitPromise = (async () => {
    await loadHumanScript();
    if (!window.Human?.Human) throw new Error("Human not available");
    const human = new window.Human.Human(humanConfig);
    await human.load();
    try {
      await human.warmup();
    } catch { /* warmup is optional */ }
    humanSingleton = human;
    return human;
  })();

  humanInitPromise.catch(() => {
    humanInitPromise = null;
  });
  return humanInitPromise;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const DETECTION_INTERVAL_MS = 500;
const MIN_FACE_SCORE = 0.5;
const CAMERA_CONSTRAINTS = {
  video: { facingMode: "user" as const, width: 480, height: 360 },
  audio: false,
};

const FacialBiometricsSubform = forwardRef<
  SubformRef,
  FacialBiometricsSubformProps
>(
  ({ initialData, companyId, systemSlug, systemToken }, ref) => {
    const { t } = useTenantContext();

    // DOM refs
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const humanRef = useRef<HumanInstance | null>(null);
    const detectionIntervalRef = useRef<number | null>(null);

    // State
    const [modelsLoaded, setModelsLoaded] = useState(false);
    const [cameraReady, setCameraReady] = useState(false);
    const [faceDetected, setFaceDetected] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [avatarUri, setAvatarUri] = useState<string | null>(
      (initialData?.avatarUri as string) ?? null,
    );
    const [faceDescriptor, setFaceDescriptor] = useState<number[] | null>(
      (initialData?.faceDescriptor as number[]) ?? null,
    );
    const [cameraError, setCameraError] = useState("");

    // Refs that mirror state — needed so getData() always reads latest values
    const faceDescriptorRef = useRef(faceDescriptor);
    faceDescriptorRef.current = faceDescriptor;
    const avatarUriRef = useRef(avatarUri);
    avatarUriRef.current = avatarUri;
    const uploadingRef = useRef(uploading);
    uploadingRef.current = uploading;

    // Expose getData / isValid to FormModal
    useImperativeHandle(ref, () => ({
      getData: () => ({
        faceDescriptor: faceDescriptorRef.current ?? undefined,
        avatarUri: avatarUriRef.current ?? undefined,
      }),
      isValid: () => !uploadingRef.current,
    }));

    // Load Human.js models on mount
    useEffect(() => {
      let cancelled = false;
      getHumanInstance()
        .then((human) => {
          if (!cancelled) {
            humanRef.current = human;
            setModelsLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled) setCameraError("models_error");
        });
      return () => {
        cancelled = true;
      };
    }, []);

    // Camera controls
    const startCamera = useCallback(async () => {
      if (!navigator?.mediaDevices) {
        setCameraError("camera_error");
        return;
      }
      try {
        setCameraError("");
        const stream = await navigator.mediaDevices.getUserMedia(
          CAMERA_CONSTRAINTS,
        );
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            void videoRef.current?.play();
            setCameraReady(true);
          };
        }
      } catch {
        setCameraError("camera_error");
      }
    }, []);

    const stopCamera = useCallback(() => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraReady(false);
    }, []);

    // Start/stop camera based on capture state
    useEffect(() => {
      if (!capturedImage) startCamera();
      return () => stopCamera();
    }, [startCamera, stopCamera, capturedImage]);

    // Real-time face detection loop
    useEffect(() => {
      if (!cameraReady || !modelsLoaded || capturedImage) return;
      let busy = false;
      detectionIntervalRef.current = window.setInterval(async () => {
        if (busy || !videoRef.current || !humanRef.current) return;
        busy = true;
        try {
          const result = await humanRef.current.detect(videoRef.current);
          setFaceDetected(
            result.face.length > 0 &&
              (result.face[0].faceScore ?? 0) > MIN_FACE_SCORE,
          );
        } catch {
          /* ignore */
        } finally {
          busy = false;
        }
      }, DETECTION_INTERVAL_MS);

      return () => {
        if (detectionIntervalRef.current) {
          clearInterval(detectionIntervalRef.current);
          detectionIntervalRef.current = null;
        }
      };
    }, [cameraReady, modelsLoaded, capturedImage]);

    // Capture face + upload avatar
    const handleCapture = async () => {
      if (!videoRef.current || !canvasRef.current || !humanRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 480;
      canvas.height = video.videoHeight || 360;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const result = await humanRef.current.detect(canvas);
      const face = result.face[0];
      if (!face?.embedding?.length) {
        setCameraError("no_face");
        return;
      }

      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      setCapturedImage(dataUrl);
      setFaceDescriptor(Array.from(face.embedding));
      setCameraError("");
      stopCamera();

      // Upload captured photo as avatar
      setUploading(true);
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const fileUuid = crypto.randomUUID();
        const rawFile = new File([blob], `face_${fileUuid}.jpg`, {
          type: "image/jpeg",
        });
        const resized = await resizeImage(rawFile, {
          width: 128,
          format: "image/webp",
        });
        const uploadFile = new File(
          [new Blob([resized as BlobPart], { type: "image/webp" })],
          `face_${fileUuid}.webp`,
          { type: "image/webp" },
        );
        const formData = new FormData();
        formData.append("file", uploadFile);
        formData.append("systemSlug", systemSlug ?? "grex-id");
        formData.append("category", JSON.stringify(["lead-avatars"]));
        formData.append("fileUuid", fileUuid);

        const headers: HeadersInit = {};
        if (systemToken) headers["Authorization"] = `Bearer ${systemToken}`;

        const res = await fetch("/api/files/upload", {
          method: "POST",
          headers,
          body: formData,
        });
        const json = await res.json();
        if (json.success && json.data?.uri) setAvatarUri(json.data.uri);
      } catch {
        // Upload failed — face data is still captured locally
      } finally {
        setUploading(false);
      }
    };

    const handleRetake = () => {
      setCapturedImage(null);
      setAvatarUri(null);
      setFaceDescriptor(null);
      setFaceDetected(false);
      setCameraError("");
    };

    // Resolve error message
    const errorMessage = cameraError === "models_error"
      ? t("systems.grex-id.face.modelsError")
      : cameraError === "camera_error"
      ? t("systems.grex-id.face.cameraError")
      : cameraError === "no_face"
      ? t("systems.grex-id.face.noFaceDetected")
      : cameraError;

    /* ---- Status badge (reused in live feed + captured image) ---- */
    const badgeClass =
      "inline-flex items-center gap-1 text-xs bg-black/70 backdrop-blur-sm px-3 py-1 rounded-full border";

    const liveBadge = !modelsLoaded
      ? (
        <span className={`${badgeClass} text-yellow-400 border-yellow-400/30`}>
          <Spinner size="sm" /> {t("systems.grex-id.face.loadingModels")}
        </span>
      )
      : faceDetected
      ? (
        <span
          className={`${badgeClass} text-[var(--color-primary-green)] border-[var(--color-primary-green)]/30`}
        >
          ✓ {t("systems.grex-id.face.detected")}
        </span>
      )
      : (
        <span
          className={`${badgeClass} text-[var(--color-light-text)] border-[var(--color-dark-gray)]`}
        >
          👁 {t("systems.grex-id.face.positionFace")}
        </span>
      );

    const capturedBadge = uploading
      ? (
        <span className={`${badgeClass} text-yellow-400 border-yellow-400/30`}>
          <Spinner size="sm" /> {t("common.uploading")}
        </span>
      )
      : (
        <span
          className={`${badgeClass} text-[var(--color-primary-green)] border-[var(--color-primary-green)]/30`}
        >
          ✓ {t("systems.grex-id.face.registered")}
        </span>
      );

    /* ---- Shared styles for video/image ---- */
    const mediaStyle = {
      minHeight: "220px",
      maxHeight: "300px",
      transform: "scaleX(-1)",
    };
    const mediaClass = "w-full h-auto rounded-xl object-cover";

    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--color-secondary-blue)] mb-3 flex items-center gap-2">
          <span>📸</span> {t("systems.grex-id.face.title")}
        </h3>

        <div className="relative w-full rounded-xl overflow-hidden border border-dashed border-[var(--color-dark-gray)] bg-black/60 backdrop-blur-sm">
          {/* Live camera feed */}
          {!capturedImage && !cameraError && (
            <div className="relative">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={mediaClass}
                style={mediaStyle}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                  className={`w-40 h-52 rounded-full border-2 border-dashed transition-colors duration-300 ${
                    faceDetected
                      ? "border-[var(--color-primary-green)] shadow-[0_0_20px_rgba(2,208,125,0.5)]"
                      : "border-[var(--color-dark-gray)]"
                  }`}
                />
              </div>
              <div className="absolute top-3 left-3">{liveBadge}</div>
            </div>
          )}

          {/* Captured image preview */}
          {capturedImage && (
            <div className="relative">
              <img
                src={capturedImage}
                alt={t("systems.grex-id.face.capturedAlt")}
                className={mediaClass}
                style={mediaStyle}
              />
              <div className="absolute top-3 left-3">{capturedBadge}</div>
            </div>
          )}

          {/* Camera error */}
          {cameraError && !capturedImage && (
            <div className="flex flex-col items-center justify-center py-10 px-4 text-center min-h-[220px]">
              <span className="text-3xl mb-3">📷</span>
              <p className="text-red-400 text-xs">{errorMessage}</p>
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Action button */}
        <div className="flex gap-3">
          {!capturedImage
            ? (
              <button
                type="button"
                onClick={handleCapture}
                disabled={!faceDetected || !modelsLoaded}
                className="flex-1 rounded-lg border border-[var(--color-primary-green)]/40 bg-gradient-to-r from-[var(--color-secondary-blue)]/20 to-[var(--color-primary-green)]/20 py-3 px-4 text-xs font-bold text-[var(--color-primary-green)] hover:border-[var(--color-primary-green)] hover:shadow-lg hover:shadow-[var(--color-light-green)]/20 transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                📸 {t("systems.grex-id.face.capture")}
              </button>
            )
            : (
              <button
                type="button"
                onClick={handleRetake}
                className="flex-1 rounded-lg border border-[var(--color-dark-gray)] bg-white/5 py-3 px-4 text-xs font-bold text-[var(--color-light-text)] hover:border-[var(--color-secondary-blue)]/50 hover:text-[var(--color-secondary-blue)] transition-all duration-300"
              >
                🔄 {t("systems.grex-id.face.retake")}
              </button>
            )}
        </div>
      </div>
    );
  },
);

FacialBiometricsSubform.displayName = "FacialBiometricsSubform";
export default FacialBiometricsSubform;
