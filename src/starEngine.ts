// ===== 星の配置・接続ロジック =====

import { db, type Star, type ConstellationLine } from './db';
import { getRandomConstellationName } from './constellationNames';

// グリッド設定
const GRID_COLS = 12;
const GRID_ROWS = 8;
const JITTER = 0.3; // グリッド内のランダムずれ幅（0-1）
const CLUSTER_RADIUS = 2.4;
const CLUSTER_FALLBACK_RADIUS = 3.2;
const CLUSTER_MIN_DISTANCE = 0.8;
const SEED_CONSTELLATION_GAP = 3.4;
const SEED_CONSTELLATION_GAP_FALLBACK = 2.6;

// 占有済みグリッドセルを取得
async function getOccupiedCells(): Promise<Set<string>> {
    const stars = await db.stars.toArray();
    return new Set(stars.map((s) => `${s.gridX},${s.gridY}`));
}

// グリッド座標からCanvas座標を計算
export function gridToCanvas(
    gridX: number,
    gridY: number,
    canvasWidth: number,
    canvasHeight: number,
    jitterX = 0,
    jitterY = 0,
): { x: number; y: number } {
    const cellW = canvasWidth / GRID_COLS;
    const cellH = canvasHeight / GRID_ROWS;
    // 上部20%を使わない（空の上端にマージン）
    const marginTop = canvasHeight * 0.08;
    // 下部25%は地面
    const marginBottom = canvasHeight * 0.25;
    const usableHeight = canvasHeight - marginTop - marginBottom;

    return {
        x: cellW * (gridX + 0.5 + jitterX * JITTER),
        y: marginTop + (usableHeight / GRID_ROWS) * (gridY + 0.5 + jitterY * JITTER),
    };
}

type GridCell = { gridX: number; gridY: number };

function getAvailableCells(occupied: Set<string>): GridCell[] {
    const candidates: GridCell[] = [];

    for (let gx = 0; gx < GRID_COLS; gx++) {
        for (let gy = 0; gy < GRID_ROWS; gy++) {
            if (!occupied.has(`${gx},${gy}`)) {
                candidates.push({ gridX: gx, gridY: gy });
            }
        }
    }

    return candidates;
}

function pickRandomCell(cells: GridCell[]): GridCell | null {
    if (cells.length === 0) return null;
    return cells[Math.floor(Math.random() * cells.length)];
}

function filterByDistanceFromOtherConstellations(
    cells: GridCell[],
    allStars: Star[],
    constellationId: number,
    minDistance: number,
): GridCell[] {
    if (allStars.length === 0) return cells;

    const otherStars = allStars.filter((s) => s.constellationId !== constellationId);
    if (otherStars.length === 0) return cells;

    return cells.filter((cell) => {
        for (const star of otherStars) {
            const dist = Math.hypot(cell.gridX - star.gridX, cell.gridY - star.gridY);
            if (dist < minDistance) return false;
        }
        return true;
    });
}

function pickSeedCell(cells: GridCell[], constellationId: number, allStars: Star[]): GridCell | null {
    if (cells.length === 0) return null;

    // 新しい星座の開始位置は、既存の別星座から一定距離を取る
    let candidates = filterByDistanceFromOtherConstellations(
        cells,
        allStars,
        constellationId,
        SEED_CONSTELLATION_GAP,
    );
    if (candidates.length === 0) {
        candidates = filterByDistanceFromOtherConstellations(
            cells,
            allStars,
            constellationId,
            SEED_CONSTELLATION_GAP_FALLBACK,
        );
    }
    if (candidates.length === 0) {
        candidates = cells;
    }

    // 画面中央寄りの複数アンカーから開始し、1星座を収めやすくする
    const anchors = [
        { x: 3, y: 2 },
        { x: 8, y: 2 },
        { x: 3, y: 4 },
        { x: 8, y: 4 },
        { x: 6, y: 3 },
    ];
    const target = anchors[constellationId % anchors.length];

    const ranked = [...candidates]
        .map((cell) => ({
            cell,
            dist: Math.hypot(cell.gridX - target.x, cell.gridY - target.y),
        }))
        .sort((a, b) => a.dist - b.dist);

    const top = ranked.slice(0, Math.min(8, ranked.length)).map((r) => r.cell);
    return pickRandomCell(top);
}

function pickClusterCell(cells: GridCell[], starsInConstellation: Star[]): GridCell | null {
    if (cells.length === 0) return null;
    if (starsInConstellation.length === 0) return pickRandomCell(cells);

    const centerX = starsInConstellation.reduce((sum, s) => sum + s.gridX, 0) / starsInConstellation.length;
    const centerY = starsInConstellation.reduce((sum, s) => sum + s.gridY, 0) / starsInConstellation.length;

    const byRadius = (maxRadius: number, minRadius = CLUSTER_MIN_DISTANCE) => cells.filter((cell) => {
        const dist = Math.hypot(cell.gridX - centerX, cell.gridY - centerY);
        return dist <= maxRadius && dist >= minRadius;
    });

    let candidates = byRadius(CLUSTER_RADIUS);
    if (candidates.length === 0) candidates = byRadius(CLUSTER_FALLBACK_RADIUS, 0.4);
    if (candidates.length === 0) candidates = cells;

    const ranked = candidates
        .map((cell) => ({
            cell,
            score: Math.hypot(cell.gridX - centerX, cell.gridY - centerY) + Math.random() * 0.35,
        }))
        .sort((a, b) => a.score - b.score);

    const top = ranked.slice(0, Math.min(6, ranked.length)).map((r) => r.cell);
    return pickRandomCell(top);
}

async function findCellForConstellation(
    occupied: Set<string>,
    constellationId: number,
): Promise<GridCell | null> {
    const available = getAvailableCells(occupied);
    if (available.length === 0) return null;

    const starsInConstellation = await db.stars
        .where('constellationId')
        .equals(constellationId)
        .toArray();

    if (starsInConstellation.length === 0) {
        const allStars = await db.stars.toArray();
        return pickSeedCell(available, constellationId, allStars);
    }
    return pickClusterCell(available, starsInConstellation);
}

// 星の色パレット（水彩・絵本テイスト）
const STAR_COLORS = [
    '#fff9c4', // 淡い黄色
    '#ffe0b2', // 暖かいオレンジ
    '#f8bbd0', // 淡いピンク
    '#c5cae9', // 淡いラベンダー
    '#b3e5fc', // 淡い水色
    '#dcedc8', // 淡い黄緑
    '#fff3e0', // クリーム
];

// 一番近い星を見つける（線交差チェック付き）
async function findNearestStar(
    newStar: { x: number; y: number },
    newStarId: number,
    constellationId: number,
): Promise<Star | null> {
    const starsInConstellation = await db.stars
        .where('constellationId')
        .equals(constellationId)
        .toArray();

    const candidates = starsInConstellation.filter((s) => s.id !== newStarId);
    if (candidates.length === 0) return null;

    const existingLines = await db.constellationLines
        .where('constellationId')
        .equals(constellationId)
        .toArray();

    // 距離でソート
    const sorted = candidates
        .map((s) => {
            const dist = Math.hypot(s.x - newStar.x, s.y - newStar.y);
            return { star: s, dist };
        })
        .sort((a, b) => a.dist - b.dist);

    // 交差しない候補を探す
    for (const candidate of sorted.slice(0, 3)) {
        if (!wouldIntersect(newStar, candidate.star, existingLines, starsInConstellation)) {
            return candidate.star;
        }
    }

    // 全て交差する場合は一番近いものを返す
    return sorted[0]?.star ?? null;
}

// 線の交差チェック（簡易版）
function wouldIntersect(
    newPos: { x: number; y: number },
    targetStar: Star,
    existingLines: ConstellationLine[],
    allStars: Star[],
): boolean {
    const targetPos = { x: targetStar.x, y: targetStar.y };

    for (const line of existingLines) {
        const fromStar = allStars.find((s) => s.id === line.fromStarId);
        const toStar = allStars.find((s) => s.id === line.toStarId);
        if (!fromStar || !toStar) continue;

        const fromPos = { x: fromStar.x, y: fromStar.y };
        const toPos = { x: toStar.x, y: toStar.y };

        if (segmentsIntersect(newPos, targetPos, fromPos, toPos)) {
            return true;
        }
    }
    return false;
}

// 2つの線分が交差するか
function segmentsIntersect(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
    p4: { x: number; y: number },
): boolean {
    const d1 = direction(p3, p4, p1);
    const d2 = direction(p3, p4, p2);
    const d3 = direction(p1, p2, p3);
    const d4 = direction(p1, p2, p4);

    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }
    return false;
}

function direction(
    pi: { x: number; y: number },
    pj: { x: number; y: number },
    pk: { x: number; y: number },
): number {
    return (pk.x - pi.x) * (pj.y - pi.y) - (pj.x - pi.x) * (pk.y - pi.y);
}

// ===== メインの星追加関数 =====

export interface AddStarResult {
    star: Star;
    connectedTo: Star | null;
    constellationCompleted: boolean;
    constellationName?: string;
    isRealConstellation?: boolean;
}

export interface AddStarStyle {
    color?: string;
    size?: number;
    brightness?: number;
}

const STARS_PER_CONSTELLATION = 5;

export async function addStar(
    achievementId: number,
    canvasWidth: number,
    canvasHeight: number,
    style?: AddStarStyle,
): Promise<AddStarResult> {
    const occupied = await getOccupiedCells();

    // 現在の未完成星座を取得、なければ新規作成
    let constellation = await db.constellations
        .filter((c) => !c.completedAt)
        .first();

    const completedCount = await db.constellations
        .filter((c) => !!c.completedAt)
        .count();

    if (!constellation) {
        // 5つ目ごとに実在星座
        const isReal = (completedCount + 1) % 5 === 0;
        const name = getRandomConstellationName(isReal);
        const id = await db.constellations.add({
            name,
            isReal,
            starCount: 0,
        });
        constellation = await db.constellations.get(id);
    }

    if (!constellation) throw new Error('星座の作成に失敗');

    const cell = await findCellForConstellation(occupied, constellation.id!);
    if (!cell) {
        throw new Error('空きセルがありません');
    }

    const jitterX = Math.random() * 2 - 1;
    const jitterY = Math.random() * 2 - 1;
    const pos = gridToCanvas(cell.gridX, cell.gridY, canvasWidth, canvasHeight, jitterX, jitterY);

    const color = style?.color ?? STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
    const brightness = style?.brightness ?? (0.8 + Math.random() * 0.2);
    const size = style?.size ?? (2.5 + Math.random() * 1.5);

    const starId = await db.stars.add({
        x: pos.x,
        y: pos.y,
        gridX: cell.gridX,
        gridY: cell.gridY,
        brightness,
        size,
        color,
        achievementId,
        constellationId: constellation.id!,
        createdAt: new Date(),
    });

    const star = await db.stars.get(starId);
    if (!star) throw new Error('星の作成に失敗');

    // 最も近い星と線でつなぐ
    const connectedTo = await findNearestStar(pos, star.id!, constellation.id!);

    if (connectedTo) {
        await db.constellationLines.add({
            constellationId: constellation.id!,
            fromStarId: star.id!,
            toStarId: connectedTo.id!,
        });
    }

    // 星座の星数を更新
    const newCount = constellation.starCount + 1;
    await db.constellations.update(constellation.id!, { starCount: newCount });

    // 星座完成チェック
    let constellationCompleted = false;
    if (newCount >= STARS_PER_CONSTELLATION) {
        await db.constellations.update(constellation.id!, {
            starCount: newCount,
            completedAt: new Date(),
        });
        constellationCompleted = true;
    }

    // achievementにstarIdを紐付け
    await db.achievements.update(achievementId, { starId: star.id! });

    return {
        star,
        connectedTo,
        constellationCompleted,
        constellationName: constellationCompleted ? constellation.name : undefined,
        isRealConstellation: constellationCompleted ? constellation.isReal : undefined,
    };
}
