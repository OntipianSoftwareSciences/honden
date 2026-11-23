# HonDen wrap-up — 2026-11-23

This is a status note for the handoff. No app code, branding, encryption, DM, push, video-quality, or APK behavior was changed for this wrap-up.

## Live check on https://honden.onrender.com

| Area | Result | Evidence |
| --- | --- | --- |
| Sign-up a new test account | Pass | New accounts created and recovery saved. |
| Log in | Pass | Fresh context logged in with the new account. |
| DM a new message | Pass | Recipient read the new encrypted DM live; no “couldn’t be read” message. |
| #honey-den global chat | Pass | New global message appeared for the second account. |
| Voice-only call 30s | Pass | Connecting -> Connected, stayed Connected 30s, audio both ways, ended only on manual hangup. |
| Video call 30s | Pass | Connecting -> Connected, stayed Connected 30s, video and audio both ways. |
| Push notification on Pop!_OS desktop | Not verified here | The automated browser denied Push subscription permission. No push code was changed. |
| Settings > Call notifications toggle | Not verified here | Same browser Push permission limitation. No push code was changed. |
| Layout and themes | Pass | No horizontal overflow at 360 / 768 / 1280 px; Dark and Ultra Dark applied. |

Call lifecycle logs include `callId` and date. The three reviewed signaling logs are `Call offer received`, `Call answer sent`, and `ICE candidate received`. No message content is logged.

## Still open

- The exact live self-call between `@sukar3tto` and `@sukar3ttodev` was not retested here. Do not claim that pair is confirmed fixed.
- Video quality is still low (480x360 / 640x480). Do not fix tonight.
- The Android APK workflow still targets SDK 37 and is not part of this wrap-up. Use the Render web app + PWA.
- Old DMs that already showed “This message couldn’t be read on this device” remain unrecoverable.

## Tomorrow

- Improve video quality.
- Change Android APK targetSdk 37 -> 34/35 and rebuild the APK.
- Back up the HonDen Postgres DB before it expires on 2026-12-19.
- Do a live call test with `@skypuppy` when she is online.
