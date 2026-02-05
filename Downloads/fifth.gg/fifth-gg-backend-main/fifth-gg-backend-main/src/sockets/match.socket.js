const availabilityService = require("../services/availability.service");
const matchService = require("../services/match.service");
const matchmakerService = require("../services/matchmaker.service");

// Store socket to user mapping
const userSockets = new Map(); // userId -> socketId

module.exports = (io, socket) => {
    // User joins matchmaking
    socket.on("match:join", async ({ userId, gameMode, rankRange }) => {
        try {
            userSockets.set(userId, socket.id);

            await availabilityService.markUserReady(userId, { gameMode, rankRange });

            socket.emit("match:joined", { success: true, gameMode });

            // Broadcast to others that a new player is ready
            socket.broadcast.emit("match:player_ready", { userId, gameMode });

            console.log(`User ${userId} joined matchmaking for ${gameMode}`);

            // Try to find a match immediately
            const match = await matchmakerService.tryMatch(gameMode);

            if (match) {
                console.log(`Match found automatically: ${match.id}`);
                // Notify all participants
                match.participants.forEach((participant) => {
                    const playerSocketId = userSockets.get(participant.user_id);
                    if (playerSocketId) {
                        io.to(playerSocketId).emit("match:found", {
                            matchId: match.id,
                            matchCode: match.match_code,
                            gameMode: match.game_mode,
                            participants: match.participants,
                        });
                    }
                });
            }

        } catch (error) {
            console.error("Error joining matchmaking:", error);
            socket.emit("match:error", { message: "Failed to join matchmaking" });
        }
    });

    // User leaves matchmaking
    socket.on("match:leave", async ({ userId }) => {
        try {
            await availabilityService.removeUser(userId);
            userSockets.delete(userId);

            socket.emit("match:left", { success: true });

            console.log(`User ${userId} left matchmaking`);
        } catch (error) {
            console.error("Error leaving matchmaking:", error);
            socket.emit("match:error", { message: "Failed to leave matchmaking" });
        }
    });

    // Match found - notify all participants
    socket.on("match:found", async ({ matchId, playerIds }) => {
        try {
            const match = await matchService.getMatchById(matchId);

            // Notify all players in the match
            playerIds.forEach((playerId) => {
                const playerSocketId = userSockets.get(playerId);
                if (playerSocketId) {
                    io.to(playerSocketId).emit("match:found", {
                        matchId: match.id,
                        matchCode: match.match_code,
                        participants: match.participants,
                    });
                }
            });

            console.log(`Match ${matchId} found with ${playerIds.length} players`);
        } catch (error) {
            console.error("Error notifying match found:", error);
        }
    });

    // Player accepts match
    socket.on("match:accept", async ({ matchId, userId }) => {
        try {
            await matchService.updateParticipantStatus(matchId, userId, "accepted");

            const match = await matchService.getMatchById(matchId);

            // Notify all participants about acceptance
            match.participants.forEach((participant) => {
                const socketId = userSockets.get(participant.user_id);
                if (socketId) {
                    io.to(socketId).emit("match:player_accepted", {
                        matchId,
                        userId,
                        allAccepted: match.participants.every(p => p.status === "accepted"),
                    });
                }
            });

            // If all accepted, start the match
            if (match.participants.every(p => p.status === "accepted")) {
                await matchService.updateMatchStatus(matchId, "active");

                match.participants.forEach((participant) => {
                    const socketId = userSockets.get(participant.user_id);
                    if (socketId) {
                        io.to(socketId).emit("match:started", { matchId, match });
                    }
                });
            }

            console.log(`User ${userId} accepted match ${matchId}`);
        } catch (error) {
            console.error("Error accepting match:", error);
            socket.emit("match:error", { message: "Failed to accept match" });
        }
    });

    // Player declines match
    socket.on("match:decline", async ({ matchId, userId }) => {
        try {
            await matchService.updateParticipantStatus(matchId, userId, "declined");
            await matchService.updateMatchStatus(matchId, "cancelled");

            const match = await matchService.getMatchById(matchId);

            // Notify all participants that match was cancelled
            match.participants.forEach((participant) => {
                const socketId = userSockets.get(participant.user_id);
                if (socketId) {
                    io.to(socketId).emit("match:cancelled", {
                        matchId,
                        reason: "Player declined",
                    });
                }
            });

            console.log(`User ${userId} declined match ${matchId}`);
        } catch (error) {
            console.error("Error declining match:", error);
            socket.emit("match:error", { message: "Failed to decline match" });
        }
    });
};
