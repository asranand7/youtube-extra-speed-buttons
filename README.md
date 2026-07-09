# YouTube Extra Speed Buttons

Adds **1.75x, 2.25x, 2.5x and 2.75x** preset buttons to YouTube's playback
speed menu, alongside the native 1.0 / 1.25 / 1.5 / 2.0 / 3.0 chips.

## Install (unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select this folder (`yt-speed-buttons`).
4. Open (or reload) any YouTube video, click the gear → **Playback speed**,
   and the extra presets appear in the row of speed buttons.

## How it works

A content script watches for YouTube's playback-speed panel and clones the
native speed buttons to create the extra presets, so they pick up YouTube's
own styling automatically. Clicking one sets the video's playback rate
directly (`video.playbackRate`), which supports any value — including ones
YouTube doesn't offer natively. Both the new "chips" panel and the classic
list-style speed submenu are supported.

## Tweaking the speeds

Edit the `EXTRA_SPEEDS` array at the top of `content.js`, then hit the
refresh icon on the extension card in `chrome://extensions` and reload the
YouTube tab.
