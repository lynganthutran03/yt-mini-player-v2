import React, { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';

export const App: React.FC = () => {
  // Trạng thái bài hát
  const [isPlaying, setIsPlaying] = useState(true);
  const [isShuffle, setIsShuffle] = useState(false);
  const [loopMode, setLoopMode] = useState<'none' | 'all' | 'one'>('none');
  const [currentTime, setCurrentTime] = useState(42);
  const [duration] = useState(240);
  const [volume, setVolume] = useState(100);
  const [platform, setPlatform] = useState('youtube-music');

  // Trạng thái giao diện
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [accentColor, setAccentColor] = useState('#ff4444');
  const [vinylSpin, setVinylSpin] = useState(true);

  // Cập nhật class trên body đồng bộ với CSS gốc
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accentColor);
    if (isPlaying && vinylSpin) {
      document.body.classList.add('is-playing', 'vinyl-mode');
    } else if (vinylSpin) {
      document.body.classList.add('vinyl-mode');
      document.body.classList.remove('is-playing');
    } else {
      document.body.classList.remove('vinyl-mode', 'is-playing');
    }
  }, [isPlaying, vinylSpin, accentColor]);

  // Bộ đếm thời gian giả lập
  useEffect(() => {
    let timer: any;
    if (isPlaying) {
      timer = setInterval(() => {
        setCurrentTime((prev) => (prev >= duration ? 0 : prev + 1));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isPlaying, duration]);

  // Đóng ứng dụng
  const handleClose = async () => {
    try {
      const win = getCurrentWindow();
      await win.close();
    } catch (e) {
      console.warn('Cannot close outside desktop runtime', e);
    }
  };

  // Đăng nhập an toàn qua Chrome/Edge thật
  const handleSafeLogin = async () => {
    const url = 'https://accounts.google.com/ServiceLogin?service=youtube';
    try {
      await openUrl(url);
    } catch {
      window.open(url, '_blank');
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
      <div className="drag-header" data-tauri-drag-region>
        {/* Hàng 1: Đĩa than + Tên bài + Nút Đóng */}
        <div className="top-row" data-tauri-drag-region>
          <div className="vinyl-container" id="vinyl-container">
            <img
              id="thumb"
              className="thumbnail"
              src="https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150&auto=format&fit=crop&q=80"
              alt="Thumbnail"
              draggable="false"
            />
            <div className="vinyl-center-dot" style={{ backgroundColor: accentColor }} />
          </div>

          <div className="song-info" data-tauri-drag-region>
            <div id="title" className="title">Nothin' on You (feat. Bruno Mars)</div>
            <div className="artist">
              <span id="artist">B.o.B</span>
              <span id="album"> • The Adventures of Bobby Ray</span>
            </div>
          </div>

          <button id="close-app" title="Tắt Mini Player" onClick={handleClose}>
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
              onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
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
              title="Trộn bài"
              className={isShuffle ? 'active' : ''}
              onClick={() => setIsShuffle(!isShuffle)}
            >
              <i className="fa-solid fa-shuffle"></i>
            </button>
            <button id="prev" title="Bài trước" onClick={() => setCurrentTime(0)}>
              <i className="fa-solid fa-backward-step"></i>
            </button>
            <button
              id="play-pause"
              title="Phát/Dừng"
              onClick={() => setIsPlaying(!isPlaying)}
            >
              <i className={isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play'}></i>
            </button>
            <button id="next" title="Bài tiếp" onClick={() => setCurrentTime(0)}>
              <i className="fa-solid fa-forward-step"></i>
            </button>
            <button
              id="loop"
              title="Lặp lại"
              className={loopMode !== 'none' ? 'active' : ''}
              onClick={() => setLoopMode(loopMode === 'none' ? 'all' : loopMode === 'all' ? 'one' : 'none')}
            >
              <i className={loopMode === 'one' ? 'fa-solid fa-repeat-1' : 'fa-solid fa-repeat'}></i>
            </button>
          </div>

          <div className="utility-controls">
            <div className="volume-container" title="Âm lượng">
              <i
                className={volume === 0 ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high'}
                style={{ fontSize: '12px', marginRight: '4px' }}
                onClick={() => setVolume(volume === 0 ? 100 : 0)}
              ></i>
              <input
                type="range"
                id="volume-slider"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => setVolume(parseInt(e.target.value, 10))}
                style={{
                  background: `linear-gradient(to right, ${accentColor} ${volume}%, rgba(255, 255, 255, 0.2) ${volume}%)`
                }}
              />
            </div>

            <div className="platform-selector-wrapper" title="Chọn nền tảng">
              <i id="platform-icon" className="fa-solid fa-circle-play"></i>
              <select
                id="platform-select"
                className="platform-select"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
              >
                <option value="youtube-music">YouTube Music</option>
                <option value="youtube">YouTube</option>
                <option value="soundcloud">SoundCloud</option>
              </select>
            </div>

            <button
              id="settings-menu-btn"
              title="Cài đặt"
              onClick={() => setIsSettingsOpen(true)}
            >
              <i className="fa-solid fa-ellipsis-vertical"></i>
            </button>
            <button id="toggle-web" title="Mở rộng giao diện">
              <i className="fa-solid fa-expand"></i>
            </button>
          </div>
        </div>
      </div>

      {/* Modal Cài đặt đúng theo style cũ */}
      {isSettingsOpen && (
        <div id="settings-modal" className="modal" style={{ display: 'flex' }}>
          <div className="settings-modal-content">
            <div className="settings-header">
              <h3>
                <i className="fa-solid fa-sliders" style={{ color: accentColor }}></i> Tùy chỉnh
              </h3>
              <button id="close-settings" title="Đóng cài đặt" onClick={() => setIsSettingsOpen(false)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="settings-grid">
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
                    onChange={(e) => setVinylSpin(e.target.checked)}
                  />
                  <span className="slider"></span>
                </label>
              </div>

              <div
                className="menu-item"
                style={{
                  gridColumn: 'span 2',
                  display: 'flex',
                  alignItems: 'center',
                  color: '#4ade80',
                  gap: '8px',
                  cursor: 'pointer'
                }}
                onClick={handleSafeLogin}
                title="Đăng nhập tài khoản Google trên Chrome/Edge thật, an toàn 100%"
              >
                <i className="fa-solid fa-shield-halved" style={{ color: '#4ade80' }}></i>
                <span>Đăng nhập an toàn (Trình duyệt ngoài)</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default App;