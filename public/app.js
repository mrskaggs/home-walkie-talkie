const socket = io();

// DOM Elements
const views = {
    lobby: document.getElementById('lobby'),
    room: document.getElementById('room')
};
const roomList = document.getElementById('room-list');
const newRoomNameInput = document.getElementById('new-room-name');
const createRoomBtn = document.getElementById('create-room-btn');
const leaveRoomBtn = document.getElementById('leave-room-btn');
const currentRoomNameEl = document.getElementById('current-room-name');
const participantsGrid = document.getElementById('participants');

const pingBtn = document.getElementById('ping-btn');
const modeSelect = document.getElementById('mode-select');
const filterCheckbox = document.getElementById('filter-checkbox');
const pttBtn = document.getElementById('ptt-btn');
const muteBtn = document.getElementById('mute-btn');

const handsfreeControls = document.getElementById('handsfree-controls');
const pttControls = document.getElementById('ptt-controls');

// State
let currentRoom = null;
let originalLocalStream = null; // Raw microphone stream
let processedLocalStream = null; // Filtered/processed stream
let localStream = null;          // Active stream being sent
let isMuted = false;
let myUserData = null;
let isFilterEnabled = false;
let audioMode = 'hands-free'; // 'hands-free' or 'ptt'
let isPTTActive = false;

const peers = {}; // id -> RTCPeerConnection
const remoteAudios = {}; // id -> HTMLAudioElement

// Web Audio Context for Filters and SFX Synthesis
let audioContext = null;
let audioEffectsNode = null;

// Kid-friendly random avatars and colors
const avatars = ['🦊', '🐱', '🐼', '🐨', '🦁', '🐯', '🐰', '🐹', '🐻', '🐶', '🦄', '🐸'];
const colors = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#FF9F43', '#54A0FF', '#1DD1A1', '#5F27CD', '#FF9FF3'];

function generateUserData() {
    const avatar = avatars[Math.floor(Math.random() * avatars.length)];
    const color = colors[Math.floor(Math.random() * colors.length)];
    return { avatar, color, name: `Agent ${avatar}` };
}

// Web Audio Sound Synthesizer for Transceiver SFX
class TransceiverSFX {
    constructor() {
        this.synthCtx = null;
    }

    init() {
        if (!this.synthCtx) {
            this.synthCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    // Classic 1980s Roger Beep (over-and-out)
    playRogerBeep() {
        this.init();
        const now = this.synthCtx.currentTime;
        
        // Squelch white noise tail (hiss)
        const bufferSize = this.synthCtx.sampleRate * 0.15; // 150ms
        const buffer = this.synthCtx.createBuffer(1, bufferSize, this.synthCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noiseNode = this.synthCtx.createBufferSource();
        noiseNode.buffer = buffer;

        const noiseFilter = this.synthCtx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = 1000;
        noiseFilter.Q.value = 1.0;

        const noiseGain = this.synthCtx.createGain();
        noiseGain.gain.setValueAtTime(0.04, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        noiseNode.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.synthCtx.destination);
        noiseNode.start(now);

        // Roger Beep tones (Dual tone: 1000Hz and 1200Hz)
        const osc1 = this.synthCtx.createOscillator();
        const osc2 = this.synthCtx.createOscillator();
        const toneGain = this.synthCtx.createGain();

        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(1000, now + 0.08); // offset slightly after squelch start
        osc2.frequency.setValueAtTime(1200, now + 0.08);

        toneGain.gain.setValueAtTime(0.0, now);
        toneGain.gain.setValueAtTime(0.05, now + 0.08);
        toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

        osc1.connect(toneGain);
        osc2.connect(toneGain);
        toneGain.connect(this.synthCtx.destination);

        osc1.start(now + 0.08);
        osc2.start(now + 0.08);
        osc1.stop(now + 0.18);
        osc2.stop(now + 0.18);
    }

    // Transceiver "click-in" beep when starting transmission
    playClickIn() {
        this.init();
        const now = this.synthCtx.currentTime;
        const osc = this.synthCtx.createOscillator();
        const gain = this.synthCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.setValueAtTime(1000, now + 0.03);

        gain.gain.setValueAtTime(0.03, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

        osc.connect(gain);
        gain.connect(this.synthCtx.destination);
        osc.start(now);
        osc.stop(now + 0.06);
    }

    // Pleasant chime alert for call pings
    playCallChime() {
        this.init();
        const now = this.synthCtx.currentTime;
        const osc = this.synthCtx.createOscillator();
        const gain = this.synthCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.linearRampToValueAtTime(900, now + 0.1);
        osc.frequency.linearRampToValueAtTime(1200, now + 0.2);

        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc.connect(gain);
        gain.connect(this.synthCtx.destination);
        osc.start(now);
        osc.stop(now + 0.35);
    }
}

const sfx = new TransceiverSFX();

// Initialization
function init() {
    myUserData = generateUserData();
    
    // Set up event listeners
    createRoomBtn.addEventListener('click', () => {
        const name = newRoomNameInput.value.trim();
        if (name) {
            joinRoom(name);
        }
    });

    newRoomNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const name = newRoomNameInput.value.trim();
            if (name) {
                joinRoom(name);
            }
        }
    });

    leaveRoomBtn.addEventListener('click', leaveRoom);
    muteBtn.addEventListener('click', toggleMute);

    // Call Ping Button
    pingBtn.addEventListener('click', () => {
        if (currentRoom) {
            sfx.playCallChime();
            triggerLocalBellAnimation('me');
            socket.emit('call-ping', currentRoom);
        }
    });

    // PTT Mode Selector
    modeSelect.addEventListener('change', (e) => {
        audioMode = e.target.value;
        if (audioMode === 'ptt') {
            handsfreeControls.classList.remove('active');
            pttControls.classList.add('active');
            
            // Mute mic by default on PTT load
            setMicEnabled(false);
        } else {
            pttControls.classList.remove('active');
            handsfreeControls.classList.add('active');
            isPTTActive = false;
            pttBtn.classList.remove('transmitting');
            
            // Restore microphone to current handsfree state
            setMicEnabled(!isMuted);
        }
    });

    // Transceiver radio filter check
    filterCheckbox.addEventListener('change', (e) => {
        isFilterEnabled = e.target.checked;
        if (localStream) {
            updateAudioFilterRouting();
        }
    });

    // PTT Tactile Touch Listeners (Supports both mouse click and mobile touch)
    pttBtn.addEventListener('mousedown', startPTTTraining);
    pttBtn.addEventListener('mouseup', stopPTTTraining);
    pttBtn.addEventListener('mouseleave', stopPTTTraining);

    pttBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startPTTTraining();
    });
    pttBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        stopPTTTraining();
    });

    // Global keyboard listeners for Spacebar as PTT key
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && audioMode === 'ptt' && !isPTTActive && document.activeElement !== newRoomNameInput) {
            e.preventDefault();
            startPTTTraining();
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space' && audioMode === 'ptt' && isPTTActive) {
            e.preventDefault();
            stopPTTTraining();
        }
    });
}

// UI Navigation
function showView(viewId) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[viewId].classList.add('active');
}

// WebRTC Configuration
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ]
};

// --- Socket Events ---

socket.on('available-rooms', (rooms) => {
    roomList.innerHTML = '';
    if (rooms.length === 0) {
        roomList.innerHTML = '<div class="empty-state">No rooms active. Create one!</div>';
        return;
    }

    rooms.forEach(room => {
        const div = document.createElement('div');
        div.className = 'room-item';
        div.innerHTML = `
            <span class="room-name">${room.name}</span>
            <span class="room-count">👥 ${room.count}</span>
        `;
        div.addEventListener('click', () => joinRoom(room.name));
        roomList.appendChild(div);
    });
});

socket.on('room-users', (users) => {
    users.forEach(user => {
        addParticipantUI(user.id, user);
    });
});

socket.on('user-connected', async (userId, userData) => {
    addParticipantUI(userId, userData);
    const peerConnection = createPeerConnection(userId);
    
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', offer, userId);
    } catch (err) {
        console.error('Error creating offer', err);
    }
});

socket.on('user-disconnected', (userId) => {
    removeParticipantUI(userId);
    if (peers[userId]) {
        peers[userId].close();
        delete peers[userId];
    }
    if (remoteAudios[userId]) {
        remoteAudios[userId].remove();
        delete remoteAudios[userId];
    }
});

socket.on('offer', async (offer, fromId) => {
    const peerConnection = createPeerConnection(fromId);
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', answer, fromId);
    } catch (err) {
        console.error('Error handling offer', err);
    }
});

socket.on('answer', async (answer, fromId) => {
    const peerConnection = peers[fromId];
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
            console.error('Error handling answer', err);
        }
    }
});

socket.on('ice-candidate', async (candidate, fromId) => {
    const peerConnection = peers[fromId];
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error('Error adding ICE candidate', err);
        }
    }
});

// Broadcasted Transceiver Event Receivers
socket.on('user-ptt-start', (userId) => {
    // Other user pressed PTT - show radio light or click-in
    sfx.playClickIn();
    const el = document.getElementById(`participant-${userId}`);
    if (el) el.classList.add('talking');
});

socket.on('user-ptt-stop', (userId) => {
    // Other user released PTT - play squelch roger beep!
    sfx.playRogerBeep();
    const el = document.getElementById(`participant-${userId}`);
    if (el) el.classList.remove('talking');
});

socket.on('call-ping', (userId) => {
    // Someone pinged the room
    sfx.playCallChime();
    triggerLocalBellAnimation(userId);
    
    // Tactile haptic buzz if on a mobile browser
    if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100]);
    }
});

// --- Core Web Audio Filter Routing ---

function buildAudioFilter() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Create source
    const source = audioContext.createMediaStreamSource(originalLocalStream);
    
    // Low-bandwidth analog walkie-talkie bandpass filter (500Hz - 2500Hz)
    const bandpass = audioContext.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1400; // speech range centered
    bandpass.Q.value = 1.4;          // narrow band

    // Low-pass to clean crisp high frequencies
    const lowpass = audioContext.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 2800;

    // High-pass to strip out heavy background rumble
    const highpass = audioContext.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 400;

    // Gain node to slightly boost and saturate the signal
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.35; // slightly louder to mimic analog overdrive

    // Chain node structure
    source.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(lowpass);
    lowpass.connect(gainNode);

    const destination = audioContext.createMediaStreamDestination();
    gainNode.connect(destination);

    processedLocalStream = destination.stream;
}

function updateAudioFilterRouting() {
    if (isFilterEnabled) {
        if (!processedLocalStream) {
            buildAudioFilter();
        }
        localStream = processedLocalStream;
    } else {
        localStream = originalLocalStream;
    }

    // Keep active audio track mute state synchronized
    const isMicActive = audioMode === 'hands-free' ? !isMuted : isPTTActive;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = isMicActive;
    });

    // Replace the track in all ongoing WebRTC peer connections
    const newTrack = localStream.getAudioTracks()[0];
    Object.values(peers).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender) {
            sender.replaceTrack(newTrack);
        }
    });
}

// --- PTT Button Callbacks ---

function startPTTTraining() {
    if (isPTTActive || audioMode !== 'ptt' || !localStream) return;
    isPTTActive = true;
    
    sfx.playClickIn();
    pttBtn.classList.add('transmitting');
    document.getElementById('participant-me').classList.add('talking');
    
    // Trigger mic transmission
    setMicEnabled(true);
    socket.emit('ptt-start', currentRoom);

    // Simple mobile haptic tap
    if (navigator.vibrate) {
        navigator.vibrate(20);
    }
}

function stopPTTTraining() {
    if (!isPTTActive || audioMode !== 'ptt' || !localStream) return;
    isPTTActive = false;
    
    pttBtn.classList.remove('transmitting');
    document.getElementById('participant-me').classList.remove('talking');
    
    // Mute mic transmission
    setMicEnabled(false);
    sfx.playRogerBeep();
    socket.emit('ptt-stop', currentRoom);
}

function setMicEnabled(enabled) {
    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = enabled;
        });
    }
}

// --- Join & Leave Core ---

async function joinRoom(roomName) {
    if (currentRoom) return;

    try {
        // Request microphone access
        originalLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        
        // Build processed stream ready in background
        buildAudioFilter();

        // Default local stream based on filter checkbox
        localStream = isFilterEnabled ? processedLocalStream : originalLocalStream;
        
        currentRoom = roomName;
        currentRoomNameEl.textContent = roomName;
        newRoomNameInput.value = '';
        
        showView('room');
        participantsGrid.innerHTML = '';
        
        // Add self to UI
        addParticipantUI('me', myUserData);
        
        // Setup mic visualizer for self
        setupAudioVisualizer(localStream, 'me');

        // Configure default mic active state based on selected mode
        if (audioMode === 'ptt') {
            setMicEnabled(false);
        } else {
            setMicEnabled(!isMuted);
        }

        // Join via socket
        socket.emit('join-room', roomName, myUserData);

    } catch (err) {
        console.error("Microphone access denied or error:", err);
        alert("We need microphone access to join the chat!");
    }
}

function leaveRoom() {
    if (!currentRoom) return;
    
    // Disconnect and clean up WebRTC connections
    Object.values(peers).forEach(pc => pc.close());
    for (let key in peers) delete peers[key];
    
    // Stop local tracks
    if (originalLocalStream) {
        originalLocalStream.getTracks().forEach(track => track.stop());
        originalLocalStream = null;
    }
    if (processedLocalStream) {
        processedLocalStream.getTracks().forEach(track => track.stop());
        processedLocalStream = null;
    }
    localStream = null;
    
    // Clear audio elements
    Object.values(remoteAudios).forEach(audio => audio.remove());
    for (let key in remoteAudios) delete remoteAudios[key];

    // Close AudioContext
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    // Re-connect to get a fresh socket state without rooms
    socket.disconnect();
    socket.connect();
    
    currentRoom = null;
    isMuted = false;
    isPTTActive = false;
    updateMuteBtnUI();
    showView('lobby');
}

function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    
    setMicEnabled(!isMuted);
    updateMuteBtnUI();
}

function updateMuteBtnUI() {
    if (isMuted) {
        muteBtn.classList.add('muted');
        muteBtn.querySelector('.label').textContent = 'Unmute';
    } else {
        muteBtn.classList.remove('muted');
        muteBtn.querySelector('.label').textContent = 'Mute';
    }
}

function createPeerConnection(userId) {
    const pc = new RTCPeerConnection(rtcConfig);
    peers[userId] = pc;

    // Add local tracks to the connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', event.candidate, userId);
        }
    };

    // Handle incoming audio stream
    pc.ontrack = (event) => {
        if (remoteAudios[userId]) return; // Already have audio for this user
        
        const audio = document.createElement('audio');
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
        document.body.appendChild(audio);
        remoteAudios[userId] = audio;
        
        // Setup visualizer for the remote stream
        setupAudioVisualizer(event.streams[0], userId);
    };

    return pc;
}

// --- UI Helpers ---

function addParticipantUI(id, userData) {
    if (document.getElementById(`participant-${id}`)) return;

    const div = document.createElement('div');
    div.id = `participant-${id}`;
    div.className = 'participant-card';
    div.innerHTML = `
        <div class="avatar" style="background-color: ${userData.color}">${userData.avatar}</div>
        <div class="participant-name">${id === 'me' ? 'You' : userData.name}</div>
    `;
    participantsGrid.appendChild(div);
}

function removeParticipantUI(id) {
    const el = document.getElementById(`participant-${id}`);
    if (el) {
        el.remove();
    }
}

function triggerLocalBellAnimation(userId) {
    const card = document.getElementById(`participant-${userId}`);
    if (card) {
        const avatar = card.querySelector('.avatar');
        avatar.classList.add('pinging');
        setTimeout(() => {
            avatar.classList.remove('pinging');
        }, 600);
    }
}

// --- Audio Visualizer (Who is talking in hands-free mode) ---

function setupAudioVisualizer(stream, participantId) {
    try {
        const audioContextVis = new (window.AudioContext || window.webkitAudioContext)();
        const analyzer = audioContextVis.createAnalyser();
        const microphone = audioContextVis.createMediaStreamSource(stream);
        
        microphone.connect(analyzer);
        analyzer.fftSize = 256;
        const bufferLength = analyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        function checkVolume() {
            if (!document.getElementById(`participant-${participantId}`)) {
                audioContextVis.close();
                return;
            }

            // In PTT mode, we don't want volume check overriding the socket-driven 'talking' style
            if (audioMode === 'ptt') {
                requestAnimationFrame(checkVolume);
                return;
            }

            analyzer.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            const average = sum / bufferLength;

            const participantCard = document.getElementById(`participant-${participantId}`);
            if (average > 15) { // Threshold for talking
                participantCard.classList.add('talking');
            } else {
                participantCard.classList.remove('talking');
            }

            requestAnimationFrame(checkVolume);
        }

        checkVolume();
    } catch (e) {
        console.log("AudioContext visualizer failed", e);
    }
}

// Start
init();
