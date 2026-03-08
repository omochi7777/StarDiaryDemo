import Dexie, { type EntityTable } from 'dexie';

// ===== データモデル =====

export interface Star {
    id?: number;
    skyId: number;
    x: number;
    y: number;
    gridX: number;
    gridY: number;
    brightness: number;
    size: number;
    color: string;
    constellationId?: number;
    createdAt: Date;
}

export interface ConstellationLine {
    id?: number;
    skyId: number;
    constellationId: number;
    fromStarId: number;
    toStarId: number;
}

export interface Constellation {
    id?: number;
    skyId: number;
    name: string;
    completedAt?: Date;
    starCount: number;
}

export interface SkyPage {
    id?: number;
    title: string;
    createdAt: Date;
    lastOpenedAt: Date;
}

// ===== データベース =====

class StarDiaryDB extends Dexie {
    stars!: EntityTable<Star, 'id'>;
    constellationLines!: EntityTable<ConstellationLine, 'id'>;
    constellations!: EntityTable<Constellation, 'id'>;
    skyPages!: EntityTable<SkyPage, 'id'>;

    constructor() {
        super('StarDiaryDB');
        this.version(1).stores({
            achievements: '++id, createdAt, starId',
            stars: '++id, achievementId, constellationId, gridX, gridY, createdAt',
            constellationLines: '++id, constellationId, fromStarId, toStarId',
            constellations: '++id, name, completedAt',
        });
        this.version(2).stores({
            achievements: null,
            stars: '++id, constellationId, gridX, gridY, createdAt',
            constellationLines: '++id, constellationId, fromStarId, toStarId',
            constellations: '++id, name, completedAt',
        });
        this.version(3).stores({
            achievements: null,
            stars: '++id, skyId, constellationId, gridX, gridY, createdAt',
            constellationLines: '++id, skyId, constellationId, fromStarId, toStarId',
            constellations: '++id, skyId, name, completedAt',
            skyPages: '++id, createdAt, lastOpenedAt',
        }).upgrade(async (tx) => {
            const now = new Date();
            const skyPagesTable = tx.table('skyPages');
            const skyId = await skyPagesTable.add({
                title: '空 1',
                createdAt: now,
                lastOpenedAt: now,
            });

            await tx.table('stars').toCollection().modify((star: Star) => {
                star.skyId = skyId as number;
            });

            await tx.table('constellationLines').toCollection().modify((line: ConstellationLine) => {
                line.skyId = skyId as number;
            });

            await tx.table('constellations').toCollection().modify((constellation: Constellation) => {
                constellation.skyId = skyId as number;
            });
        });
    }
}

export const db = new StarDiaryDB();
