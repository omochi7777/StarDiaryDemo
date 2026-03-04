// 星座のランダム名前リスト（和風・ファンタジー・絵本テイスト）
const constellationNames: string[] = [
    // 自然・風景
    'ゆうやけ雲座',
    'はるかぜ座',
    'こもれび座',
    'あさつゆ座',
    'たそがれ座',
    'ゆきどけ座',
    'なみのこ座',
    'かげぼうし座',
    'そよかぜ座',
    'にじいろ座',
    // 動物・生き物
    'ほしくじら座',
    'つきうさぎ座',
    'ゆめねこ座',
    'ひかりとり座',
    'こぐまの足あと座',
    'たびがらす座',
    'ほたるの灯座',
    'きんいろさかな座',
    'くものす座',
    'こねこのひげ座',
    // ファンタジー・おとぎ話
    'まほうのかぎ座',
    'ものがたり座',
    'ねがいの泉座',
    'ちいさな王冠座',
    'おくりもの座',
    'しあわせのしるし座',
    'おやすみのうた座',
    'ゆめのかけら座',
    'ひみつの扉座',
    'おほしさまのみち座',
    // 季節・時間
    'はなぞの座',
    'なつのそら座',
    'あきのみのり座',
    'ふゆのまど座',
    'まよなかの時計座',
    'あかつき座',
    'ゆうぐれの灯台座',
    'しおかぜ座',
    'つばめのしっぽ座',
    'こだまの森座',
];

// 実在の星座名リスト（レア枠）
const realConstellationNames: string[] = [
    'オリオン座',
    'カシオペヤ座',
    'おおぐま座',
    'こぐま座',
    'さそり座',
    'はくちょう座',
    'こと座',
    'わし座',
    'おうし座',
    'ふたご座',
];

let usedNames = new Set<string>();

export function getRandomConstellationName(isReal: boolean): string {
    const list = isReal ? realConstellationNames : constellationNames;
    const available = list.filter((n) => !usedNames.has(n));

    if (available.length === 0) {
        // 全部使い切ったらリセット
        usedNames = new Set<string>();
        return getRandomConstellationName(isReal);
    }

    const name = available[Math.floor(Math.random() * available.length)];
    usedNames.add(name);
    return name;
}

export function resetUsedNames(): void {
    usedNames = new Set<string>();
}
