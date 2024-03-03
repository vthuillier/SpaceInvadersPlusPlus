import { describe, test, expect } from "vitest";
import { createFakeCanvas, createHTMLImage } from "./lib/createHTMLElement";
import { createDummyEnemy, createDummyPlayer } from "./lib/createDummyObjects";
import Enemy from "../Enemy";
import Vector2 from "../Vector2";

describe('Tests for Enemy class', () => {
    const canvas = createFakeCanvas();
    const img = createHTMLImage();

    test('should genere a random position', () => {
        const vector = Enemy.generateRandomXPosition(canvas);
        expect(vector.x).toBeGreaterThanOrEqual(0);
        expect(vector.x).toBeLessThanOrEqual(canvas.width);
        expect(vector.x).toBeLessThanOrEqual(canvas.height);
        expect(vector.y).toEqual(0);
    });

    test('should kill a enemy', () => {
        const enemy = createDummyEnemy(canvas, img);
        const player = createDummyPlayer(canvas, img);
        expect(enemy.killedBy(player)).toBeTruthy();
        expect(enemy.isDead).toBeTruthy();
        expect(player.score).toEqual(10);
    });
    
    test('should move the enemy horizontally', () => {
        Enemy.horizontally = true;
        const enemy = createDummyEnemy(canvas, img);
        enemy.speed = new Vector2(0, 10);
        enemy.next();
        expect(enemy.position.x).toEqual(0);
        expect(enemy.position.y).toEqual(10);
    });
});