import Vector2 from "./Vector2";
import { Skin, getSkinImage } from "./utils/Skins";

export default class GameClient {
    private static canvas: HTMLCanvasElement | undefined = undefined;
    private static context: CanvasRenderingContext2D | undefined = undefined;

    /**
     * Gets the maximum and minimum X and Y coordinates that an entity can have
     * to be considered still within the boundaries of the game. An entity outside of
     * these boundaries should be removed and the player should bounce off of them.
     */
    public static limits: GameLimits = { maxX: 0, maxY: 0, minX: 0, minY: 0 };

    public static initWith(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.context = canvas.getContext('2d')!;
        console.log("context initialized", this.context);
    }

    public static getCanvas(): HTMLCanvasElement { return this.canvas!; }
    public static getContext(): CanvasRenderingContext2D { return this.context!; }

    public static isWithinLimits(position: Vector2): boolean {
        return position.y > this.limits.minY &&
            position.y < this.limits.maxY &&
            position.x > this.limits.minX &&
            position.x < this.limits.maxX;
    }

    public static renderPlayer(x: number, y: number, skin: Skin) {
        const skinImg = getSkinImage(skin);
        this.context!.beginPath();
        this.context!.drawImage(skinImg, x, y, skinImg.width, skinImg.height);
        this.context!.fill();
        this.context!.closePath();
    }
}
