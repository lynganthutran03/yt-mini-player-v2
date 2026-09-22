import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  vi: {
    translation: {
      common: { settings: 'Cài đặt', close: 'Đóng', language: 'Ngôn ngữ', vietnamese: 'Tiếng Việt', english: 'English' },
      player: { close: 'Tắt Mini Player', previous: 'Bài trước', next: 'Bài tiếp', playPause: 'Phát/Dừng', shuffle: 'Trộn bài', repeat: 'Lặp lại', shuffleUnavailable: 'YouTube chỉ hỗ trợ trộn trong playlist/queue', repeatUnavailable: 'YouTube chỉ hỗ trợ lặp trong playlist/queue', volume: 'Âm lượng', choosePlatform: 'Chọn nền tảng', expand: 'Mở rộng giao diện', collapse: 'Thu nhỏ giao diện', loading: 'Đang tải {{platform}}…', opening: 'Đang mở {{platform}}…', loadingWeb: 'Đang tải web player', failed: 'Không thể tải trang' },
      platform: { local: 'Nhạc trên máy' },
      local: { library: 'Thư viện nhạc', refresh: 'Làm mới thư viện', allMusic: 'Tất cả nhạc', playFolder: 'Phát folder', playNextFolder: 'Tự phát folder tiếp theo sau khi chọn', name: 'Tên', type: 'Loại', folder: 'Folder', chooseFolder: 'Chọn một folder để bắt đầu phát nhạc.', tracks: '{{count}} bài' },
      settings: { changeTheme: 'Đổi giao diện', changeAccent: 'Đổi màu nhấn', spinningVinyl: 'Đĩa than xoay', alwaysOnTop: 'Ghim cửa sổ' },
    },
  },
  en: {
    translation: {
      common: { settings: 'Settings', close: 'Close', language: 'Language', vietnamese: 'Tiếng Việt', english: 'English' },
      player: { close: 'Close Mini Player', previous: 'Previous track', next: 'Next track', playPause: 'Play/Pause', shuffle: 'Shuffle', repeat: 'Repeat', shuffleUnavailable: 'YouTube supports shuffle only in a playlist or queue', repeatUnavailable: 'YouTube supports repeat only in a playlist or queue', volume: 'Volume', choosePlatform: 'Choose platform', expand: 'Expand window', collapse: 'Collapse window', loading: 'Loading {{platform}}…', opening: 'Opening {{platform}}…', loadingWeb: 'Loading web player', failed: 'Unable to load page' },
      platform: { local: 'Local Music' },
      local: { library: 'Music library', refresh: 'Refresh library', allMusic: 'All music', playFolder: 'Play folder', playNextFolder: 'Play next folder automatically', name: 'Name', type: 'Type', folder: 'Folder', chooseFolder: 'Select a folder to start playing music.', tracks: '{{count}} tracks' },
      settings: { changeTheme: 'Change theme', changeAccent: 'Change accent color', spinningVinyl: 'Spinning vinyl', alwaysOnTop: 'Always on top' },
    },
  },
} as const;

i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem('yt-mini-language') || 'vi',
  fallbackLng: 'vi',
  interpolation: { escapeValue: false },
});

export default i18n;
