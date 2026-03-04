# ⭐ Star Diary - 実装計画

## 技術スタック

- **フレームワーク**: Vite + React + TypeScript
- **描画**: HTML Canvas 2D
- **パララックス**: CSS transform + will-change
- **永続化**: IndexedDB（Dexie.js）
- **PWA**: vite-plugin-pwa
- **レスポンシブ**: モバイル対応

## フェーズ構成

### Phase 1: 骨格（MVP Core）
- [x] Vite + React + TypeScript プロジェクトセットアップ
- [x] PWA設定（vite-plugin-pwa）
- [x] Dexie.js によるデータベース設計
- [x] 入力UI（できたこと入力フォーム）
- [x] Canvas: 背景星の描画（グリッド+ジッター）
- [x] Canvas: 星座星の配置・描画
- [x] Canvas: 星同士の線接続

### Phase 2: 演出
- [ ] 紙片 → 粒 → 星の出現アニメーション
- [ ] パララックス背景レイヤー
- [ ] 線の接続アニメーション（糸/縫い目風）
- [ ] 星の瞬きアニメーション

### Phase 3: 完成体験
- [ ] 星座完成判定（5個で完成）
- [ ] 星座完成演出
- [ ] 図鑑ページ
- [ ] 星タップで「できたこと」表示
- [ ] 星座名の自動命名（ランダムリスト）

## データモデル

```typescript
interface Achievement {
  id?: number;
  text: string;
  createdAt: Date;
  starId?: number;
}

interface Star {
  id?: number;
  x: number;          // Canvas上のX座標
  y: number;          // Canvas上のY座標
  gridX: number;      // グリッド座標X
  gridY: number;      // グリッド座標Y
  brightness: number; // 明るさ
  achievementId: number;
  constellationId?: number;
  createdAt: Date;
}

interface ConstellationLine {
  id?: number;
  constellationId: number;
  fromStarId: number;
  toStarId: number;
}

interface Constellation {
  id?: number;
  name: string;
  isReal: boolean;     // 実在 or 架空
  completedAt?: Date;
  starCount: number;
}
```
