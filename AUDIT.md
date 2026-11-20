HonDen Audit — 2026-11-19

No code was changed. Brand colors are untouched: Heart Pink #FF6B9D, Warm Cream #FFF7F2.

What is here
- Frontend: React + TypeScript + Vite in src/. The live chat UI is src/App.tsx. Other screens and pieces are in src/screens/ and src/components/. Encryption code is in src/crypto/e2ee.ts and call code in src/webrtc/callManager.ts.
- Backend: Express plus WebSocket in server/index.ts. The build copies it to server/index.js (package.json:9), and Render starts that file (render.yaml:7). A second Fastify API under server/routes/ is not the one Render runs.
- Database: Postgres on Render when DATABASE_URL is set (server/index.ts:224-262). Users, messages, and public keys live there. Without DATABASE_URL the server falls back to JSON files on disk (server/index.ts:273-276).
- What works now: sign up, log in, password reset, public key upload, sending and reading encrypted text messages, thread history from Postgres, WebSocket message fan-out, WebRTC call signaling, local thread list, settings, invite links, profile modal, APK link, and health route.

Bugs, in order

1. Call screen says Alex for everyone. src/components/CallScreens.tsx:49, 52, 101, 153. The call snapshot has no contact name (src/webrtc/callManager.ts:11-23), and App.tsx:738-740 starts a call without passing one. Related hardcoded text: aria-label "Call Alex" at src/App.tsx:916, fake contact at src/App.tsx:77, and "You have a message from Alex" at src/screens/Settings.tsx:253.

2. Chat header says "Only you and Alex can read this." at src/App.tsx:905, for every thread. src/screens/Chat.tsx:71 and 147 use a name prop, but that component is not imported by the app.

3. Error says "@thatname" literally. src/screens/Onboarding.tsx:16 is a fixed fallback, and server/index.ts:39 defines the same fixed text; it is returned by login at server/index.ts:425 and by user lookup at server/index.ts:494 and 499. The built server copy has it at server/index.js:19.

4. @mom's messages show "This message couldn't be read on this device." Any decrypt failure becomes that text at src/App.tsx:83 and 123-131. The public key is fetched by username at src/App.tsx:103 and uploaded at 202-217; the private key is stored or reused per username at 177-200; the server serves keys at server/index.ts:502-506. There is no key version check, so a changed, missing, or wrongly uploaded key makes older messages unreadable forever.

5. Add @mom works on one device but not another. The browser API base follows the current page origin at src/api/client.ts:67-74, so a laptop opened from a different origin calls a different server. Lookup failures are swallowed at src/App.tsx:150-159, adding fails silently at 702-718, and the shown error is generic at src/screens/AddUser.tsx:15-26. Username rules also differ between src/store/messages.ts:46-48, src/screens/Onboarding.tsx:25-27, and server/index.ts:68-72.

6. Profile defaults to "You" and does not save to Postgres. src/App.tsx:223, 675, 817 set "You"; the modal starts from that value at src/components/Modals.tsx:49. Saving needs a token at src/App.tsx:777-793, but login issues none at server/index.ts:415-429. The deployed users table has no display name, bio, or avatar color columns at server/index.ts:233-243, and there is no profile route there. The working Fastify profile route at server/routes/auth.ts:97-130 is not used.

7. Offline banner can appear even when /api/messages works. src/App.tsx:400-413 treats the browser offline event as proof, with the 3-second timer at 339-353; real API failure is handled at 428-453 and the banner is at 1175-1179. The health check at 415-421 does not set the banner. The Message input stays enabled.

8. Raw ciphertext can be shown in the unused chat screen. src/screens/Chat.tsx:110-113 prints the iv and ciphertext behind a "Ciphertext" toggle.
