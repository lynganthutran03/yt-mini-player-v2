import React, { useState, useEffect, useRef } from 'react';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalPosition, LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';

interface YTMusicData {
  title: string;
  artist: string;
  album: string;
  thumb: string;
  isPlaying: boolean;
  volume: number;
  isShuffleActive: boolean;
  loopState: 'none' | 'all' | 'one';
  currentTime: number;
  duration: number;
  repeatDebug?: string;
  source?: 'local';
}

interface PlayerFullscreenData {
  isFullscreen: boolean;
}

interface PlayerLoadData {
  status: 'loading' | 'ready' | 'failed';
}

interface PlayerDocumentReadyData {
  host: string;
}

interface LocalMusicFolder {
  name: string;
  paths: string[];
}

export const App: React.FC = () => {
  const { t, i18n } = useTranslation();
  const savedLocalVolume = Number(localStorage.getItem('yt-mini-local-volume'));
  const initialLocalVolume = Number.isFinite(savedLocalVolume) ? Math.max(0, Math.min(100, savedLocalVolume)) : 100;
  // Trạng thái bài hát thực tế nhận từ Webview
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('YouTube Music');
  const [album, setAlbum] = useState('');
  const [thumb, setThumb] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [loopMode, setLoopMode] = useState<'none' | 'all' | 'one'>('none');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(100);
  const [platform, setPlatform] = useState('youtube-music');
  const [playerLoadState, setPlayerLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [localTracks, setLocalTracks] = useState<string[]>([]);
  const [localQueue, setLocalQueue] = useState<string[]>([]);
  const [localFolders, setLocalFolders] = useState<LocalMusicFolder[]>([]);
  const [selectedLocalFolder, setSelectedLocalFolder] = useState<string | 'all' | null>(null);
  const [autoNextFolder, setAutoNextFolder] = useState(false);
  const loadTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | undefined>(undefined);
  const loadStateTimerRef = useRef<ReturnType<typeof window.setTimeout> | undefined>(undefined);
  const loadingStartedAtRef = useRef<number | undefined>(undefined);
  const platformRef = useRef(platform);
  const localVolumeRef = useRef(initialLocalVolume);

  // Trạng thái giao diện
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPlayerFullscreen, setIsPlayerFullscreen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [accentColor, setAccentColor] = useState(localStorage.getItem('yt-mini-accent') || '#ff4444');
  const [vinylSpin, setVinylSpin] = useState(localStorage.getItem('yt-mini-vinyl') !== 'false');
  const [alwaysOnTop, setAlwaysOnTop] = useState(localStorage.getItem('yt-mini-always-on-top') !== 'false');
  const [themeIdx, setThemeIdx] = useState(0);

  const themes = ['theme-dark-glass', 'theme-light-glass', 'theme-dark-solid', 'theme-light-solid'];
  const youtubePlaylistControlsUnavailable = platform === 'youtube';
  const platformLabel = platform === 'youtube-music' ? 'YouTube Music' : platform === 'youtube' ? 'YouTube' : platform === 'soundcloud' ? 'SoundCloud' : t('platform.local');

  const beginPlayerLoading = () => {
    if (loadStateTimerRef.current) window.clearTimeout(loadStateTimerRef.current);
    loadingStartedAtRef.current = performance.now();
    setPlayerLoadState('loading');
  };

  const finishPlayerLoading = (status: 'ready' | 'failed') => {
    if (loadStateTimerRef.current) window.clearTimeout(loadStateTimerRef.current);
    const delay = 0;
    loadStateTimerRef.current = window.setTimeout(() => {
      setPlayerLoadState(status);
      loadingStartedAtRef.current = undefined;
      loadStateTimerRef.current = undefined;
    }, delay);
  };

  useEffect(() => {
    platformRef.current = platform;
  }, [platform]);

  // Khởi tạo child webview YouTube Music và lắng nghe sự kiện scraper
  useEffect(() => {
    invoke('init_player_webview').catch((err) => {
      console.warn('init_player_webview error:', err);
    });

    const unlistenDataPromise = listen<YTMusicData>('yt-music-data', (event) => {
      const data = event.payload;
      if (platformRef.current === 'local' && data.source !== 'local') return;
      if (platformRef.current !== 'local' && data.source === 'local') return;
      if (data.title) setTitle(data.title);
      if (data.artist) setArtist(data.artist);
      setAlbum(data.album ? ` • ${data.album}` : '');
      if (data.thumb) setThumb(data.thumb);
      setIsPlaying(data.isPlaying);
      setIsShuffle(data.isShuffleActive);
      try {
        const repeatMode = JSON.parse(data.repeatDebug || '{}').repeatMode?.toString().toUpperCase();
        if (repeatMode === 'NONE' || repeatMode === 'OFF') setLoopMode('none');
        else if (repeatMode === 'ONE' || repeatMode === 'SINGLE') setLoopMode('one');
        else if (repeatMode === 'ALL' || repeatMode === 'PLAYLIST') setLoopMode('all');
        else setLoopMode(data.loopState || 'none');
      } catch {
        setLoopMode(data.loopState || 'none');
      }
      if (typeof data.currentTime === 'number') setCurrentTime(data.currentTime);
      if (typeof data.duration === 'number') setDuration(data.duration);
      if (typeof data.volume === 'number') {
        if (data.source === 'local') {
          localVolumeRef.current = data.volume;
          localStorage.setItem('yt-mini-local-volume', String(data.volume));
        }
        setVolume(data.volume);
      }
    });
    const unlistenFullscreenPromise = listen<PlayerFullscreenData>('player-fullscreen-state', (event) => {
      setIsPlayerFullscreen(Boolean(event.payload.isFullscreen));
    });
    const unlistenLoadPromise = listen<PlayerLoadData>('player-load-state', (event) => {
      if (event.payload.status === 'loading') beginPlayerLoading();
      else if (event.payload.status === 'failed') finishPlayerLoading('failed');
      if (event.payload.status === 'failed' && loadTimeoutRef.current) {
        window.clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = undefined;
      }
    });
    const unlistenDocumentReadyPromise = listen<PlayerDocumentReadyData>('player-document-ready', (event) => {
      const host = event.payload.host;
      const expectedPlatform = platformRef.current;
      const matches = (expectedPlatform === 'youtube-music' && host === 'music.youtube.com')
        || (expectedPlatform === 'youtube' && (host === 'youtube.com' || host === 'www.youtube.com'))
        || (expectedPlatform === 'soundcloud' && (host === 'soundcloud.com' || host === 'www.soundcloud.com'));
      if (!matches) return;
      finishPlayerLoading('ready');
      if (loadTimeoutRef.current) {
        window.clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = undefined;
      }
    });
    const unlistenLocalAudioErrorPromise = listen<string>('local-audio-error', (event) => {
      setPlayerLoadState('failed');
      setTitle('Không thể phát file nhạc');
      setArtist(event.payload);
    });
    // The child WebView can finish its initial navigation before React has
    // attached its event listener. Do not leave the mini UI in loading state
    // in that race; later navigation events still drive the normal status.
    const initialReadyTimeout = window.setTimeout(() => {
      setPlayerLoadState((current) => current === 'loading' ? 'ready' : current);
    }, 1_500);
    return () => {
      unlistenDataPromise.then((unlisten) => unlisten());
      unlistenFullscreenPromise.then((unlisten) => unlisten());
      unlistenLoadPromise.then((unlisten) => unlisten());
      unlistenDocumentReadyPromise.then((unlisten) => unlisten());
      unlistenLocalAudioErrorPromise.then((unlisten) => unlisten());
      window.clearTimeout(initialReadyTimeout);
      if (loadTimeoutRef.current) window.clearTimeout(loadTimeoutRef.current);
      if (loadStateTimerRef.current) window.clearTimeout(loadStateTimerRef.current);
    };
  }, []);

  // Cập nhật Theme & Accent Color & Body classes
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accentColor);
    localStorage.setItem('yt-mini-accent', accentColor);

    const body = document.body;
    // Không gán body.className trực tiếp: dữ liệu bài hát mới sẽ chạy effect này
    // và vô tình xóa class `compact` do ResizeObserver quản lý.
    body.classList.remove(...themes);
    body.classList.add(themes[themeIdx]);

    body.classList.toggle('vinyl-mode', vinylSpin);
    body.classList.toggle('is-playing', isPlaying);
    body.classList.toggle('expanded', isExpanded);
    body.classList.toggle('settings-open', isSettingsOpen);
    body.classList.toggle('player-fullscreen', isPlayerFullscreen);
  }, [isPlaying, vinylSpin, accentColor, isExpanded, isSettingsOpen, isPlayerFullscreen, themeIdx]);

  useEffect(() => {
    invoke('set_always_on_top', { enabled: alwaysOnTop }).catch((err) => {
      console.warn('set_always_on_top error:', err);
    });
  }, [alwaysOnTop]);

  // Đóng ứng dụng
  const handleClose = async () => {
    try {
      await invoke('close_app');
    } catch (e) {
      console.error('Native close failed:', e);
    }
  };

  // Điều khiển phát nhạc qua Rust invoke
  const handleControl = async (action: string, value?: number) => {
    try {
      await invoke('control_player', { action, value });
      if (platform === 'local' && action === 'play-pause') setIsPlaying((current) => !current);
      if (platform === 'local' && action === 'volume' && typeof value === 'number') {
        const nextVolume = Math.round(value * 100);
        localVolumeRef.current = nextVolume;
        localStorage.setItem('yt-mini-local-volume', String(nextVolume));
        setVolume(nextVolume);
      }
    } catch (err) {
      console.warn('control_player error:', err);
    }
  };

  // Chuyển nền tảng
  const handleSwitchPlatform = async (newPlatform: string) => {
    if (newPlatform === 'local') {
      try {
        const folders = await invoke<LocalMusicFolder[]>('get_local_music_library');
        if (!folders.length) {
          setPlayerLoadState('failed');
          return;
        }
        // A WebView2 child surface can remain above React for one compositor
        // frame when it is already expanded. Park only that child surface;
        // the main window stays expanded throughout the switch.
        if (isExpanded) {
          await invoke('park_player_webview');
          await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
        }
        await invoke('switch_platform', { platform: newPlatform });
        await invoke('toggle_expand_view', { isExpanded: true, showPlayer: false });
        setPlatform(newPlatform);
        setVolume(localVolumeRef.current);
        setIsExpanded(true);
        setLocalFolders(folders);
        setLocalTracks([]);
        setLocalQueue([]);
        setSelectedLocalFolder(null);
        setPlayerLoadState('ready');
      } catch (err) {
        setPlayerLoadState('failed');
        console.warn('local_music error:', err);
      }
      return;
    }

    setPlatform(newPlatform);
    beginPlayerLoading();
    if (loadTimeoutRef.current) window.clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = window.setTimeout(() => {
      finishPlayerLoading('failed');
      loadTimeoutRef.current = undefined;
    }, 20_000);
    try {
      await invoke('switch_platform', { platform: newPlatform });
      if (isExpanded) {
        await invoke('toggle_expand_view', { isExpanded: true, showPlayer: true });
      }
    } catch (err) {
      setPlayerLoadState('failed');
      console.warn('switch_platform error:', err);
    }
  };

  // Mở rộng / thu nhỏ giao diện webview
  const handleSelectLocalFolder = async (folder: LocalMusicFolder | 'all') => {
    const allTracks = localFolders.flatMap((item) => item.paths);
    const isAllTracks = folder === 'all';
    const tracks = isAllTracks ? allTracks : folder.paths;
    if (!tracks.length) return;
    const folderIndex = isAllTracks ? -1 : localFolders.findIndex((item) => item.name === folder.name);
    const queue = !isAllTracks && autoNextFolder
      ? localFolders.slice(folderIndex).flatMap((item) => item.paths)
      : tracks;
    setSelectedLocalFolder(isAllTracks ? 'all' : folder.name);
    setLocalTracks(tracks);
    setLocalQueue(queue);
  };

  const handlePlayCurrentLocalFolder = async (paths?: string[]) => {
    const queue = paths || (localQueue.length ? localQueue : localTracks);
    if (!queue.length) return;
    try {
      await invoke('play_local_folder', { paths: queue, volume: localVolumeRef.current / 100 });
      setIsPlaying(true);
      setPlayerLoadState('ready');
    } catch (err) {
      console.warn('play_local_folder error:', err);
    }
  };

  const handleRefreshLocalLibrary = async () => {
    try {
      const folders = await invoke<LocalMusicFolder[]>('get_local_music_library');
      setLocalFolders(folders);
      if (!selectedLocalFolder) return;

      const allTracks = folders.flatMap((folder) => folder.paths);
      const activeFolder = selectedLocalFolder === 'all'
        ? null
        : folders.find((folder) => folder.name === selectedLocalFolder);
      const tracks = selectedLocalFolder === 'all' ? allTracks : activeFolder?.paths;
      if (!tracks?.length) {
        setSelectedLocalFolder(null);
        setLocalTracks([]);
        setLocalQueue([]);
        return;
      }

      const activeIndex = activeFolder ? folders.findIndex((folder) => folder.name === activeFolder.name) : -1;
      setLocalTracks(tracks);
      setLocalQueue(autoNextFolder && activeIndex >= 0
        ? folders.slice(activeIndex).flatMap((folder) => folder.paths)
        : tracks);
    } catch (err) {
      console.warn('local_music library refresh error:', err);
    }
  };

  const getLocalTrackFolder = (track: string) => (
    localFolders.find((folder) => folder.paths.includes(track))?.name || 'Nhạc chưa phân loại'
  );

  const handleToggleExpand = async () => {
    const nextState = !isExpanded;
    setIsExpanded(nextState);
    try {
      await invoke('toggle_expand_view', { isExpanded: nextState, showPlayer: platform !== 'local' });
    } catch (err) {
      if (nextState && String(err).includes('Player webview not found')) {
        window.setTimeout(() => {
          invoke('toggle_expand_view', { isExpanded: true })
            .catch((retryErr) => console.error('Native expand retry failed:', retryErr));
        }, 300);
      } else {
        console.error('Native expand failed:', err);
      }
    }
  };

  const handlePlayLocalTrack = async (startIndex: number) => {
    try {
      await invoke('play_local_folder', { paths: localQueue.length ? localQueue : localTracks, startIndex, volume: localVolumeRef.current / 100 });
      setIsPlaying(true);
      setPlayerLoadState('ready');
    } catch (err) {
      console.warn('play_local_track error:', err);
    }
  };

  // Bắt ở capture phase vì WebView2/custom drag region có thể chặn event
  // trước khi nó đến React hoặc listener gắn trực tiếp lên button.
  useEffect(() => {
    const onPointerDownCapture = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;

      if (event.target.closest('#close-app')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void handleClose();
      } else if (event.target.closest('#toggle-web')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void handleToggleExpand();
      }
    };

    document.addEventListener('pointerdown', onPointerDownCapture, true);
    return () => document.removeEventListener('pointerdown', onPointerDownCapture, true);
  }, [isExpanded, platform]);

  // Snap cửa sổ vào các cạnh/góc của màn hình khi được kéo tới gần.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isSnapping = false;
    let lastDragPosition: PhysicalPosition | undefined;

    const snapAfterDrag = async (position: PhysicalPosition) => {
      if (isSnapping) return;

      try {
        const win = getCurrentWindow();
        const [monitor, size, scaleFactor] = await Promise.all([
          currentMonitor(),
          win.outerSize(),
          win.scaleFactor(),
        ]);
        if (!monitor) return;

        const threshold = Math.round(16 * scaleFactor);
        const workArea = monitor.workArea;
        const right = workArea.position.x + workArea.size.width;
        const bottom = workArea.position.y + workArea.size.height;
        let x = position.x;
        let y = position.y;

        if (Math.abs(position.x - workArea.position.x) <= threshold) x = workArea.position.x;
        else if (Math.abs(position.x + size.width - right) <= threshold) x = right - size.width;
        if (Math.abs(position.y - workArea.position.y) <= threshold) y = workArea.position.y;
        else if (Math.abs(position.y + size.height - bottom) <= threshold) y = bottom - size.height;

        if (x !== position.x || y !== position.y) {
          isSnapping = true;
          await win.setPosition(new PhysicalPosition(x, y));
          window.setTimeout(() => { isSnapping = false; }, 50);
        }
      } catch (err) {
        console.warn('window snap error:', err);
        isSnapping = false;
      }
    };

    const snapOnRelease = () => {
      if (lastDragPosition) {
        void snapAfterDrag(lastDragPosition);
        lastDragPosition = undefined;
      }
    };
    const snapCustomDragEnd = (event: Event) => {
      const position = (event as CustomEvent<PhysicalPosition>).detail;
      if (position) void snapAfterDrag(position);
    };

    getCurrentWindow().onMoved(({ payload: position }) => {
      lastDragPosition = position;
    }).then((stop) => { unlisten = stop; }).catch((err) => console.warn('window snap listener error:', err));
    window.addEventListener('mouseup', snapOnRelease, true);
    window.addEventListener('pointerup', snapOnRelease, true);
    window.addEventListener('mini-player-drag-end', snapCustomDragEnd);

    return () => {
      window.removeEventListener('mouseup', snapOnRelease, true);
      window.removeEventListener('pointerup', snapOnRelease, true);
      window.removeEventListener('mini-player-drag-end', snapCustomDragEnd);
      unlisten?.();
    };
  }, []);

  // Đồng bộ kích thước Webview khi cửa sổ được kéo resize hoặc thay đổi kích thước
  useEffect(() => {
    const ytView = document.getElementById('yt-view');
    if (!ytView) return;

    const resizeWebview = () => {
      if (isExpanded) {
        const rect = ytView.getBoundingClientRect();
        invoke('resize_yt_view', {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        }).catch(() => {});
      }
    };

    const observer = new ResizeObserver(resizeWebview);
    observer.observe(ytView);
    resizeWebview();
    return () => observer.disconnect();
  }, [isExpanded, platform]);

  // Kiểm tra compact mode khi kéo cửa sổ xuống < 90px (như V1)
  useEffect(() => {
    const checkCompact = () => {
      const height = document.documentElement.clientHeight;
      if (!isExpanded && height <= 105) {
        document.body.classList.add('compact');
      } else {
        document.body.classList.remove('compact');
      }
    };
    const observer = new ResizeObserver(checkCompact);
    observer.observe(document.documentElement);
    checkCompact();
    return () => observer.disconnect();
  }, [isExpanded]);

  // Resize bằng Pointer Capture để tiếp tục nhận được con trỏ sau khi nó rời
  // khỏi viền mảnh của WebView. Cách này ổn định cả khi native resize của
  // WebView2 không khởi động được trên Windows.
  const handleEdgeResize = (direction: 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest') => {
    return async (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const target = e.currentTarget;

      try {
        target.setPointerCapture(e.pointerId);
        const win = getCurrentWindow();
        const scaleFactor = await win.scaleFactor();
        const initialSize = (await win.innerSize()).toLogical(scaleFactor);
        const initialPosition = (await win.innerPosition()).toLogical(scaleFactor);
        const startX = e.screenX;
        const startY = e.screenY;
        let pending = false;

        const onPointerMove = (moveEvent: PointerEvent) => {
          if ((moveEvent.buttons & 1) === 0 || pending) return;
          pending = true;

          requestAnimationFrame(() => {
            const deltaX = moveEvent.screenX - startX;
            const deltaY = moveEvent.screenY - startY;
            let width = initialSize.width;
            let height = initialSize.height;
            let x = initialPosition.x;
            let y = initialPosition.y;

            if (direction.includes('East')) width = Math.max(350, width + deltaX);
            if (direction.includes('South')) height = Math.max(55, height + deltaY);
            if (direction.includes('West')) {
              width = Math.max(350, width - deltaX);
              x = initialPosition.x + (initialSize.width - width);
            }
            if (direction.includes('North')) {
              height = Math.max(55, height - deltaY);
              y = initialPosition.y + (initialSize.height - height);
            }

            Promise.all([
              win.setSize(new LogicalSize(width, height)),
              win.setPosition(new LogicalPosition(x, y)),
            ]).catch((err) => console.warn('resize error:', err)).finally(() => {
              pending = false;
            });
          });
        };

        const stopResize = () => {
          target.removeEventListener('pointermove', onPointerMove);
          target.removeEventListener('pointerup', stopResize);
          target.removeEventListener('pointercancel', stopResize);
          if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
        };

        target.addEventListener('pointermove', onPointerMove);
        target.addEventListener('pointerup', stopResize, { once: true });
        target.addEventListener('pointercancel', stopResize, { once: true });
      } catch (err) {
        console.warn(`Could not start ${direction} resize:`, err);
      }
    };
  };

  // Đổi Theme qua danh sách V1
  const handleToggleTheme = () => {
    setThemeIdx((prev) => (prev + 1) % themes.length);
  };

  // Đổi trạng thái Settings Modal
  const handleToggleSettings = async (open: boolean) => {
    if (open && isExpanded) {
      try {
        await invoke('toggle_expand_view', { isExpanded: false });
        setIsExpanded(false);
      } catch (err) {
        console.warn('Could not close expanded player before settings:', err);
        return;
      }
    }

    setIsSettingsOpen(open);
    try {
      await invoke('resize_modal', { isOpen: open, height: open ? 270 : 130 });
    } catch (err) {
      console.warn('resize_modal error:', err);
    }
  };

  // Bấm giữ kéo di chuyển cửa sổ (native dragging)
  const handleStartDragging = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('select')) {
      return;
    }
    e.preventDefault();
    try {
      const win = getCurrentWindow();
      const dragTarget = e.currentTarget;
      dragTarget.setPointerCapture(e.pointerId);
      const [startPosition, scaleFactor] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
      const startX = e.screenX;
      const startY = e.screenY;
      let pending = false;

      const onPointerMove = (moveEvent: PointerEvent) => {
        if ((moveEvent.buttons & 1) === 0 || pending) return;
        pending = true;
        requestAnimationFrame(() => {
          const x = Math.round(startPosition.x + (moveEvent.screenX - startX) * scaleFactor);
          const y = Math.round(startPosition.y + (moveEvent.screenY - startY) * scaleFactor);
          win.setPosition(new PhysicalPosition(x, y)).catch((err) => console.warn('drag move error:', err)).finally(() => {
            pending = false;
          });
        });
      };
      const onPointerUp = (upEvent: PointerEvent) => {
        dragTarget.removeEventListener('pointermove', onPointerMove);
        dragTarget.removeEventListener('pointerup', onPointerUp);
        dragTarget.removeEventListener('pointercancel', onPointerUp);
        if (dragTarget.hasPointerCapture(e.pointerId)) dragTarget.releasePointerCapture(e.pointerId);
        window.dispatchEvent(new CustomEvent('mini-player-drag-end', {
          detail: new PhysicalPosition(
            Math.round(startPosition.x + (upEvent.screenX - startX) * scaleFactor),
            Math.round(startPosition.y + (upEvent.screenY - startY) * scaleFactor),
          ),
        }));
      };
      dragTarget.addEventListener('pointermove', onPointerMove);
      dragTarget.addEventListener('pointerup', onPointerUp, { once: true });
      dragTarget.addEventListener('pointercancel', onPointerUp, { once: true });
    } catch (err) {
      console.warn('startDragging error:', err);
    }
  };

  // Format giây thành mm:ss
  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      <div className="drag-header" onPointerDown={handleStartDragging}>
        {/* Hàng 1: Đĩa than + Tên bài + Nút Đóng */}
        <div className="top-row">
          <div className="vinyl-container" id="vinyl-container">
            <img
              id="thumb"
              className="thumbnail"
              src={thumb || 'https://music.youtube.com/img/on_platform_logo_dark.svg'}
              alt="Thumbnail"
              draggable="false"
            />
            <div className="vinyl-center-dot" />
          </div>

          <div className="song-info">
            <div id="title" className="title player-title" title={title || platformLabel}>
              <span>{title || platformLabel}</span>
            </div>
            <div className="artist">
              <span id="artist">{playerLoadState === 'failed' ? t('player.failed') : artist}</span>
              <span id="album">{album}</span>
            </div>
          </div>

            <button id="close-app" title={t('player.close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {/* Hàng 2: Thanh tua nhạc */}
        <div className="progress-container">
          <span id="current-time">{formatTime(currentTime)}</span>
          <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
            <input
              type="range"
              id="progress-slider"
              min={0}
              max={duration || 100}
              value={currentTime}
              step="any"
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setCurrentTime(val);
                handleControl('seek', val);
              }}
              style={{
                background: `linear-gradient(to right, ${accentColor} ${progressPercent}%, rgba(255, 255, 255, 0.2) ${progressPercent}%)`
              }}
            />
          </div>
          <span id="total-time">{formatTime(duration)}</span>
        </div>

        {/* Hàng 3: Các nút điều khiển */}
        <div className="controls">
          <div className="playback-controls">
            <button
              id="shuffle"
              title={youtubePlaylistControlsUnavailable ? t('player.shuffleUnavailable') : t('player.shuffle')}
              className={`${isShuffle ? 'active' : ''} ${youtubePlaylistControlsUnavailable ? 'unavailable' : ''}`.trim()}
              disabled={youtubePlaylistControlsUnavailable}
              onClick={() => handleControl('shuffle')}
            >
              <i className="fa-solid fa-shuffle"></i>
            </button>
            <button id="prev" title={t('player.previous')} onClick={() => handleControl('prev')}>
              <i className="fa-solid fa-backward-step"></i>
            </button>
            <button
              id="play-pause"
              title={t('player.playPause')}
              onClick={() => handleControl('play-pause')}
            >
              <i className={isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play'}></i>
            </button>
            <button id="next" title={t('player.next')} onClick={() => handleControl('next')}>
              <i className="fa-solid fa-forward-step"></i>
            </button>
            <button
              id="loop"
              title={youtubePlaylistControlsUnavailable ? t('player.repeatUnavailable') : t('player.repeat')}
              className={`${loopMode !== 'none' ? 'active' : ''} ${loopMode === 'one' ? 'repeat-one' : ''} ${youtubePlaylistControlsUnavailable ? 'unavailable' : ''}`.trim()}
              disabled={youtubePlaylistControlsUnavailable}
              onClick={() => handleControl('loop')}
            >
              <i className="fa-solid fa-repeat"></i>
              {loopMode === 'one' && <span className="repeat-one-badge">1</span>}
            </button>
          </div>

          <div className="utility-controls">
            <div className="volume-container" title={t('player.volume')}>
              <i
                className={volume === 0 ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high'}
                style={{ fontSize: '12px', marginRight: '4px', cursor: 'pointer' }}
                onClick={() => handleControl('volume', volume === 0 ? 1 : 0)}
              ></i>
              <input
                type="range"
                id="volume-slider"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setVolume(val);
                  handleControl('volume', val / 100);
                }}
                style={{
                  background: `linear-gradient(to right, ${accentColor} ${volume}%, rgba(255, 255, 255, 0.2) ${volume}%)`
                }}
              />
            </div>

            <div className="platform-selector-wrapper" title={t('player.choosePlatform')}>
              {platform === 'youtube-music' ? (
                <span id="platform-icon" className="platform-brand platform-brand-music" aria-label="YouTube Music">
                  <span className="youtube-music-play"></span>
                </span>
              ) : platform === 'youtube' ? (
                <i id="platform-icon" className="platform-brand fa-brands fa-youtube" aria-label="YouTube"></i>
              ) : platform === 'soundcloud' ? (
                <i id="platform-icon" className="platform-brand fa-brands fa-soundcloud" aria-label="SoundCloud"></i>
              ) : (
                <i id="platform-icon" className="platform-brand fa-solid fa-music" aria-label="Nhạc trên máy"></i>
              )}
              <select
                id="platform-select"
                className="platform-select"
                value={platform}
                onChange={(e) => handleSwitchPlatform(e.target.value)}
              >
                <option value="youtube-music">YouTube Music</option>
                <option value="youtube">YouTube</option>
                <option value="soundcloud">SoundCloud</option>
                <option value="local">{t('platform.local')}</option>
              </select>
            </div>

            <button
              id="settings-menu-btn"
              title={t('common.settings')}
              onClick={() => handleToggleSettings(true)}
            >
              <i className="fa-solid fa-ellipsis-vertical"></i>
            </button>
            <button id="toggle-web" title={isExpanded ? t('player.collapse') : t('player.expand')} disabled={isSettingsOpen}>
              <i className={isExpanded ? 'fa-solid fa-xmark' : 'fa-solid fa-expand'}></i>
            </button>
          </div>
        </div>
      </div>

      {/* Vùng hiển thị webview khi mở rộng */}
      {platform === 'local' && isExpanded ? (
        <div id="local-library" className="expanded">
          <div className="local-library-header">
            <span><i className="fa-solid fa-folder-music"></i> {t('local.library')}</span>
            <span>{t('local.tracks', { count: localTracks.length })}</span>
            <button className="local-library-refresh" title={t('local.refresh')} onClick={handleRefreshLocalLibrary}>
              <i className="fa-solid fa-rotate" />
            </button>
          </div>
          <div className="local-explorer">
            <aside className="local-folder-pane" aria-label="Music folders">
            <button className={`local-folder-chip ${selectedLocalFolder === 'all' ? 'active' : ''}`} onClick={() => handleSelectLocalFolder('all')} onDoubleClick={() => handlePlayCurrentLocalFolder(localFolders.flatMap((folder) => folder.paths))}>
              <i className="fa-solid fa-music" /> {t('local.allMusic')} <small>{localFolders.reduce((count, folder) => count + folder.paths.length, 0)}</small>
            </button>
            {localFolders.map((folder) => (
              <button className={`local-folder-chip ${selectedLocalFolder === folder.name ? 'active' : ''}`} key={folder.name} onClick={() => handleSelectLocalFolder(folder)} onDoubleClick={() => {
                const folderIndex = localFolders.findIndex((item) => item.name === folder.name);
                handlePlayCurrentLocalFolder(autoNextFolder ? localFolders.slice(folderIndex).flatMap((item) => item.paths) : folder.paths);
              }}>
                <i className="fa-solid fa-folder" /> {folder.name} <small>{folder.paths.length}</small>
              </button>
            ))}
            </aside>
            <main className="local-file-pane">
          <div className="local-library-toolbar">
          <button className="local-play-folder" disabled={!selectedLocalFolder} onClick={() => handlePlayCurrentLocalFolder()}>
            <i className="fa-solid fa-play" /> {t('local.playFolder')}
          </button>
          <label className="local-auto-next">
            <input type="checkbox" checked={autoNextFolder} onChange={(event) => setAutoNextFolder(event.target.checked)} />
            <span className="local-toggle-switch" aria-hidden="true" />
            <span>{t('local.playNextFolder')}</span>
          </label>
          </div>
          <div className={`local-file-header ${selectedLocalFolder === 'all' ? 'show-folder' : ''}`}>
            <span />
            <span>{t('local.name')}</span>
            <span>{t('local.type')}</span>
            {selectedLocalFolder === 'all' && <span>{t('local.folder')}</span>}
          </div>
          <div className="local-track-list">
            {!selectedLocalFolder && <div className="local-library-empty">{t('local.chooseFolder')}</div>}
            {localTracks.map((track, index) => (
              <button className={`local-track-row ${selectedLocalFolder === 'all' ? 'show-folder' : ''}`} key={track} title={track} onClick={() => handlePlayLocalTrack(index)}>
                <span>{index + 1}</span>
                <span>{track.split(/[/\\]/).pop()}</span>
                <span className="local-track-type">{track.split('.').pop()?.toUpperCase()}</span>
                {selectedLocalFolder === 'all' && <span className="local-track-folder">{getLocalTrackFolder(track)}</span>}
              </button>
            ))}
          </div>
            </main>
          </div>
        </div>
      ) : <div id="yt-view" className={isExpanded ? 'expanded' : ''}></div>}

      {/* Modal Cài đặt chuẩn V1 */}
      {isSettingsOpen && (
        <div id="settings-modal" className="modal" style={{ display: 'flex' }}>
          <div className="settings-modal-content">
            <div className="settings-header">
              <h3>
                <i className="fa-solid fa-sliders" style={{ color: accentColor }}></i> {t('common.settings')}
              </h3>
              <button id="close-settings" title={t('common.close')} onClick={() => handleToggleSettings(false)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="settings-grid">
              <div className="menu-item language-setting">
                <span><i className="fa-solid fa-language"></i> {t('common.language')}</span>
                <select
                  className="language-select"
                  value={i18n.resolvedLanguage || 'vi'}
                  onChange={(event) => {
                    const language = event.target.value;
                    i18n.changeLanguage(language);
                    localStorage.setItem('yt-mini-language', language);
                  }}
                >
                  <option value="vi">{t('common.vietnamese')}</option>
                  <option value="en">{t('common.english')}</option>
                </select>
              </div>
              <button id="toggle-theme" className="menu-item" onClick={handleToggleTheme}>
                <i className="fa-solid fa-palette"></i> {t('settings.changeTheme')}
              </button>

              <label className="color-picker-btn menu-item">
                <i className="fa-solid fa-droplet"></i> {t('settings.changeAccent')}
                <input
                  type="color"
                  id="accent-color-picker"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                />
              </label>

              <div className="menu-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="fa-solid fa-compact-disc"></i> {t('settings.spinningVinyl')}
                </span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={vinylSpin}
                    onChange={(e) => {
                      setVinylSpin(e.target.checked);
                      localStorage.setItem('yt-mini-vinyl', e.target.checked ? 'true' : 'false');
                    }}
                  />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="menu-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="fa-solid fa-thumbtack"></i> {t('settings.alwaysOnTop')}
                </span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={alwaysOnTop}
                    onChange={(e) => {
                      setAlwaysOnTop(e.target.checked);
                      localStorage.setItem('yt-mini-always-on-top', e.target.checked ? 'true' : 'false');
                    }}
                  />
                  <span className="slider"></span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 8 vùng viền & góc kéo thay đổi kích thước cửa sổ linh hoạt (North, South, East, West, corners) */}
      <div className="resize-edge resize-top" onPointerDown={handleEdgeResize('North')} />
      <div className="resize-edge resize-bottom" onPointerDown={handleEdgeResize('South')} />
      <div className="resize-edge resize-left" onPointerDown={handleEdgeResize('West')} />
      <div className="resize-edge resize-right" onPointerDown={handleEdgeResize('East')} />
      <div className="resize-corner resize-top-left" onPointerDown={handleEdgeResize('NorthWest')} />
      <div className="resize-corner resize-top-right" onPointerDown={handleEdgeResize('NorthEast')} />
      <div className="resize-corner resize-bottom-left" onPointerDown={handleEdgeResize('SouthWest')} />
      <div className="resize-corner resize-bottom-right" onPointerDown={handleEdgeResize('SouthEast')} />

    </>
  );
};

export default App;
