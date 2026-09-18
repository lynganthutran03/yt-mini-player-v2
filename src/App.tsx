import React, { useState, useEffect } from 'react';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalPosition, LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

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
}

interface PlayerFullscreenData {
  isFullscreen: boolean;
}

export const App: React.FC = () => {
  // Trạng thái bài hát thực tế nhận từ Webview
  const [title, setTitle] = useState('Đang kết nối YouTube Music...');
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

  // Khởi tạo child webview YouTube Music và lắng nghe sự kiện scraper
  useEffect(() => {
    invoke('init_player_webview').catch((err) => {
      console.warn('init_player_webview error:', err);
    });

    const unlistenDataPromise = listen<YTMusicData>('yt-music-data', (event) => {
      const data = event.payload;
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
      if (typeof data.volume === 'number') setVolume(data.volume);
    });
    const unlistenFullscreenPromise = listen<PlayerFullscreenData>('player-fullscreen-state', (event) => {
      setIsPlayerFullscreen(Boolean(event.payload.isFullscreen));
    });

    return () => {
      unlistenDataPromise.then((unlisten) => unlisten());
      unlistenFullscreenPromise.then((unlisten) => unlisten());
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
    } catch (err) {
      console.warn('control_player error:', err);
    }
  };

  // Chuyển nền tảng
  const handleSwitchPlatform = async (newPlatform: string) => {
    setPlatform(newPlatform);
    try {
      await invoke('switch_platform', { platform: newPlatform });
    } catch (err) {
      console.warn('switch_platform error:', err);
    }
  };

  // Mở rộng / thu nhỏ giao diện webview
  const handleToggleExpand = async () => {
    const nextState = !isExpanded;
    setIsExpanded(nextState);
    try {
      await invoke('toggle_expand_view', { isExpanded: nextState });
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
  }, [isExpanded]);

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

    const observer = new ResizeObserver(() => {
      if (isExpanded) {
        const rect = ytView.getBoundingClientRect();
        invoke('resize_yt_view', {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        }).catch(() => {});
      }
    });

    observer.observe(ytView);
    return () => observer.disconnect();
  }, [isExpanded]);

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
      await invoke('resize_modal', { isOpen: open, height: open ? 200 : 130 });
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
            <div id="title" className="title" title={title}>{title}</div>
            <div className="artist">
              <span id="artist">{artist}</span>
              <span id="album">{album}</span>
            </div>
          </div>

          <button id="close-app" title="Tắt Mini Player">
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
              title={youtubePlaylistControlsUnavailable ? 'YouTube chỉ hỗ trợ trộn trong playlist/queue' : 'Trộn bài'}
              className={`${isShuffle ? 'active' : ''} ${youtubePlaylistControlsUnavailable ? 'unavailable' : ''}`.trim()}
              disabled={youtubePlaylistControlsUnavailable}
              onClick={() => handleControl('shuffle')}
            >
              <i className="fa-solid fa-shuffle"></i>
            </button>
            <button id="prev" title="Bài trước" onClick={() => handleControl('prev')}>
              <i className="fa-solid fa-backward-step"></i>
            </button>
            <button
              id="play-pause"
              title="Phát/Dừng"
              onClick={() => handleControl('play-pause')}
            >
              <i className={isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play'}></i>
            </button>
            <button id="next" title="Bài tiếp" onClick={() => handleControl('next')}>
              <i className="fa-solid fa-forward-step"></i>
            </button>
            <button
              id="loop"
              title={youtubePlaylistControlsUnavailable ? 'YouTube chỉ hỗ trợ lặp trong playlist/queue' : 'Lặp lại'}
              className={`${loopMode !== 'none' ? 'active' : ''} ${loopMode === 'one' ? 'repeat-one' : ''} ${youtubePlaylistControlsUnavailable ? 'unavailable' : ''}`.trim()}
              disabled={youtubePlaylistControlsUnavailable}
              onClick={() => handleControl('loop')}
            >
              <i className="fa-solid fa-repeat"></i>
              {loopMode === 'one' && <span className="repeat-one-badge">1</span>}
            </button>
          </div>

          <div className="utility-controls">
            <div className="volume-container" title="Âm lượng">
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

            <div className="platform-selector-wrapper" title="Chọn nền tảng">
              {platform === 'youtube-music' ? (
                <span id="platform-icon" className="platform-brand platform-brand-music" aria-label="YouTube Music">
                  <span className="youtube-music-play"></span>
                </span>
              ) : platform === 'youtube' ? (
                <i id="platform-icon" className="platform-brand fa-brands fa-youtube" aria-label="YouTube"></i>
              ) : (
                <i id="platform-icon" className="platform-brand fa-brands fa-soundcloud" aria-label="SoundCloud"></i>
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
              </select>
            </div>

            <button
              id="settings-menu-btn"
              title="Cài đặt"
              onClick={() => handleToggleSettings(true)}
            >
              <i className="fa-solid fa-ellipsis-vertical"></i>
            </button>
            <button id="toggle-web" title={isExpanded ? 'Thu nhỏ giao diện' : 'Mở rộng giao diện'} disabled={isSettingsOpen}>
              <i className={isExpanded ? 'fa-solid fa-xmark' : 'fa-solid fa-expand'}></i>
            </button>
          </div>
        </div>
      </div>

      {/* Vùng hiển thị webview khi mở rộng */}
      <div id="yt-view" className={isExpanded ? 'expanded' : ''}></div>

      {/* Modal Cài đặt chuẩn V1 */}
      {isSettingsOpen && (
        <div id="settings-modal" className="modal" style={{ display: 'flex' }}>
          <div className="settings-modal-content">
            <div className="settings-header">
              <h3>
                <i className="fa-solid fa-sliders" style={{ color: accentColor }}></i> Tùy chỉnh
              </h3>
              <button id="close-settings" title="Đóng cài đặt" onClick={() => handleToggleSettings(false)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="settings-grid">
              <button id="toggle-theme" className="menu-item" onClick={handleToggleTheme}>
                <i className="fa-solid fa-palette"></i> Đổi giao diện
              </button>

              <label className="color-picker-btn menu-item">
                <i className="fa-solid fa-droplet"></i> Đổi màu nhấn
                <input
                  type="color"
                  id="accent-color-picker"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                />
              </label>

              <div className="menu-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="fa-solid fa-compact-disc"></i> Đĩa than xoay
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
                  <i className="fa-solid fa-thumbtack"></i> Ghim cửa sổ
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
