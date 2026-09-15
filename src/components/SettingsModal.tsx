import React from 'react';
import { X, Disc, Palette, ShieldCheck, ExternalLink } from 'lucide-react';
import { PlayerSettings } from '../types/player';

interface SettingsModalProps {
  isOpen: boolean;
  settings: PlayerSettings;
  onClose: () => void;
  onUpdateSettings: (newSettings: Partial<PlayerSettings>) => void;
  onOpenGoogleLogin: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  onClose,
  onUpdateSettings,
  onOpenGoogleLogin,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-black/60 backdrop-blur-md animate-pop-in">
      <div className="w-full h-full max-h-[120px] bg-neutral-900/90 border border-white/10 rounded-xl p-2.5 flex flex-col justify-between shadow-2xl text-xs select-none">
        <div className="flex items-center justify-between border-b border-white/10 pb-1">
          <span className="font-semibold text-white flex items-center gap-1.5 text-[12px]">
            <Palette className="w-3.5 h-3.5" style={{ color: settings.accentColor }} />
            Tùy Chỉnh & Đăng Nhập
          </span>
          <button
            onClick={onClose}
            className="p-0.5 text-neutral-400 hover:text-white rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5 py-1">
          <label className="flex items-center justify-between px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/5 rounded-md cursor-pointer transition-colors">
            <span className="text-neutral-300">Màu nhấn</span>
            <input
              type="color"
              value={settings.accentColor}
              onChange={(e) => onUpdateSettings({ accentColor: e.target.value })}
              className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent"
            />
          </label>

          <div
            onClick={() => onUpdateSettings({ enableVinylSpin: !settings.enableVinylSpin })}
            className="flex items-center justify-between px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/5 rounded-md cursor-pointer transition-colors"
          >
            <span className="flex items-center gap-1 text-neutral-300">
              <Disc className="w-3 h-3" />
              Đĩa than xoay
            </span>
            <span
              className={`w-3 h-3 rounded-full border border-white/20 transition-all ${
                settings.enableVinylSpin ? 'bg-emerald-500 scale-110' : 'bg-neutral-600'
              }`}
            />
          </div>

          <div
            onClick={onOpenGoogleLogin}
            className="flex items-center justify-between px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/5 rounded-md cursor-pointer transition-colors col-span-2 text-emerald-400"
            title="Mở Chrome/Edge thật để đăng nhập Google không bị chặn"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Đăng nhập Google an toàn (Trình duyệt ngoài)
            </span>
            <ExternalLink className="w-3 h-3 text-neutral-400" />
          </div>
        </div>
      </div>
    </div>
  );
};