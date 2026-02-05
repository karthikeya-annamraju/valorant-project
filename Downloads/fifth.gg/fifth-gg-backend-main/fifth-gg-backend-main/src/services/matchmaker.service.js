const availabilityService = require("./availability.service");
const matchService = require("./match.service");

// Match size config
const MATCH_SIZE = process.env.MIN_PLAYERS_TO_MATCH
    ? parseInt(process.env.MIN_PLAYERS_TO_MATCH)
    : (process.env.NODE_ENV === 'development' ? 2 : 5);

// Rank System Logic
// Standard Valorant ranks mapped to numeric values for comparison
const RANK_VALUES = {
    "iron 1": 10, "iron 2": 20, "iron 3": 30,
    "bronze 1": 40, "bronze 2": 50, "bronze 3": 60,
    "silver 1": 70, "silver 2": 80, "silver 3": 90,
    "gold 1": 100, "gold 2": 110, "gold 3": 120,
    "platinum 1": 130, "platinum 2": 140, "platinum 3": 150,
    "diamond 1": 160, "diamond 2": 170, "diamond 3": 180,
    "ascendant 1": 190, "ascendant 2": 200, "ascendant 3": 210,
    "immortal 1": 220, "immortal 2": 230, "immortal 3": 240,
    "radiant": 250
};

// Max allowed rank difference (3 tiers = 30 points)
// e.g. Diamond 3 (180) can match with Platinum 3 (150) -> Diff 30.
const RANK_WINDOW = 30;

function getRankValue(rank) {
    if (!rank) return 0; // Unranked or unknown rank
    return RANK_VALUES[rank.toLowerCase()] || 0;
}

/**
 * Try to find a match for a game mode
 * Logic: Group by Region, then Find compatible Rank Window
 */
async function tryMatch(gameMode) {
    console.log(`Matchmaker: Looking for match in ${gameMode} (Need ${MATCH_SIZE} players)...`);

    // 1. Get all ready users
    const readyUsers = await availabilityService.getReadyUsers(gameMode);

    console.log(`Matchmaker: Found ${readyUsers.length} total ready users.`);

    if (readyUsers.length < MATCH_SIZE) {
        return null; // Not enough total players
    }

    // 2. Group by Region first (Players must be in same server)
    const regionBuckets = {};
    for (const user of readyUsers) {
        const region = user.region || 'unknown';
        if (!regionBuckets[region]) {
            regionBuckets[region] = [];
        }
        regionBuckets[region].push(user);
    }

    // 3. Find Match in each Region using Rank Window
    let matchedUsers = null;

    for (const [region, users] of Object.entries(regionBuckets)) {
        if (users.length < MATCH_SIZE) continue;

        // Sort users by Rank Value (Ascending)
        // e.g. [150 (Plat3), 160 (Dia1), 180 (Dia3)]
        users.sort((a, b) => getRankValue(a.rank_range) - getRankValue(b.rank_range));

        // Sliding Window to find compatible group
        // Check every sequential group of MATCH_SIZE players
        for (let i = 0; i <= users.length - MATCH_SIZE; i++) {
            const window = users.slice(i, i + MATCH_SIZE);

            // Filter only Ranked users (Value > 0) to check compatibility
            // Unranked/Any (Value 0) are considered "Wildcards" -> Compatible with anyone
            const rankedUsers = window.filter(u => getRankValue(u.rank_range) > 0);

            let diff = 0;
            // Only calculate diff if we have at least 2 ranked players
            // If 0 or 1 ranked player (rest are Wildcards), they are compatible by definition
            if (rankedUsers.length >= 2) {
                const minRank = getRankValue(rankedUsers[0].rank_range);
                const maxRank = getRankValue(rankedUsers[rankedUsers.length - 1].rank_range);
                diff = maxRank - minRank;
            }

            console.log(`Checking Window [${i}]: Ranked Count ${rankedUsers.length}, Diff: ${diff}`);

            // Check if difference is within allowed range
            if (diff <= RANK_WINDOW) {
                matchedUsers = window;
                console.log(`Matchmaker: Match found in ${region} with rank diff ${diff}`);
                break;
            }
        }

        if (matchedUsers) break;
    }

    if (!matchedUsers) {
        console.log("Matchmaker: No compatible match groups found yet.");
        return null;
    }

    const playerIds = matchedUsers.map(u => u.user_id);

    console.log(`Matchmaker: Creating match for players: ${playerIds.join(", ")}`);

    // 4. Create match
    const match = await matchService.createMatch(gameMode, playerIds);

    // 5. Remove matched users from queue
    for (const userId of playerIds) {
        await availabilityService.removeUser(userId);
    }

    // Return match with full participants
    const matchWithParticipants = await matchService.getMatchById(match.id);
    return matchWithParticipants;
}

module.exports = {
    tryMatch
};
