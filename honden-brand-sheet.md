# HonDen — Brand Sheet
## A sweet, safe den to talk in

**Name:** HonDen — Swedish *honung* (honey) + *den*. Short for Honungsden / Honungslya (honey den).
**Version:** 1.0 — 2026-11-18, renamed from HeartMessage
**For:** OpenCode, Gemini / Antigravity, and anyone building HonDen
**Use this file as the single source of truth for brand, colors, words, and feel. Do not invent a different palette or tone.**

---

## 1. The idea in one sentence

> HonDen is a secure messaging app where the design itself reminds people that HonDen cares about its customers.

Care is not a slogan on a marketing page. It is:
- privacy you can understand,
- control you actually have,
- language that sounds human,
- and a warm, calm interface that never pressures you.

---

## 2. Mission and values

**Mission:** Messaging should feel safe. Your words stay yours.

**Values — show these in the product, not just in words:**
1. **Privacy first:** end-to-end encrypted, no ads, no tracking, no selling data.
2. **Control:** delete for everyone, turn off read receipts, leave anytime, export your chats.
3. **Kindness by default:** gentle notifications, no red-badge panic, no read-receipt pressure.
4. **Clarity:** plain language. If a 12-year-old cannot understand a privacy sentence, rewrite it.
5. **Accessibility is care:** large text, high contrast, screen-reader friendly.

**What we never do:**
- No ads, ever.
- No selling or sharing message data.
- No dark patterns (no fake urgency, no hiding delete, no guilt-trip copy).
- No jargon on user-facing screens.

---

## 3. Colors — exact hex codes

Use these exact values. Do not substitute close colors.

### Primary palette
| Name | Hex | Use |
|---|---|---|
| Heart Pink | `#FF6B9D` | Primary buttons, heart mark, links, active states |
| Deep Rose | `#D94F7A` | Button hover / pressed, important accents |
| Warm Cream | `#FFF7F2` | Main app background, light mode |
| Soft Blush | `#FFE9F0` | Cards, message bubbles (own), gentle highlights |
| Warm Charcoal | `#2B2330` | Main text, headings |
| Soft Grey | `#6B6470` | Secondary text, timestamps, hints |

### Supporting
| Name | Hex | Use |
|---|---|---|
| Leaf Green | `#2FA37C` | Success, "encrypted" check, online dot |
| Warm Amber | `#F2A93B` | Warning only, sparingly |
| Soft Red | `#E5484D` | Delete / destructive only, sparingly |
| White | `#FFFFFF` | Cards on cream, message bubbles (other person) |
| Border | `#F0DDE6` | Dividers, card borders, input borders |

### Dark mode (optional, same feeling)
| Name | Hex | Use |
|---|---|---|
| Deep Plum | `#1E1620` | Main background |
| Plum Card | `#2A212E` | Cards, bubbles |
| Heart Pink | `#FF6B9D` | Same primary, keep it |
| Warm Cream Text | `#FFF7F2` | Main text |

**Rules:**
- Background is always warm, never pure black / cold blue-grey.
- Pink is for care and action, never for warnings.
- Contrast: Warm Charcoal on Warm Cream must pass WCAG AA. Large text option must increase all text by at least 20%.

---

## 4. Typography

- **Headings:** Rounded, friendly sans-serif. System default is fine to start: Segoe UI / Inter / system-ui. Weight 700, tight spacing.
- **Body:** Same family, weight 400, line height 1.5, minimum 16px.
- **Timestamps / hints:** 13px, Soft Grey, weight 400.
- **Never:** all-caps for whole sentences, tiny 11px body text, or a second decorative font for body copy.

---

## 5. Logo idea

**Name:** HonDen
**Mark:** A small, rounded heart, slightly tilted, with a soft speech-bubble tail — a heart that is also a message.

- **Do:** Keep the heart small and quiet. Use it on onboarding, the empty-chat screen, and in Settings. One heart, one pink (`#FF6B9D`), on cream.
- **Do not:** Put a big logo on every screen, animate it constantly, or use a realistic / anatomical heart.
- **Wordmark:** "HonDen" — one word, capital H and D, in Warm Charcoal, with the heart mark to the left. No tagline locked to the logo.
- **Favicon / app icon:** Heart mark on a Soft Blush (`#FFE9F0`) rounded square, no text.

**Lionheart credit:** The company name appears in words, not as a second logo:
> Made with care by HonDen

---

## 6. Voice — how HonDen talks

- Warm, calm, direct. Like a kind friend, not a company.
- Short sentences. Plain words. No jargon.
- Never guilt-trip, never pressure, never fake urgency.
- Use "you" and "we". Example: "We can't see your messages." Not: "User data is inaccessible to the service provider."

**Replace jargon like this:**
| Don't say | Say instead |
|---|---|
| End-to-end encryption (E2EE) protocol initialized | Only you and the person you're talking to can read this. |
| Your session has expired | You've been signed out. Sign in again to continue. |
| Failed to deliver message | This message didn't send. Tap to try again. |
| Read receipts enabled | They'll see when you've read a message. You can turn this off. |
| Data retention policy | We don't keep your messages on our servers after they're delivered. |

---

## 7. Exact copy — use these words

### Onboarding — Screen 1 (Welcome)
**Heading:** Welcome to HonDen
**Body:**
> HonDen is made with care. We built this because messaging should feel safe — your words stay yours, we don't sell them, we don't read them, and we don't show you ads.

**Button:** Get started
**Small print:** No ads. No tracking. No selling your data.

### Onboarding — Screen 2 (Privacy, in plain words)
**Heading:** Your messages are private
**Body — use as a list:**
- Only you and the person you're talking to can read your messages.
- We can't see them, even if we wanted to.
- No ads, no tracking, no selling your data.
- You can delete a message for everyone, anytime.

**Button:** I understand

### Onboarding — Screen 3 (Your choice)
**Heading:** You're in control
**Body:**
> Turn read receipts on or off. Choose gentle notifications. Leave a chat anytime. It's your conversation.

**Button:** Start messaging

### Empty chat list
**Heading:** No conversations yet
**Body:** Start a conversation with someone you care about.
**Button:** New message

### Empty open chat
**Body:** No messages yet. Say hello — they'll be glad to hear from you.
**Hint under the input:** Only you and Alex can read this.

### New message / first message hint
> This is the start of your conversation. Be kind — it matters.

### Settings — Privacy section
**Heading:** Privacy
**Lines:**
- Messages are encrypted end-to-end.
- Read receipts: [Off by default] — "They'll see when you've read a message. You can turn this on."
- Delete for everyone: "You can delete a message for everyone, anytime."
- Export your chats: "Download a copy of your chats anytime."

### Settings — Footer (every Settings screen)
> Made with care by HonDen
>
> Questions? We actually read our messages. [Contact us]

### Notifications
- **Normal:** "You have a message from Alex"
- **Never:** "URGENT! 3 UNREAD MESSAGES!" / "Alex is waiting!!" / any red panic badge copy.

### Errors — kind, not technical
- **Message didn't send:** "This message didn't send. Tap to try again."
- **No connection:** "You're offline right now. Your message will send when you're back."
- **Something went wrong:** "Something went wrong on our side. Nothing was sent. Try again in a moment."

### Delete confirmation
**Heading:** Delete this message?
**Body:** This will delete it for everyone in this chat. This can't be undone.
**Buttons:** [Delete for everyone] [Keep it] — Delete is Soft Red (`#E5484D`), Keep is the primary button.

---

## 8. Care features — build these in

These are not nice-to-haves. They are how the brand is proven.

1. **Delete for everyone** — always available, clearly labeled, no time limit trick.
2. **Read receipts OFF by default** — user opts in, never opts out.
3. **Gentle notifications** — no urgency language, no stacking panic badges.
4. **Large text option** — in Settings > Accessibility, increases all text by 20%+.
5. **High contrast option** — in Settings > Accessibility.
6. **Export your chats** — one tap, in Settings > Privacy.
7. **No ads, no tracking** — stated on onboarding and in Settings, and true in code. No analytics SDK that tracks message content.
8. **Block / leave, kindly** — "Leave chat" and "Block" are easy to find, with confirmation copy that does not shame the other person.

---

## 9. Layout and feel

- **Corners:** 16px radius on cards and bubbles, 12px on buttons, 24px on the main chat container. Nothing sharp.
- **Spacing:** Generous. 16px minimum padding, 24px between sections.
- **Shadows:** Soft and low — `0 2px 12px rgba(43, 35, 48, 0.06)`. No harsh drop shadows.
- **Message bubbles:**
  - Own messages: Soft Blush (`#FFE9F0`), Warm Charcoal text, right-aligned.
  - Other person's: White (`#FFFFFF`), Warm Charcoal text, left-aligned, with a soft border (`#F0DDE6`).
- **Primary button:** Heart Pink (`#FF6B9D`), white text, 16px radius, full width on mobile.
- **Input:** White, 16px radius, Border (`#F0DDE6`), placeholder in Soft Grey.
- **Empty states:** Always have a heart mark, a kind heading, and one clear next step. Never a blank screen.

---

## 10. What good looks like — checklist for OpenCode / Gemini

Before calling a screen done, check:
- [ ] Does it use only the colors in Section 3?
- [ ] Does it use the exact copy in Section 7, where that screen exists?
- [ ] Is there any jargon a 12-year-old would not understand? If yes, rewrite it.
- [ ] Is "Made with care by HonDen" in Settings?
- [ ] Is there a delete / leave / turn-off option where the user would expect control?
- [ ] Is the notification copy gentle?
- [ ] Does large-text mode still look right?
- [ ] Is there an ad, tracker, or dark pattern anywhere? If yes, remove it.

**If unsure, ask 1 question instead of guessing. Do not invent a new brand, palette, or tone.**

---

## 11. Copy-paste prompt for OpenCode / Gemini

Use this when you start building with this sheet:

```
Use the brand sheet at heartmessage/brand-sheet.md as the single source of truth.

Build HonDen (Vite, React, TypeScript, Tauri v2) so its design reminds people that HonDen cares about its customers.

Use only the exact colors in Section 3, the exact copy in Section 7, and the care features in Section 8.

Start with: the color palette as CSS variables, the onboarding screens, and the empty-chat screen.
Show me the files you create, and ask 1 question if anything is unclear.
Do not invent a different palette, logo, or tone.
```
