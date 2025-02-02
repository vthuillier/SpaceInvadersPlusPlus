import { } from "./src/types.js";
import { createServer } from "http";
import { Server } from "socket.io";
import Box from "./src/utils/Box.js";
import GameSettings from "./src/models/GameSettings.js";

const port = 3000;
const httpServer = createServer();
const io = new Server(httpServer, {
    cors: {
        origin: "*"
    }
});

const rooms: Room[] = [];
const games: Map<string, GameData> = new Map();

const BULLET_VELOCITY = 10;
const ENEMY_VELOCITY = 4;
const ENEMY_SHOOTING_CHANCE = 0.04;
const BULLET_SIZE = 8;
const SCORE_MULTIPLIER = 0.0001;
const INITIAL_MAX_ENEMY_COUNT = 5;
const INITIAL_SPAWN_CHANCE = 0.02;
const MAX_POWERUPS = 5;
const BOSS_HP = 4;
const BOSS_SPAWN_CHANCE = 0.2;
const BOSS_VELOCITY = 1;

function generateUniqueRoomId(): string {
    let room = "room-";
    for (let i = 0; i < 4; i++) {
        room += Math.floor(Math.random() * 10);
    }
    return room;
}

function removePlayerFromGameData(player_id: string, room_id: string) {
    if (games.has(room_id)) {
        const game = games.get(room_id)!;
        if (game.players.length === 1) {
            games.delete(room_id);
        } else {
            game.players = game.players.filter(p => p.id !== player_id);
        }
    }
}

function getAvailableRooms(): Room[] {
    return rooms.filter(r => !r.game_started);
}

function updateLobby() {
    io.emit("update_lobby", getAvailableRooms());
}

function getRandomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min) + min);
}

function getRandomPlayerSpawnPosition(limits: GameLimits, skin_width: number, skin_height: number): Vec2 {
    return {
        x: getRandomInt(limits.minX + 1, limits.maxX - skin_width),
        y: limits.maxY - skin_height - 10,
    };
}

io.on("connection", (socket) => {
    console.log("connection", socket.id);

    function clearGameIntervals(game?: GameData) {
        if (game === undefined) {
            const room = getRoom();
            if (room) {
                game = games.get(room);
            }
        }
        if (game?._physics_process) clearInterval(game._physics_process);
        if (game?._process) clearInterval(game._process);
    }

    function quitGame() {
        const room_id = getRoom();
        if (room_id) {
            clearGameIntervals();
            removePlayerFromGameData(socket.id, room_id);
            leaveRoom(room_id);
            updateLobby();
        }
    }

    function leaveRoom(room_id: string): void {
        for (let i = 0; i < rooms.length; i++) {
            const room = rooms[i];
            if (room.id === room_id) {
                socket.leave(room_id);
                if (room.players.length === 1) {
                    // The player is the only one in his room,
                    // so just delete the room.
                    rooms.splice(i, 1);
                } else {
                    // The player is not alone in the room,
                    // so just remove him from the list of players.
                    let playerIdx = room.players.findIndex(p => p.id === socket.id);
                    room.players.splice(playerIdx, 1);
                    recomputeGameLimits(room);
                }
                return;
            }
        }
    }

    function createRoom(initialLimits: GameLimits, host_username: string, si: FullSkinInformation, ps: FullSkinInformation[]): string {
        // Leave the other rooms where the already player was.
        if (socket.rooms.size > 1) {
            for (const room_id of socket.rooms) {
                leaveRoom(room_id);
            }
        }
        const roomId = generateUniqueRoomId();
        socket.join(roomId);
        rooms.push({
            id: roomId,
            game_started: false,
            players: [{
                id: socket.id,
                username: host_username,
                game_limits: initialLimits,
                skin: si.skin,
                sw: si.sw,
                sh: si.sh,
            }],
            computed_screen_limits: structuredClone(initialLimits),
            all_powerups: ps,
        });
        return roomId;
    }

    function getRoom(): string | null {
        for (const room of rooms) {
            if (room.players.map(p => p.id).includes(socket.id)) {
                return room.id;
            }
        }
        return null;
    }

    function joinExistingRoom(room_id: string, game_limits: GameLimits, client_username: string, si: FullSkinInformation): boolean {
        // Basically checking if the user is already in another room.
        // If he is in another room, then leave it.
        // Also make sure that if the room he's already in is the
        // given one (`room_id`) then don't leave it and return a failure.
        let current_room = getRoom();
        if (current_room != null) {
            if (current_room == room_id) {
                return false;
            }
            leaveRoom(current_room);
        }
        for (const room of rooms) {
            if (room.id === room_id) {
                room.players.push({
                    username: client_username,
                    id: socket.id,
                    game_limits,
                    skin: si.skin,
                    sw: si.sw,
                    sh: si.sh,
                });
                recomputeGameLimits(room);
                socket.join(room_id);
                return true;
            }
        }
        return false;
    }

    /**
     * Save the maximums X and Y and minimum X of the game limits.
     */
    function recomputeGameLimits(room: Room) {
        let minX = room.players[0].game_limits.minX;
        let maxX = room.players[0].game_limits.maxX;
        let maxY = room.players[0].game_limits.maxY;
        for (let i = 1; i < room.players.length; i++) {
            const player = room.players[i];
            if (player.game_limits.minX < minX) minX = player.game_limits.minX;
            if (player.game_limits.maxX > maxX) maxX = player.game_limits.maxX;
            if (player.game_limits.maxY > maxY) maxY = player.game_limits.maxY;
        }
        room.computed_screen_limits.minX = minX;
        room.computed_screen_limits.maxX = maxX;
        room.computed_screen_limits.maxY = maxY;
    }

    /**
     * Increases the difficulty of the same depending on the current score.
     * It increases the spawn chance for faster spawns.
     * It also increases the maximum number of enemies every 100 points.
     */
    function increaseDifficulty(game: GameData) {
        game.spawn_chance = Math.min(game.spawn_chance + game.score * SCORE_MULTIPLIER, 1);
        game.max_enemy_count = INITIAL_MAX_ENEMY_COUNT + Math.floor(game.score / 100);
    }

    function generateBoxFor(enemy: EnemyData, game: GameData) {
        const scale = enemy.boss ? 2 : 1;
        const box = new Box(enemy.x, enemy.y, game.esw * scale, game.esh * scale);
        return box;
    }

    function startGame(room: Room, settings: GameSettings, esw: number, esh: number): GameData {
        const data: GameData = {
            enemies: [],
            bullets: [],
            powerups: [],
            score: 0,
            spawn_chance: INITIAL_SPAWN_CHANCE,
            esw,
            esh,
            settings,
            paused: false,
            paused_by: undefined,
            is_over: false,
            _physics_process: undefined,
            _process: undefined,
            max_enemy_count: INITIAL_MAX_ENEMY_COUNT,
            players: room.players.map(p => ({
                username: p.username,
                position: getRandomPlayerSpawnPosition(room.computed_screen_limits, p.sw, p.sh),
                immune: false,
                id: p.id,
                skin: p.skin,
                sw: p.sw,
                sh: p.sh,
                ammo: settings.playerBasedAmmo,
                hp: settings.playerHp,
            })),
        };

        room.game_started = true;
        games.set(room.id, data);
        socket.to(room.id).emit("host_started_game", data);

        const physics_process = setInterval(() => {
            const game = games.get(room.id);
            if (game) {
                if (game.paused || game.is_over) {
                    return;
                }
                // - Update position of enemies and bullets.
                // - Remove bullets that are out of the screen.
                // - Check for collisions and update the game accordingly.
                for (let i = game.enemies.length - 1; i >= 0; i--) {
                    if (game.enemies[i].y >= room.computed_screen_limits.maxY) {
                        game.enemies.splice(i, 1);
                    }
                }
                for (let i = game.bullets.length - 1; i >= 0; i--) {
                    if (game.bullets[i].y < 10 || game.bullets[i].y >= room.computed_screen_limits.maxY) {
                        game.bullets.splice(i, 1);
                    }
                }
                const enemy_hit_boxes: Box[] = [];
                const player_hurt_boxes: Box[] = [];
                const used_bullets: number[] = [];
                const killed_enemies: number[] = [];
                const used_powerups: number[] = [];
                for (let b = 0; b < game.bullets.length; b++) {
                    const bullet = game.bullets[b];
                    const hit_box = new Box(bullet.x, bullet.y, BULLET_SIZE, BULLET_SIZE);
                    if (bullet.shotByPlayer) {
                        for (let i = 0; i < game.enemies.length; i++) {
                            const enemy = game.enemies[i];
                            const hurt_box = generateBoxFor(enemy, game);
                            enemy_hit_boxes.push(hurt_box);
                            if (hit_box.isColliding(hurt_box)) {
                                enemy.hp -= 1;
                                if (enemy.hp <= 0) {
                                    killed_enemies.push(i);
                                    game.score += enemy.boss ? 30 : 10;
                                    increaseDifficulty(game);
                                }
                                used_bullets.push(b);
                                break;
                            }
                        }
                    } else {
                        for (const player of game.players) {
                            const hurt_box = new Box(player.position.x, player.position.y, player.sw, player.sh);
                            player_hurt_boxes.push(hurt_box);
                            if (player.hp > 0) {
                                if (hit_box.isColliding(hurt_box)) {
                                    if (!player.immune) {
                                        player.hp -= 1;
                                        player.immune = true;
                                        setTimeout(() => {
                                            player.immune = false;
                                        }, 500);
                                    }
                                    used_bullets.push(b);
                                    break;
                                }
                            }
                        }
                    }
                }
                for (let e = 0; e < game.enemies.length; e++) {
                    const enemy = game.enemies[e];
                    const hit_box = e >= enemy_hit_boxes.length ? generateBoxFor(enemy, game): enemy_hit_boxes[e];
                    for (let i = 0; i < game.players.length; i++) {
                        const player = game.players[i];
                        if (player.hp > 0 && !player.immune) {
                            const hurt_box = i >= player_hurt_boxes.length ? new Box(player.position.x, player.position.y, player.sw, player.sh) : player_hurt_boxes[i];
                            if (hit_box.isColliding(hurt_box)) {
                                player.hp -= 1;
                                player.immune = true;
                                setTimeout(() => {
                                    player.immune = false;
                                }, 500);
                            }
                        }
                    }
                }
                for (let i = 0; i < game.powerups.length; i++) {
                    const powerup = game.powerups[i];
                    const skin = room.all_powerups[powerup.type];
                    const hit_box = new Box(powerup.x, powerup.y, skin.sw, skin.sh);
                    for (let p = 0; p < game.players.length; p++) {
                        const player = game.players[p];
                        if (player.hp > 0) {
                            const hurt_box = p >= player_hurt_boxes.length ? new Box(player.position.x, player.position.y, player.sw, player.sh) : player_hurt_boxes[p];
                            if (hit_box.isColliding(hurt_box)) {
                                used_powerups.push(i);
                                switch (powerup.type) {
                                    case 0: player.hp += 1; break;
                                    case 1: player.ammo += 5; break;
                                    default:
                                        console.error("undefined powerup");
                                } 
                            }
                        }
                    }
                }
                for (let i = killed_enemies.length - 1; i >= 0; i--) {
                    game.enemies.splice(killed_enemies[i], 1);
                }
                for (let i = used_bullets.length - 1; i >= 0; i--) {
                    game.bullets.splice(used_bullets[i], 1);
                }
                for (let i = used_powerups.length - 1; i >= 0; i--) {
                    game.powerups.splice(used_powerups[i], 1);
                }
                game.bullets.forEach(b => b.y += b.shotByPlayer ? -BULLET_VELOCITY : BULLET_VELOCITY);
                game.enemies.forEach(e => e.y += e.boss ? BOSS_VELOCITY : ENEMY_VELOCITY);
                io.to(room.id).emit("game_update", game);
            } else {
                clearInterval(data._physics_process);
            }
        }, 1000 / 60);

        const process = setInterval(() => {
            const game = games.get(room.id);
            if (game) {
                if (game.paused || game.is_over) {
                    return;
                }
                // - Create new enemies
                // - Make the enemies shoot
                // - Create powerups
                if (game.enemies.length < game.max_enemy_count && game.spawn_chance > Math.random()) {
                    const boss = BOSS_SPAWN_CHANCE > Math.random();
                    const scale = boss ? 2 : 1;
                    game.enemies.push({
                        boss,
                        hp: boss ? BOSS_HP : 1,
                        y: -(game.esh * scale),
                        x: getRandomInt(
                            room.computed_screen_limits.minX,
                            room.computed_screen_limits.maxX - game.esw * scale,
                        ),
                    });
                }
                if (game.powerups.length < MAX_POWERUPS && 0.01 > Math.random()) {
                    const powerup = room.all_powerups[getRandomInt(0, room.all_powerups.length)];
                    game.powerups.push({
                        x: getRandomInt(room.computed_screen_limits.minX, room.computed_screen_limits.maxX - powerup.sw),
                        y: getRandomInt(room.computed_screen_limits.minY, room.computed_screen_limits.maxY - powerup.sh),
                        type: powerup.skin,
                    });
                }
                for (const enemy of game.enemies) {
                    if (ENEMY_SHOOTING_CHANCE > Math.random()) {
                        const scale = enemy.boss ? 2 : 1;
                        game.bullets.push({
                            shotByPlayer: false,
                            x: enemy.x + (game.esw * scale / 2) - BULLET_SIZE,
                            y: enemy.y + (game.esh * scale),
                        });
                    }
                }
            } else {
                clearInterval(data._process);
            }
        }, 1000 / 20);

        // I have learned the hard way that variables stored in this scope
        // are global to all players. Therefore, the intervals must be attached 
        // to individuals games via properties. However, it is not possible
        // to send a variable of type `NodeJS.Timeout` via socket.io.
        // As a consequence, those intervals must be converted into
        // their primitive value (numbers).
        data._physics_process = physics_process[Symbol.toPrimitive]();
        data._process = process[Symbol.toPrimitive]();

        return data;
    }

    socket.on("username_changed", (new_name: string) => {
        for (const room of rooms) {
            const playerIdx = room.players.findIndex(p => p.id === socket.id);
            if (playerIdx >= 0) {
                room.players[playerIdx].username = new_name;
            }
        }
        updateLobby(); // necessary in the lobby when we're waiting for players to arrive
    });

    socket.on("host", (initial_game_limits: GameLimits, host_username: string, si: FullSkinInformation, ps: FullSkinInformation[], ack: (room_id: string) => void) => {
        ack(createRoom(initial_game_limits, host_username, si, ps)); // will be called on the client
        updateLobby();
    });

    socket.on("join_room", (room_id: string, limits: GameLimits, client_username: string, si: FullSkinInformation, ack: (success: boolean) => void) => {
        const success = joinExistingRoom(room_id, limits, client_username, si);
        ack(success);
        updateLobby();
    });

    socket.on("quit_room", (room_id: string, ack: () => void) => {
        leaveRoom(room_id);
        ack(); // must be called before "updateLobby"
        updateLobby();
    });

    socket.on("start_game", (room_id: string, settings: GameSettings, esw: number, esh: number, ack: (gameData: GameData) => void) => {
        const room = rooms.find(r => r.id === room_id);
        if (room) {
            const data = startGame(room, settings, esw, esh);
            ack(data);
            updateLobby();
        }
    });

    socket.on("start_solo_game",
        (
            sett: GameSettings,
            lts: GameLimits,
            name: string,
            si: FullSkinInformation,
            esw: number,
            esh: number,
            ps: FullSkinInformation[],
            ack: (gameData: GameData) => void) => {
            const room_id = createRoom(lts, name, si, ps);
            const room = rooms.find(r => r.id === room_id)!;
            const data = startGame(room, sett, esw, esh);
            ack(data);
        });

    socket.on("game_ended", () => {
        quitGame();
    });

    socket.on("game_over", () => {
        const room_id = getRoom();
        if (room_id) {
            const game = games.get(room_id);
            if (game) {
                game.is_over = true;
                io.to(room_id).emit("game_update", game);
            }
        }
    });

    socket.on("game_restart", () => {
        const room_id = getRoom();
        if (room_id) {
            const room = rooms.find(r => r.id === room_id);
            const game = games.get(room_id);
            if (room && game) {
                clearGameIntervals(game);
                const new_game = startGame(room, game.settings, game.esw, game.esh);
                games.set(room_id, new_game);
                io.to(room_id).emit("game_restarted", new_game);
            }
        }
    });

    socket.on("game_pause_toggled", (paused_by: string) => {
        const room_id = getRoom();
        if (room_id) {
            const game = games.get(room_id);
            if (game) {
                game.paused = !game.paused;
                if (game.paused) {
                    game.paused_by = paused_by;
                } else {
                    game.paused_by = undefined;
                }
                io.to(room_id).emit("game_update", game);
            }
        }
    });

    socket.on("player_moved", (player_position: { x: number, y: number }) => {
        const game = games.get(getRoom() ?? "");
        if (game) {
            const player = game.players.find(p => p.id === socket.id);
            if (player) {
                player.position = player_position;
            }
        }
    });

    socket.on("game_player_shooting", () => {
        const game = games.get(getRoom() ?? "");
        if (game) {
            const shooter = game.players.find(p => p.id === socket.id);
            if (shooter) {
                if (shooter.ammo > 0) {
                    shooter.ammo -= 1;
                    game.bullets.push({
                        shotByPlayer: true,
                        x: shooter.position.x + (shooter.sw / 2) - BULLET_SIZE,
                        y: shooter.position.y,
                    });
                }
            }
        }
    });

    socket.on("screen_resized", (room_id: string, limits: GameLimits) => {
        const room = rooms.find(r => r.id === room_id);
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.game_limits = limits;
                recomputeGameLimits(room);
            }
        }
    });

    socket.on("request_lobby", (ack: (rooms: Room[]) => void) => {
        ack(getAvailableRooms());
    });

    socket.on("quit_game", () => {
        const room_id = getRoom();
        quitGame();
        // If the game still exists,
        // check if it was paused when the player quit.
        // If it is, then check if this player is the one that paused it.
        // If it is, then transmit a message to all other players and
        // transfer ownership of the game's state to the first player in the list.
        if (room_id) {
            const game = games.get(room_id);
            if (game && game.paused && game.paused_by === socket.id) {
                game.paused_by = game.players[0].id;
                socket.to(room_id).emit("game_pauser_quit", game);
            }
        }
    });

    socket.on("disconnect", quitGame);
});

httpServer.listen(port, () => {
    console.log("listening on port " + port);
});
