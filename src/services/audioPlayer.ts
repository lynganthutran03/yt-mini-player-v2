export interface TrackPlaySource {
  streamUrl: string;
  title: string;
  artist: string;
  thumbnail: string;
}

class AudioPlayerService {
  private audio: HTMLAudioElement;
  private onTimeUpdateCallback?: (currentTime: number, duration: number) => void;
  private onTrackEndedCallback?: () => void;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';

    this.audio.addEventListener('timeupdate', () => {
      if (this.onTimeUpdateCallback) {
        this.onTimeUpdateCallback(this.audio.currentTime, this.audio.duration || 0);
      }
    });

    this.audio.addEventListener('ended', () => {
      if (this.onTrackEndedCallback) {
        this.onTrackEndedCallback();
      }
    });

    this.audio.addEventListener('error', (e) => {
      console.error('Audio stream playback error:', e);
    });
  }

  public async loadStream(url: string): Promise<void> {
    this.audio.src = url;
    await this.audio.play();
  }

  public play(): Promise<void> {
    return this.audio.play();
  }

  public pause(): void {
    this.audio.pause();
  }

  public seek(seconds: number): void {
    if (this.audio.duration && !isNaN(seconds)) {
      this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration));
    }
  }

  public setVolume(volumePercentage: number): void {
    const clamped = Math.max(0, Math.min(100, volumePercentage));
    this.audio.volume = clamped / 100;
  }

  public setMuted(muted: boolean): void {
    this.audio.muted = muted;
  }

  public onTimeUpdate(cb: (currentTime: number, duration: number) => void): void {
    this.onTimeUpdateCallback = cb;
  }

  public onTrackEnded(cb: () => void): void {
    this.onTrackEndedCallback = cb;
  }
}

export const audioPlayer = new AudioPlayerService();