// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Aggressive Chromium memory tuning:
    // - Limit V8 JavaScript heap size to 128MB
    // - Disable GPU rasterization & frame buffering caches for invisible webview
    // - Enable aggressive memory trimming and single-process network service
    let existing_args = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
    let memory_args = "--js-flags=\"--max-old-space-size=128 --optimize-for-size --expose-gc\" \
                       --disable-background-networking \
                       --disable-component-update \
                       --disable-features=Translate,OptimizationHints,MediaRouter,AudioServiceOutOfProcess \
                       --enable-features=NetworkServiceInProcess \
                       --disable-gpu-memory-buffer-video-frames \
                       --disable-gpu-compositing \
                       --in-process-gpu \
                       --disk-cache-size=10485760 \
                       --media-cache-size=10485760 \
                       --autoplay-policy=no-user-gesture-required";

    let combined_args = if existing_args.is_empty() {
        memory_args.to_string()
    } else {
        format!("{existing_args} {memory_args}")
    };

    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", combined_args);

    yt_mini_player_v2_lib::run()
}

