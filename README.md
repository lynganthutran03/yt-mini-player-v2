# Mini Music Player

Mini Music Player is an always-on-top desktop app that provides quick music controls for YouTube Music, YouTube, and SoundCloud.

Built with Tauri 2, React, TypeScript, and Vite, the app embeds the selected platform in a child webview. You continue to use your own account, library, and content on that service.

## Features

- A borderless, transparent mini window that can be dragged, resized, and optionally kept always on top.
- Displays artwork, track title, artist/album, playback state, and progress.
- Play/pause, previous/next, seek, volume, and mute controls.
- Quickly switch between YouTube Music, YouTube, and SoundCloud.
- Expand the window to interact directly with the platform's webpage.
- Four visual themes, an accent-color picker, and an optional spinning-vinyl effect. Accent color and vinyl preferences are stored locally.
- Snaps the window to screen edges when dragged nearby.

## Prerequisites

- A recent version of [Bun](https://bun.sh/).
- Rust stable and the native build tools required by Tauri.
- On Windows: Microsoft Edge WebView2 Runtime, which is usually already installed on Windows 10/11.

See the official [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for detailed setup instructions.

## Install and run

```bash
bun install
bunx tauri dev
```

This starts Vite and launches the Tauri app in development mode.

To run only the web UI in a browser:

```bash
bun run dev
```

Browser mode is intended for UI development only. Native APIs, the embedded webview, and platform controls require `bunx tauri dev`.

## Build a release

```bash
bunx tauri build
```

Tauri writes the built application and installers to `src-tauri/target/release/bundle/`.

## Scripts

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the Vite development server. |
| `bun run build` | Type-check TypeScript and build the frontend into `dist/`. |
| `bun run preview` | Preview the built frontend. |
| `bunx tauri dev` | Run the desktop app in development mode. |
| `bunx tauri build` | Build a desktop release package. |

## Usage

1. Open the app and select a platform from the menu beside the volume control.
2. Select the expand button to reveal the platform's webpage, then sign in if needed.
3. Start playback as usual. The mini player synchronizes track information and the basic controls.
4. Use the three-dot menu to switch themes, change the accent color, or enable/disable the vinyl effect.

On regular YouTube, shuffle and repeat are available only when the current content belongs to a playlist or queue. Control support also depends on each platform's webpage structure and may change when the service updates its UI.

## Project structure

```text
src/                 React UI and stylesheets
src-tauri/           Rust code, Tauri configuration, and bundle assets
src-tauri/src/lib.rs Embedded webview control and native commands
public/              Static assets
```

## Note

The app does not download, store, or distribute content from these platforms. Use it in accordance with the terms of service and copyright requirements of YouTube, YouTube Music, and SoundCloud.
