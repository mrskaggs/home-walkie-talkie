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
const muteBtn = document.getElementById('mute-btn');

// State
let currentRoom = null;
let localStream = null;
let isMuted = false;
let myUserData = null;
const peers = {}; // id -> RTCPeerConnection
const remoteAudios = {}; // id -> HTMLAudioElement

// Kid-friendly random avatars and colors
const avatars = ['🦊', '🐱', '🐼', '🐨', '🦁', '🐯', '🐰', '🐹', '🐻', '🐶', '🦄', '🐸'];
const colors = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#FF9F43', '#54A0FF', '#1DD1A1', '#5F27CD', '#FF9FF3'];

function generateUserData() {
    const avatar = avatars[Math.floor(Math.random() * avatars.length)];
    const color = colors[Math.floor(Math.random() * colors.length)];
    return { avatar, color, name: `Agent ${avatar}` };
}

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
    // Other users currently in the room
    users.forEach(user => {
        addParticipantUI(user.id, user);
        // We do NOT initiate the connection here. 
        // The existing users in the room will see 'user-connected' and initiate the offer.
    });
});

socket.on('user-connected', async (userId, userData) => {
    // A new user joined. Let's add them to UI and create an offer.
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

// --- Core Functions ---

async function joinRoom(roomName) {
    if (currentRoom) return;

    try {
        // Request microphone access
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        
        currentRoom = roomName;
        currentRoomNameEl.textContent = roomName;
        newRoomNameInput.value = '';
        
        showView('room');
        participantsGrid.innerHTML = '';
        
        // Add self to UI
        addParticipantUI('me', myUserData);
        
        // Setup audio visualizer for self
        setupAudioVisualizer(localStream, 'me');

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
    // Clear peer references
    for (let key in peers) delete peers[key];
    
    // Stop local tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Clear audio elements
    Object.values(remoteAudios).forEach(audio => audio.remove());
    for (let key in remoteAudios) delete remoteAudios[key];

    // Re-connect to get a fresh socket state without rooms
    socket.disconnect();
    socket.connect();
    
    currentRoom = null;
    isMuted = false;
    updateMuteBtnUI();
    showView('lobby');
}

function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });
    
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

// --- Audio Visualizer (Who is talking) ---

function setupAudioVisualizer(stream, participantId) {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyzer = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);
        
        microphone.connect(analyzer);
        analyzer.fftSize = 256;
        const bufferLength = analyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        function checkVolume() {
            if (!document.getElementById(`participant-${participantId}`)) {
                audioContext.close();
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
        console.log("AudioContext not supported or failed", e);
    }
}

// Start
init();
