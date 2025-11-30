// ================================================================
// GeoForge System - Google Sheets Data API (v1.0)
// ================================================================

// ターゲットのスプレッドシートIDを設定
const SPREADSHEET_ID = '1WJqsaohJoXxwRcREsyZzA0ihvSOpfMXI7CnQfZX68PE';
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1441760230688948335/zrk2DbmQY7t6LTYEaERiVZfofZDl8-7bAbTa8jsFAGWrjBOAX6eIwhybY1cpRIMM6wyo';

// 各データを保存するシート名
// 各データを保存するシート名
const HEX_SHEET_NAME = 'HexData';
const ROAD_SHEET_NAME = 'RoadData';
const DICT_SHEET_NAME = 'DictData';
const META_SHEET_NAME = 'MetaData';

/**
 * WebアプリからGETリクエストを受け取ったときに実行される関数。
 * スプレッドシートからデータを読み込み、JSON形式で返す。
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    // メタデータを読み込む
    const metaSheet = ss.getSheetByName(META_SHEET_NAME);
    const metaValues = metaSheet ? metaSheet.getDataRange().getValues() : [];
    const meta = {};
    metaValues.forEach(row => { if(row.length >= 2) meta[row[0]] = row[1]; });

    // 辞書データを読み込む
    const dictSheet = ss.getSheetByName(DICT_SHEET_NAME);
    const dictValues = dictSheet ? dictSheet.getDataRange().getValues() : [];
    const dicts = {};
    dictValues.forEach(row => { if(row.length >= 2) dicts[row[0]] = JSON.parse(row[1]); });

    // ヘックスデータを読み込む
    const hexSheet = ss.getSheetByName(HEX_SHEET_NAME);
    const hexValues = hexSheet.getDataRange().getValues();
    const hexes = valuesToObjects(hexValues);
    
    // 道路データを読み込む
    const roadSheet = ss.getSheetByName(ROAD_SHEET_NAME);
    const roadValues = roadSheet.getDataRange().getValues();
    const roads = valuesToObjects(roadValues);

    // V2フォーマットで構築
    const worldData = {
      version: meta.version || 2,
      cols: meta.cols || 115,
      rows: meta.rows || 100,
      dicts: dicts,
      hexes: hexes,
      roads: roads,
      // 互換性のため古いキーも残す（必要なら）
      allHexes: hexes,
      roadPaths: roads
    };

    // JSON形式で出力
    return ContentService
      .createTextOutput(JSON.stringify(worldData))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    // エラーが発生した場合は、エラーメッセージを返す
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * WebアプリからPOSTリクエストを受け取ったときに実行される関数。
 * 送信されてきたJSONデータをパースし、スプレッドシートに保存する。
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // --- 【追加】強制再生成の通知リクエストの場合 ---
    if (data.type === 'notification' && data.action === 'force_regenerate') {
      sendRegenerateNotification(data.ipData, data.userAgent);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success', message: 'Notification sent' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // V2対応: キーのマッピング
    const hexes = data.hexes || data.allHexes;
    const roads = data.roads || data.roadPaths;
    const dicts = data.dicts || {};
    const meta = {
        version: data.version || 2,
        cols: data.cols || 115,
        rows: data.rows || 100
    };

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // ヘックスデータをシートに書き込む
    const hexSheet = getOrCreateSheet(ss, HEX_SHEET_NAME);
    const hexRows = objectsToValues(hexes);
    updateSheetData(hexSheet, hexRows);
    
    // 道路データをシートに書き込む
    const roadSheet = getOrCreateSheet(ss, ROAD_SHEET_NAME);
    const roadRows = objectsToValues(roads);
    updateSheetData(roadSheet, roadRows);

    // 辞書データをシートに書き込む
    const dictSheet = getOrCreateSheet(ss, DICT_SHEET_NAME);
    const dictRows = Object.entries(dicts).map(([k, v]) => [k, JSON.stringify(v)]);
    updateSheetData(dictSheet, dictRows);

    // メタデータをシートに書き込む
    const metaSheet = getOrCreateSheet(ss, META_SHEET_NAME);
    const metaRows = Object.entries(meta);
    updateSheetData(metaSheet, metaRows);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);
  
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// --- ヘルパー関数 ---

/**
 * 指定された名前のシートを取得、なければ作成する
 */
function getOrCreateSheet(spreadsheet, sheetName) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  return sheet;
}

/**
 * シートのデータをクリアして新しいデータを書き込む
 */
function updateSheetData(sheet, dataRows) {
  sheet.clearContents();
  if (dataRows.length > 0) {
    sheet.getRange(1, 1, dataRows.length, dataRows[0].length).setValues(dataRows);
  }
}

/**
 * オブジェクトの配列をスプレッドシート書き込み用の2次元配列に変換する
 */
function objectsToValues(objects) {
  if (!objects || objects.length === 0) return [];

  // 1. 全オブジェクトからすべてのキーを収集してヘッダーを作成
  const headerSet = new Set();
  objects.forEach(obj => {
    Object.keys(obj).forEach(key => headerSet.add(key));
  });
  const header = Array.from(headerSet);

  // 2. 各オブジェクトをヘッダーの順序に従って配列に変換
  const rows = objects.map(obj => {
    return header.map(key => {
      const value = obj[key];
      // 値がオブジェクトや配列の場合はJSON文字列に変換
      if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value);
      }
      return value !== undefined ? value : ''; // undefinedは空文字に
    });
  });

  return [header, ...rows];
}

/**
 * スプレッドシートから読み込んだ2次元配列をオブジェクトの配列に変換する
 */
function valuesToObjects(values) {
    if (!values || values.length < 2) return [];

    const header = values[0];
    const objects = [];

    for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const obj = {};
        for (let j = 0; j < header.length; j++) {
            const key = header[j];
            let value = row[j];
            // 値がJSON文字列のように見えればパースを試みる
            if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
                try {
                    value = JSON.parse(value);
                } catch (e) {
                    // パース失敗時はそのままの文字列を使用
                }
            }
            obj[key] = value;
        }
        objects.push(obj);
    }
    return objects;
}

/**
 * 【新設】強制再生成の通知をDiscordに送る関数
 */
function sendRegenerateNotification(ipData, userAgent) {
  // IPデータが取得できなかった場合のフォールバック
  const ip = ipData.ip || "不明";
  const location = `${ipData.city || "不明"}, ${ipData.region || ""} (${ipData.country_name || "不明"})`;
  const org = ipData.org || "不明";
  
  const payload = {
    username: "GeoForge監視システム", // 送信者名
    content: "# 👀 誰かが「強制再生成」に興味があるようですね...\nhttps://geoforge-system.onrender.com/", // メッセージ本文
    embeds: [{
      title: `⚠️ 世界の再構築がリクエストされました`,
      description: "Webアプリ上の「強制再生成」ボタンがクリックされました。",
      color: 15158332, // 赤系 (0xE74C3C)
      fields: [
        {
          name: "📡 IPアドレス",
          value: ip,
          inline: true
        },
        {
          name: "📍 推定位置",
          value: location,
          inline: true
        },
        {
          name: "🏢 プロバイダ/組織",
          value: org,
          inline: false
        },
        {
          name: "💻 ユーザーエージェント",
          value: userAgent || "不明",
          inline: false
        }
      ],
      footer: {
        text: "GeoForge System Security Log"
      },
      timestamp: new Date().toISOString()
    }]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };

  try {
    UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, options);
  } catch (e) {
    // 通知エラーでもメイン処理は止めないためログのみ残す
    console.error("Discord通知エラー: " + e.toString());
  }
}

/**
 * Discord通知のテストと権限承認用関数
 * エディタ上部のプルダウンからこの関数を選択し、「実行」を押してください。
 * 初回実行時に「外部サービスへの接続許可」が求められます。
 */
function testDiscordNotification() {
  // テスト用のダミーIP情報
  const testIpData = {
    ip: "127.0.0.1 (Test)",
    city: "Test City",
    region: "Test Region",
    country_name: "Test Country",
    org: "Test Provider Auth Check"
  };
  
  // テスト用のUserAgent
  const testUserAgent = "GAS Debugger / Test Execution";
  
  Logger.log("通知テスト開始");
  try {
    // 実装済みの通知関数を呼び出し
    sendRegenerateNotification(testIpData, testUserAgent);
    Logger.log("通知テスト成功！Discordを確認してください。");
  } catch (e) {
    Logger.log("通知テスト失敗: " + e.toString());
  }
}
