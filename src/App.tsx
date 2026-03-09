import { useState, useRef, useEffect, useCallback } from 'react';
import { db } from './db';
import type { SkyPage, Star } from './db';
import { addStar, type AddStarStyle } from './starEngine';
import {
    render,
    initRenderer,
    resizeRenderer,
    createPaperFragment,
    type RenderState,
    type PaperFragment,
    type CompletionEffect,
    type CompletionEffectLine,
    type SkyThemePreset,
} from './renderer';
import './App.css';
import button01Url from '../assets/button01.png';
import button02Url from '../assets/button02.png';
import logoUrl from '../assets/logo.png';
import starChimeUrl from '../assets/VSQSE_0528_kiran_03.mp3';

type ViewMode = 'sky' | 'zukan';
const SKY_THEME_STORAGE_KEY = 'stardiary.skyThemePreset';
const CONSTELLATION_LINES_STORAGE_KEY = 'stardiary.showConstellationLines';
const SOUND_ENABLED_STORAGE_KEY = 'stardiary.soundEnabled';
const CURRENT_SKY_PAGE_STORAGE_KEY = 'stardiary.currentSkyPageId';
const DAILY_CHECKIN_LIMIT = 10;
const SKY_PAGE_LIMIT = 8;
const STAR_STORAGE_LIMIT = 600;
const STAR_DISPLAY_LIMIT = 120;

type ReflectionTab = {
    key: 'otsukare' | 'yokuyatta' | 'hokkori' | 'oyasumi';
    label: string;
    color: string;
    sizeRange: [number, number];
    brightnessRange: [number, number];
    phrases: string[];
};

type SkyPageSummary = {
    id: number;
    title: string;
    createdAt: Date;
};

const skyThemeOptions: { value: SkyThemePreset; label: string }[] = [
    { value: 'auto', label: 'おまかせ' },
    { value: 'spring', label: '春' },
    { value: 'summer', label: '夏' },
    { value: 'autumn', label: '秋' },
    { value: 'winter', label: '冬' },
];

const REFLECTION_TABS: ReflectionTab[] = [
    {
        key: 'otsukare',
        label: 'おつかれ',
        color: '#d8d0ff',
        sizeRange: [2.6, 3.5],
        brightnessRange: [0.82, 0.92],
        phrases: [
            '今日も無事に終わった',
            'ちゃんと息した',
            '美味しいものを食べた',
            'お風呂に入った',
            'とりあえず乗り切った',
            'いっぱい寝ていい日',
            'ただただ、おつかれさま',
        ],
    },
    {
        key: 'yokuyatta',
        label: 'よくやった',
        color: '#ffd0a8',
        sizeRange: [2.7, 3.6],
        brightnessRange: [0.86, 0.96],
        phrases: [
            '苦手なことを頑張った',
            'ちゃんと起きた',
            '外に出た',
            '誰かに優しくできた',
            '自分に優しくできた',
            'やるべきことをできた',
            '少しだけ前に進んだ',
            '今日もよくやった',
        ],
    },
    {
        key: 'hokkori',
        label: 'ほっこり',
        color: '#c9f2d8',
        sizeRange: [2.5, 3.3],
        brightnessRange: [0.82, 0.92],
        phrases: [
            'たくさん笑った',
            '好きなものに触れた',
            '空がきれいだった',
            '新しい出会いがあった',
            'ほっこりする時間があった',
        ],
    },
    {
        key: 'oyasumi',
        label: 'おやすみ',
        color: '#b9d9ff',
        sizeRange: [2.3, 3.1],
        brightnessRange: [0.78, 0.88],
        phrases: [
            '嫌なことは星に流そう',
            '今日のモヤモヤは宇宙の彼方へ',
            '今日はもう閉店',
            'ゆっくり布団に沈もう',
            'いい夢が見られそう',
            '明日は明日の風が吹く',
        ],
    },
];

function isSkyThemePreset(value: string): value is SkyThemePreset {
    return skyThemeOptions.some((option) => option.value === value);
}

function pickRandomInRange([min, max]: [number, number]): number {
    return min + Math.random() * (max - min);
}

function getDayRange(now = new Date()): { start: Date; end: Date } {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
}

function parseStoredSkyPageId(): number | null {
    const raw = localStorage.getItem(CURRENT_SKY_PAGE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getNextSkyTitle(pages: Array<Pick<SkyPage, 'title'>>): string {
    let maxNumber = 0;

    for (const page of pages) {
        const match = page.title.match(/^空\s+(\d+)$/);
        if (!match) continue;
        maxNumber = Math.max(maxNumber, Number(match[1]));
    }

    return `空 ${maxNumber + 1}`;
}

function App() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('sky');
    const [constellations, setConstellations] = useState<
        { id: number; name: string; completedAt?: Date }[]
    >([]);
    const [skyPages, setSkyPages] = useState<SkyPageSummary[]>([]);
    const [currentSkyId, setCurrentSkyId] = useState<number | null>(null);
    const [starCount, setStarCount] = useState(0);
    const [completionMessage, setCompletionMessage] = useState<string | null>(null);
    const [skyThemePreset, setSkyThemePreset] = useState<SkyThemePreset>('auto');
    const [isSkySettingsOpen, setIsSkySettingsOpen] = useState(false);
    const [isInputTrayOpen, setIsInputTrayOpen] = useState(false);
    const [isSkyUiHidden, setIsSkyUiHidden] = useState(false);
    const [isSkySharing, setIsSkySharing] = useState(false);
    const [showConstellationLines, setShowConstellationLines] = useState(true);
    const [isSoundEnabled, setIsSoundEnabled] = useState(true);
    const [todayCheckinCount, setTodayCheckinCount] = useState(0);
    const [expandedTabKey, setExpandedTabKey] = useState<ReflectionTab['key'] | null>(null);
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    const [isOtherSettingsOpen, setIsOtherSettingsOpen] = useState(false);

    // レンダリング状態
    const renderStateRef = useRef<RenderState>({
        stars: [],
        lines: [],
        showConstellationLines: true,
        paperFragments: [],
        completionEffects: [],
        skyThemePreset: 'auto',
        canvasWidth: 0,
        canvasHeight: 0,
        hoveredStarId: null,
        camera: { x: 0, y: 0, scale: 1 },
    });
    const animFrameRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);
    const starChimeAudioRef = useRef<HTMLAudioElement | null>(null);
    const lastChimeTimeRef = useRef(0);
    const isSkyShotBusyRef = useRef(false);
    const skyTapTimerRef = useRef<number | null>(null);
    const dragMovedRef = useRef(false);
    const toastTimerRef = useRef<number | null>(null);

    // パン・ズーム用Ref
    const isDraggingRef = useRef(false);
    const dragStartRef = useRef({ x: 0, y: 0, camX: 0, camY: 0 });

    const playStarChime = useCallback(() => {
        if (!isSoundEnabled) return;
        if (typeof Audio === 'undefined') return;

        const nowMs = performance.now();
        const minIntervalMs = 80;
        if (nowMs - lastChimeTimeRef.current < minIntervalMs) return;
        lastChimeTimeRef.current = nowMs;

        if (!starChimeAudioRef.current) {
            const audio = new Audio(starChimeUrl);
            audio.preload = 'auto';
            audio.volume = 0.38;
            starChimeAudioRef.current = audio;
        }

        const audio = starChimeAudioRef.current;
        audio.currentTime = 0;
        void audio.play().catch((err) => {
            console.error('Failed to play star chime sound:', err);
        });
    }, [isSoundEnabled]);

    const handleToggleInputTray = useCallback(() => {
        setIsInputTrayOpen((open) => {
            const nextOpen = !open;
            if (!nextOpen) {
                setExpandedTabKey(null);
            }
            return nextOpen;
        });
    }, []);

    const showToast = useCallback((message: string, durationMs = 3200) => {
        setCompletionMessage(message);
        if (toastTimerRef.current) {
            window.clearTimeout(toastTimerRef.current);
        }
        toastTimerRef.current = window.setTimeout(() => {
            setCompletionMessage(null);
            toastTimerRef.current = null;
        }, durationMs);
    }, []);

    const downloadBlob = useCallback((blob: Blob, fileName: string) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, []);

    const captureSkyBlob = useCallback(async (): Promise<Blob | null> => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
    }, []);

    const shareOrSaveSkyShot = useCallback(async () => {
        const blob = await captureSkyBlob();
        if (!blob) return;

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `stardiary-sky-${stamp}.png`;
        const file = new File([blob], fileName, { type: 'image/png' });
        const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
        const shareTitle = 'Star Diary';
        const shareText = '今日の星空 #StarDiaryApp';

        if (typeof nav.share === 'function') {
            const shareDataWithFile: ShareData = {
                files: [file],
                title: shareTitle,
                text: shareText,
            };
            const canShareFiles = typeof nav.canShare !== 'function' || nav.canShare({ files: [file] });
            if (canShareFiles) {
                try {
                    await nav.share(shareDataWithFile);
                    return;
                } catch (err) {
                    if (err instanceof DOMException && err.name === 'AbortError') return;
                    console.error('Failed to share sky screenshot:', err);
                }
            }

            try {
                await nav.share({ title: shareTitle, text: shareText });
                return;
            } catch (err) {
                if (err instanceof DOMException && err.name === 'AbortError') return;
                console.error('Failed to share sky text:', err);
            }
        }

        downloadBlob(blob, fileName);
    }, [captureSkyBlob, downloadBlob]);

    const handleSkyTapAction = useCallback(async () => {
        if (viewMode !== 'sky' || isSkyShotBusyRef.current) return;

        if (!isSkyUiHidden) {
            setIsSkySettingsOpen(false);
            setIsInputTrayOpen(false);
            setExpandedTabKey(null);
            setIsSkyUiHidden(true);
            return;
        }

        setIsSkyUiHidden(false);
    }, [isSkyUiHidden, viewMode]);

    const handleSkyShare = useCallback(async () => {
        if (isSkyShotBusyRef.current) return;
        isSkyShotBusyRef.current = true;
        setIsSkySharing(true);
        try {
            await shareOrSaveSkyShot();
        } finally {
            setIsSkySharing(false);
            isSkyShotBusyRef.current = false;
        }
    }, [shareOrSaveSkyShot]);

    // カメラのパン範囲を制限するヘルパー
    const clampCamera = useCallback(() => {
        const cam = renderStateRef.current.camera;
        const { canvasWidth: w, canvasHeight: h } = renderStateRef.current;
        const s = cam.scale;
        // ワールドが画面外に完全に消えないよう、余白を設ける
        const margin = 0.3; // 画面の30%分まではみ出しOK
        const minX = w * (1 - s) - w * margin;
        const maxX = w * margin;
        const minY = h * (1 - s) - h * margin;
        const maxY = h * margin;
        cam.x = Math.max(minX, Math.min(maxX, cam.x));
        cam.y = Math.max(minY, Math.min(maxY, cam.y));
    }, []);

    const resetSkyScene = useCallback(() => {
        renderStateRef.current.stars = [];
        renderStateRef.current.lines = [];
        renderStateRef.current.paperFragments = [];
        renderStateRef.current.completionEffects = [];
        renderStateRef.current.hoveredStarId = null;
        renderStateRef.current.camera = { x: 0, y: 0, scale: 1 };
        lastTimeRef.current = 0;
        setCompletionMessage(null);
    }, []);

    const deleteSkyPages = useCallback(async (skyIds: number[]) => {
        if (skyIds.length === 0) return;

        await db.transaction('rw', db.stars, db.constellationLines, db.constellations, db.skyPages, async () => {
            await Promise.all([
                db.constellationLines.where('skyId').anyOf(skyIds).delete(),
                db.constellations.where('skyId').anyOf(skyIds).delete(),
                db.stars.where('skyId').anyOf(skyIds).delete(),
            ]);
            await db.skyPages.bulkDelete(skyIds);
        });
    }, []);

    const syncSkyPages = useCallback(async (preferredSkyId?: number | null): Promise<number> => {
        let pages = await db.skyPages.orderBy('createdAt').toArray();

        if (pages.length === 0) {
            const now = new Date();
            const skyId = await db.skyPages.add({
                title: '空 1',
                createdAt: now,
                lastOpenedAt: now,
            });
            pages = await db.skyPages.orderBy('createdAt').toArray();
            if (!pages.some((page) => page.id === skyId)) {
                throw new Error('最初の空の作成に失敗しました');
            }
        }

        const removeSkyIds = new Set<number>();

        if (pages.length > SKY_PAGE_LIMIT) {
            for (const page of pages.slice(0, pages.length - SKY_PAGE_LIMIT)) {
                if (typeof page.id === 'number') {
                    removeSkyIds.add(page.id);
                }
            }
        }

        let totalStars = await db.stars.count();
        for (const page of pages) {
            if (totalStars <= STAR_STORAGE_LIMIT) break;
            if (typeof page.id !== 'number' || removeSkyIds.has(page.id)) continue;
            if (pages.length - removeSkyIds.size <= 1) break;

            const pageStarCount = await db.stars.where('skyId').equals(page.id).count();
            removeSkyIds.add(page.id);
            totalStars -= pageStarCount;
        }

        if (removeSkyIds.size > 0) {
            await deleteSkyPages([...removeSkyIds]);
            pages = await db.skyPages.orderBy('createdAt').toArray();
        }

        if (pages.length === 0) {
            const now = new Date();
            const skyId = await db.skyPages.add({
                title: '空 1',
                createdAt: now,
                lastOpenedAt: now,
            });
            pages = await db.skyPages.orderBy('createdAt').toArray();
            if (!pages.some((page) => page.id === skyId)) {
                throw new Error('空の復元に失敗しました');
            }
        }

        const storedSkyId = parseStoredSkyPageId();
        const activePage = pages.find((page) => page.id === preferredSkyId)
            ?? pages.find((page) => page.id === storedSkyId)
            ?? pages[pages.length - 1];

        if (!activePage || typeof activePage.id !== 'number') {
            throw new Error('現在の空を特定できません');
        }

        await db.skyPages.update(activePage.id, { lastOpenedAt: new Date() });

        setSkyPages(
            pages
                .filter((page): page is SkyPage & { id: number } => typeof page.id === 'number')
                .map((page) => ({
                    id: page.id,
                    title: page.title,
                    createdAt: page.createdAt,
                })),
        );
        setCurrentSkyId(activePage.id);
        localStorage.setItem(CURRENT_SKY_PAGE_STORAGE_KEY, String(activePage.id));

        return activePage.id;
    }, [deleteSkyPages]);

    // データ読み込み
    const loadData = useCallback(async (preferredSkyId?: number | null) => {
        const skyId = await syncSkyPages(preferredSkyId ?? currentSkyId);

        const allStars = await db.stars.where('skyId').equals(skyId).sortBy('createdAt');
        const visibleStars = allStars.slice(-STAR_DISPLAY_LIMIT);
        const starMap = new Map(visibleStars.map((star) => [star.id, star] as const));

        const allLines = await db.constellationLines.where('skyId').equals(skyId).toArray();
        const lines = allLines
            .map((line) => {
                const from = starMap.get(line.fromStarId);
                const to = starMap.get(line.toStarId);
                return from && to ? { from, to } : null;
            })
            .filter((line): line is { from: Star; to: Star } => line !== null);

        renderStateRef.current.stars = visibleStars;
        renderStateRef.current.lines = lines;
        setStarCount(allStars.length);

        const { start, end } = getDayRange();
        const todayCount = await db.stars
            .filter((star) => star.createdAt >= start && star.createdAt < end)
            .count();
        setTodayCheckinCount(todayCount);
    }, [currentSkyId, syncSkyPages]);

    // 図鑑データ読み込み
    const loadZukan = useCallback(async (preferredSkyId?: number | null) => {
        const skyId = await syncSkyPages(preferredSkyId ?? currentSkyId);
        const allConstellations = await db.constellations.where('skyId').equals(skyId).toArray();
        const completed = allConstellations.filter((c) => c.completedAt);

        const zukanData = completed.map((c) => ({
            id: c.id!,
            name: c.name,
            completedAt: c.completedAt,
        }));

        setConstellations(zukanData.sort((a, b) => {
            const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
            const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
            return dateB - dateA;
        }));
    }, [currentSkyId, syncSkyPages]);

    useEffect(() => {
        const storedValue = localStorage.getItem(SKY_THEME_STORAGE_KEY);
        if (storedValue && isSkyThemePreset(storedValue)) {
            setSkyThemePreset(storedValue);
        }

        const storedLineVisibility = localStorage.getItem(CONSTELLATION_LINES_STORAGE_KEY);
        if (storedLineVisibility === '0') {
            setShowConstellationLines(false);
        }

        const storedSoundEnabled = localStorage.getItem(SOUND_ENABLED_STORAGE_KEY);
        if (storedSoundEnabled === '0') {
            setIsSoundEnabled(false);
        }
    }, []);

    useEffect(() => {
        renderStateRef.current.skyThemePreset = skyThemePreset;
        localStorage.setItem(SKY_THEME_STORAGE_KEY, skyThemePreset);
    }, [skyThemePreset]);

    useEffect(() => {
        renderStateRef.current.showConstellationLines = showConstellationLines;
        localStorage.setItem(CONSTELLATION_LINES_STORAGE_KEY, showConstellationLines ? '1' : '0');
    }, [showConstellationLines]);

    useEffect(() => {
        localStorage.setItem(SOUND_ENABLED_STORAGE_KEY, isSoundEnabled ? '1' : '0');
        if (!isSoundEnabled && starChimeAudioRef.current) {
            starChimeAudioRef.current.pause();
            starChimeAudioRef.current.currentTime = 0;
        }
    }, [isSoundEnabled]);

    useEffect(() => {
        if (viewMode !== 'sky') {
            setIsSkySettingsOpen(false);
            setIsInputTrayOpen(false);
            setIsSkyUiHidden(false);
            setExpandedTabKey(null);
        }
    }, [viewMode]);

    // Canvas初期化
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const resize = () => {
            const dpr = window.devicePixelRatio || 1;
            const w = window.innerWidth;
            const h = window.innerHeight;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.scale(dpr, dpr);

            renderStateRef.current.canvasWidth = w;
            renderStateRef.current.canvasHeight = h;
            resizeRenderer(w, h);
        };

        resize();
        initRenderer(window.innerWidth, window.innerHeight);
        window.addEventListener('resize', resize);

        return () => {
            window.removeEventListener('resize', resize);
        };
    }, []);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    useEffect(() => {
        if (viewMode !== 'zukan') return;
        void loadZukan();
    }, [loadZukan, viewMode]);

    // アニメーションループ
    useEffect(() => {
        if (viewMode !== 'sky') {
            cancelAnimationFrame(animFrameRef.current);
            return;
        }

        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx) return;

        const animate = (time: number) => {
            const dt = lastTimeRef.current ? time - lastTimeRef.current : 16;
            lastTimeRef.current = time;

            // 完了したエフェクトを除去
            renderStateRef.current.paperFragments = renderStateRef.current.paperFragments.filter(
                (f) => f.phase !== 'done',
            );
            renderStateRef.current.completionEffects = renderStateRef.current.completionEffects.filter(
                (e) => e.phase !== 'done',
            );

            // 星座完成エフェクトの更新
            for (const effect of renderStateRef.current.completionEffects) {
                effect.progress += dt * 0.001;
                if (effect.phase === 'lineDrawing' && effect.progress >= effect.totalLineDuration) {
                    effect.phase = 'flash';
                    effect.progress = 0;
                } else if (effect.phase === 'flash' && effect.progress >= 1) {
                    effect.phase = 'nameReveal';
                    effect.progress = 0;
                } else if (effect.phase === 'nameReveal' && effect.progress >= 1.5) {
                    effect.phase = 'done';
                }
            }

            render(ctx, renderStateRef.current, time, dt);
            animFrameRef.current = requestAnimationFrame(animate);
        };

        animFrameRef.current = requestAnimationFrame(animate);

        return () => cancelAnimationFrame(animFrameRef.current);
    }, [viewMode]);

    useEffect(() => () => {
        if (skyTapTimerRef.current) {
            window.clearTimeout(skyTapTimerRef.current);
            skyTapTimerRef.current = null;
        }
        if (toastTimerRef.current) {
            window.clearTimeout(toastTimerRef.current);
            toastTimerRef.current = null;
        }
        if (starChimeAudioRef.current) {
            starChimeAudioRef.current.pause();
            starChimeAudioRef.current = null;
        }
    }, []);

    // 星のホバー判定（ワールド座標で検索）
    const handleCanvasInteraction = useCallback(
        (clientX: number, clientY: number) => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const rect = canvas.getBoundingClientRect();
            const screenX = clientX - rect.left;
            const screenY = clientY - rect.top;

            // スクリーン→ワールド座標変換
            const cam = renderStateRef.current.camera;
            const worldX = (screenX - cam.x) / cam.scale;
            const worldY = (screenY - cam.y) / cam.scale;

            let closestStar: Star | null = null;
            let closestDist = 25 / cam.scale;

            for (const star of renderStateRef.current.stars) {
                const dist = Math.hypot(star.x - worldX, star.y - worldY);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestStar = star;
                }
            }

            if (closestStar) {
                renderStateRef.current.hoveredStarId = closestStar.id!;
            } else {
                renderStateRef.current.hoveredStarId = null;
            }
        },
        [],
    );

    // マウスドラッグ（パン）
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        isDraggingRef.current = true;
        dragMovedRef.current = false;
        const cam = renderStateRef.current.camera;
        dragStartRef.current = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y };
    }, []);

    const handleMouseUp = useCallback(() => { isDraggingRef.current = false; }, []);

    const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
        if (isDraggingRef.current) {
            const cam = renderStateRef.current.camera;
            if (Math.hypot(e.clientX - dragStartRef.current.x, e.clientY - dragStartRef.current.y) > 4) {
                dragMovedRef.current = true;
            }
            cam.x = dragStartRef.current.camX + (e.clientX - dragStartRef.current.x);
            cam.y = dragStartRef.current.camY + (e.clientY - dragStartRef.current.y);
            clampCamera();
        } else {
            handleCanvasInteraction(e.clientX, e.clientY);
        }
    }, [clampCamera, handleCanvasInteraction]);

    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (viewMode !== 'sky' || e.button !== 0) return;
        if (dragMovedRef.current) {
            dragMovedRef.current = false;
            return;
        }

        if (skyTapTimerRef.current) {
            window.clearTimeout(skyTapTimerRef.current);
        }
        skyTapTimerRef.current = window.setTimeout(() => {
            skyTapTimerRef.current = null;
            void handleSkyTapAction();
        }, 220);
    }, [handleSkyTapAction, viewMode]);

    // ダブルクリックでカメラリセット
    const handleDoubleClick = useCallback(() => {
        if (skyTapTimerRef.current) {
            window.clearTimeout(skyTapTimerRef.current);
            skyTapTimerRef.current = null;
        }
        const cam = renderStateRef.current.camera;
        cam.x = 0; cam.y = 0; cam.scale = 1;
    }, []);

    // タッチ・ホイールイベント（passive:false が必要なため useEffect で直接登録）
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        let pinchStartDist = 0, pinchStartScale = 1, pinchMidX = 0, pinchMidY = 0;
        let panStartX = 0, panStartY = 0, panStartCamX = 0, panStartCamY = 0;
        let isPanning = false;
        let lastTapTime = 0;

        const clampInline = () => {
            const cam = renderStateRef.current.camera;
            const { canvasWidth: w, canvasHeight: h } = renderStateRef.current;
            const s = cam.scale;
            const margin = 0.3;
            cam.x = Math.max(w * (1 - s) - w * margin, Math.min(w * margin, cam.x));
            cam.y = Math.max(h * (1 - s) - h * margin, Math.min(h * margin, cam.y));
        };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const cam = renderStateRef.current.camera;
            const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
            const newScale = Math.max(0.35, Math.min(2.5, cam.scale * factor));
            const rect = canvas.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            cam.x = px - (px - cam.x) * newScale / cam.scale;
            cam.y = py - (py - cam.y) * newScale / cam.scale;
            cam.scale = newScale;
            clampInline();
        };

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 1) {
                const now = Date.now();
                if (now - lastTapTime < 300) {
                    // ダブルタップでカメラリセット
                    const cam = renderStateRef.current.camera;
                    cam.x = 0; cam.y = 0; cam.scale = 1;
                }
                lastTapTime = now;
                isPanning = true;
                panStartX = e.touches[0].clientX;
                panStartY = e.touches[0].clientY;
                panStartCamX = renderStateRef.current.camera.x;
                panStartCamY = renderStateRef.current.camera.y;
            } else if (e.touches.length === 2) {
                isPanning = false;
                const t1 = e.touches[0], t2 = e.touches[1];
                pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                pinchStartScale = renderStateRef.current.camera.scale;
                const rect = canvas.getBoundingClientRect();
                pinchMidX = (t1.clientX + t2.clientX) / 2 - rect.left;
                pinchMidY = (t1.clientY + t2.clientY) / 2 - rect.top;
            }
        };

        const onTouchMove = (e: TouchEvent) => {
            e.preventDefault();
            const cam = renderStateRef.current.camera;
            if (e.touches.length === 1 && isPanning) {
                cam.x = panStartCamX + (e.touches[0].clientX - panStartX);
                cam.y = panStartCamY + (e.touches[0].clientY - panStartY);
                clampInline();
            } else if (e.touches.length === 2 && pinchStartDist > 0) {
                const t1 = e.touches[0], t2 = e.touches[1];
                const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                const newScale = Math.max(0.35, Math.min(2.5, pinchStartScale * dist / pinchStartDist));
                cam.x = pinchMidX - (pinchMidX - cam.x) * newScale / cam.scale;
                cam.y = pinchMidY - (pinchMidY - cam.y) * newScale / cam.scale;
                cam.scale = newScale;
                clampInline();
            }
        };

        const onTouchEnd = (e: TouchEvent) => {
            if (e.touches.length === 0) { isPanning = false; pinchStartDist = 0; }
            else if (e.touches.length === 1) {
                isPanning = true;
                panStartX = e.touches[0].clientX;
                panStartY = e.touches[0].clientY;
                panStartCamX = renderStateRef.current.camera.x;
                panStartCamY = renderStateRef.current.camera.y;
                pinchStartDist = 0;
            }
        };

        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('touchstart', onTouchStart, { passive: true });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd, { passive: true });
        return () => {
            canvas.removeEventListener('wheel', onWheel);
            canvas.removeEventListener('touchstart', onTouchStart);
            canvas.removeEventListener('touchmove', onTouchMove);
            canvas.removeEventListener('touchend', onTouchEnd);
        };
    }, []);

    const handleCheckin = useCallback(
        async (tab: ReflectionTab, phrase: string) => {
            if (isSubmitting) return;
            if (currentSkyId === null) return;

            if (todayCheckinCount >= DAILY_CHECKIN_LIMIT) {
                showToast(`今日は${DAILY_CHECKIN_LIMIT}個まで星を追加できます。続きは明日。`, 3600);
                return;
            }

            setIsSubmitting(true);
            const checkinAt = new Date();

            try {
                const { canvasWidth, canvasHeight } = renderStateRef.current;
                const starStyle: AddStarStyle = {
                    color: tab.color,
                    size: pickRandomInRange(tab.sizeRange),
                    brightness: pickRandomInRange(tab.brightnessRange),
                };

                const result = await addStar(currentSkyId, canvasWidth, canvasHeight, starStyle, checkinAt);

                const checkinPanel = document.getElementById('checkin-panel');
                const panelRect = checkinPanel?.getBoundingClientRect();
                const screenStartX = panelRect ? panelRect.left + panelRect.width / 2 : canvasWidth / 2;
                const screenStartY = panelRect ? panelRect.top + panelRect.height * 0.5 : canvasHeight * 0.82;
                const cam = renderStateRef.current.camera;
                const worldStartX = (screenStartX - cam.x) / cam.scale;
                const worldStartY = (screenStartY - cam.y) / cam.scale;

                const fragment = createPaperFragment(worldStartX, worldStartY, result.star.x, result.star.y);
                renderStateRef.current.paperFragments.push(fragment);

                setTodayCheckinCount((count) => Math.min(DAILY_CHECKIN_LIMIT, count + 1));
                setExpandedTabKey(null);
                // 紙片エフェクト後に星を反映
                await new Promise<void>((resolve) => {
                    window.setTimeout(() => resolve(), 1200);
                });

                await loadData(currentSkyId);
                playStarChime();

                if (result.constellationCompleted && result.constellationName) {
                    const starsInConstellation = renderStateRef.current.stars.filter(
                        (s) => s.constellationId === result.star.constellationId,
                    );

                    const constellationLines = renderStateRef.current.lines.filter(
                        (line) => line.from.constellationId === result.star.constellationId
                            || line.to.constellationId === result.star.constellationId,
                    );

                    const LINE_STAGGER = 0.3;
                    const LINE_DRAW_DURATION = 0.4;
                    const effectLines: CompletionEffectLine[] = constellationLines.map((line, i) => ({
                        fromX: line.from.x,
                        fromY: line.from.y,
                        toX: line.to.x,
                        toY: line.to.y,
                        drawProgress: 0,
                        startDelay: i * LINE_STAGGER,
                        glowAlpha: 1,
                    }));

                    const totalLineDuration = effectLines.length > 0
                        ? (effectLines.length - 1) * LINE_STAGGER + LINE_DRAW_DURATION + 0.3
                        : 0.5;

                    const completionEffect: CompletionEffect = {
                        constellationId: result.star.constellationId!,
                        name: result.constellationName,
                        progress: 0,
                        phase: 'lineDrawing',
                        starPositions: starsInConstellation.map((s) => ({ x: s.x, y: s.y })),
                        lines: effectLines,
                        totalLineDuration,
                    };

                    renderStateRef.current.completionEffects.push(completionEffect);

                    const toastDelay = totalLineDuration * 1000 + 800;
                    window.setTimeout(() => {
                        showToast(
                            `✨ ${result.constellationName} が完成しました！`,
                            4000,
                        );
                    }, toastDelay);
                }
            } catch (err) {
                console.error('Failed to add star:', err);
                showToast('星の追加に失敗しました。時間をおいて再試行してください。', 3200);
            } finally {
                setIsSubmitting(false);
            }
        },
        [currentSkyId, isSubmitting, loadData, playStarChime, showToast, todayCheckinCount],
    );

    const handleClearAllData = useCallback(async () => {
        if (isSubmitting || starCount === 0) return;

        const shouldClear = window.confirm('記録したすべての星と空を削除します。よろしいですか？');
        if (!shouldClear) return;

        try {
            await db.transaction('rw', db.stars, db.constellationLines, db.constellations, db.skyPages, async () => {
                await Promise.all([
                    db.constellationLines.clear(),
                    db.stars.clear(),
                    db.constellations.clear(),
                    db.skyPages.clear(),
                ]);
            });

            resetSkyScene();
            setStarCount(0);
            setConstellations([]);
            setSkyPages([]);
            setCurrentSkyId(null);
            setTodayCheckinCount(0);
            localStorage.removeItem(CURRENT_SKY_PAGE_STORAGE_KEY);

            await loadData();
            if (viewMode === 'zukan') {
                await loadZukan();
            }
        } catch (err) {
            console.error('Failed to clear all data:', err);
        }
    }, [isSubmitting, loadData, loadZukan, resetSkyScene, starCount, viewMode]);

    const handleSelectSky = useCallback(async (skyId: number) => {
        if (skyId === currentSkyId) return;

        resetSkyScene();
        setConstellations([]);
        setIsSkySettingsOpen(false);
        setIsInputTrayOpen(false);
        setExpandedTabKey(null);

        await loadData(skyId);
        if (viewMode === 'zukan') {
            await loadZukan(skyId);
        }
    }, [currentSkyId, loadData, loadZukan, resetSkyScene, viewMode]);

    const handleCreateNewSky = useCallback(async () => {
        if (isSubmitting) return;

        const pages = await db.skyPages.orderBy('createdAt').toArray();
        const now = new Date();
        const nextSkyId = await db.skyPages.add({
            title: getNextSkyTitle(pages),
            createdAt: now,
            lastOpenedAt: now,
        });

        resetSkyScene();
        setConstellations([]);
        setIsSkySettingsOpen(false);
        setIsInputTrayOpen(false);
        setExpandedTabKey(null);

        await loadData(nextSkyId);
        if (viewMode === 'zukan') {
            await loadZukan(nextSkyId);
        }
        showToast('新しい空を用意しました。', 2400);
    }, [isSubmitting, loadData, loadZukan, resetSkyScene, showToast, viewMode]);

    const currentSkyIndex = skyPages.findIndex((sky) => sky.id === currentSkyId);
    const currentSkyTitle = currentSkyIndex >= 0 ? skyPages[currentSkyIndex].title : '空 1';
    const canMoveToPrevSky = currentSkyIndex > 0;
    const canMoveToNextSky = currentSkyIndex >= 0 && currentSkyIndex < skyPages.length - 1;
    const currentSkyProgressText = skyPages.length > 0 && currentSkyIndex >= 0
        ? `${currentSkyIndex + 1} / ${skyPages.length}`
        : '1 / 1';
    const canResetAllData = skyPages.length > 1 || starCount > 0;

    const handleDeleteCurrentSky = useCallback(async () => {
        if (isSubmitting || currentSkyId === null) return;

        const shouldDelete = window.confirm(
            `「${currentSkyTitle}」を削除します。\nこの空にある星もすべて消えますがよろしいですか？`,
        );
        if (!shouldDelete) return;

        const remainingSkyPages = skyPages.filter((sky) => sky.id !== currentSkyId);
        const fallbackSkyId = remainingSkyPages[Math.max(0, currentSkyIndex - 1)]?.id
            ?? remainingSkyPages[0]?.id
            ?? null;

        try {
            resetSkyScene();
            setConstellations([]);
            setStarCount(0);
            setTodayCheckinCount(0);
            setCurrentSkyId(null);
            localStorage.removeItem(CURRENT_SKY_PAGE_STORAGE_KEY);

            await deleteSkyPages([currentSkyId]);

            if (fallbackSkyId !== null) {
                await loadData(fallbackSkyId);
                if (viewMode === 'zukan') {
                    await loadZukan(fallbackSkyId);
                }
            } else {
                await loadData();
                if (viewMode === 'zukan') {
                    await loadZukan();
                }
            }

            showToast(`「${currentSkyTitle}」を削除しました。`, 2400);
        } catch (err) {
            console.error('Failed to delete current sky:', err);
            showToast('空の削除に失敗しました。時間をおいて再試行してください。', 3200);
        }
    }, [
        currentSkyId,
        currentSkyIndex,
        currentSkyTitle,
        deleteSkyPages,
        isSubmitting,
        loadData,
        loadZukan,
        resetSkyScene,
        showToast,
        skyPages,
        viewMode,
    ]);

    const isSkyUiSlideHidden = viewMode === 'sky' && isSkyUiHidden;
    const isDailyLimitReached = todayCheckinCount >= DAILY_CHECKIN_LIMIT;
    const checkinDisabled = isSubmitting || isDailyLimitReached;
    const expandedTab = expandedTabKey
        ? REFLECTION_TABS.find((tab) => tab.key === expandedTabKey) ?? null
        : null;
    const isCheckinSubmenuOpen = viewMode === 'sky' && expandedTab !== null;
    const showHelpFab = !isCheckinSubmenuOpen && !(viewMode === 'sky' && isSkyUiHidden);
    const checkinStatusText = isDailyLimitReached
        ? '星にしたい言葉を選ぶ　明日また追加できます。'
        : isSubmitting
            ? '星を描いています…'
            : expandedTab
                ? `「${expandedTab.label}」から言葉を選べます。`
                : 'タブを押すと、言葉の候補が開きます。※星ができるときに音が出ます';

    return (
        <div className={`app ${isInputTrayOpen ? 'input-tray-open' : ''}`}>
            {/* 星空Canvas */}
            <canvas
                ref={canvasRef}
                className="sky-canvas"
                onMouseDown={handleMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleMouseUp}
                onClick={handleCanvasClick}
                onDoubleClick={handleDoubleClick}
                onMouseLeave={() => {
                    isDraggingRef.current = false;
                    dragMovedRef.current = false;
                    renderStateRef.current.hoveredStarId = null;
                }}
            />

            {/* ヘッダー */}
            <div className={`sky-top-ui-layer ${isSkyUiSlideHidden ? 'sky-ui-hidden' : ''}`}>
                <header className="app-header">
                    <div className="header-left">
                        <h1 className="app-title">
                            <img src={logoUrl} alt="Star Diary" className="app-logo" />
                        </h1>
                    </div>
                    <nav className="header-nav">
                        <button
                            className={`nav-btn nav-btn-img ${viewMode === 'sky' ? 'active' : ''}`}
                            onClick={() => setViewMode('sky')}
                            aria-label="夜空"
                        >
                            <img src={button01Url} alt="夜空" className="nav-btn-image" />
                        </button>
                        <button
                            className={`nav-btn nav-btn-img ${viewMode === 'zukan' ? 'active' : ''}`}
                            onClick={() => setViewMode('zukan')}
                            aria-label="図鑑"
                        >
                            <img src={button02Url} alt="図鑑" className="nav-btn-image" />
                        </button>
                    </nav>
                </header>
                {/* 星座完成メッセージ */}
                {completionMessage && (
                    <div className="completion-toast">
                        {completionMessage}
                    </div>
                )}
            </div>

            {/* チェックイン・設定（星空ビューのみ） */}
            {viewMode === 'sky' && (
                <div className={`sky-bottom-ui-layer ${isSkyUiSlideHidden ? 'sky-ui-hidden' : ''}`}>
                    <div className={`input-form ${isInputTrayOpen ? 'open' : ''}`}>
                        <button
                            type="button"
                            className="input-form-handle"
                            onClick={handleToggleInputTray}
                            aria-expanded={isInputTrayOpen}
                            aria-controls="input-tray-content"
                            aria-label={isInputTrayOpen ? 'チェックイントレイを閉じる' : 'チェックイントレイを開く'}
                        >
                            {isInputTrayOpen ? '↓' : '↑'}
                        </button>

                        <div id="input-tray-content" className="input-form-content">
                            <div id="checkin-panel" className="checkin-panel">
                                <div className="checkin-panel-content">
                                    <p className="checkin-title">星にしたい言葉を選ぶ</p>
                                    <p className="checkin-counter">{todayCheckinCount} / {DAILY_CHECKIN_LIMIT}</p>
                                    <div className="checkin-tab-area">
                                        {expandedTab && (
                                            <div className="checkin-submenu" role="listbox" aria-label={`${expandedTab.label} の言葉一覧`}>
                                                {expandedTab.phrases.map((phrase) => (
                                                    <button
                                                        key={phrase}
                                                        type="button"
                                                        className="checkin-subitem-btn"
                                                        onClick={() => void handleCheckin(expandedTab, phrase)}
                                                        disabled={checkinDisabled}
                                                    >
                                                        {phrase}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        <div className="checkin-tab-row">
                                            {REFLECTION_TABS.map((tab) => (
                                                <button
                                                    key={tab.key}
                                                    type="button"
                                                    className={`checkin-tab-btn ${expandedTabKey === tab.key ? 'active' : ''}`}
                                                    onClick={() => {
                                                        if (isSubmitting) return;
                                                        setExpandedTabKey((current) => (current === tab.key ? null : tab.key));
                                                    }}
                                                    disabled={isSubmitting}
                                                >
                                                    <span
                                                        className="checkin-option-dot"
                                                        style={{ backgroundColor: tab.color }}
                                                        aria-hidden="true"
                                                    />
                                                    {tab.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <p className="checkin-note">{checkinStatusText}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {isSkySettingsOpen && (
                        <button
                            type="button"
                            className="sky-settings-backdrop"
                            aria-label="設定を閉じる"
                            onClick={() => setIsSkySettingsOpen(false)}
                        />
                    )}

                    <div className={`sky-settings-sheet ${isSkySettingsOpen ? 'open' : ''}`}>
                        <p className="sky-settings-title">表示設定</p>

                        <div className="sky-settings-section">
                            <p className="sky-settings-section-title">空の色</p>
                            <div className="sky-theme-options">
                                {skyThemeOptions.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        className={`sky-theme-option ${skyThemePreset === option.value ? 'active' : ''}`}
                                        onClick={() => {
                                            setSkyThemePreset(option.value);
                                        }}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="sky-settings-section">
                            <p className="sky-settings-section-title">星座の線</p>
                            <div className="sky-line-options">
                                <button
                                    type="button"
                                    className={`sky-line-option ${showConstellationLines ? 'active' : ''}`}
                                    onClick={() => setShowConstellationLines(true)}
                                >
                                    表示
                                </button>
                                <button
                                    type="button"
                                    className={`sky-line-option ${showConstellationLines ? '' : 'active'}`}
                                    onClick={() => setShowConstellationLines(false)}
                                >
                                    非表示
                                </button>
                            </div>
                        </div>

                        <div className="sky-settings-section">
                            <p className="sky-settings-section-title">効果音</p>
                            <div className="sky-line-options">
                                <button
                                    type="button"
                                    className={`sky-line-option ${isSoundEnabled ? 'active' : ''}`}
                                    onClick={() => setIsSoundEnabled(true)}
                                >
                                    オン
                                </button>
                                <button
                                    type="button"
                                    className={`sky-line-option ${isSoundEnabled ? '' : 'active'}`}
                                    onClick={() => setIsSoundEnabled(false)}
                                >
                                    オフ
                                </button>
                            </div>
                        </div>
                    </div>

                    {!isCheckinSubmenuOpen && (
                        <button
                            type="button"
                            className={`sky-settings-fab ${isSkySettingsOpen ? 'active' : ''}`}
                            onClick={() => setIsSkySettingsOpen((open) => !open)}
                            aria-label="表示設定を開く"
                        >
                            ⚙ 設定
                        </button>
                    )}
                </div>
            )}

            {viewMode === 'sky' && isSkyUiHidden && (
                <button
                    type="button"
                    className="sky-share-fab"
                    onClick={() => void handleSkyShare()}
                    disabled={isSkySharing}
                    aria-label="この空をシェア"
                >
                    <svg className="sky-share-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <line x1="8.5" y1="11.2" x2="14.8" y2="7.4" />
                        <line x1="8.5" y1="12.8" x2="14.8" y2="16.6" />
                        <circle cx="6" cy="12" r="3.1" />
                        <circle cx="18" cy="6" r="3.1" />
                        <circle cx="18" cy="18" r="3.1" />
                    </svg>
                </button>
            )}

            {/* 図鑑ビュー */}
            {viewMode === 'zukan' && (
                <div className="zukan-view">
                    <div className="zukan-container">
                        <div className="zukan-meta">
                            <div className="zukan-meta-main">
                                <span className="zukan-sky-title">{currentSkyTitle}</span>
                                <span className="zukan-sky-count">{currentSkyProgressText}</span>
                                <span className="star-counter">星の数 {starCount}</span>
                            </div>
                            <div className="zukan-sky-controls">
                                <button
                                    type="button"
                                    className="zukan-sky-btn"
                                    onClick={() => {
                                        if (!canMoveToPrevSky) return;
                                        void handleSelectSky(skyPages[currentSkyIndex - 1].id);
                                    }}
                                    disabled={!canMoveToPrevSky}
                                >
                                    前の空
                                </button>
                                <button
                                    type="button"
                                    className="zukan-sky-btn"
                                    onClick={() => {
                                        if (!canMoveToNextSky) return;
                                        void handleSelectSky(skyPages[currentSkyIndex + 1].id);
                                    }}
                                    disabled={!canMoveToNextSky}
                                >
                                    次の空
                                </button>
                            </div>
                        </div>

                        {constellations.length === 0 ? (
                            <div className="zukan-empty">
                                <p className="zukan-empty-icon">🌌</p>
                                <p>{currentSkyTitle} にはまだ星座がありません</p>
                                <p className="zukan-empty-hint">星を5つ追加すると、この空の最初の星座が完成します</p>
                            </div>
                        ) : (
                            <div className="zukan-grid">
                                {constellations.map((c) => (
                                    <div key={c.id} className="zukan-card">
                                        <div className="zukan-card-header">
                                            <span className="zukan-card-label">架空</span>
                                            <span className="zukan-card-date">
                                                {c.completedAt
                                                    ? new Date(c.completedAt).toLocaleDateString('ja-JP')
                                                    : ''}
                                            </span>
                                        </div>
                                        <h3 className="zukan-card-name">{c.name}</h3>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="zukan-footer">
                            <button
                                className="nav-btn zukan-new-sky-btn"
                                onClick={() => void handleCreateNewSky()}
                                disabled={isSubmitting}
                                title="新しい空をつくる"
                                aria-label="新しい空をつくる"
                            >
                                新しい空をつくる
                            </button>
                            <button
                                className="nav-btn danger zukan-delete-sky-btn"
                                onClick={() => void handleDeleteCurrentSky()}
                                disabled={isSubmitting || currentSkyId === null}
                                title="この空を削除"
                                aria-label="この空を削除"
                            >
                                この空を削除
                            </button>
                            <button
                                className="nav-btn zukan-other-settings-btn"
                                onClick={() => setIsOtherSettingsOpen(true)}
                                disabled={isSubmitting}
                                title="その他の設定"
                                aria-label="その他の設定"
                            >
                                その他の設定
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isOtherSettingsOpen && (
                <div className="other-settings-overlay" onClick={() => setIsOtherSettingsOpen(false)}>
                    <div className="other-settings-modal" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            className="other-settings-close-btn"
                            onClick={() => setIsOtherSettingsOpen(false)}
                            aria-label="閉じる"
                        >
                            ✕
                        </button>
                        <h2 className="other-settings-title">その他の設定</h2>
                        <p className="other-settings-note">この操作は元に戻せません。</p>
                        <button
                            type="button"
                            className="other-settings-reset-btn"
                            onClick={() => {
                                setIsOtherSettingsOpen(false);
                                handleClearAllData();
                            }}
                            disabled={isSubmitting || !canResetAllData}
                        >
                            すべての星と空をリセット
                        </button>
                    </div>
                </div>
            )}

            {/* ヘルプボタン */}
            {showHelpFab && (
                <button
                    type="button"
                    className="help-fab"
                    onClick={() => setIsHelpOpen(true)}
                    aria-label="使い方を見る"
                >
                    ?
                </button>
            )}

            {/* ヘルプモーダル */}
            {isHelpOpen && (
                <div className="help-overlay" onClick={() => setIsHelpOpen(false)}>
                    <div className="help-modal" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            className="help-close-btn"
                            onClick={() => setIsHelpOpen(false)}
                            aria-label="閉じる"
                        >
                            ✕
                        </button>
                        <h2 className="help-modal-title">つかいかた</h2>
                        <div className="help-steps">
                            <div className="help-step">
                                <span className="help-step-number">1．</span>
                                <p className="help-step-text">
                                    星にしたい言葉を選ぶと<br />星ができます。
                                </p>
                            </div>
                            <div className="help-step">
                                <span className="help-step-number">2．</span>
                                <p className="help-step-text">
                                    星が５つできると<br />星座になります。
                                </p>
                            </div>
                            <div className="help-step">
                                <span className="help-step-number">3．</span>
                                <p className="help-step-text">
                                    あなただけの星空を<br />作ってみましょう。
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            className="help-ok-btn"
                            onClick={() => setIsHelpOpen(false)}
                        >
                            はじめる ✦
                        </button>
                        <p className="help-about-meta">
                            <a
                                href="/terms.html"
                                className="help-about-link"
                                target="_blank"
                                rel="noreferrer"
                            >
                                このアプリについて　powered by tane
                            </a>
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
