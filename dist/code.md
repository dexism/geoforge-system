// =========================================================================
// グローバル設定
// =========================================================================
const SPREADSHEET_ID = '1kX945WYVgjSfphGhsXcVXMuqt5awp85m4DUxconb_g4';

// =========================================================================
// Webアプリの基本動作
// =========================================================================

/**
 * Webページを表示するためのメイン関数。
 * HTMLテンプレートを読み込み、スプレッドシートから取得したゲームデータを渡す。
 */
function doGet(e) {
  const html = HtmlService.createTemplateFromFile('entrysheet.html');
  html.gameData = loadGameData(); // データを読み込んでテンプレート変数にセット
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
 * 【改修】保存されているキャラクターの基本情報（ID, キャラ名, プレイヤー名）のリストを取得する。
 */
function getCharacterList() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheets = ss.getSheets();
    const characterList = [];

    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      // シート名が4桁の数字であるものだけをキャラクターシートと見なす
      if (/^\d{4}$/.test(sheetName)) {
        const playerName = sheet.getRange("B6").getValue(); 
        const charName = sheet.getRange("B7").getValue(); 
        characterList.push({
          id: sheetName,
          charName: charName,
          playerName: playerName
        });
      }
    });
    return characterList;
  } catch (e) {
    Logger.log(`getCharacterList Error: ${e.message}`);
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
        'キャラクターID': 'id', '作成日': 'createdAt', '更新日': 'updatedAt',
        // ▼ 追加
        'パスコードHash': 'passcodeHash', 
        // ▲
        'プレイヤー名': 'playerName', 'キャラクター名': 'charName', '二つ名': 'nickname', '二つ名使用': 'useNickname',
        '信用': 'credit', '名声': 'fame', '悪名': 'notoriety', '生まれ': 'birth', '育ち': 'upbringing', '契機': 'trigger',
        'スキル': 'skills', '特徴': 'features', 'R: ロール': 'vectorR', 'A: アプローチ': 'vectorA', 'ポジション': 'position'
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
 * 【改修】スプレッドシートに書き込むデータ形式を更新。
 */
function writeDataToSheet(sheet, data) {
  const outputData = [
      ['管理情報', ''],
      ['キャラクターID', data.id],
      ['作成日', data.createdAt],
      ['更新日', data.updatedAt],
      ['パスコードHash', data.passcodeHash || ''], // 5行目: 元の「基本情報」見出しを置換
      ['プレイヤー名', data.playerName],          // 6行目: これによりB6参照が維持される
      ['キャラクター名', data.charName],          // 7行目: これによりB7参照が維持される
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
      ['特徴', data.features.join(',')],
      ['専門技能', ''],
      ['スキル', data.skills.join(',')],
      ['能力評価', ''],
      ['R: ロール', data.vectorR],
      ['A: アプローチ', data.vectorA],
      ['ポジション', data.position]
  ];
  
  // A列とB列に書き込み
  sheet.getRange(1, 1, outputData.length, 2).setValues(outputData);
  sheet.getRange("A:A").setFontWeight("bold");
  
  // ID(B2), 作成日(B3), 更新日(B4), Hash(B5) を文字列として扱う
  sheet.getRange("B2:B5").setNumberFormat('@'); 
  
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