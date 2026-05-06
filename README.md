# 🎙️ Home Walkie-Talkie

A simple, sleek, and kid-friendly WebRTC voice chat app designed to be used as a digital walkie-talkie on a home network. 

Built with **Node.js**, **Socket.IO**, and **Vanilla JS/CSS**, it provides a zero-configuration, self-hosted voice chat room experience.

## ✨ Features

- **Kid-Friendly Design:** Vibrant colors, bouncy animations, and large buttons designed for tablets and mobile devices.
- **Random Avatars:** Users are automatically assigned a fun animal avatar (🦄, 🐼, 🦊) and color when joining a room.
- **Audio Visualizer:** Card highlights dynamically when a user is speaking.
- **Mesh WebRTC Network:** Low latency, peer-to-peer audio communication between all users in a room.
- **Self-Hosted First:** Designed specifically for home servers and internal local networks.

## 🚀 Deployment (Docker / Portainer)

This project is fully containerized and ready to be deployed to Portainer via the included `docker-compose.yml`.

1. In Portainer, create a new Stack and point it to this GitHub repository.
2. The default configuration exposes the app on port `3005`. 
3. Deploy the stack.

### 🔒 Important: Microphone Permissions & HTTPS
Modern web browsers require a secure context (`HTTPS`) to allow access to a device's microphone (unless you are testing on `localhost`). 

To use this app across different devices on your network, you should place it behind a reverse proxy like **Nginx Proxy Manager**.
- Point the proxy to the container's IP and port (e.g., `3005`).
- Ensure **Websockets Support** is turned **ON** in the proxy settings (Socket.IO requires this).
- Enable **Force SSL** to serve the app over HTTPS.

## 💻 Local Development

If you want to run the app locally without Docker:

1. Clone the repository:
   ```bash
   git clone https://github.com/mrskaggs/home-walkie-talkie.git
   cd home-walkie-talkie
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the server:
   ```bash
   npm start
   ```
   *(Note: You may need to add `"start": "node server.js"` to your `package.json` scripts, or simply run `node server.js` directly).*
4. Navigate to `http://localhost:3000` in your browser.

## 🛠️ Tech Stack
- **Backend:** Node.js, Express, Socket.IO
- **Frontend:** Vanilla HTML, CSS, JavaScript
- **Voice Routing:** WebRTC (`RTCPeerConnection`)
