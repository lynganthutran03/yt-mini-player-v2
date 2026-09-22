use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Sender},
    Arc, Mutex,
};
use std::{fs::File, io::BufReader};
use std::time::{Duration, Instant};
use rodio::{Decoder, OutputStream, Sink, Source};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewBuilder, WebviewUrl,
};
use serde::Serialize;

static PLAYER_WEBVIEW_INIT_STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Clone)]
struct WindowGeometry {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
}

#[derive(Default)]
struct WindowRestoreState(Mutex<Option<WindowGeometry>>);

enum LocalAudioCommand {
    PlayQueue { paths: Vec<String>, start_index: usize, app: AppHandle },
    TogglePause,
    SetVolume(f32),
    Next,
    Previous,
    ToggleShuffle,
    CycleRepeat,
    Stop,
}

struct LocalAudioState {
    sender: Sender<LocalAudioCommand>,
    is_active: AtomicBool,
    volume_bits: Arc<std::sync::atomic::AtomicU32>,
}

struct ActiveLocalPlayback {
    _stream: OutputStream,
    sink: Sink,
    queue: Vec<String>,
    index: usize,
    app: AppHandle,
    title: String,
    duration: f64,
    shuffle: bool,
    repeat: LocalRepeatMode,
    last_progress_emit: Instant,
}

#[derive(Serialize)]
struct LocalMusicFolder {
    name: String,
    paths: Vec<String>,
}

#[derive(Clone, Copy)]
enum LocalRepeatMode { None, All, One }

impl LocalRepeatMode {
    fn next(self) -> Self { match self { Self::None => Self::All, Self::All => Self::One, Self::One => Self::None } }
    fn as_str(self) -> &'static str { match self { Self::None => "none", Self::All => "all", Self::One => "one" } }
}

fn create_local_playback(queue: Vec<String>, index: usize, app: AppHandle, volume: f32, shuffle: bool, repeat: LocalRepeatMode) -> Result<ActiveLocalPlayback, String> {
    let path = queue.get(index).ok_or_else(|| "Không còn bài trong hàng đợi".to_string())?;
    let file = File::open(path).map_err(|error| format!("Không thể mở file nhạc: {error}"))?;
    let source = Decoder::new(BufReader::new(file))
        .map_err(|error| format!("File nhạc không được hỗ trợ: {error}"))?;
    let duration = source.total_duration().map(|value| value.as_secs_f64()).unwrap_or(0.0);
    let (stream, stream_handle) = OutputStream::try_default()
        .map_err(|error| format!("Không thể khởi tạo audio output: {error}"))?;
    let sink = Sink::try_new(&stream_handle)
        .map_err(|error| format!("Không thể tạo audio player: {error}"))?;
    sink.append(source);
    sink.set_volume(volume);
    sink.play();
    let title = std::path::Path::new(path)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Nhạc trên máy")
        .to_string();
    Ok(ActiveLocalPlayback { _stream: stream, sink, queue, index, app, title, duration, shuffle, repeat, last_progress_emit: Instant::now() - Duration::from_secs(1) })
}

fn emit_local_playback(playback: &ActiveLocalPlayback) {
    let _ = playback.app.emit("yt-music-data", serde_json::json!({
        "source": "local",
        "title": playback.title,
        "artist": "Nhạc trên máy",
        "album": "",
        "thumb": "",
        "isPlaying": !playback.sink.is_paused() && !playback.sink.empty(),
        "volume": (playback.sink.volume() * 100.0).round(),
        "isShuffleActive": playback.shuffle,
        "loopState": playback.repeat.as_str(),
        "currentTime": playback.sink.get_pos().as_secs_f64(),
        "duration": playback.duration,
    }));
}

impl LocalAudioState {
    fn new() -> Self {
        let (sender, receiver) = mpsc::channel::<LocalAudioCommand>();
        let volume_bits = Arc::new(std::sync::atomic::AtomicU32::new(1.0f32.to_bits()));
        let worker_volume_bits = volume_bits.clone();
        std::thread::spawn(move || {
            let mut playback: Option<ActiveLocalPlayback> = None;
            let mut shuffle_enabled = false;
            let mut repeat_mode = LocalRepeatMode::None;
            loop {
                match receiver.recv_timeout(Duration::from_millis(250)) {
                    Ok(LocalAudioCommand::PlayQueue { mut paths, start_index, app }) => {
                        if shuffle_enabled { shuffle_paths(&mut paths); }
                        let index = start_index.min(paths.len().saturating_sub(1));
                        match create_local_playback(paths, index, app.clone(), f32::from_bits(worker_volume_bits.load(Ordering::SeqCst)), shuffle_enabled, repeat_mode) {
                        Ok(next) => playback = Some(next),
                        Err(error) => { let _ = app.emit("local-audio-error", error); }
                    }},
                    Ok(LocalAudioCommand::TogglePause) => if let Some(current) = playback.as_ref() {
                        if current.sink.is_paused() { current.sink.play(); } else { current.sink.pause(); }
                    },
                    Ok(LocalAudioCommand::SetVolume(volume)) => if let Some(current) = playback.as_ref() { current.sink.set_volume(volume); },
                    Ok(LocalAudioCommand::Next) => {
                        let next = playback.as_ref().and_then(|current| {
                            let target = (current.index + 1).min(current.queue.len().saturating_sub(1));
                            (target != current.index).then(|| (current.queue.clone(), target, current.app.clone()))
                        });
                        if let Some((queue, target, app)) = next {
                            playback = create_local_playback(queue, target, app, f32::from_bits(worker_volume_bits.load(Ordering::SeqCst)), shuffle_enabled, repeat_mode).ok();
                        }
                    }
                    Ok(LocalAudioCommand::Previous) => {
                        let previous = playback.as_ref().and_then(|current| {
                            let target = current.index.saturating_sub(1);
                            (target != current.index).then(|| (current.queue.clone(), target, current.app.clone()))
                        });
                        if let Some((queue, target, app)) = previous {
                            playback = create_local_playback(queue, target, app, f32::from_bits(worker_volume_bits.load(Ordering::SeqCst)), shuffle_enabled, repeat_mode).ok();
                        }
                    }
                    Ok(LocalAudioCommand::ToggleShuffle) => {
                        shuffle_enabled = !shuffle_enabled;
                        if let Some(current) = playback.as_mut() {
                            let active_path = current.queue[current.index].clone();
                            if shuffle_enabled { shuffle_paths(&mut current.queue); } else { current.queue.sort_unstable(); }
                            current.index = current.queue.iter().position(|path| path == &active_path).unwrap_or(0);
                            current.shuffle = shuffle_enabled;
                            emit_local_playback(current);
                        }
                    }
                    Ok(LocalAudioCommand::CycleRepeat) => {
                        repeat_mode = repeat_mode.next();
                        if let Some(current) = playback.as_mut() { current.repeat = repeat_mode; emit_local_playback(current); }
                    }
                    Ok(LocalAudioCommand::Stop) => playback = None,
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        let following = playback.as_ref().and_then(|current| {
                            if !current.sink.empty() || current.sink.get_pos() < Duration::from_millis(200) { return None; }
                            let target = if current.repeat.as_str() == "one" { Some(current.index) }
                                else if current.index + 1 < current.queue.len() { Some(current.index + 1) }
                                else if current.repeat.as_str() == "all" { Some(0) } else { None };
                            target.map(|target| (current.queue.clone(), target, current.app.clone(), current.shuffle, current.repeat))
                        });
                        if let Some((queue, target, app, shuffle, repeat)) = following {
                            playback = create_local_playback(queue, target, app, f32::from_bits(worker_volume_bits.load(Ordering::SeqCst)), shuffle, repeat).ok();
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
                if let Some(current) = playback.as_mut() {
                    if current.last_progress_emit.elapsed() >= Duration::from_secs(1) {
                        emit_local_playback(current);
                        current.last_progress_emit = Instant::now();
                    }
                }
            }
        });
        Self { sender, is_active: AtomicBool::new(false), volume_bits }
    }
}

fn shuffle_paths(paths: &mut [String]) {
    let mut seed = Instant::now().elapsed().as_nanos() as u64 ^ paths.len() as u64;
    for index in (1..paths.len()).rev() {
        seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17;
        paths.swap(index, (seed as usize) % (index + 1));
    }
}

struct PlayerNavigationState(Mutex<String>);

impl Default for PlayerNavigationState {
    fn default() -> Self {
        Self(Mutex::new("youtube-music".to_string()))
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerLoadEvent {
    status: &'static str,
}

fn emit_player_load_state(app: &AppHandle, status: &'static str) {
    // This event is intentionally best-effort. A missing frontend listener must
    // never interrupt page navigation or media playback.
    let _ = app.emit("player-load-state", PlayerLoadEvent { status });
}

fn set_expected_platform(app: &AppHandle, platform: &str) {
    if let Ok(mut expected) = app.state::<PlayerNavigationState>().0.lock() {
        *expected = platform.to_string();
    }
}

fn navigation_matches_expected_platform(app: &AppHandle, host: &str) -> bool {
    let expected = match app.state::<PlayerNavigationState>().0.lock() {
        Ok(expected) => expected.clone(),
        // Be conservative when state is unavailable: keep the webview hidden
        // rather than flashing an outdated page above the loading UI.
        Err(_) => return false,
    };

    match expected.as_str() {
        "youtube-music" => host == "music.youtube.com",
        "youtube" => matches!(host, "youtube.com" | "www.youtube.com"),
        "soundcloud" => matches!(host, "soundcloud.com" | "www.soundcloud.com"),
        _ => false,
    }
}

#[tauri::command]
fn close_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn play_local_folder(
    app: AppHandle,
    paths: Vec<String>,
    start_index: Option<usize>,
    volume: Option<f64>,
    local_audio: State<'_, LocalAudioState>,
) -> Result<(), String> {
    if paths.is_empty() {
        return Err("Thư mục này không có file nhạc được hỗ trợ".to_string());
    }
    if let Some(volume) = volume {
        let volume = (volume as f32).clamp(0.0, 1.0);
        local_audio.volume_bits.store(volume.to_bits(), Ordering::SeqCst);
    }
    local_audio.is_active.store(true, Ordering::SeqCst);
    local_audio
        .sender
        .send(LocalAudioCommand::PlayQueue { paths, start_index: start_index.unwrap_or(0), app })
        .map_err(|_| "Native audio thread is unavailable".to_string())
}

fn local_music_folder_config_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    let folder = app.path().app_config_dir().ok()?;
    std::fs::create_dir_all(&folder).ok()?;
    Some(folder.join("local-music-folder.txt"))
}

fn saved_local_music_folder(app: &AppHandle) -> Option<std::path::PathBuf> {
    let path = local_music_folder_config_path(app)?;
    let folder = std::path::PathBuf::from(std::fs::read_to_string(path).ok()?.trim());
    folder.is_dir().then_some(folder)
}

fn default_local_music_folder() -> Option<std::path::PathBuf> {
    let folder = std::env::var_os("USERPROFILE").map(std::path::PathBuf::from)?.join("Music");
    folder.is_dir().then_some(folder)
}

#[tauri::command]
fn get_local_music_library(app: AppHandle) -> Vec<LocalMusicFolder> {
    let Some(root) = default_local_music_folder().or_else(|| saved_local_music_folder(&app)) else {
        return Vec::new();
    };

    let mut folders: Vec<LocalMusicFolder> = std::fs::read_dir(&root)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_dir() { return None; }
            let paths = collect_audio_files(&path);
            (!paths.is_empty()).then(|| LocalMusicFolder {
                name: entry.file_name().to_string_lossy().to_string(),
                paths,
            })
        })
        .collect();
    folders.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));

    let root_tracks: Vec<String> = std::fs::read_dir(&root)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            path.is_file().then_some(path)
        })
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "mp3" | "flac" | "wav" | "ogg" | "m4a" | "aac"))
                .unwrap_or(false)
        })
        .map(|path| path.to_string_lossy().to_string())
        .collect();
    if !root_tracks.is_empty() {
        folders.insert(0, LocalMusicFolder { name: "Nhạc chưa phân loại".to_string(), paths: root_tracks });
    }
    folders
}

#[tauri::command]
fn load_saved_local_music_folder(app: AppHandle) -> Option<Vec<String>> {
    let folder = saved_local_music_folder(&app)?;
    let tracks = collect_audio_files(&folder);
    (!tracks.is_empty()).then_some(tracks)
}

#[tauri::command]
fn pick_local_music_folder(app: AppHandle) -> Option<Vec<String>> {
    let initial_folder = saved_local_music_folder(&app).or_else(default_local_music_folder);
    let dialog = if let Some(folder) = initial_folder {
        rfd::FileDialog::new().set_directory(folder)
    } else {
        rfd::FileDialog::new()
    };
    let folder = dialog.pick_folder()?;
    let tracks = collect_audio_files(&folder);
    if tracks.is_empty() {
        return None;
    }
    if let Some(config_path) = local_music_folder_config_path(&app) {
        let _ = std::fs::write(config_path, folder.to_string_lossy().as_bytes());
    }
    Some(tracks)
}

fn collect_audio_files(folder: &std::path::Path) -> Vec<String> {
    const EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "ogg", "m4a", "aac"];
    let mut files = Vec::new();
    let mut folders = vec![folder.to_path_buf()];
    while let Some(current) = folders.pop() {
        let entries = match std::fs::read_dir(current) { Ok(entries) => entries, Err(_) => continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                folders.push(path);
            } else if path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| EXTENSIONS.iter().any(|known| ext.eq_ignore_ascii_case(known))) {
                files.push(path.to_string_lossy().to_string());
            }
        }
    }
    files.sort_unstable();
    files
}

#[tauri::command]
fn set_always_on_top(window: tauri::Window, enabled: bool) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|e| format!("Failed to set always-on-top state: {e}"))
}

#[tauri::command]
fn init_player_webview(app: AppHandle, window: tauri::Window) {
    if PLAYER_WEBVIEW_INIT_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    // Creating a child WebView must not run synchronously inside the invoke
    // handler: on Windows it can block the IPC queue, leaving every later
    // frontend invoke (close, resize, expand) pending forever.
    let app_for_thread = app.clone();
    std::thread::spawn(move || {
        let window_for_main = window.clone();
        let app_for_main = app_for_thread.clone();
        if let Err(err) = window.run_on_main_thread(move || {
            if let Err(err) = init_player_webview_inner(app_for_main, window_for_main) {
                eprintln!("Failed to initialize player webview: {err}");
            }
        }) {
            eprintln!("Failed to schedule player webview initialization: {err}");
        }
    });
}

fn init_player_webview_inner(app: AppHandle, main_win: tauri::Window) -> Result<(), String> {
    if app.get_webview("yt-player").is_some() {
        return Ok(());
    }

    let init_script = r#"
        // Anti-bot & Safe login evasion
        try {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
                configurable: true
            });
        } catch(e) {}

        // Keep the native mini-player chrome out of the way while a site uses
        // the browser fullscreen API (notably YouTube's fullscreen button).
        const emitFullscreenState = (force = false) => {
            try {
                const isFullscreen = Boolean(
                    document.fullscreenElement ||
                    document.webkitFullscreenElement ||
                    document.querySelector('.ytp-fullscreen')
                );
                if (!force && window.__miniPlayerFullscreenState === isFullscreen) return;
                window.__miniPlayerFullscreenState = isFullscreen;
                if (window.__TAURI__ && window.__TAURI__.event) {
                    window.__TAURI__.event.emit('player-fullscreen-state', {
                        isFullscreen
                    });
                }
            } catch(e) {}
        };
        document.addEventListener('fullscreenchange', emitFullscreenState);
        document.addEventListener('webkitfullscreenchange', emitFullscreenState);
        window.setTimeout(() => emitFullscreenState(true), 0);

        // When in background mini-player mode, reduce video decoding workload
        window.__miniPlayerExpanded = false;
        window.__setExpandedMode = (expanded) => {
            window.__miniPlayerExpanded = Boolean(expanded);
            try {
                const videos = document.querySelectorAll('video');
                videos.forEach(v => {
                    if (!v) return;
                    if (window.__miniPlayerExpanded) {
                        // Phóng to: Khôi phục hiển thị và render đầy đủ
                        v.removeAttribute('disablepictureinpicture');
                    } else {
                        // Thu nhỏ mini: Giảm tải visual rendering
                        v.setAttribute('disablepictureinpicture', 'true');
                    }
                });
            } catch(e) {}
        };


        let lastEmittedState = '';
        const emitMusicData = (data) => {
            try {
                if (!window.__TAURI__ || !window.__TAURI__.event) return;
                // Truncate currentTime to 1 decimal place to avoid flooding IPC events every frame
                const roundedTime = typeof data.currentTime === 'number' ? Math.floor(data.currentTime) : 0;
                const signature = `${data.title}|${data.artist}|${data.thumb}|${data.isPlaying}|${data.volume}|${data.isShuffleActive}|${data.loopState}|${roundedTime}|${data.duration}`;
                if (signature === lastEmittedState) return;
                lastEmittedState = signature;
                window.__TAURI__.event.emit('yt-music-data', data);
            } catch(e) {}
        };

        // Periodic scraper for YouTube Music (ran every 1000ms instead of 500ms to save CPU & RAM)
        setInterval(() => {
            try {
                emitFullscreenState();
                const playerBar = document.querySelector('ytmusic-player-bar');
                if (!playerBar) {
                    // Standard YouTube watch page has a different DOM from
                    // YouTube Music, so collect its metadata separately.
                    if (location.hostname.includes('youtube.com')) {
                        const video = document.querySelector('video');
                        const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') || document.querySelector('h1.title yt-formatted-string') || document.querySelector('h1');
                        const artistEl = document.querySelector('#owner #channel-name a') || document.querySelector('ytd-channel-name a');
                        const imageMeta = document.querySelector('meta[property="og:image"]') || document.querySelector('meta[name="twitter:image"]');
                        const thumbnailList = window.ytInitialPlayerResponse?.videoDetails?.thumbnail?.thumbnails || [];
                        const playerThumb = thumbnailList[thumbnailList.length - 1]?.url || '';
                        const videoId = new URLSearchParams(location.search).get('v') || location.pathname.match(/^\/shorts\/([^/?]+)/)?.[1] || '';
                        const generatedThumb = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
                        const thumb = playerThumb || generatedThumb || imageMeta?.content || video?.getAttribute('poster') || '';
                        const youtubePlayer = document.getElementById('movie_player');
                        const shuffleButton = document.querySelector('button.ytp-shuffle-button');
                        const repeatButton = document.querySelector('button.ytp-repeat-button');
                        const isShuffleActive = typeof youtubePlayer?.getShuffle === 'function'
                            ? Boolean(youtubePlayer.getShuffle())
                            : shuffleButton?.getAttribute('aria-pressed') === 'true' || shuffleButton?.classList.contains('ytp-button-active');
                        const isLoopActive = typeof youtubePlayer?.getLoop === 'function'
                            ? Boolean(youtubePlayer.getLoop())
                            : repeatButton?.getAttribute('aria-pressed') === 'true' || repeatButton?.classList.contains('ytp-button-active');

                        emitMusicData({
                            title: titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : document.title.replace(/\s*-\s*YouTube\s*$/, ''),
                            artist: artistEl ? (artistEl.innerText || artistEl.textContent || '').trim() : 'YouTube',
                            album: '',
                            thumb,
                            isPlaying: Boolean(video && !video.paused),
                            volume: video ? Math.round((video.muted ? 0 : video.volume) * 100) : 100,
                            isShuffleActive,
                            loopState: isLoopActive ? 'all' : 'none',
                            currentTime: video?.currentTime || 0,
                            duration: video?.duration || 0
                        });
                    }
                    if (location.hostname.includes('soundcloud.com')) {
                        const audio = document.querySelector('audio');
                        const imageMeta = document.querySelector('meta[property="og:image"]');
                        const titleEl = document.querySelector('.playbackSoundBadge__titleLink');
                        const artistEl = document.querySelector('.playbackSoundBadge__lightLink');
                        const playerBadge = titleEl?.closest('.playbackSoundBadge') || document.querySelector('.playbackSoundBadge');
                        const artworkEl = playerBadge?.querySelector('img') || document.querySelector('img.playbackSoundBadge__avatar') || document.querySelector('.playbackSoundBadge__avatar img');
                        const artworkNode = playerBadge?.querySelector('.playbackSoundBadge__avatar, .sc-artwork') || document.querySelector('.playbackSoundBadge__avatar');
                        const artworkStyle = artworkNode?.getAttribute('style') || '';
                        const artworkComputed = artworkNode ? getComputedStyle(artworkNode).backgroundImage : '';
                        const artworkBg = (artworkStyle.match(/url\(["']?(.*?)["']?\)/)?.[1] || artworkComputed.match(/url\(["']?(.*?)["']?\)/)?.[1] || '');
                        const hydratedTrack = (window.__sc_hydration || []).map(item => item?.data).find(item => item?.artwork_url);
                        const hydratedArtwork = hydratedTrack?.artwork_url ? hydratedTrack.artwork_url.replace(/-large(?=\.[a-z]+$)/i, '-t500x500') : '';
                        const shuffleControl = document.querySelector('.shuffleControl, [aria-label*="Shuffle"], [title*="Shuffle"]');
                        const repeatControl = document.querySelector('.repeatControl, [aria-label*="Repeat"], [title*="Repeat"]');
                        const playControl = document.querySelector('.playControl');
                        const timePassedEl = document.querySelector('.playbackTimeline__timePassed');
                        const durationEl = document.querySelector('.playbackTimeline__duration');
                        const volumeControl = document.querySelector('.volume__slider, input[aria-label*="Volume"]');
                        const soundcloudVolume = document.querySelector('.volume[data-level]');
                        const parseTime = value => {
                            const stamp = (value || '').match(/\d+(?::\d+)+/g)?.pop();
                            return stamp ? stamp.split(':').reduce((total, part) => total * 60 + (parseInt(part, 10) || 0), 0) : 0;
                        };
                        const playLabel = (playControl?.getAttribute('title') || playControl?.getAttribute('aria-label') || '').toLowerCase();
                        const isPlaying = audio ? !audio.paused : /pause|tạm dừng|tam dung/.test(playLabel) || playControl?.classList.contains('playing');
                        const volumeValue = audio ? Math.round((audio.muted ? 0 : audio.volume) * 100) : (soundcloudVolume?.getAttribute('data-level') !== null ? Number(soundcloudVolume.getAttribute('data-level')) * 10 : Number(volumeControl?.value || volumeControl?.getAttribute('aria-valuenow') || 100));
                        // The page metadata changes while browsing feeds. Only
                        // emit data from SoundCloud's persistent player bar.
                        if (!titleEl) return;
                        const title = (titleEl.textContent || '').trim();
                        const artist = (artistEl?.textContent || 'SoundCloud').trim();
                        const trackUrl = titleEl.href || '';
                        if (trackUrl && window.__scArtworkTrack !== trackUrl) {
                            window.__scArtworkTrack = trackUrl;
                            window.__scArtworkUrl = '';
                            fetch(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(trackUrl)}`)
                                .then(response => response.ok ? response.json() : null)
                                .then(data => {
                                    if (data?.thumbnail_url && window.__scArtworkTrack === trackUrl) {
                                        window.__scArtworkUrl = data.thumbnail_url.replace(/-large(?=\.[a-z]+$)/i, '-t500x500');
                                    }
                                })
                                .catch(() => {});
                        }
                        emitMusicData({
                            title, artist, album: '', thumb: window.__scArtworkUrl || hydratedArtwork || artworkEl?.src || artworkBg || imageMeta?.content || '',
                            isPlaying: Boolean(isPlaying),
                            volume: volumeValue,
                            isShuffleActive: shuffleControl?.classList.contains('m-shuffling') || shuffleControl?.classList.contains('m-active'),
                            loopState: repeatControl?.classList.contains('m-one') ? 'one' : (repeatControl?.classList.contains('m-repeating') || repeatControl?.classList.contains('m-all') || repeatControl?.classList.contains('m-active') ? 'all' : 'none'),
                            currentTime: audio?.currentTime || parseTime(timePassedEl?.textContent),
                            duration: audio?.duration || parseTime(durationEl?.textContent)
                        });
                    }
                    return;
                }

                const titleElem = playerBar.querySelector('.title') || playerBar.querySelector('yt-formatted-string.title');
                const title = titleElem ? (titleElem.innerText || titleElem.textContent).trim() : 'Không có bài hát';

                const bylineElem = playerBar.querySelector('.byline') || playerBar.querySelector('span.subtitle');
                let artist = '';
                let album = '';
                if (bylineElem) {
                    const links = bylineElem.querySelectorAll('a');
                    if (links.length > 0) {
                        artist = (links[0].innerText || links[0].textContent).trim();
                        if (links.length > 1) {
                            album = (links[1].innerText || links[1].textContent).trim();
                        }
                    } else {
                        const bylineText = (bylineElem.innerText || bylineElem.textContent).trim();
                        const parts = bylineText.split(/[•\u2022\u00b7\n\r|]/).map(p => p.trim()).filter(Boolean);
                        if (parts.length > 0) artist = parts[0];
                        if (parts.length > 1 && !/^\d{4}$/.test(parts[1])) {
                            album = parts[1];
                        }
                    }
                }

                const img = playerBar.querySelector('img.image') || playerBar.querySelector('img#img') || playerBar.querySelector('.thumbnail img') || playerBar.querySelector('img');
                const thumb = img && img.src && img.src.startsWith('http') ? img.src : '';

                const playBtn = playerBar.querySelector('#play-pause-button') || playerBar.querySelector('.play-pause-button');
                let isPlaying = false;
                if (playBtn) {
                    const titleAttr = playBtn.getAttribute('title') || '';
                    const labelAttr = playBtn.getAttribute('aria-label') || '';
                    isPlaying = titleAttr.toLowerCase().includes('tạm dừng') ||
                                titleAttr.toLowerCase().includes('pause') ||
                                labelAttr.toLowerCase().includes('tạm dừng') ||
                                labelAttr.toLowerCase().includes('pause');
                }

                let volume = 100;
                const video = document.querySelector('video');
                const slider = document.querySelector('ytmusic-player-bar tp-yt-paper-slider#volume-slider') || document.querySelector('#volume-slider');
                if (video && video.muted) {
                    volume = 0;
                } else if (slider && slider.value !== undefined && slider.value !== null && slider.value !== '') {
                    volume = parseInt(slider.value, 10);
                } else if (video && video.volume !== undefined) {
                    volume = Math.round(video.volume * 100);
                }

                let currentTime = 0;
                let duration = 0;
                const progressBar = document.getElementById('progress-bar') || document.querySelector('ytmusic-player-bar tp-yt-paper-progress');
                if (progressBar) {
                    const val = progressBar.getAttribute('aria-valuenow') || progressBar.value;
                    const max = progressBar.getAttribute('aria-valuemax') || progressBar.max;
                    if (val !== null && val !== undefined) currentTime = parseFloat(val) || 0;
                    if (max !== null && max !== undefined) duration = parseFloat(max) || 0;
                }

                if (duration === 0) {
                    const timeInfo = document.querySelector('ytmusic-player-bar .time-info');
                    if (timeInfo) {
                        const text = (timeInfo.innerText || timeInfo.textContent).trim();
                        const parts = text.split('/');
                        if (parts.length === 2) {
                            const parse = t => t.trim().split(':').reduce((acc, val) => acc * 60 + parseInt(val, 10), 0);
                            currentTime = parse(parts[0]);
                            duration = parse(parts[1]);
                        }
                    }
                }

                const shuffleBtn = playerBar.querySelector('#shuffle') || playerBar.querySelector('.shuffle') || document.querySelector('#shuffle') || document.querySelector('[data-action="shuffle"]');
                let isShuffleActive = false;
                if (shuffleBtn) {
                    const pressed = (shuffleBtn.getAttribute('aria-pressed') || '').toLowerCase();
                    const state = (shuffleBtn.getAttribute('data-state') || shuffleBtn.getAttribute('active') || '').toLowerCase();
                    const playerState = [playerBar.getAttribute('shuffle'), playerBar.getAttribute('shuffle-on'), playerBar.getAttribute('shuffle-enabled')].filter(Boolean).join(' ').toLowerCase();
                    const internalShuffle = playerBar.shuffleOn ?? playerBar.isShuffleOn ?? playerBar.shuffle;
                    isShuffleActive = typeof internalShuffle === 'boolean'
                        ? internalShuffle
                        : pressed === 'true' || state === 'true' || state === 'on' || playerState === 'true' || playerState === 'on' || shuffleBtn.classList.contains('active');
                }

                const loopBtn = playerBar.querySelector('#repeat') || playerBar.querySelector('.repeat') || document.querySelector('#repeat');
                let loopState = 'none';
                if (loopBtn) {
                    const state = [
                        loopBtn.getAttribute('title'),
                        loopBtn.getAttribute('aria-label'),
                        loopBtn.getAttribute('data-state'),
                        loopBtn.getAttribute('icon'),
                        loopBtn.querySelector('iron-icon')?.getAttribute('icon'),
                        loopBtn.querySelector('yt-icon')?.getAttribute('icon'),
                        playerBar.getAttribute('repeat-mode')
                    ].filter(Boolean).join(' ').toLowerCase();
                    const pressed = (loopBtn.getAttribute('aria-pressed') || '').toLowerCase();
                    const internalMode = String(playerBar.repeatMode ?? playerBar.repeatMode_ ?? playerBar._repeatMode ?? '').toLowerCase();
                    if (/one|single|một|mot|\b1\b/.test(internalMode)) {
                        loopState = 'one';
                    } else if (/all|playlist/.test(internalMode)) {
                        loopState = 'all';
                    } else if (/off|none|tắt|tat|disabled/.test(internalMode) || internalMode || /off|none|tắt|tat|disabled/.test(state) || pressed === 'false') {
                        loopState = 'none';
                    } else if (pressed === 'true' || loopBtn.classList.contains('active') || /all|playlist/.test(state)) {
                        loopState = 'all';
                    }
                }

                const repeatDebug = loopBtn ? JSON.stringify({
                    title: loopBtn.getAttribute('title'),
                    ariaLabel: loopBtn.getAttribute('aria-label'),
                    ariaPressed: loopBtn.getAttribute('aria-pressed'),
                    dataState: loopBtn.getAttribute('data-state'),
                    className: loopBtn.className?.toString(),
                    icon: loopBtn.querySelector('iron-icon, yt-icon')?.getAttribute('icon'),
                    repeatMode: playerBar.repeatMode ?? playerBar.repeatMode_ ?? playerBar._repeatMode,
                }) : 'repeat button not found';

                emitMusicData({
                    title,
                    artist,
                    album,
                    thumb,
                    isPlaying,
                    volume,
                    isShuffleActive,
                    loopState,
                    repeatDebug,
                    currentTime,
                    duration
                });
            } catch(e) {}
        }, 1000);
    "#;

    let user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

    // Embed YouTube Music directly as a child webview of the main window
    let player_page_events_app = app.clone();
    let webview = WebviewBuilder::new(
        "yt-player",
        WebviewUrl::External(
            "https://music.youtube.com"
                .parse()
                .map_err(|e| format!("{:?}", e))?,
        ),
    )
    .user_agent(user_agent)
    .initialization_script(init_script)
    .on_page_load(move |_webview, payload| match payload.event() {
        tauri::webview::PageLoadEvent::Started => {
            emit_player_load_state(&player_page_events_app, "loading");
        }
        tauri::webview::PageLoadEvent::Finished => {
            // WebView2 can still deliver a Finished event from the page we just
            // left. Only the platform currently requested by the user may make
            // the native child surface visible again.
            if navigation_matches_expected_platform(
                &player_page_events_app,
                payload.url().host_str().unwrap_or(""),
            ) {
                // Do not hide/show the native WebView while navigating: doing
                // so makes WebView2 replay the prior compositor frame. Keep it
                // visible like a normal browser and update only the React mini
                // chrome with its loading state.
                let app_for_show = player_page_events_app.clone();
                let loaded_host = payload.url().host_str().unwrap_or("").to_string();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    let app_for_main = app_for_show.clone();
                    let _ = app_for_show.run_on_main_thread(move || {
                        if !navigation_matches_expected_platform(&app_for_main, &loaded_host) {
                            return;
                        }
                        emit_player_load_state(&app_for_main, "ready");
                    });
                });
            }
        }
    })
    .on_new_window(move |url, features| {
        let label = format!(
            "login-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        );
        let visited_google = Arc::new(AtomicBool::new(false));
        let popup_login_state = visited_google.clone();
        let popup_app = app.clone();
        let popup = tauri::WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
            .window_features(features)
            .title("SoundCloud login")
            .user_agent(user_agent)
            .on_page_load(move |webview, payload| {
                if !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                    return;
                }

                let url = payload.url();
                let host = url.host_str().unwrap_or("");
                if host.ends_with("google.com") {
                    popup_login_state.store(true, Ordering::SeqCst);
                    return;
                }

                // Only the clean SoundCloud home URL counts as completion.
                // Redirects used for verification and OAuth callbacks retain a
                // path or query string and must stay open.
                let is_completed_login = popup_login_state.load(Ordering::SeqCst)
                    && matches!(host, "soundcloud.com" | "www.soundcloud.com")
                    && url.path() == "/"
                    && url.query().is_none();
                if is_completed_login {
                    popup_login_state.store(false, Ordering::SeqCst);
                    if let Some(player) = popup_app.get_webview("yt-player") {
                        let _ = player.eval("window.location.reload();");
                    }
                    let _ = webview.close();
                }
            })
            .build()
            .expect("failed to create login popup");
        let _ = popup.set_always_on_top(true);
        let _ = popup.show();
        let _ = popup.set_focus();
        tauri::webview::NewWindowResponse::Create { window: popup }
    });

    // Park child webview at 1x1 bottom corner initially (same trick as V1)
    main_win
        .add_child(
            webview,
            PhysicalPosition::new(419, 129),
            PhysicalSize::new(1, 1),
        )
        .map_err(|e| format!("Failed to embed YouTube Music webview: {:?}", e))?;

    Ok(())
}

#[tauri::command]
fn control_player(
    app: AppHandle,
    action: String,
    value: Option<f64>,
    local_audio: State<'_, LocalAudioState>,
) -> Result<(), String> {
    if local_audio.is_active.load(Ordering::SeqCst) {
        match action.as_str() {
            "play-pause" => local_audio
                .sender
                .send(LocalAudioCommand::TogglePause)
                .map_err(|_| "Native audio thread is unavailable".to_string())?,
            "volume" => {
                let volume = value.unwrap_or(1.0) as f32;
                local_audio.volume_bits.store(volume.to_bits(), Ordering::SeqCst);
                local_audio
                    .sender
                    .send(LocalAudioCommand::SetVolume(volume))
                    .map_err(|_| "Native audio thread is unavailable".to_string())?
            }
            "next" => local_audio
                .sender
                .send(LocalAudioCommand::Next)
                .map_err(|_| "Native audio thread is unavailable".to_string())?,
            "prev" => local_audio
                .sender
                .send(LocalAudioCommand::Previous)
                .map_err(|_| "Native audio thread is unavailable".to_string())?,
            "shuffle" => local_audio
                .sender
                .send(LocalAudioCommand::ToggleShuffle)
                .map_err(|_| "Native audio thread is unavailable".to_string())?,
            "loop" => local_audio
                .sender
                .send(LocalAudioCommand::CycleRepeat)
                .map_err(|_| "Native audio thread is unavailable".to_string())?,
            "seek" => {}
            _ => return Err(format!("Unknown action: {}", action)),
        }
        return Ok(());
    }

    let webview = app
        .get_webview("yt-player")
        .ok_or_else(|| "Player webview not found".to_string())?;

    let script = match action.as_str() {
        "play-pause" => {
            r#"
            (function() {
                const playBtn = document.querySelector('#play-pause-button') || document.querySelector('.play-pause-button') || document.querySelector('.playControl');
                if (playBtn) playBtn.click();
                else {
                    const v = document.querySelector('video, audio');
                    if (v) v.paused ? v.play() : v.pause();
                }
            })();
            "#
            .to_string()
        }
        "next" => {
            r#"
            (function() {
                const youtubePlayer = document.getElementById('movie_player');
                if (youtubePlayer && typeof youtubePlayer.nextVideo === 'function') {
                    youtubePlayer.nextVideo();
                    return;
                }
                const btn = document.querySelector('.next-button') || document.querySelector('.skipControl__next') || document.querySelector('button.ytp-next-button');
                if (btn) btn.click();
            })();
            "#
            .to_string()
        }
        "prev" => {
            r#"
            (function() {
                const youtubePlayer = document.getElementById('movie_player');
                if (youtubePlayer && typeof youtubePlayer.previousVideo === 'function') {
                    youtubePlayer.previousVideo();
                    return;
                }
                const btn = document.querySelector('.previous-button') || document.querySelector('.skipControl__previous') || document.querySelector('button.ytp-prev-button');
                if (btn) btn.click();
            })();
            "#
            .to_string()
        }
        "shuffle" => {
            r#"
            (function() {
                const youtubePlayer = document.getElementById('movie_player');
                if (youtubePlayer && typeof youtubePlayer.setShuffle === 'function') {
                    const isActive = typeof youtubePlayer.getShuffle === 'function' && youtubePlayer.getShuffle();
                    youtubePlayer.setShuffle(!isActive);
                    return;
                }
                const btn = document.querySelector('ytmusic-player-bar #shuffle') || document.querySelector('ytmusic-player-bar .shuffle') || document.querySelector('#shuffle') || document.querySelector('[data-action="shuffle"]') || document.querySelector('.shuffleControl') || document.querySelector('button.ytp-shuffle-button');
                if (btn) btn.click();
            })();
            "#
            .to_string()
        }
        "loop" => {
            r#"
            (function() {
                const youtubePlayer = document.getElementById('movie_player');
                if (youtubePlayer && typeof youtubePlayer.setLoop === 'function') {
                    const isActive = typeof youtubePlayer.getLoop === 'function' && youtubePlayer.getLoop();
                    youtubePlayer.setLoop(!isActive);
                    return;
                }
                const btn = document.querySelector('ytmusic-player-bar #repeat') || document.querySelector('ytmusic-player-bar .repeat') || document.querySelector('#repeat') || document.querySelector('.repeatControl') || document.querySelector('button.ytp-repeat-button');
                if (btn) btn.click();
            })();
            "#
            .to_string()
        }
        "volume" => {
            let v = value.unwrap_or(1.0);
            let vol_int = (v * 100.0).round() as i32;
            format!(
                r#"
                (function() {{
                    const v = document.querySelector('video, audio');
                    if (v) {{
                        v.volume = {};
                        v.muted = {};
                    }}
                    const slider = document.querySelector('ytmusic-player-bar tp-yt-paper-slider#volume-slider') || document.querySelector('#volume-slider');
                    if (slider) {{
                        if (typeof slider.set === 'function') slider.set('value', {});
                        else slider.value = {};
                        slider.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        slider.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    }}
                    // YouTube's watch-page player owns its own volume state.
                    // Updating it through this API keeps the visible YouTube
                    // slider and the media element in sync.
                    const youtubePlayer = document.getElementById('movie_player');
                    if (location.hostname.endsWith('youtube.com') &&
                        !location.hostname.includes('music.youtube.com') &&
                        youtubePlayer && typeof youtubePlayer.setVolume === 'function') {{
                        if ({}) {{
                            youtubePlayer.setVolume(0);
                            youtubePlayer.mute();
                        }}
                        else {{
                            youtubePlayer.unMute();
                            youtubePlayer.setVolume({});
                        }}
                    }}
                }})();
                "#,
                v,
                if vol_int == 0 { "true" } else { "false" },
                vol_int,
                vol_int,
                if vol_int == 0 { "true" } else { "false" },
                vol_int,
            )
        }
        "seek" => {
            let s = value.unwrap_or(0.0);
            format!(
                r#"
                (function() {{
                    const moviePlayer = document.getElementById('movie_player');
                    if (moviePlayer && typeof moviePlayer.seekTo === 'function') {{
                        moviePlayer.seekTo({}, true);
                    }} else {{
                    const v = document.querySelector('video, audio');
                        if (v && v.duration) v.currentTime = {};
                    }}
                }})();
                "#,
                s, s
            )
        }
        _ => return Err(format!("Unknown action: {}", action)),
    };

    webview
        .eval(&script)
        .map_err(|e| format!("Failed to evaluate script: {:?}", e))?;

    Ok(())
}

#[tauri::command]
fn switch_platform(
    app: AppHandle,
    platform: String,
    local_audio: State<'_, LocalAudioState>,
) -> Result<(), String> {
    if platform != "local" {
        local_audio.is_active.store(false, Ordering::SeqCst);
        let _ = local_audio.sender.send(LocalAudioCommand::Stop);
    }

    if platform == "local" {
        if let Some(webview) = app.get_webview("yt-player") {
            let _ = webview.eval("document.querySelectorAll('video,audio').forEach(media => media.pause());");
        }
        return Ok(());
    }

    let webview = app
        .get_webview("yt-player")
        .ok_or_else(|| "Player webview not found".to_string())?;

    let url = match platform.as_str() {
        "youtube-music" => "https://music.youtube.com",
        "youtube" => "https://www.youtube.com",
        "soundcloud" => "https://soundcloud.com",
        _ => return Err("Invalid platform".to_string()),
    };

    emit_player_load_state(&app, "loading");
    set_expected_platform(&app, &platform);
    // Navigate through WebView2 itself instead of assigning location through
    // JavaScript. Native navigation clears the outgoing document/compositor
    // surface before loading the destination, avoiding a flash of the old site.
    let target_url = url
        .parse::<tauri::Url>()
        .map_err(|error| format!("Invalid player URL: {error}"))?;
    if let Err(error) = webview.navigate(target_url) {
        emit_player_load_state(&app, "failed");
        return Err(format!("{:?}", error));
    }

    Ok(())
}

#[tauri::command]
fn toggle_expand_view(
    app: AppHandle,
    window: tauri::Window,
    is_expanded: bool,
    show_player: Option<bool>,
    restore_state: State<'_, WindowRestoreState>,
) -> Result<(), String> {
    let main_win = window;

    let scale_factor = main_win.scale_factor().unwrap_or(1.0);

    if is_expanded {
        let geometry = WindowGeometry {
            position: main_win
                .outer_position()
                .map_err(|e| format!("Failed to read window position: {e}"))?,
            size: main_win
                .outer_size()
                .map_err(|e| format!("Failed to read window size: {e}"))?,
        };
        let mut saved = restore_state
            .0
            .lock()
            .map_err(|_| "Window restore state lock poisoned".to_string())?;
        if saved.is_none() {
            *saved = Some(geometry);
        }
        drop(saved);
        // Phóng to cửa sổ chính lên 950x700 Logical
        let target_size = tauri::LogicalSize::new(950.0, 700.0);
        main_win
            .set_size(target_size)
            .map_err(|e| format!("Failed to expand window: {e}"))?;
        main_win
            .center()
            .map_err(|e| format!("Failed to center expanded window: {e}"))?;

        let webview = app
            .get_webview("yt-player")
            .ok_or_else(|| "Player webview not found".to_string())?;

        if !show_player.unwrap_or(true) {
            webview
                .set_position(PhysicalPosition::new(
                    (949.0 * scale_factor).round() as i32,
                    (699.0 * scale_factor).round() as i32,
                ))
                .map_err(|e| format!("Failed to park player: {e}"))?;
            webview
                .set_size(PhysicalSize::new(1, 1))
                .map_err(|e| format!("Failed to resize parked player: {e}"))?;
            return Ok(());
        }

        // Đặt webview chiếm khu vực bên dưới thanh điều khiển
        // logical x=10, y=130, width=930, height=560
        let phys_pos = PhysicalPosition::new(
            (10.0 * scale_factor).round() as i32,
            (130.0 * scale_factor).round() as i32,
        );
        let phys_size = PhysicalSize::new(
            (930.0 * scale_factor).round() as u32,
            (560.0 * scale_factor).round() as u32,
        );

        webview
            .set_position(phys_pos)
            .map_err(|e| format!("Failed to position player: {e}"))?;
        webview
            .set_size(phys_size)
            .map_err(|e| format!("Failed to size player: {e}"))?;
        webview
            .show()
            .map_err(|e| format!("Failed to show player: {e}"))?;
        webview
            .set_focus()
            .map_err(|e| format!("Failed to focus player: {e}"))?;
        let _ = webview.eval("if (window.__setExpandedMode) window.__setExpandedMode(true);");
    } else {
        // Thu nhỏ cửa sổ chính về 420x130 Logical
        let saved_geometry = restore_state
            .0
            .lock()
            .map_err(|_| "Window restore state lock poisoned".to_string())?
            .clone();

        if let Some(geometry) = saved_geometry {
            main_win
                .set_size(geometry.size)
                .map_err(|e| format!("Failed to restore window size: {e}"))?;
            main_win
                .set_position(geometry.position)
                .map_err(|e| format!("Failed to restore window position: {e}"))?;
            *restore_state
                .0
                .lock()
                .map_err(|_| "Window restore state lock poisoned".to_string())? = None;
        } else {
            main_win
                .set_size(tauri::LogicalSize::new(420.0, 130.0))
                .map_err(|e| format!("Failed to shrink window: {e}"))?;
        }

        let webview = app
            .get_webview("yt-player")
            .ok_or_else(|| "Player webview not found".to_string())?;

        let _ = webview.eval("if (window.__setExpandedMode) window.__setExpandedMode(false);");

        // Park webview về 1x1 ở góc ngoài tầm nhìn
        let phys_pos = PhysicalPosition::new(
            (419.0 * scale_factor).round() as i32,
            (129.0 * scale_factor).round() as i32,
        );
        let phys_size = PhysicalSize::new(1, 1);

        webview
            .set_position(phys_pos)
            .map_err(|e| format!("Failed to park player: {e}"))?;
        webview
            .set_size(phys_size)
            .map_err(|e| format!("Failed to resize parked player: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
fn resize_yt_view(
    app: AppHandle,
    window: tauri::Window,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let main_win = window;
    let webview = app
        .get_webview("yt-player")
        .ok_or_else(|| "Player webview not found".to_string())?;

    let scale_factor = main_win.scale_factor().unwrap_or(1.0);
    let phys_pos = PhysicalPosition::new(
        (x * scale_factor).round() as i32,
        (y * scale_factor).round() as i32,
    );
    let phys_size = PhysicalSize::new(
        (width * scale_factor).round() as u32,
        (height * scale_factor).round() as u32,
    );

    let _ = webview.set_position(phys_pos);
    let _ = webview.set_size(phys_size);
    Ok(())
}

#[tauri::command]
fn park_player_webview(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    let webview = app
        .get_webview("yt-player")
        .ok_or_else(|| "Player webview not found".to_string())?;
    let size = window
        .inner_size()
        .map_err(|error| format!("Failed to read window size: {error}"))?;

    webview
        .hide()
        .map_err(|error| format!("Failed to hide player: {error}"))?;
    webview
        .set_position(PhysicalPosition::new(size.width as i32, size.height as i32))
        .map_err(|error| format!("Failed to park player: {error}"))?;
    webview
        .set_size(PhysicalSize::new(1, 1))
        .map_err(|error| format!("Failed to resize parked player: {error}"))?;
    Ok(())
}

#[tauri::command]
fn resize_modal(
    window: tauri::Window,
    is_open: bool,
    height: Option<u32>,
    restore_state: State<'_, WindowRestoreState>,
) -> Result<(), String> {
    let main_win = window;

    if is_open {
        let h = height.unwrap_or(200);
        let geometry = WindowGeometry {
            position: main_win
                .outer_position()
                .map_err(|e| format!("Failed to read window position: {e}"))?,
            size: main_win
                .outer_size()
                .map_err(|e| format!("Failed to read window size: {e}"))?,
        };
        let mut saved = restore_state
            .0
            .lock()
            .map_err(|_| "Window restore state lock poisoned".to_string())?;
        if saved.is_none() {
            *saved = Some(geometry);
        }
        drop(saved);
        main_win
            .set_size(tauri::LogicalSize::new(420.0, h as f64))
            .map_err(|e| format!("Failed to resize settings window: {e}"))?;
        main_win
            .center()
            .map_err(|e| format!("Failed to center settings window: {e}"))?;
    } else {
        let saved_geometry = restore_state
            .0
            .lock()
            .map_err(|_| "Window restore state lock poisoned".to_string())?
            .clone();
        if let Some(geometry) = saved_geometry {
            main_win
                .set_size(geometry.size)
                .map_err(|e| format!("Failed to restore settings window size: {e}"))?;
            main_win
                .set_position(geometry.position)
                .map_err(|e| format!("Failed to restore settings window position: {e}"))?;
            *restore_state
                .0
                .lock()
                .map_err(|_| "Window restore state lock poisoned".to_string())? = None;
        } else {
            main_win
                .set_size(tauri::LogicalSize::new(420.0, 130.0))
                .map_err(|e| format!("Failed to shrink settings window: {e}"))?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(WindowRestoreState::default())
        .manage(PlayerNavigationState::default())
        .manage(LocalAudioState::new())
        .invoke_handler(tauri::generate_handler![
            close_app,
            set_always_on_top,
            init_player_webview,
            get_local_music_library,
            load_saved_local_music_folder,
            pick_local_music_folder,
            play_local_folder,
            control_player,
            switch_platform,
            toggle_expand_view,
            resize_yt_view,
            park_player_webview,
            resize_modal
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
