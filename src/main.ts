import SettingsDB from "./server/SettingsDB";
import SettingsPage from "./ui/SettingsPage";
import RankingDB from "./server/RankingDB";
import Player from "./Player";
import Enemy from "./Enemy";
import UI from "./ui/UI";

// Allow the button to be interactive.
// Without it, the buttons wouldn't work.
UI.bindEvents();

// Fetch the rankings from the database.
const rankings = RankingDB.fetchRankingsAndScores();
// Display that into the ranking table.
// Even if the data is empty, the initWith()
// method has to be called.
UI.rankingTable.initWith(rankings);

SettingsDB.fetchPlayerSettings();
SettingsPage.initWith(SettingsDB.cloned);
SettingsPage.listenToNameChange((newName) => SettingsDB.name = newName);

const canvas: HTMLCanvasElement = document.querySelector("canvas") as HTMLCanvasElement;

// Set this varialbe to `false` to allow the UI to appear.
// This variable should not get modified, as it is just for debugging purposes.
// Manually set it `false` if the UI is needed.
// This variable will have to be removed entirely later on.
const playing = false;

// Add event listener, if window is being moved, resize canva height et width

function resize() : void {
    console.log("Resizing canvas.");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

window.addEventListener("resize", resize);
resize();

const context: CanvasRenderingContext2D = canvas.getContext("2d")!;
const player: Player = new Player("Player 1", "red", canvas);
const enemy : Enemy = new Enemy(canvas);

console.log(player.toString());

function render() {
    if (playing) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        player.render();
        enemy.render();
        requestAnimationFrame(render);
    }
}

setInterval(() => {
    if (playing) {
        player.move()
        enemy.next();
    }
}, 1000 / 20);

render();

// This is temporary.
// The goal here is to be able to debug easily
// without having to deal with the UI.
if (playing) {
    UI.hideUI();
}