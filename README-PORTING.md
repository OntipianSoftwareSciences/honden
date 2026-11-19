# HonDen porting

## CachyOS / Linux

```bash
sudo pacman -S rust nodejs npm webkit2gtk libappindicator-gtk3
npm install
npm run tauri build
```

Output: `src-tauri/target/release/bundle/appimage/`

## Android / PWA

Open the HonDen link in Chrome on the Galaxy S21, then choose **Add to Home Screen** or **Install app**. No APK is built in this step.
