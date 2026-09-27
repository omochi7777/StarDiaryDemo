// ===== 星空の手紙（バックアップの書き出し・読み込み） =====

import { db, type Star, type ConstellationLine, type Constellation, type SkyPage } from './db';

const LETTER_FORMAT = 'stardiary-letter';
const LETTER_VERSION = 1;

interface SkyLetter {
    format: typeof LETTER_FORMAT;
    version: number;
    exportedAt: string;
    skyPages: SkyPage[];
    constellations: Constellation[];
    stars: Star[];
    constellationLines: ConstellationLine[];
}

export interface SkyLetterSummary {
    skyCount: number;
    starCount: number;
    exportedAt: Date | null;
}

export class SkyLetterError extends Error {}

export async function createSkyLetter(): Promise<{ blob: Blob; fileName: string; summary: SkyLetterSummary }> {
    const [skyPages, constellations, stars, constellationLines] = await db.transaction(
        'r',
        db.skyPages,
        db.constellations,
        db.stars,
        db.constellationLines,
        () => Promise.all([
            db.skyPages.toArray(),
            db.constellations.toArray(),
            db.stars.toArray(),
            db.constellationLines.toArray(),
        ]),
    );

    const now = new Date();
    const letter: SkyLetter = {
        format: LETTER_FORMAT,
        version: LETTER_VERSION,
        exportedAt: now.toISOString(),
        skyPages,
        constellations,
        stars,
        constellationLines,
    };

    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;

    return {
        blob: new Blob([JSON.stringify(letter)], { type: 'application/json' }),
        fileName: `stardiary-letter-${stamp}.json`,
        summary: { skyCount: skyPages.length, starCount: stars.length, exportedAt: now },
    };
}

// ----- 読み込み時の検証 -----

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toId(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new SkyLetterError('invalid id');
    }
    return value;
}

function toFiniteNumber(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new SkyLetterError('invalid number');
    }
    return value;
}

function toGridIndex(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new SkyLetterError('invalid grid index');
    }
    return value;
}

function toText(value: unknown, maxLength: number): string {
    if (typeof value !== 'string') throw new SkyLetterError('invalid text');
    return value.slice(0, maxLength);
}

function toDate(value: unknown): Date {
    if (typeof value !== 'string' && typeof value !== 'number') {
        throw new SkyLetterError('invalid date');
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new SkyLetterError('invalid date');
    return date;
}

function toColor(value: unknown): string {
    // 描画時に末尾へアルファ値を連結するため #rrggbb 形式に限定する
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
        throw new SkyLetterError('invalid color');
    }
    return value;
}

function toArray(value: unknown): RawRecord[] {
    if (!Array.isArray(value) || !value.every(isRecord)) {
        throw new SkyLetterError('invalid list');
    }
    return value;
}

function parseSkyLetter(raw: unknown): SkyLetter {
    if (!isRecord(raw) || raw.format !== LETTER_FORMAT) {
        throw new SkyLetterError('not a sky letter');
    }
    if (typeof raw.version !== 'number' || raw.version > LETTER_VERSION) {
        throw new SkyLetterError('unsupported version');
    }

    const skyPages: SkyPage[] = toArray(raw.skyPages).map((page) => ({
        id: toId(page.id),
        title: toText(page.title, 40),
        createdAt: toDate(page.createdAt),
        lastOpenedAt: toDate(page.lastOpenedAt),
    }));
    const skyIds = new Set(skyPages.map((page) => page.id!));

    const constellations: Constellation[] = toArray(raw.constellations).map((c) => ({
        id: toId(c.id),
        skyId: toId(c.skyId),
        name: toText(c.name, 60),
        starCount: toGridIndex(c.starCount),
        ...(c.completedAt != null ? { completedAt: toDate(c.completedAt) } : {}),
    }));

    const stars: Star[] = toArray(raw.stars).map((s) => ({
        id: toId(s.id),
        skyId: toId(s.skyId),
        x: toFiniteNumber(s.x),
        y: toFiniteNumber(s.y),
        gridX: toGridIndex(s.gridX),
        gridY: toGridIndex(s.gridY),
        brightness: toFiniteNumber(s.brightness),
        size: toFiniteNumber(s.size),
        color: toColor(s.color),
        ...(s.constellationId != null ? { constellationId: toId(s.constellationId) } : {}),
        createdAt: toDate(s.createdAt),
    }));
    const starIds = new Set(stars.map((star) => star.id!));

    const constellationLines: ConstellationLine[] = toArray(raw.constellationLines).map((line) => ({
        id: toId(line.id),
        skyId: toId(line.skyId),
        constellationId: toId(line.constellationId),
        fromStarId: toId(line.fromStarId),
        toStarId: toId(line.toStarId),
    }));

    const belongsToKnownSky = (item: { skyId: number }) => skyIds.has(item.skyId);
    if (
        !constellations.every(belongsToKnownSky)
        || !stars.every(belongsToKnownSky)
        || !constellationLines.every(
            (line) => belongsToKnownSky(line) && starIds.has(line.fromStarId) && starIds.has(line.toStarId),
        )
    ) {
        throw new SkyLetterError('broken references');
    }

    return {
        format: LETTER_FORMAT,
        version: raw.version,
        exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
        skyPages,
        constellations,
        stars,
        constellationLines,
    };
}

export async function readSkyLetter(file: File): Promise<{ letter: SkyLetter; summary: SkyLetterSummary }> {
    let raw: unknown;
    try {
        raw = JSON.parse(await file.text());
    } catch {
        throw new SkyLetterError('not json');
    }

    const letter = parseSkyLetter(raw);
    const exportedAt = letter.exportedAt ? new Date(letter.exportedAt) : null;
    return {
        letter,
        summary: {
            skyCount: letter.skyPages.length,
            starCount: letter.stars.length,
            exportedAt: exportedAt && !Number.isNaN(exportedAt.getTime()) ? exportedAt : null,
        },
    };
}

// 今の星空をすべて手紙の内容に置きかえる。途中で失敗した場合は元の星空が残る。
export async function restoreSkyLetter(letter: SkyLetter): Promise<void> {
    await db.transaction('rw', db.skyPages, db.constellations, db.stars, db.constellationLines, async () => {
        await Promise.all([
            db.constellationLines.clear(),
            db.stars.clear(),
            db.constellations.clear(),
            db.skyPages.clear(),
        ]);
        await db.skyPages.bulkAdd(letter.skyPages);
        await db.constellations.bulkAdd(letter.constellations);
        await db.stars.bulkAdd(letter.stars);
        await db.constellationLines.bulkAdd(letter.constellationLines);
    });
}
