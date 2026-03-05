import Dexie, { type EntityTable } from 'dexie';

// ===== データモデル =====

export interface Star {
    id?: number;
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
    constellationId: number;
    fromStarId: number;
    toStarId: number;
}

export interface Constellation {
    id?: number;
    name: string;
    completedAt?: Date;
    starCount: number;
}

// ===== データベース =====

class StarDiaryDB extends Dexie {
    stars!: EntityTable<Star, 'id'>;
    constellationLines!: EntityTable<ConstellationLine, 'id'>;
    constellations!: EntityTable<Constellation, 'id'>;

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
    }
}

export const db = new StarDiaryDB();
