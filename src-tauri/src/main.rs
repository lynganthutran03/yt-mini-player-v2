// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Chromium arguments:
    // Do NOT strictly cap V8 heap (--max-old-space-size=128) because YouTube Music's
    // SPA bundle alone needs ~200-300MB of JS heap to compile and run. Capping it
    // causes V8 to throw "Out of Memory" (OOM) and crash the tab.
    let existing_args = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
    let memory_args = "--disable-background-networking \
                       --disable-component-update \
                       --disable-features=Translate,OptimizationHints,MediaRouter \
                       --autoplay-policy=no-user-gesture-required";

    let combined_args = if existing_args.is_empty() {
        memory_args.to_string()
    } else {
        format!("{existing_args} {memory_args}")
    };

    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", combined_args);

    yt_mini_player_v2_lib::run()
}

