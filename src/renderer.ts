// ===== Canvas描画エンジン =====
// 絵本テイストの夜空を描画する

import type { Star, ConstellationLine } from './db';
import { gridToCanvas } from './starEngine';
import tree01Url from '../assets/tree01.png';
import tree02Url from '../assets/tree02.png';
import cloudUrl from '../assets/cloud.png';
import cloud02Url from '../assets/cloud02.png';
import textureUrl from '../assets/texture.png';

// ===== 背景星（固定の飾り） =====

interface BackgroundStar {
    x: number;
    y: number;
    size: number;
    alpha: number;
    twinkleSpeed: number;
    twinkleOffset: number;
}

let bgStars: BackgroundStar[] = [];

interface ShootingStar {
    x: number;
    y: number;
    vx: number;
    vy: number;
    speed: number;
    length: number;
    thickness: number;
    lifeMs: number;
    ageMs: number;
}

let shootingStars: ShootingStar[] = [];
let nextShootingStarAt = 0;
interface TreeSprite {
    image: HTMLImageElement;
    processed: HTMLCanvasElement | null;
}

const treeSprites: TreeSprite[] = [];

// cloud.png / cloud02.png 画像
let cloudImage: HTMLImageElement | null = null;
let cloud02Image: HTMLImageElement | null = null;
if (typeof Image !== 'undefined') {
    const img = new Image();
    img.decoding = 'async';
    img.src = cloudUrl;
    cloudImage = img;

    const img2 = new Image();
    img2.decoding = 'async';
    img2.src = cloud02Url;
    cloud02Image = img2;
}

// texture.png 画像（絵本風の紙テクスチャ）
let textureImage: HTMLImageElement | null = null;
if (typeof Image !== 'undefined') {
    const img = new Image();
    img.decoding = 'async';
    img.src = textureUrl;
    textureImage = img;
}

function createTreeSilhouette(image: HTMLImageElement): HTMLCanvasElement | null {
    if (typeof document === 'undefined' || image.naturalWidth === 0 || image.naturalHeight === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const w = canvas.width;
    const h = canvas.height;

    const samples: Array<[number, number]> = [
        [0, 0],
        [w - 1, 0],
        [0, h - 1],
        [w - 1, h - 1],
        [Math.floor(w * 0.5), 0],
        [Math.floor(w * 0.5), h - 1],
        [0, Math.floor(h * 0.5)],
        [w - 1, Math.floor(h * 0.5)],
    ];

    let keyR = 0;
    let keyG = 0;
    let keyB = 0;
    let keyCount = 0;
    let transparentSamples = 0;

    for (const [sx, sy] of samples) {
        const idx = (sy * w + sx) * 4;
        const a = data[idx + 3];
        if (a < 16) {
            transparentSamples += 1;
            continue;
        }
        keyR += data[idx];
        keyG += data[idx + 1];
        keyB += data[idx + 2];
        keyCount += 1;
    }

    // 縁の色が背景として焼き込まれているPNGを想定して透過化
    if (keyCount > 0 && transparentSamples < samples.length / 2) {
        keyR /= keyCount;
        keyG /= keyCount;
        keyB /= keyCount;

        for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3];
            if (a === 0) continue;

            const dr = Math.abs(data[i] - keyR);
            const dg = Math.abs(data[i + 1] - keyG);
            const db = Math.abs(data[i + 2] - keyB);
            const dist = Math.max(dr, dg, db);

            if (dist <= 12) {
                data[i + 3] = 0;
                continue;
            }
            if (dist < 42) {
                const ratio = (dist - 12) / 30;
                data[i + 3] = Math.round(a * ratio);
            }
        }
    }

    // 形状は維持しつつ暗色に寄せてシルエットとして統一
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        data[i] = 10;
        data[i + 1] = 8;
        data[i + 2] = 20;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

if (typeof Image !== 'undefined') {
    for (const src of [tree01Url, tree02Url]) {
        const img = new Image();
        const sprite: TreeSprite = { image: img, processed: null };
        img.onload = () => {
            sprite.processed = createTreeSilhouette(img);
        };
        img.decoding = 'async';
        img.src = src;
        treeSprites.push(sprite);
    }
}

function generateBackgroundStars(w: number, h: number): BackgroundStar[] {
    const stars: BackgroundStar[] = [];
    const count = Math.floor((w * h) / 4000); // 画面サイズに比例

    for (let i = 0; i < count; i++) {
        stars.push({
            x: Math.random() * w,
            y: Math.random() * h * 0.75, // 上3/4に配置
            size: 0.3 + Math.random() * 1.2,
            alpha: 0.2 + Math.random() * 0.5,
            twinkleSpeed: 0.5 + Math.random() * 2,
            twinkleOffset: Math.random() * Math.PI * 2,
        });
    }
    return stars;
}

function scheduleNextShootingStar(nowMs: number): void {
    const minDelay = 3500;
    const maxDelay = 7500;
    nextShootingStarAt = nowMs + minDelay + Math.random() * (maxDelay - minDelay);
}

function createShootingStar(w: number, h: number): ShootingStar {
    const useTopEdge = Math.random() < 0.6;
    const startX = useTopEdge ? Math.random() * w : w + Math.random() * (w * 0.2);
    const startY = useTopEdge ? Math.random() * (h * 0.25) : Math.random() * (h * 0.35);

    const angleDeg = 120 + Math.random() * 45; // down-left
    const angle = (angleDeg * Math.PI) / 180;
    const speed = 700 + Math.random() * 600; // px/s

    return {
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        speed,
        length: 100 + Math.random() * 120,
        thickness: 1 + Math.random() * 1.2,
        lifeMs: 700 + Math.random() * 600,
        ageMs: 0,
    };
}

function updateShootingStar(star: ShootingStar, dtMs: number): void {
    star.ageMs += dtMs;
    const dt = dtMs / 1000;
    star.x += star.vx * dt;
    star.y += star.vy * dt;
}

function drawShootingStar(ctx: CanvasRenderingContext2D, star: ShootingStar): void {
    const lifeRatio = Math.max(0, 1 - star.ageMs / star.lifeMs);
    if (lifeRatio <= 0) return;

    const dirX = star.vx / star.speed;
    const dirY = star.vy / star.speed;
    const tailX = star.x - dirX * star.length;
    const tailY = star.y - dirY * star.length;

    ctx.save();
    ctx.globalAlpha = 0.85 * lifeRatio;
    ctx.lineWidth = star.thickness;
    ctx.lineCap = 'round';

    const grad = ctx.createLinearGradient(star.x, star.y, tailX, tailY);
    grad.addColorStop(0, 'rgba(255, 249, 196, 0.9)');
    grad.addColorStop(0.4, 'rgba(255, 224, 178, 0.55)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.strokeStyle = grad;
    ctx.shadowColor = 'rgba(255, 249, 196, 0.6)';
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.moveTo(star.x, star.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    ctx.restore();
}

// ===== 空のグラデーション =====

export type SkyThemePreset = 'auto' | 'spring' | 'summer' | 'autumn' | 'winter';
type ResolvedSkyTheme = Exclude<SkyThemePreset, 'auto'>;

const SKY_GRADIENTS: Record<ResolvedSkyTheme, string[]> = {
    spring: ['#1B1F3B', '#2E356B', '#5C4D9B', '#A186D9'],
    summer: ['#0A1026', '#0D1B4C', '#123C8C', '#1E6FD9'],
    autumn: ['#1A0F1F', '#2B1633', '#4A235A', '#B04E6F'],
    winter: ['#06121F', '#0A2A40', '#0F4C5C', '#9AD9FF'],
};

const AUTO_SKY_THEME_CANDIDATES: ResolvedSkyTheme[] = ['spring', 'summer', 'autumn', 'winter'];
const AUTO_SKY_THEME: ResolvedSkyTheme =
    AUTO_SKY_THEME_CANDIDATES[Math.floor(Math.random() * AUTO_SKY_THEME_CANDIDATES.length)];

function resolveSkyTheme(preset: SkyThemePreset): ResolvedSkyTheme {
    if (preset !== 'auto') return preset;
    return AUTO_SKY_THEME;
}

function drawSkyGradient(ctx: CanvasRenderingContext2D, w: number, h: number, skyThemePreset: SkyThemePreset): void {
    const resolvedTheme = resolveSkyTheme(skyThemePreset);
    const colors = SKY_GRADIENTS[resolvedTheme];
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(0.35, colors[1]);
    gradient.addColorStop(0.62, colors[2]);
    gradient.addColorStop(0.82, colors[3]);
    gradient.addColorStop(1, colors[3]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
}

// ===== 紙テクスチャオーバーレイ =====

function drawTextureOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const img = textureImage;
    if (!img || !img.complete || img.naturalWidth === 0) return;

    ctx.save();
    // soft-light で重ねると夜空の暗さを保ちつつ和紙の凹凸感が出る
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.50;

    const tw = img.naturalWidth;
    const th = img.naturalHeight;

    // canvasを覆うようにテクスチャをタイリング
    for (let y = 0; y < h; y += th) {
        for (let x = 0; x < w; x += tw) {
            ctx.drawImage(img, x, y, tw, th);
        }
    }

    ctx.restore();
}

// ===== 地面（切り絵風の丘） =====

function drawGround(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
    const groundY = h * 0.78;

    // 奥の丘
    ctx.beginPath();
    ctx.moveTo(0, groundY + 10);
    ctx.bezierCurveTo(w * 0.15, groundY - 25, w * 0.3, groundY - 15, w * 0.5, groundY + 5);
    ctx.bezierCurveTo(w * 0.7, groundY + 20, w * 0.85, groundY - 10, w, groundY + 15);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = '#151020';
    ctx.fill();

    // 手前の丘
    ctx.beginPath();
    ctx.moveTo(0, groundY + 30);
    ctx.bezierCurveTo(w * 0.2, groundY + 15, w * 0.4, groundY + 35, w * 0.6, groundY + 25);
    ctx.bezierCurveTo(w * 0.8, groundY + 20, w * 0.95, groundY + 40, w, groundY + 30);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = '#151020';
    ctx.fill();

    // 木のシルエット（切り絵風）
    // drawTree(ctx, x, baseY, trunkW, treeH, variant)
    // variant 0 = tree01（丸い広葉樹）、1 = tree02（針葉樹・大きめ）

    // tree01（広葉樹・小さめ）
    drawTree(ctx, w * 0.1, groundY + 5, 18, 42, 0, time);
    drawTree(ctx, w * 0.5, groundY + 10, 10, 22, 0, time);
    drawTree(ctx, w * 0.85, groundY + 10, 20, 48, 0, time);

    // tree02（針葉樹・大きめ・本数増し）
    drawTree(ctx, w * 0.03, groundY + 10, 22, 70, 1, time);
    drawTree(ctx, w * 0.4, groundY + 5, 10, 30, 1, time);
    drawTree(ctx, w * 0.72, groundY + 20, 16, 60, 1, time);
    drawTree(ctx, w * 0.92, groundY + 20, 22, 72, 1, time);
}

function drawTree(
    ctx: CanvasRenderingContext2D,
    x: number,
    baseY: number,
    trunkW: number,
    treeH: number,
    variant: number,
    time: number,
): void {
    const treeScale = 1.3;
    const scaledTreeH = treeH * treeScale;
    const scaledTrunkW = trunkW * treeScale;
    const sway = Math.sin(time * 0.001 + x * 0.02 + variant * 1.7) * 0.015;

    const sprite = treeSprites.length > 0
        ? treeSprites[Math.abs(variant) % treeSprites.length]
        : null;
    const drawable = sprite?.processed
        ?? ((sprite?.image.complete && sprite.image.naturalWidth > 0 && sprite.image.naturalHeight > 0)
            ? sprite.image
            : null);
    ctx.save();
    ctx.translate(x, baseY);
    ctx.rotate(sway);
    ctx.translate(-x, -baseY);

    if (drawable) {
        const sourceW = drawable instanceof HTMLCanvasElement ? drawable.width : drawable.naturalWidth;
        const sourceH = drawable instanceof HTMLCanvasElement ? drawable.height : drawable.naturalHeight;
        const aspect = sourceW / sourceH;
        const drawH = scaledTreeH * 1.25;
        const drawW = Math.max(drawH * aspect, scaledTrunkW * 2.2);
        const drawX = x - drawW / 2;
        const drawY = baseY - drawH;

        ctx.globalAlpha = 0.95;
        ctx.drawImage(drawable, drawX, drawY, drawW, drawH);
        ctx.restore();
        return;
    }

    // 画像未ロード時のフォールバック
    ctx.fillStyle = '#0a0814';

    // 幹
    ctx.fillRect(x - scaledTrunkW * 0.15, baseY - scaledTreeH * 0.4, scaledTrunkW * 0.3, scaledTreeH * 0.4);

    // 葉（三角を重ねて）
    for (let i = 0; i < 3; i++) {
        const layerY = baseY - scaledTreeH * 0.3 - (scaledTreeH * 0.25 * i);
        const layerW = scaledTrunkW * (1.3 - i * 0.25);
        ctx.beginPath();
        ctx.moveTo(x, layerY - scaledTreeH * 0.3);
        ctx.lineTo(x - layerW, layerY);
        ctx.lineTo(x + layerW, layerY);
        ctx.closePath();
        ctx.fill();
    }

    ctx.restore();
}

// ===== 雲（cloud.png 使用） =====

// 雲の定義: [初期X比率, Y比率, 高さ比率, 透過度, スクロール速度倍率, 画像インデックス(0=cloud, 1=cloud02)]
const CLOUD_DEFS: [number, number, number, number, number, number][] = [
    [0.12, 0.18, 0.15, 0.20, 1.0, 0],
    [0.46, 0.24, 0.12, 0.30, 0.7, 1],
    [0.70, 0.15, 0.135, 0.15, 0.5, 0],
    [0.30, 0.20, 0.10, 0.18, 0.9, 1],
];

function drawClouds(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
    const images = [cloudImage, cloud02Image];
    if (!images[0] || !images[0].complete || images[0].naturalWidth === 0) return;

    ctx.save();
    // time は ms 単位。0.012 px/ms ≈ 12 px/s → 画面幅400pxなら約33秒で1周
    const baseOffset = time * 0.012;

    for (const [initX, initY, hRatio, alpha, speedMul, imgIdx] of CLOUD_DEFS) {
        const img = images[imgIdx];
        if (!img || !img.complete || img.naturalWidth === 0) continue;

        const cloudH = h * hRatio;
        const cloudW = cloudH * (img.naturalWidth / img.naturalHeight);
        const scrollRange = w + cloudW;
        const x = ((initX * w + baseOffset * speedMul) % scrollRange) - cloudW;
        const y = h * initY;

        ctx.globalAlpha = alpha;
        ctx.drawImage(img, x, y, cloudW, cloudH);
        // ループ用に追加コピー
        if (x + cloudW < w) {
            ctx.drawImage(img, x + scrollRange, y, cloudW, cloudH);
        }
    }

    ctx.restore();
}

// ===== 背景星の描画 =====

function drawBackgroundStars(ctx: CanvasRenderingContext2D, time: number): void {
    for (const star of bgStars) {
        const twinkle = Math.sin(time * 0.001 * star.twinkleSpeed + star.twinkleOffset);
        const alpha = star.alpha * (0.6 + 0.4 * twinkle);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#e8e0f0';

        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();

        // にじみ効果
        if (star.size > 0.8) {
            ctx.globalAlpha = alpha * 0.2;
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.size * 2.5, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }
}

// ===== 星座星の描画（主役） =====

function drawConstellationStar(
    ctx: CanvasRenderingContext2D,
    star: Star,
    time: number,
    _w: number,
    _h: number,
): void {
    const twinkle = Math.sin(time * 0.0015 + star.id! * 1.7);
    const pulse = 1 + twinkle * 0.08;
    const glowAlpha = 0.3 + twinkle * 0.1;

    const x = star.x;
    const y = star.y;
    const size = star.size * pulse;

    ctx.save();

    // 外側のにじみ（水彩風）
    const outerGlow = ctx.createRadialGradient(x, y, 0, x, y, size * 8);
    outerGlow.addColorStop(0, star.color + '40');
    outerGlow.addColorStop(0.5, star.color + '15');
    outerGlow.addColorStop(1, star.color + '00');
    ctx.fillStyle = outerGlow;
    ctx.beginPath();
    ctx.arc(x, y, size * 8, 0, Math.PI * 2);
    ctx.fill();

    // 中間のグロー
    const midGlow = ctx.createRadialGradient(x, y, 0, x, y, size * 4);
    midGlow.addColorStop(0, star.color + '80');
    midGlow.addColorStop(0.6, star.color + '30');
    midGlow.addColorStop(1, star.color + '00');
    ctx.globalAlpha = glowAlpha + 0.3;
    ctx.fillStyle = midGlow;
    ctx.beginPath();
    ctx.arc(x, y, size * 4, 0, Math.PI * 2);
    ctx.fill();

    // 星の本体
    ctx.globalAlpha = star.brightness;
    ctx.fillStyle = star.color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();

    // 中心のハイライト
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, size * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // 十字の光芒（繊細に）
    ctx.globalAlpha = 0.15 + twinkle * 0.05;
    ctx.strokeStyle = star.color;
    ctx.lineWidth = 0.5;
    const rayLen = size * 5;
    ctx.beginPath();
    ctx.moveTo(x - rayLen, y);
    ctx.lineTo(x + rayLen, y);
    ctx.moveTo(x, y - rayLen);
    ctx.lineTo(x, y + rayLen);
    ctx.stroke();

    ctx.restore();
}

// ===== 星座の線（糸/縫い目風） =====

function drawConstellationLine(
    ctx: CanvasRenderingContext2D,
    fromStar: Star,
    toStar: Star,
    time: number,
): void {
    const fromX = fromStar.x;
    const fromY = fromStar.y;
    const toX = toStar.x;
    const toY = toStar.y;
    const lineLength = Math.hypot(toX - fromX, toY - fromY);
    if (lineLength < 0.01) return;

    ctx.save();

    // 糸のようなゆらぎ
    const segments = 20;
    const dx = (toX - fromX) / segments;
    const dy = (toY - fromY) / segments;

    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#c8bfe0';
    ctx.lineWidth = 0.6;
    ctx.setLineDash([3, 4]); // 縫い目風の点線

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);

    for (let i = 1; i <= segments; i++) {
        const x = fromX + dx * i;
        const y = fromY + dy * i;
        // 微かなゆらぎ
        const wobble = Math.sin(time * 0.002 + i * 0.5) * 1.2;
        const perpX = -dy / lineLength * wobble;
        const perpY = dx / lineLength * wobble;
        ctx.lineTo(x + perpX, y + perpY);
    }

    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

// ===== 紙片エフェクト =====

export interface PaperFragment {
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    rotation: number;
    rotationSpeed: number;
    width: number;
    height: number;
    color: string;
    alpha: number;
    phase: 'rising' | 'dissolving' | 'done';
    progress: number; // 0-1
    particles: { x: number; y: number; vx: number; vy: number; alpha: number; size: number }[];
}

export function createPaperFragment(startX: number, startY: number, targetX: number, targetY: number): PaperFragment {
    return {
        x: startX,
        y: startY,
        targetX,
        targetY,
        rotation: 0,
        rotationSpeed: (Math.random() - 0.5) * 0.08,
        width: 20 + Math.random() * 15,
        height: 12 + Math.random() * 8,
        color: '#f5f0e8',
        alpha: 1,
        phase: 'rising',
        progress: 0,
        particles: [],
    };
}

function updatePaperFragment(frag: PaperFragment, dt: number): void {
    frag.progress += dt * 0.0012;

    if (frag.phase === 'rising') {
        // 上昇中：カーブを描きながら上に
        const t = Math.min(frag.progress, 1);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        frag.x = frag.x + (frag.targetX - frag.x) * 0.02;
        frag.y = frag.y + (frag.targetY - frag.y - 60) * 0.02; // 目標よりちょっと上を目指す
        frag.rotation += frag.rotationSpeed;
        frag.alpha = 1 - ease * 0.3;

        // 小さな揺れ
        frag.x += Math.sin(frag.progress * 8) * 0.5;

        if (frag.progress >= 0.7) {
            frag.phase = 'dissolving';
            frag.progress = 0;
            // パーティクルを生成
            for (let i = 0; i < 8; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 0.3 + Math.random() * 0.8;
                frag.particles.push({
                    x: frag.x,
                    y: frag.y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed - 0.5,
                    alpha: 0.8,
                    size: 1 + Math.random() * 2,
                });
            }
        }
    } else if (frag.phase === 'dissolving') {
        frag.alpha = Math.max(0, 1 - frag.progress * 2);

        // パーティクルを目標に向かわせる
        for (const p of frag.particles) {
            const toTargetX = frag.targetX - p.x;
            const toTargetY = frag.targetY - p.y;
            p.vx += toTargetX * 0.003;
            p.vy += toTargetY * 0.003;
            p.x += p.vx;
            p.y += p.vy;
            p.alpha = Math.max(0, p.alpha - 0.008);
        }

        if (frag.progress >= 1) {
            frag.phase = 'done';
        }
    }
}

function drawPaperFragment(ctx: CanvasRenderingContext2D, frag: PaperFragment): void {
    if (frag.phase === 'done') return;

    ctx.save();

    // 紙片本体
    if (frag.alpha > 0.01 && frag.phase === 'rising') {
        ctx.translate(frag.x, frag.y);
        ctx.rotate(frag.rotation);
        ctx.globalAlpha = frag.alpha;
        ctx.fillStyle = frag.color;
        ctx.shadowColor = '#fff8e1';
        ctx.shadowBlur = 8;

        // 不規則な四角（切り絵風）
        ctx.beginPath();
        ctx.moveTo(-frag.width / 2 + 2, -frag.height / 2);
        ctx.lineTo(frag.width / 2, -frag.height / 2 + 1);
        ctx.lineTo(frag.width / 2 - 1, frag.height / 2);
        ctx.lineTo(-frag.width / 2, frag.height / 2 - 2);
        ctx.closePath();
        ctx.fill();

        ctx.shadowBlur = 0;
    }

    ctx.restore();

    // パーティクル（光の粒）
    for (const p of frag.particles) {
        if (p.alpha <= 0) continue;
        ctx.save();
        ctx.globalAlpha = p.alpha;

        // にじみグロー
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3);
        glow.addColorStop(0, '#fff9c4');
        glow.addColorStop(0.5, '#ffe08280');
        glow.addColorStop(1, '#ffe08200');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
        ctx.fill();

        // 本体
        ctx.fillStyle = '#fff9c4';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

// ===== 星座完成エフェクト =====

export interface CompletionEffectLine {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    drawProgress: number; // 0-1, how much of this line is drawn
    startDelay: number;   // seconds before this line starts drawing
    glowAlpha: number;    // trailing glow intensity
}

export interface CompletionEffect {
    constellationId: number;
    name: string;
    progress: number; // 0-1
    phase: 'lineDrawing' | 'flash' | 'nameReveal' | 'done';
    starPositions: { x: number; y: number }[];
    lines: CompletionEffectLine[];
    totalLineDuration: number; // total time for all lines to finish
}

function drawCompletionEffect(ctx: CanvasRenderingContext2D, effect: CompletionEffect, w: number, h: number): void {
    if (effect.phase === 'done') return;

    ctx.save();

    if (effect.phase === 'lineDrawing') {
        // 線を1本ずつ順番に描画するフェーズ
        const elapsed = effect.progress; // seconds elapsed

        for (const line of effect.lines) {
            const lineElapsed = elapsed - line.startDelay;
            if (lineElapsed < 0) continue; // まだこの線の番ではない

            const LINE_DRAW_DURATION = 0.4; // 1本あたりの描画時間（秒）
            const t = Math.min(lineElapsed / LINE_DRAW_DURATION, 1);
            line.drawProgress = t;

            // イージング（ゆっくり始まり、すっと伸びる）
            const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

            // 線の途中点を計算
            const currentX = line.fromX + (line.toX - line.fromX) * eased;
            const currentY = line.fromY + (line.toY - line.fromY) * eased;

            // グロー効果（先端が光る）
            if (t < 1) {
                const glowRadius = 12;
                const glowGrad = ctx.createRadialGradient(currentX, currentY, 0, currentX, currentY, glowRadius);
                glowGrad.addColorStop(0, '#fff9c4cc');
                glowGrad.addColorStop(0.4, '#ffe08260');
                glowGrad.addColorStop(1, '#ffe08200');
                ctx.globalAlpha = 0.8;
                ctx.fillStyle = glowGrad;
                ctx.beginPath();
                ctx.arc(currentX, currentY, glowRadius, 0, Math.PI * 2);
                ctx.fill();
            }

            // 描画済みの線（金色の光る線）
            ctx.globalAlpha = 0.6 + 0.2 * (1 - t); // 描画中はやや明るく
            ctx.strokeStyle = '#fff9c4';
            ctx.lineWidth = 1.2;
            ctx.shadowColor = '#fff9c4';
            ctx.shadowBlur = 8;
            ctx.setLineDash([]);

            // 直線で現在位置まで描画
            ctx.beginPath();
            ctx.moveTo(line.fromX, line.fromY);
            if (eased > 0) {
                ctx.lineTo(currentX, currentY);
            }

            ctx.stroke();
            ctx.shadowBlur = 0;

            // 描画完了した線の起点・終点に小さな光
            if (t >= 1) {
                line.glowAlpha = Math.max(0, line.glowAlpha - 0.02);
                if (line.glowAlpha > 0) {
                    ctx.globalAlpha = line.glowAlpha * 0.5;
                    for (const pt of [{ x: line.fromX, y: line.fromY }, { x: line.toX, y: line.toY }]) {
                        const ptGlow = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 8);
                        ptGlow.addColorStop(0, '#fff9c4');
                        ptGlow.addColorStop(1, '#fff9c400');
                        ctx.fillStyle = ptGlow;
                        ctx.beginPath();
                        ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
        }
    } else if (effect.phase === 'flash') {
        // 星座全体がキラッと光る
        const alpha = Math.sin(effect.progress * Math.PI) * 0.5;
        ctx.globalAlpha = alpha;

        for (const pos of effect.starPositions) {
            const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 35);
            glow.addColorStop(0, '#fff9c4');
            glow.addColorStop(0.4, '#ffe08260');
            glow.addColorStop(1, '#ffe08200');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 35, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (effect.phase === 'nameReveal') {
        // 星座名の表示
        const alpha = Math.min(effect.progress * 2, 1) * (effect.progress < 0.8 ? 1 : (1 - effect.progress) * 5);
        ctx.globalAlpha = alpha;

        // 中央に星座名
        const centerX = effect.starPositions.reduce((s, p) => s + p.x, 0) / effect.starPositions.length;
        const centerY = effect.starPositions.reduce((s, p) => s + p.y, 0) / effect.starPositions.length;

        ctx.font = '700 18px "Zen Maru Gothic", sans-serif';
        ctx.fillStyle = '#fff9c4';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#fff9c4';
        ctx.shadowBlur = 15;

        // 背景のにじみ
        const bgGlow = ctx.createRadialGradient(centerX, centerY - 25, 0, centerX, centerY - 25, 80);
        bgGlow.addColorStop(0, 'rgba(26, 20, 60, 0.6)');
        bgGlow.addColorStop(1, 'rgba(26, 20, 60, 0)');
        ctx.fillStyle = bgGlow;
        ctx.fillRect(centerX - 80, centerY - 50, 160, 50);

        ctx.fillStyle = '#fff9c4';
        ctx.fillText(`✧ ${effect.name} ✧`, centerX, centerY - 30);

        ctx.font = '400 12px "Zen Maru Gothic", sans-serif';
        ctx.fillStyle = '#c8bfe0';
        ctx.shadowBlur = 5;
        ctx.fillText('星座が完成しました', centerX, centerY - 10);
    }

    ctx.restore();
}

// ===== メイン描画関数 =====

export interface RenderState {
    stars: Star[];
    lines: { from: Star; to: Star }[];
    showConstellationLines: boolean;
    paperFragments: PaperFragment[];
    completionEffects: CompletionEffect[];
    skyThemePreset: SkyThemePreset;
    canvasWidth: number;
    canvasHeight: number;
    hoveredStarId: number | null;
    hoveredAchievementText: string | null;
    camera: { x: number; y: number; scale: number };
}

export function initRenderer(w: number, h: number): void {
    bgStars = generateBackgroundStars(w, h);
    shootingStars = [];
    nextShootingStarAt = 0;
}

export function resizeRenderer(w: number, h: number): void {
    bgStars = generateBackgroundStars(w, h);
    shootingStars = [];
    nextShootingStarAt = 0;
}

export function render(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
    time: number,
    dt: number,
): void {
    const { canvasWidth: w, canvasHeight: h, camera } = state;

    // クリア
    ctx.clearRect(0, 0, w, h);

    // 空のグラデーション（スクリーン空間）
    drawSkyGradient(ctx, w, h, state.skyThemePreset);

    // 紙テクスチャオーバーレイ（絵本風）
    drawTextureOverlay(ctx, w, h);

    // 雲（スクリーン空間）
    drawClouds(ctx, w, h, time);

    // 背景星（スクリーン空間）
    drawBackgroundStars(ctx, time);

    // 流れ星（スクリーン空間）
    if (nextShootingStarAt === 0) {
        scheduleNextShootingStar(time);
    }
    if (time >= nextShootingStarAt) {
        shootingStars.push(createShootingStar(w, h));
        scheduleNextShootingStar(time);
    }
    shootingStars = shootingStars.filter((star) => {
        updateShootingStar(star, dt);
        if (star.ageMs >= star.lifeMs) return false;
        if (star.x < -200 || star.y > h + 200) return false;
        drawShootingStar(ctx, star);
        return true;
    });

    // ===== ワールド空間（カメラ変換あり） =====
    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.scale, camera.scale);

    // 星座の線
    if (state.showConstellationLines) {
        for (const line of state.lines) {
            drawConstellationLine(ctx, line.from, line.to, time);
        }
    }

    // 星座星
    for (const star of state.stars) {
        drawConstellationStar(ctx, star, time, w, h);
    }

    // 紙片エフェクト
    for (const frag of state.paperFragments) {
        updatePaperFragment(frag, dt);
        drawPaperFragment(ctx, frag);
    }

    // 星座完成エフェクト
    for (const effect of state.completionEffects) {
        drawCompletionEffect(ctx, effect, w, h);
    }

    ctx.restore();
    // ===== ここまでワールド空間 =====

    // 地面（スクリーン空間・手前）
    drawGround(ctx, w, h, time);

    // ホバー中の星のツールチップ（スクリーン座標に変換）
    if (state.hoveredStarId !== null && state.hoveredAchievementText) {
        const star = state.stars.find((s) => s.id === state.hoveredStarId);
        if (star) {
            const sx = star.x * camera.scale + camera.x;
            const sy = star.y * camera.scale + camera.y;
            drawTooltip(ctx, sx, sy, state.hoveredAchievementText, w);
        }
    }
}

function drawTooltip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, canvasW: number): void {
    ctx.save();

    ctx.font = '400 13px "Zen Maru Gothic", sans-serif';
    const metrics = ctx.measureText(text);
    const textW = metrics.width;
    const padX = 12;
    const padY = 8;
    const boxW = textW + padX * 2;
    const boxH = 28;

    // 画面端でのはみ出し防止
    let boxX = x - boxW / 2;
    if (boxX < 8) boxX = 8;
    if (boxX + boxW > canvasW - 8) boxX = canvasW - 8 - boxW;
    const boxY = y - boxH - 15;

    // 背景（すりガラス風）
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#1a1535';
    ctx.beginPath();
    const r = 8;
    ctx.moveTo(boxX + r, boxY);
    ctx.lineTo(boxX + boxW - r, boxY);
    ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + r);
    ctx.lineTo(boxX + boxW, boxY + boxH - r);
    ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH);
    ctx.lineTo(boxX + r, boxY + boxH);
    ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - r);
    ctx.lineTo(boxX, boxY + r);
    ctx.quadraticCurveTo(boxX, boxY, boxX + r, boxY);
    ctx.closePath();
    ctx.fill();

    // ボーダー
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#c8bfe0';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // テキスト
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e8e0f0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, boxX + boxW / 2, boxY + boxH / 2);

    ctx.restore();
}
