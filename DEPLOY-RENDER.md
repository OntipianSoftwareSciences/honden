# Deploy HonDen to Render Free

## Step 1: Put HonDen on GitHub

Open a terminal in the HonDen folder and run:

```bash
git init
git add .
git commit -m "HonDen 0.1.0"
```

Go to github.com, sign in, and create a new repository named `HonDen`. Copy the repository link. Then run:

```bash
git remote add origin THE_LINK_YOU_COPIED
git push -u origin main
```

If your branch is called `master`, use `git push -u origin master` instead.

## Step 2: Create the Render Web Service

Go to render.com and sign up free. Click **New > Web Service**. Choose **Connect GitHub repo** and pick the `HonDen` repository.

## Step 3: Build and start settings

Use these exact settings:

- Build Command: `npm install && npm run build`
- Start Command: `node server/index.js`
- Plan: **Free**

Click **Create Web Service**.

## Step 4: Copy your permanent link

Wait for the build to finish. Render will give you a link like:

`https://honden-xyz.onrender.com`

Copy that link. That is your HonDen address.

## Step 5: Test it

Open that link on your phone, on a friend's phone, and anywhere else. Create `@sukar3tto`, send a message, and check that it shows up on your PC.

## Honest note

Render Free sleeps after 15 minutes idle. The first load after sleep takes about 30 seconds to wake up. That is normal on free. A $7/month plan stays awake.
