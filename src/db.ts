import Dexie, { type EntityTable } from 'dexie';

// ===== データモデル =====

export interface Achievement {
    id?: number;
    text: string;
    createdAt: Date;
    starId?: number;
}

export interface Star {
    id?: number;
    x: number;
    y: number;
    gridX: number;
    gridY: number;
    brightness: number;
    size: number;
    color: string;
    achievementId: number;
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
    isReal: boolean;
    completedAt?: Date;
    starCount: number;
}

// ===== データベース =====

class StarDiaryDB extends Dexie {
    achievements!: EntityTable<Achievement, 'id'>;
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
    }
}

export const db = new StarDiaryDB();
