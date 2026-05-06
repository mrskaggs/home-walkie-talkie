const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Keep track of active rooms and their participants
const rooms = new Map();

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Send available rooms to the newly connected user
    socket.emit('available-rooms', getActiveRooms());

    socket.on('join-room', (roomName, userData) => {
        socket.join(roomName);
        
        if (!rooms.has(roomName)) {
            rooms.set(roomName, new Map());
        }
        
        // Store user data (avatar, color, name)
        const roomUsers = rooms.get(roomName);
        roomUsers.set(socket.id, userData);

        console.log(`User ${socket.id} joined room ${roomName}`);

        // Notify others in the room
        socket.to(roomName).emit('user-connected', socket.id, userData);
        
        // Send the current participants to the user who just joined
        const usersInRoom = Array.from(roomUsers.entries()).map(([id, data]) => ({ id, ...data }));
        socket.emit('room-users', usersInRoom.filter(u => u.id !== socket.id));

        // Broadcast updated room list to everyone
        io.emit('available-rooms', getActiveRooms());
    });

    // WebRTC Signaling handlers
    socket.on('offer', (offer, toId) => {
        socket.to(toId).emit('offer', offer, socket.id);
    });

    socket.on('answer', (answer, toId) => {
        socket.to(toId).emit('answer', answer, socket.id);
    });

    socket.on('ice-candidate', (candidate, toId) => {
        socket.to(toId).emit('ice-candidate', candidate, socket.id);
    });

    // Handle user disconnect
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        rooms.forEach((roomUsers, roomName) => {
            if (roomUsers.has(socket.id)) {
                roomUsers.delete(socket.id);
                socket.to(roomName).emit('user-disconnected', socket.id);
                
                if (roomUsers.size === 0) {
                    rooms.delete(roomName);
                }
            }
        });
        
        io.emit('available-rooms', getActiveRooms());
    });
});

function getActiveRooms() {
    const activeRooms = [];
    rooms.forEach((users, roomName) => {
        activeRooms.push({ name: roomName, count: users.size });
    });
    return activeRooms;
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Accessible on your local network at http://<your-local-ip>:${PORT}`);
});
