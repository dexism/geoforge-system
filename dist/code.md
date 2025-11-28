// =========================================================================
// グローバル設定
// =========================================================================
const SPREADSHEET_ID = '1kX945WYVgjSfphGhsXcVXMuqt5awp85m4DUxconb_g4';
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1441760230688948335/zrk2DbmQY7t6LTYEaERiVZfofZDl8-7bAbTa8jsFAGWrjBOAX6eIwhybY1cpRIMM6wyo';
const IMAGE_FOLDER_ID = '1t-97_rs748pDfyXcQkd_-mpTKaMFqRTa'; 

// =========================================================================
// Webアプリの基本動作
// =========================================================================

/**
 * Webページを表示するためのメイン関数。
 * HTMLテンプレートを読み込み、スプレッドシートから取得したゲームデータを渡す。
 */
function doGet(e) {
  var html = HtmlService.createTemplateFromFile('entrysheet');
  html.gameData = loadGameData();
  html.targetCharacterId = e.parameter.id || "";
  html.deployUrl = ScriptApp.getService().getUrl();
  return html.evaluate()
      .setTitle('キャラクター履歴書 | 運命を刻む元帳 VoT TRPG')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * 外部ファイル（CSSなど）をHTMLにインクルードするためのヘルパー関数。
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * スプレッドシートの各データシートからゲームデータを読み込む。
 */
function loadGameData() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    // 各シートからデータを読み込み、オブジェクトの配列に変換
    const lifepathArray = convertToObjectArray(ss.getSheetByName('Data_Lifepath').getDataRange().getValues());
    const skillsArray = convertToObjectArray(ss.getSheetByName('Data_Skills').getDataRange().getValues());
    const featuresArray = convertToObjectArray(ss.getSheetByName('Data_Features').getDataRange().getValues());

    // カテゴリごとにデータをグループ化
    const lifepathData = groupByCategory(lifepathArray);
    const skillsData = groupByCategory(skillsArray);
    const featuresData = groupByCategory(featuresArray);

    return {
        LIFEPATH_DATA: lifepathData,
        SKILLS: skillsData,
        FEATURES_DATA: featuresData,
    };
}

// =========================================================================
// キャラクターデータ操作 (HTMLから呼び出される関数群)
// =========================================================================

/**
 * 【改修】保存されているキャラクターリストを取得し、更新日時の新しい順にソートする。
 * 【改修版】エラーが発生したシートがあっても、他のシートは読み込むように修正
 */
/**
 * 【ログ出力強化版】キャラクターリスト取得
 * 処理中のシート名や、取得したデータをログに出力して原因を特定します。
 */
/**
 * 【最終修正版】日付データを文字列に変換して送信する
 */
function getCharacterList() {
  Logger.log("=== getCharacterList 処理開始 ===");
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheets = ss.getSheets();
    const characterList = [];
    
    Logger.log(`スプレッドシートID: ${SPREADSHEET_ID}`);
    Logger.log(`全シート枚数: ${sheets.length}`);

    sheets.forEach(sheet => {
      const sheetName = sheet.getName();

      // 4桁の数字のシート名のみ対象
      if (/^\d{4}$/.test(sheetName)) {
        try {
          // B4:更新日, B5:ハッシュ, B6:プレイヤー名, B7:キャラクター名
          const values = sheet.getRange("B4:B7").getValues();
          
          // ★★★ ここが修正ポイント ★★★
          // Dateオブジェクトのままだと通信で消滅するため、強制的に文字列に変換する
          let updatedAtVal = values[0][0];
          let updatedAtStr = "";

          if (updatedAtVal instanceof Date) {
            // 日付型なら文字列に整形
            updatedAtStr = Utilities.formatDate(updatedAtVal, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss");
          } else {
            // 文字列ならそのまま
            updatedAtStr = String(updatedAtVal);
          }

          const playerName = values[2][0];
          const charName = values[3][0];

          Logger.log(`シート[${sheetName}] -> 更新日:${updatedAtStr}, PC:${charName}`);

          characterList.push({
            id: sheetName,
            updatedAt: updatedAtStr, // ★変換した文字列を入れる
            playerName: playerName,
            charName: charName
          });

        } catch (innerError) {
          Logger.log(`  -> [エラー] データ取得失敗: ${innerError.message}`);
        }
      }
    });
    
    // ソート処理（文字列の日付でもDate変換して比較するため、ロジックは変えなくてOK）
    characterList.sort((a, b) => {
      const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return dateB - dateA;
    });

    Logger.log(`=== 処理完了 (返却件数: ${characterList.length}) ===`);
    return characterList;

  } catch (e) {
    Logger.log(`!!! 致命的なエラー !!!: ${e.message}`);
    return [];
  }
}

/**
 * 【改修】指定されたキャラクターIDのシートから全データを読み込む。
 */
function getCharacterData(characterId) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(characterId);
    if (!sheet) return null;
    
    const values = sheet.getDataRange().getValues();
    const data = {};
    
    values.forEach(row => {
      const key = row[0];
      const value = row[1];
      const keyMap = {
        'キャラクターID': 'id', 
        '作成日': 'createdAt', 
        '更新日': 'updatedAt',
        'パスコードHash': 'passcodeHash',
        'プレイヤー名': 'playerName', 
        'キャラクター名': 'charName', 
        '二つ名': 'nickname', 
        '二つ名使用': 'useNickname',
        '信用': 'credit', 
        '名声': 'fame', 
        '悪名': 'notoriety', 
        '生まれ': 'birth', 
        '育ち': 'upbringing', 
        '契機': 'trigger',
        'スキル': 'skills', 
        '特徴': 'features', 
        'R: ロール': 'vectorR', 
        'A: アプローチ': 'vectorA', 
        'ポジション': 'position',
        
        // ▼ 追加項目のマッピング
        '野望': 'ambition',
        'HP': 'hp', 
        'MP': 'mp', 
        'IP': 'ip',
        '人材': 'resHuman', 
        '資産': 'resAsset', 
        '資金': 'resFund', 
        '所持金': 'money',
        'メモ': 'memo',
        '画像URL': 'imageUrl'
      };
      
      if (keyMap[key]) {
        if (key === 'スキル' || key === '特徴') {
          data[keyMap[key]] = value ? String(value).split(',') : [];
        } else if (key === '二つ名使用') {
          data[keyMap[key]] = (value === true || String(value).toUpperCase() === 'TRUE');
        } else {
          data[keyMap[key]] = (value instanceof Date) ? Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss") : value;
        }
      }
    });
    return data;
  } catch (e) {
    Logger.log(`getCharacterData Error: ${e.message}`);
    throw new Error(e.message);
  }
}

/**
 * 【新設】ユニークな4桁のキャラクターIDを生成する。
 */
function generateUniqueCharacterId(ss) {
    const existingIds = ss.getSheets().map(sheet => sheet.getName());
    let newId;
    let attempts = 0;
    do {
        newId = Utilities.formatString('%04d', Math.floor(Math.random() * 10000));
        attempts++;
        if (attempts > 1000) { // 無限ループを避ける
            throw new Error("ユニークなIDの生成に失敗しました。シートがいっぱいか、一時的な問題です。");
        }
    } while (existingIds.includes(newId));
    return newId;
}

/**
 * 【改修】新しいキャラクターシートを作成し、データを保存する。
 * 保存成功時にDiscordへ通知を送る。
 */
function saveNewCharacterSheet(data) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const newId = generateUniqueCharacterId(ss);
    
    // データにIDとタイムスタンプを追加
    data.id = newId;
    data.createdAt = new Date();
    data.updatedAt = new Date();

    const sheet = ss.insertSheet(newId);
    writeDataToSheet(sheet, data);

    // ▼▼▼ 追加: Discordへ通知 ▼▼▼
    try {
      sendDiscordNotification(data);
    } catch (discordError) {
      // 通知に失敗しても、保存自体は成功しているのでログだけ残してエラーにはしない
      Logger.log(`Discord Notification Failed: ${discordError.message}`);
    }
    // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
    
    return `キャラクター「${data.charName}」をID: ${newId} で正常に保存しました。`;
  } catch (e) {
    Logger.log(`saveNewCharacterSheet Error: ${e.message}`);
    throw new Error(e.message);
  }
}

/**
 * 【改修】既存のキャラクターシートのデータを更新する。
 */
function updateCharacterSheet(data) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const characterId = data.id; // 送られてくるデータにIDが含まれる
    const sheet = ss.getSheetByName(characterId);

    if (!sheet) {
      throw new Error(`更新対象のキャラクター(ID: ${characterId})が見つかりません。`);
    }
    
    // データに更新日を追加
    data.updatedAt = new Date();

    sheet.clear();
    writeDataToSheet(sheet, data);
    
    return `キャラクター「${data.charName}」(ID: ${characterId})を正常に更新しました。`;
  } catch (e) {
    Logger.log(`updateCharacterSheet Error: ${e.message}`);
    throw new Error(e.message);
  }
}

/**
 * 【改修】指定されたキャラクターIDのシートを削除する。
 */
function deleteCharacterSheet(characterId) {
    try {
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName(characterId);
        if (!sheet) {
            throw new Error(`削除対象のキャラクター(ID: ${characterId})が見つかりません。`);
        }
        if (ss.getSheets().length <= 1) {
            throw new Error("最後のシートは削除できません。");
        }
        ss.deleteSheet(sheet);
        return `キャラクター(ID: ${characterId})を削除しました。`;
    } catch(e) {
        Logger.log(`deleteCharacterSheet Error: ${e.message}`);
        throw new Error(e.message);
    }
}


// =========================================================================
// ヘルパー関数 (内部処理用)
// =========================================================================

/**
 * スプレッドシートから読み込んだ2次元配列を、オブジェクトの配列に変換する。
 */
function convertToObjectArray(data) {
    const headers = data.shift();
    return data.map(row => {
        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = row[index];
        });
        return obj;
    });
}

/**
 * オブジェクトの配列を、指定された'category'キーでグループ化する。
 */
function groupByCategory(dataArray) {
    return dataArray.reduce((obj, item) => {
        const category = item.category;
        if (!obj[category]) obj[category] = [];
        obj[category].push(item);
        return obj;
    }, {});
}

/**
 * 【新設】Discord Webhookに新規登録通知を送る
 */
function sendDiscordNotification(data) {
  // メッセージの組み立て（Embed形式を使用）
  const payload = {
    username: "職能ギルド事務局",
    content: "# 🆕 新しいキャラクターが登録されました！\nhttps://script.google.com/macros/s/AKfycbwRLJth6_1xB_MVuGwLhbtBbTuA51kyDOO8oehRjRowkEgEE7PWRxP5fEasB1Pu2Tn2/exec",
    embeds: [{
      title: `エントリーID ${data.id}`,
      color: 5763719, // 緑系 (0x57F287)
      fields: [
        {
          name: "キャラクター名",
          value: data.charName || "名称未設定",
          inline: true
        },
        {
          name: "プレイヤー名",
          value: data.playerName || "不明",
          inline: true
        },
        {
          name: "ポジション",
          value: data.position || "不明",
          inline: false
        },
        {
          name: "経歴（ライフパス）",
          value: `生まれ: ${data.birth}\n育ち: ${data.upbringing}\n契機: ${data.trigger}`,
          inline: false
        },
        {
          name: "野望",
          value: data.ambition || "なし",
          inline: false
        }
      ],
      footer: {
        text: "運命を刻む元帳 ベンチャー of テイルズ TRPG"
      },
      timestamp: new Date().toISOString()
    }]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };

  UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, options);
}

/**
 * 【改修】スプレッドシートに書き込むデータ形式を更新。
 */
function writeDataToSheet(sheet, data) {
  const outputData = [
      ['管理情報', ''],
      ['キャラクターID', data.id],
      ['作成日', data.createdAt],
      ['更新日', data.updatedAt],
      ['パスコードHash', data.passcodeHash || ''],
      ['プレイヤー名', data.playerName],
      ['キャラクター名', data.charName],
      ['二つ名', data.nickname],
      ['二つ名使用', data.useNickname],
      ['風評', ''],
      ['信用', data.credit],
      ['名声', data.fame],
      ['悪名', data.notoriety],
      ['経歴', ''],
      ['生まれ', data.birth],
      ['育ち', data.upbringing],
      ['契機', data.trigger],
      // ▼ 追加: 野望 (経歴の一部として扱う位置に挿入する場合はここだが、
      // 行ズレを完全に防ぐため、既存の項目の下に追加していくのが安全)
      // ここでは既存の項目を出力
      ['特徴', data.features.join(',')],
      ['専門技能', ''],
      ['スキル', data.skills.join(',')],
      ['能力評価', ''],
      ['R: ロール', data.vectorR],
      ['A: アプローチ', data.vectorA],
      ['ポジション', data.position],
      
      // ▼▼▼ ここから下に追加項目 (下位互換維持のため末尾に追加) ▼▼▼
      ['追加情報', ''],
      ['野望', data.ambition || ''],
      ['状態', ''],
      ['HP', data.hp],
      ['MP', data.mp],
      ['IP', data.ip],
      ['リソース', ''],
      ['人材', data.resHuman],
      ['資産', data.resAsset],
      ['資金', data.resFund],
      ['所持金', data.money],
      ['その他', ''],
      ['メモ', data.memo || ''],
      ['画像URL', data.imageUrl || '']
  ];
  
  // データの書き込み（既存データをクリアしてから書き込むか、上書きするか）
  // updateCharacterSheetでは sheet.clear() しているので、
  // 配列全体を (1, 1) から書き込めばOK。
  
  sheet.getRange(1, 1, outputData.length, 2).setValues(outputData);
  sheet.getRange("A:A").setFontWeight("bold");
  sheet.getRange("B2:B5").setNumberFormat('@');
  
  // メモ欄などは長文になる可能性があるため、折り返し設定などをしても良いが
  // 基本的にはセルに格納されればOK
  
  sheet.autoResizeColumn(1);
  sheet.autoResizeColumn(2);
}

/**
 * 【新設】パスコードのみを更新する関数
 */
function updateCharacterPasscode(characterId, newHash) {
    try {
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName(characterId);
        if (!sheet) throw new Error("シートが見つかりません");
        
        // "パスコードHash" というラベルのある行を探して書き換える
        const textFinder = sheet.getRange("A:A").createTextFinder("パスコードHash");
        const cell = textFinder.findNext();
        
        if (cell) {
            cell.offset(0, 1).setValue(newHash); // B列に書き込む
            // 更新日も更新
            const dateFinder = sheet.getRange("A:A").createTextFinder("更新日");
            const dateCell = dateFinder.findNext();
            if (dateCell) {
                dateCell.offset(0, 1).setValue(new Date());
            }
        } else {
            // 古い形式のシートなどで行がない場合は挿入する等の処理が必要だが、
            // 今回は簡易的にエラーとするか、運用でカバー（新規保存時に行が作られるため）
             throw new Error("パスコード保存行が見つかりません。シートの形式が古い可能性があります。");
        }
        
        return "認証コードを更新しました。";
    } catch(e) {
        throw new Error(e.message);
    }
}

/**
 * ▼▼▼ 修正: 画像データをGoogleドライブに保存し、表示に強いURLを返す ▼▼▼
 */
function saveImageToDrive(base64Data, fileName) {
  try {
    const folder = DriveApp.getFolderById(IMAGE_FOLDER_ID);
    
    // Base64ヘッダ除去とデコード
    const splitBase64 = base64Data.split(',');
    const contentType = splitBase64[0].match(/:(.*?);/)[1];
    const decoded = Utilities.base64Decode(splitBase64[1]);
    const blob = Utilities.newBlob(decoded, contentType, fileName);
    
    // ファイル作成
    const file = folder.createFile(blob);
    
    // 権限設定 (フォルダの設定を継承するため、明示的な操作は不要だが、
    // 念のため公開設定にしておくコードを残す場合は try-catch で囲むのが安全)
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
      console.log("権限設定スキップ: " + e.message);
    }
    
    const fileId = file.getId();
    
    // ★ここが重要: ココフォリアやWebアプリで表示されやすい形式に変更
    // const directUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
    const directUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=s4000`;
    
    return directUrl;
  } catch (e) {
    throw new Error("画像のアップロードに失敗しました: " + e.message);
  }
}

/**
 * Discord通知のテストと権限承認用関数
 * エディタ上部のプルダウンからこの関数を選択し、「実行」を押してください。
 */
function testDiscordNotification() {
  const testData = {
    id: "TEST-0000",
    charName: "通信テスト用キャラクター",
    playerName: "管理者",
    position: "テストポジション",
    birth: "テスト生まれ",
    upbringing: "テスト育ち",
    trigger: "テスト契機",
    ambition: "Discordへの開通確認"
  };
  
  Logger.log("通知テスト開始");
  try {
    sendDiscordNotification(testData);
    Logger.log("通知テスト成功！Discordを確認してください。");
  } catch (e) {
    Logger.log("通知テスト失敗: " + e.message);
  }
}

/**
 * 権限承認用の一時的な関数
 * これを選択して「実行」し、アクセス権を許可してください。
 * https://www.google.com/url?sa=E&q=https%3A%2F%2Fmyaccount.google.com%2Fpermissions
 */
function authorizeDrive() {
  // ドライブ機能に触れることで、権限ダイアログを呼び出す
  DriveApp.getRootFolder();
  console.log("権限の承認が完了しました。");
}

function authorizeAll() {
  // すべての権限をトリガーする
  SpreadsheetApp.getActiveSpreadsheet(); // スプレッドシート
  DriveApp.getRootFolder();              // Googleドライブ
  UrlFetchApp.fetch("https://google.com"); // 外部通信 (Discord用)
  console.log("全権限の承認完了");
}