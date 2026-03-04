import { useState, useRef, useEffect, useCallback } from 'react';
import { db } from './db';
import type { Star } from './db';
import { addStar } from './starEngine';
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
import paperUrl from '../assets/paper.png';
import sousinUrl from '../assets/sousin.png';
import inputTrayFlipUrl from '../assets/Book01-1(Flip).mp3';
import starChimeUrl from '../assets/VSQSE_0528_kiran_03.mp3';

type ViewMode = 'sky' | 'zukan';
const SKY_THEME_STORAGE_KEY = 'stardiary.skyThemePreset';
const CONSTELLATION_LINES_STORAGE_KEY = 'stardiary.showConstellationLines';

const skyThemeOptions: { value: SkyThemePreset; label: string }[] = [
    { value: 'auto', label: 'おまかせ' },
    { value: 'spring', label: '春' },
    { value: 'summer', label: '夏' },
    { value: 'autumn', label: '秋' },
    { value: 'winter', label: '冬' },
];

function isSkyThemePreset(value: string): value is SkyThemePreset {
    return skyThemeOptions.some((option) => option.value === value);
}

function App() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [inputText, setInputText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('sky');
    const [constellations, setConstellations] = useState<
        { id: number; name: string; isReal: boolean; completedAt?: Date; achievements: string[] }[]
    >([]);
    const [starCount, setStarCount] = useState(0);
    const [completionMessage, setCompletionMessage] = useState<string | null>(null);
    const [skyThemePreset, setSkyThemePreset] = useState<SkyThemePreset>('auto');
    const [isSkySettingsOpen, setIsSkySettingsOpen] = useState(false);
    const [isInputTrayOpen, setIsInputTrayOpen] = useState(false);
    const [isSkyUiHidden, setIsSkyUiHidden] = useState(false);
    const [isSkySharing, setIsSkySharing] = useState(false);
    const [showConstellationLines, setShowConstellationLines] = useState(true);

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
        hoveredAchievementText: null,
        camera: { x: 0, y: 0, scale: 1 },
    });
    const animFrameRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);
    const inputTrayAudioRef = useRef<HTMLAudioElement | null>(null);
    const starChimeAudioRef = useRef<HTMLAudioElement | null>(null);
    const lastChimeTimeRef = useRef(0);
    const isSkyShotBusyRef = useRef(false);
    const skyTapTimerRef = useRef<number | null>(null);
    const dragMovedRef = useRef(false);

    // パン・ズーム用Ref
    const isDraggingRef = useRef(false);
    const dragStartRef = useRef({ x: 0, y: 0, camX: 0, camY: 0 });

    const playStarChime = useCallback(() => {
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
    }, []);

    const playInputTrayFlip = useCallback(() => {
        if (typeof Audio === 'undefined') return;

        if (!inputTrayAudioRef.current) {
            const audio = new Audio(inputTrayFlipUrl);
            audio.preload = 'auto';
            audio.volume = 0.45;
            inputTrayAudioRef.current = audio;
        }

        const audio = inputTrayAudioRef.current;
        audio.currentTime = 0;
        void audio.play().catch((err) => {
            console.error('Failed to play input tray sound:', err);
        });
    }, []);

    const handleToggleInputTray = useCallback(() => {
        setIsInputTrayOpen((open) => !open);
        playInputTrayFlip();
    }, [playInputTrayFlip]);

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

        if (typeof nav.share === 'function') {
            const canShareFiles = typeof nav.canShare !== 'function' || nav.canShare({ files: [file] });
            if (canShareFiles) {
                try {
                    await nav.share({ files: [file], title: 'Star Diary Sky' });
                    return;
                } catch (err) {
                    if (err instanceof DOMException && err.name === 'AbortError') return;
                    console.error('Failed to share sky screenshot:', err);
                }
            }
        }

        downloadBlob(blob, fileName);
    }, [captureSkyBlob, downloadBlob]);

    const handleSkyTapAction = useCallback(async () => {
        if (viewMode !== 'sky' || isSkyShotBusyRef.current) return;

        if (!isSkyUiHidden) {
            setIsSkySettingsOpen(false);
            setIsInputTrayOpen(false);
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

    // データ読み込み
    const loadData = useCallback(async () => {
        const stars = await db.stars.toArray();
        const allLines = await db.constellationLines.toArray();
        const lines = allLines
            .map((l) => {
                const from = stars.find((s) => s.id === l.fromStarId);
                const to = stars.find((s) => s.id === l.toStarId);
                return from && to ? { from, to } : null;
            })
            .filter((l): l is { from: Star; to: Star } => l !== null);

        renderStateRef.current.stars = stars;
        renderStateRef.current.lines = lines;
        setStarCount(stars.length);
    }, []);

    // 図鑑データ読み込み
    const loadZukan = useCallback(async () => {
        const allConstellations = await db.constellations.toArray();
        const completed = allConstellations.filter((c) => c.completedAt);

        const zukanData = await Promise.all(
            completed.map(async (c) => {
                const stars = await db.stars.where('constellationId').equals(c.id!).toArray();
                const achievements = await Promise.all(
                    stars.map(async (s) => {
                        const a = await db.achievements.get(s.achievementId);
                        return a?.text ?? '';
                    }),
                );
                return {
                    id: c.id!,
                    name: c.name,
                    isReal: c.isReal,
                    completedAt: c.completedAt,
                    achievements,
                };
            }),
        );

        setConstellations(zukanData.sort((a, b) => {
            const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
            const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
            return dateB - dateA;
        }));
    }, []);

    useEffect(() => {
        const storedValue = localStorage.getItem(SKY_THEME_STORAGE_KEY);
        if (storedValue && isSkyThemePreset(storedValue)) {
            setSkyThemePreset(storedValue);
        }

        const storedLineVisibility = localStorage.getItem(CONSTELLATION_LINES_STORAGE_KEY);
        if (storedLineVisibility === '0') {
            setShowConstellationLines(false);
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
        if (viewMode !== 'sky') {
            setIsSkySettingsOpen(false);
            setIsInputTrayOpen(false);
            setIsSkyUiHidden(false);
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

        loadData();

        return () => {
            window.removeEventListener('resize', resize);
        };
    }, [loadData]);

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
        if (inputTrayAudioRef.current) {
            inputTrayAudioRef.current.pause();
            inputTrayAudioRef.current = null;
        }
        if (starChimeAudioRef.current) {
            starChimeAudioRef.current.pause();
            starChimeAudioRef.current = null;
        }
    }, []);

    // 星のホバー判定（ワールド座標で検索）
    const handleCanvasInteraction = useCallback(
        async (clientX: number, clientY: number) => {
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
                const achievement = await db.achievements.get(closestStar.achievementId);
                renderStateRef.current.hoveredStarId = closestStar.id!;
                renderStateRef.current.hoveredAchievementText = achievement?.text ?? '';
            } else {
                renderStateRef.current.hoveredStarId = null;
                renderStateRef.current.hoveredAchievementText = null;
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

    // 入力送信
    const handleSubmit = useCallback(
        async (e: React.FormEvent) => {
            e.preventDefault();
            if (!inputText.trim() || isSubmitting) return;

            setIsSubmitting(true);
            const text = inputText.trim();
            setInputText('');

            try {
                // achievementを保存
                const achievementId = (await db.achievements.add({
                    text,
                    createdAt: new Date(),
                })) as number;

                const { canvasWidth, canvasHeight } = renderStateRef.current;

                // 星を追加
                const result = await addStar(achievementId, canvasWidth, canvasHeight);

                // 紙片エフェクト開始
                const inputEl = document.getElementById('achievement-input');
                const inputRect = inputEl?.getBoundingClientRect();
                const screenStartX = inputRect ? inputRect.left + inputRect.width / 2 : canvasWidth / 2;
                const screenStartY = inputRect ? inputRect.top : canvasHeight * 0.8;
                // スクリーン→ワールド座標変換
                const cam = renderStateRef.current.camera;
                const worldStartX = (screenStartX - cam.x) / cam.scale;
                const worldStartY = (screenStartY - cam.y) / cam.scale;

                const fragment = createPaperFragment(worldStartX, worldStartY, result.star.x, result.star.y);
                renderStateRef.current.paperFragments.push(fragment);

                // 少し遅れてデータに反映（エフェクト後に星が見える）
                setTimeout(async () => {
                    await loadData();
                    playStarChime();

                    // 星座完成エフェクト
                    if (result.constellationCompleted && result.constellationName) {
                        const starsInConstellation = renderStateRef.current.stars.filter(
                            (s) => s.constellationId === result.star.constellationId,
                        );

                        // 星座の線データを取得してエフェクト用に変換
                        const constellationLines = renderStateRef.current.lines.filter(
                            (l) => l.from.constellationId === result.star.constellationId
                                || l.to.constellationId === result.star.constellationId,
                        );

                        const LINE_STAGGER = 0.3; // 各線の開始を0.3秒ずつずらす
                        const LINE_DRAW_DURATION = 0.4;
                        const effectLines: CompletionEffectLine[] = constellationLines.map((l, i) => ({
                            fromX: l.from.x,
                            fromY: l.from.y,
                            toX: l.to.x,
                            toY: l.to.y,
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

                        // トーストはlineDrawing後に表示
                        const toastDelay = totalLineDuration * 1000 + 800;
                        setTimeout(() => {
                            setCompletionMessage(
                                `${result.isRealConstellation ? '🌟' : '✨'} ${result.constellationName} が完成しました！`,
                            );
                            setTimeout(() => setCompletionMessage(null), 4000);
                        }, toastDelay);
                    }
                }, 1200);
            } catch (err) {
                console.error('Failed to add star:', err);
            } finally {
                setIsSubmitting(false);
            }
        },
        [inputText, isSubmitting, loadData, playStarChime],
    );

    const handleClearAllData = useCallback(async () => {
        if (isSubmitting || starCount === 0) return;

        const shouldClear = window.confirm('記録した星・線・図鑑データをすべて削除します。よろしいですか？');
        if (!shouldClear) return;

        try {
            await db.transaction('rw', db.achievements, db.stars, db.constellationLines, db.constellations, async () => {
                await Promise.all([
                    db.constellationLines.clear(),
                    db.stars.clear(),
                    db.achievements.clear(),
                    db.constellations.clear(),
                ]);
            });

            renderStateRef.current.stars = [];
            renderStateRef.current.lines = [];
            renderStateRef.current.paperFragments = [];
            renderStateRef.current.completionEffects = [];
            renderStateRef.current.hoveredStarId = null;
            renderStateRef.current.hoveredAchievementText = null;

            setCompletionMessage(null);
            setInputText('');
            setStarCount(0);
            setConstellations([]);
        } catch (err) {
            console.error('Failed to clear all data:', err);
        }
    }, [isSubmitting, starCount]);

    const isSkyUiSlideHidden = viewMode === 'sky' && isSkyUiHidden;

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
                    renderStateRef.current.hoveredAchievementText = null;
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
                            onClick={() => {
                                setViewMode('zukan');
                                loadZukan();
                            }}
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

            {/* 入力フォーム・設定（星空ビューのみ） */}
            {viewMode === 'sky' && (
                <div className={`sky-bottom-ui-layer ${isSkyUiSlideHidden ? 'sky-ui-hidden' : ''}`}>
                    <form className={`input-form ${isInputTrayOpen ? 'open' : ''}`} onSubmit={handleSubmit}>
                        <button
                            type="button"
                            className="input-form-handle"
                            onClick={handleToggleInputTray}
                            aria-expanded={isInputTrayOpen}
                            aria-controls="input-tray-content"
                            aria-label={isInputTrayOpen ? '入力欄を閉じる' : '入力欄を開く'}
                        >
                            {isInputTrayOpen ? '↓' : '↑'}
                        </button>

                        <div id="input-tray-content" className="input-form-content">
                            <div className="input-paper">
                                <img src={paperUrl} alt="" aria-hidden="true" className="input-paper-image" />
                                <input
                                    id="achievement-input"
                                    type="text"
                                    className="achievement-input"
                                    placeholder="星にしたいことばを書く"
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                    disabled={isSubmitting}
                                    autoComplete="off"
                                />
                            </div>
                            <button
                                type="submit"
                                className="submit-btn submit-btn-img"
                                disabled={!inputText.trim() || isSubmitting}
                                aria-label="送信"
                            >
                                <img src={sousinUrl} alt="送信" className="submit-btn-image" />
                            </button>
                        </div>
                    </form>

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
                    </div>

                    <button
                        type="button"
                        className={`sky-settings-fab ${isSkySettingsOpen ? 'active' : ''}`}
                        onClick={() => setIsSkySettingsOpen((open) => !open)}
                        aria-label="表示設定を開く"
                    >
                        ⚙ 設定
                    </button>
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
                            <span className="star-counter">星の数 {starCount}</span>
                        </div>

                        {constellations.length === 0 ? (
                            <div className="zukan-empty">
                                <p className="zukan-empty-icon">🌌</p>
                                <p>まだ星座は完成していません</p>
                                <p className="zukan-empty-hint">「できたこと」を5つ記録すると、最初の星座が完成します</p>
                            </div>
                        ) : (
                            <div className="zukan-grid">
                                {constellations.map((c) => (
                                    <div key={c.id} className={`zukan-card ${c.isReal ? 'real' : ''}`}>
                                        <div className="zukan-card-header">
                                            <span className="zukan-card-label">
                                                {c.isReal ? '実在' : '架空'}
                                            </span>
                                            <span className="zukan-card-date">
                                                {c.completedAt
                                                    ? new Date(c.completedAt).toLocaleDateString('ja-JP')
                                                    : ''}
                                            </span>
                                        </div>
                                        <h3 className="zukan-card-name">{c.name}</h3>
                                        <ul className="zukan-card-achievements">
                                            {c.achievements.map((a, i) => (
                                                <li key={i}>
                                                    <span className="achievement-star">◇</span>
                                                    {a}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="zukan-footer">
                            <button
                                className="nav-btn danger zukan-clear-btn"
                                onClick={handleClearAllData}
                                disabled={isSubmitting || starCount === 0}
                                title="全データをクリア"
                                aria-label="全データをクリア"
                            >
                                空をクリアに
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
