import { useCallback, useEffect, useMemo, useState } from 'react';
import { getItem, setItem } from '@/utils/storage';
import type { MediaStreamStatus } from '@/hooks/useMediaStatus';

const HEVC_NOTICE_DISMISSED_KEY = 'hevcNoticeDismissed';

/**
 * "浏览器不支持 H.265"提示条的手动关闭状态，持久化到 localStorage，
 * 媒体页/图像页/仪表盘预览三个入口共享：任一处关闭后其它入口也不再显示。
 */
export function useHevcNoticeDismissal(): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(
    () => getItem<boolean>(HEVC_NOTICE_DISMISSED_KEY) === true
  );
  const dismiss = useCallback(() => {
    setItem(HEVC_NOTICE_DISMISSED_KEY, true);
    setDismissed(true);
  }, []);
  return [dismissed, dismiss];
}

/** Pick the best H.264 stream to fall back to when HEVC can't be decoded. */
export function findH264Fallback(
  streams: MediaStreamStatus[],
  activeStream: string
): MediaStreamStatus | null {
  const isH264 = (s: MediaStreamStatus) => s.has_encoder && (s.codec ?? 'h264').toLowerCase() === 'h264';
  const STREAM_ORDER = ['main', 'sub', 'third'];
  return (
    streams.find(s => s.stream_id === activeStream && isH264(s))
    || streams.find(s => isH264(s))
    || STREAM_ORDER
      .map(id => streams.find(s => s.stream_id === id))
      .find((s): s is MediaStreamStatus => !!s && isH264(s))
    || null
  );
}

export type CodecNotice =
  | 'hevc_unsupported_fallback'
  | 'hevc_unsupported_no_h264'
  | null;

export interface UseStreamFallbackArgs {
  streams: MediaStreamStatus[];
  activeStream: string;
}

export interface UseStreamFallbackResult {
  effectiveStreamId: string;
  effectiveStreamInfo: MediaStreamStatus | undefined;
  codecNotice: CodecNotice;
}

/** Try the selected stream first; switch only after a fatal codec error. */
export function useStreamFallback({
  streams,
  activeStream,
}: UseStreamFallbackArgs): UseStreamFallbackResult {
  // React only after the player has exhausted its codec fallback options.
  const [reactiveFallbackId, setReactiveFallbackId] = useState<string | null>(
    null
  );
  const [reactiveNoH264, setReactiveNoH264] = useState(false);

  // activeStream stays as the user's selection; effectiveStreamId is what we
  // actually feed to the player.
  const { effectiveStreamId, effectiveStreamInfo, codecNotice } = useMemo(() => {
    const selected = streams.find(s => s.stream_id === activeStream);

    // Reactive override (codec_mismatch fired at runtime) takes precedence.
    if (reactiveFallbackId) {
      const fb = streams.find(s => s.stream_id === reactiveFallbackId);
      return {
        effectiveStreamId: reactiveFallbackId,
        effectiveStreamInfo: fb,
        codecNotice: 'hevc_unsupported_fallback' as CodecNotice,
      };
    }
    if (reactiveNoH264) {
      return {
        effectiveStreamId: activeStream,
        effectiveStreamInfo: selected,
        codecNotice: 'hevc_unsupported_no_h264' as CodecNotice,
      };
    }

    return {
      effectiveStreamId: activeStream,
      effectiveStreamInfo: selected,
      codecNotice: null,
    };
  }, [activeStream, streams, reactiveFallbackId, reactiveNoH264]);

  // Reset reactive fallback when the user switches streams.
  useEffect(() => {
    setReactiveFallbackId(null);
    setReactiveNoH264(false);
  }, [activeStream]);

  // Fall back to an H.264 stream after a fatal codec mismatch.
  useEffect(() => {
    const onWvError = (e: Event) => {
      const { detail } = e as CustomEvent<{ type?: string }>;
      if (detail?.type !== 'codec_mismatch') return;
      const fb = findH264Fallback(streams, activeStream);
      if (fb) {
        setReactiveFallbackId(fb.stream_id);
      } else {
        setReactiveNoH264(true);
      }
    };
    window.addEventListener('wv_error', onWvError);
    return () => window.removeEventListener('wv_error', onWvError);
  }, [streams, activeStream]);

  return { effectiveStreamId, effectiveStreamInfo, codecNotice };
}
