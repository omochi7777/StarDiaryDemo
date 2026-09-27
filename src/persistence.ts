// ===== ブラウザ保存領域の永続化 =====

// persisted: ブラウザが消さないと約束した状態
// best-effort: 容量不足や一定期間の未使用で消される可能性がある状態
// unsupported: 永続化APIが使えない環境
export type StoragePersistState = 'persisted' | 'best-effort' | 'unsupported';

function getStorageManager(): StorageManager | null {
    if (typeof navigator === 'undefined' || !navigator.storage) return null;
    if (typeof navigator.storage.persisted !== 'function') return null;
    return navigator.storage;
}

export async function getStoragePersistState(): Promise<StoragePersistState> {
    const storage = getStorageManager();
    if (!storage) return 'unsupported';
    try {
        return (await storage.persisted()) ? 'persisted' : 'best-effort';
    } catch {
        return 'unsupported';
    }
}

// 永続化をブラウザに依頼する。Chrome / Safari は利用状況から自動判定し、
// Firefox は許可ダイアログを出すため、ユーザー操作の直後に呼ぶ。
export async function requestStoragePersist(): Promise<StoragePersistState> {
    const storage = getStorageManager();
    if (!storage || typeof storage.persist !== 'function') return 'unsupported';
    try {
        if (await storage.persisted()) return 'persisted';
        return (await storage.persist()) ? 'persisted' : 'best-effort';
    } catch {
        return 'unsupported';
    }
}

// ホーム画面に追加して起動しているか（iOS Safari はこの場合のみ7日ルールの対象外）
export function isStandaloneDisplay(): boolean {
    if (typeof window === 'undefined') return false;
    const nav = navigator as Navigator & { standalone?: boolean };
    return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function isIosDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    // iPadOS 13+ は Mac と同じ UA を返すため、タッチ対応で判定する
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
