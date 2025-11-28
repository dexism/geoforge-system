<script>
// =========================================================================
// グローバル変数 & データ定義
// =========================================================================
const ALL_STATS = ["体力", "知力", "魅力", "運動", "芸術", "統御", "創造力", "交渉力", "市場感覚"];
const MAX_SKILL_POINTS = 5;

/**
 * 選択されているスキルの名前を管理するSetオブジェクト。
 */
const selectedSkills = new Set();

// =========================================================================
// アプリケーションのエントリーポイント
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    bindEventListeners();
    updateAllCalculations();
    loadCharacterList();

    // ▼▼▼ 追加: 直接リンクでIDが指定されていた場合、そのデータを読み込む ▼▼▼
    if (TARGET_CHARACTER_ID) {
        // 既存の読み込み関数を再利用
        loadCharacterData(TARGET_CHARACTER_ID);
    }
});

// =========================================================================
// 初期化関数
// =========================================================================
function initializeUI() {
    populateLifepathSelects();
    populateSkillList();
    populateFeaturesList();
}

function bindEventListeners() {
    // --- ライフパス ---
    document.querySelectorAll('.lifepath-select').forEach(select => {
        select.addEventListener('change', (event) => {
            const currentSelect = event.target;
            if (currentSelect.value === 'random') {
                const options = Array.from(currentSelect.options);
                const validOptions = options.filter(opt => opt.value && opt.value !== 'random' && !opt.disabled);
                if (validOptions.length > 0) {
                    const randomIndex = Math.floor(Math.random() * validOptions.length);
                    currentSelect.value = validOptions[randomIndex].value;
                }
            }
            updateAllCalculations();
        });
    });

    // --- ボタン ---
    document.getElementById('save-new-btn').addEventListener('click', saveCharacter);
    document.getElementById('update-btn').addEventListener('click', updateCharacter);
    document.getElementById('duplicate-btn').addEventListener('click', duplicateCharacter);
    document.getElementById('clear-btn').addEventListener('click', clearForm);
    document.getElementById('delete-btn').addEventListener('click', deleteCharacter);
    document.getElementById('ccfolia-copy-btn').addEventListener('click', copyToCcfolia);
    
    // --- 認証関連のイベントリスナー (追加) ---
    const passcodeInput = document.getElementById('auth-passcode');
    passcodeInput.addEventListener('input', handlePasscodeInput);
    
    document.getElementById('auth-change-btn').addEventListener('click', enterChangePasscodeMode);
    document.getElementById('auth-register-btn').addEventListener('click', registerNewPasscode);

    // --- 画像関連 ---
    document.getElementById('btn-trigger-file').addEventListener('click', function() {
        document.getElementById('char-image-input').click();
    });
    
    document.getElementById('char-image-input').addEventListener('change', handleImageSelect);

    document.getElementById('clear-image-btn').addEventListener('click', clearImageSelection);

    // --- メモコピー機能 ---
    document.getElementById('copy-memo-btn').addEventListener('click', copyMemoToClipboard);

    // --- アコーディオン ---
    document.body.addEventListener('click', (event) => {
        const trigger = event.target.closest('.accordion-trigger');
        if (trigger) {
            const content = trigger.nextElementSibling;
            if (content && content.classList.contains('accordion-content')) {
                trigger.classList.toggle('active');
                content.classList.toggle('active');
                content.style.maxHeight = trigger.classList.contains('active') ? content.scrollHeight + 'px' : null;
            }
            return; 
        }
        const closeTrigger = event.target.closest('.accordion-close-trigger');
        if (closeTrigger) {
            const mainTrigger = closeTrigger.closest('.accordion-content')?.previousElementSibling;
            if (mainTrigger && mainTrigger.classList.contains('active')) {
                mainTrigger.click();
            }
        }
    });

    // --- スキル選択 ---
    const skillListContainer = document.querySelector('.skill-list');
    skillListContainer.addEventListener('click', (e) => {
        const card = e.target.closest('.skill-card');
        if (card) {
            const checkbox = card.querySelector('input[type="checkbox"]');
            if (checkbox && e.target.tagName !== 'INPUT') {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });
    skillListContainer.addEventListener('change', (e) => {
        if (e.target.matches('input[name="skills"]')) {
            handleSkillChange(e);
        }
    });
}

// =========================================================================
// 認証システム (SHA-256 ハッシュ化)
// =========================================================================

/**
 * 文字列をSHA-256でハッシュ化する（非同期）
 */
async function digestMessage(message) {
    const msgUint8 = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * パスコード入力時の処理
 */
async function handlePasscodeInput(e) {
    const inputVal = e.target.value;
    
    // 新規保存モード、または変更モードの場合は何もしない（検証不要）
    const updateBtn = document.getElementById('update-btn');
    const isUpdateMode = updateBtn.style.display !== 'none';
    const isChangeMode = document.getElementById('auth-register-btn').style.display !== 'none';
    
    if (!isUpdateMode || isChangeMode) return;

    // 4桁入力されたら検証
    if (inputVal.length === 4) {
        const inputHash = await digestMessage(inputVal);
        const storedHash = document.getElementById('auth-hash-hidden').value;
        
        if (inputHash === storedHash) {
            unlockButtons();
        }
    } else {
        // 4桁未満ならロック状態に戻す（一度解除されても文字を消したらロック）
        lockButtons();
    }
}

function unlockButtons() {
    const updateBtn = document.getElementById('update-btn');
    const deleteBtn = document.getElementById('delete-btn');
    const changeBtn = document.getElementById('auth-change-btn');
    const statusIcon = document.getElementById('auth-status-icon');

    updateBtn.disabled = false;
    updateBtn.innerHTML = '上書き保存';
    deleteBtn.disabled = false;
    deleteBtn.innerHTML = '削除';
    
    changeBtn.style.display = 'inline-block'; // 認証成功したら変更ボタン表示
    statusIcon.textContent = '🔓';
    statusIcon.title = "認証成功";
}

function lockButtons() {
    const updateBtn = document.getElementById('update-btn');
    const deleteBtn = document.getElementById('delete-btn');
    const changeBtn = document.getElementById('auth-change-btn');
    const statusIcon = document.getElementById('auth-status-icon');

    updateBtn.disabled = true;
    updateBtn.innerHTML = '🔒 上書き保存';
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '🔒 削除';
    
    changeBtn.style.display = 'none'; // ロック中は変更ボタン隠す
    statusIcon.textContent = '';
}

/**
 * ⑤ 「認証コードの変更」ボタン処理
 */
function enterChangePasscodeMode() {
    const passInput = document.getElementById('auth-passcode');
    const changeBtn = document.getElementById('auth-change-btn');
    const registerBtn = document.getElementById('auth-register-btn');
    
    // UI切り替え
    passInput.value = '';
    passInput.placeholder = '新しいコード';
    passInput.focus();
    
    changeBtn.style.display = 'none';
    registerBtn.style.display = 'inline-block';
    
    // 変更中は保存/削除ボタンを一時的に無効化しておくと安全
    lockButtons(); 
    document.getElementById('auth-status-icon').textContent = '📝';
}

/**
 * ⑥ 「新しいコードを登録」ボタン処理
 */
async function registerNewPasscode() {
    const passInput = document.getElementById('auth-passcode');
    const newCode = passInput.value;
    const charId = document.getElementById('character-id-hidden').value;
    
    if (!charId) return;
    if (!/^\d{4}$/.test(newCode)) {
        alert("パスコードは4桁の数字で入力してください。");
        return;
    }
    
    // 新しいハッシュを計算
    const newHash = await digestMessage(newCode);
    
    showLoaderMessage("新しいパスコードを登録中...", { loader: true });
    
    google.script.run
        .withSuccessHandler(response => {
            hideLoaderMessage();
            showLoaderMessage("パスコードを変更しました。", { isSuccess: true });
            
            // 成功したら状態を更新
            document.getElementById('auth-hash-hidden').value = newHash;
            
            // UIを認証済み状態に戻す
            passInput.placeholder = '0000';
            document.getElementById('auth-register-btn').style.display = 'none';
            unlockButtons(); // 新しいコードを知っている状態なのでロック解除
            
        })
        .withFailureHandler(error => {
            hideLoaderMessage();
            showLoaderMessage(`変更失敗: ${error.message}`, { isSuccess: false });
        })
        .updateCharacterPasscode(charId, newHash);
}

// =========================================================================
// UI生成ヘルパー関数 (populate系)
// =========================================================================

function populateLifepathSelects() {
    for (const key in LIFEPATH_DATA) {
        const selectEl = document.getElementById(`lifepath-${key}`);
        selectEl.classList.add('lifepath-select');
        selectEl.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = "";
        placeholder.textContent = "選択してください";
        selectEl.appendChild(placeholder);
        LIFEPATH_DATA[key].forEach(data => {
            const option = document.createElement('option');
            option.value = data.value;
            option.textContent = data.text;
            const bonus = {};
            if (data.bonus_stat1 && data.bonus_value1) bonus[data.bonus_stat1] = parseInt(data.bonus_value1, 10);
            if (data.bonus_stat2 && data.bonus_value2) bonus[data.bonus_stat2] = parseInt(data.bonus_value2, 10);
            option.dataset.bonus = JSON.stringify(bonus);
            option.dataset.description = data.description;
            selectEl.appendChild(option);
        });
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '──────────';
        selectEl.appendChild(separator);
        const randomOption = document.createElement('option');
        randomOption.value = 'random';
        randomOption.textContent = 'ランダム';
        selectEl.appendChild(randomOption);
    }
}

/**
 * この関数はHTMLの描画のみに責任を持つ。イベントリスナーの登録は行わない。
 */
function populateSkillList() {
    var container = document.querySelector('.skill-list');
    container.innerHTML = '';
    Object.keys(SKILLS).forEach(function(cat) {
        // 修正: バッククォート廃止
        var html = '<div class="accordion"><summary class="accordion-trigger"><span class="arrow"></span> ' + cat + '</summary>';
        html += '<div class="accordion-content"><div style="padding:1rem;">';
        SKILLS[cat].forEach(function(s) {
            var r_val = s.r >= 0 ? '+' + s.r : s.r;
            var a_val = s.a >= 0 ? '+' + s.a : s.a;
            html += '<div class="skill-card">';
            html += '<input type="checkbox" name="skills" value="' + s.name + '" data-level="' + s.level + '" data-r="' + s.r + '" data-a="' + s.a + '">';
            html += '<div class="skill-card-header"><h5>' + s.name + '</h5><span>《L ' + s.level + ' / R ' + r_val + ' / A ' + a_val + '》</span></div>';
            html += '<p class="skill-description">' + s.description + '</p></div>';
        });
        html += '</div><div class="accordion-close-trigger">▲ 閉じる</div></div></div>';
        container.insertAdjacentHTML('beforeend', html);
    });
}

function populateFeaturesList() {
    var container = document.getElementById('features-selection-accordions');
    container.innerHTML = '';
    Object.keys(FEATURES_DATA).forEach(function(cat, i) {
        var html = '<div class="accordion"><summary class="accordion-trigger"><span class="arrow"></span> ' + cat + '</summary>';
        html += '<div class="accordion-content"><div style="padding:1rem;">';
        FEATURES_DATA[cat].forEach(function(pair, j) {
            var name = 'feature_pair_' + cat + '_' + j;
            
            html += '<div class="feature-pair-card">';
            
            // Prime
            html += '<div class="feature-option prime"><input type="radio" name="' + name + '" value="' + pair.prime_name + '" data-type="prime" ';
            html += 'data-name="' + pair.prime_name + '" data-desc="' + pair.prime_desc + '" data-pro="' + pair.prime_pro + '" data-con="' + pair.prime_con + '">';
            html += '<h5>' + pair.prime_name + '</h5><p>' + pair.prime_desc + '</p><p class="pro">利点: ' + pair.prime_pro + '</p><p class="con">欠点: ' + pair.prime_con + '</p></div>';
            
            // Fallen
            html += '<div class="feature-option fallen"><input type="radio" name="' + name + '" value="' + pair.fallen_name + '" data-type="fallen" ';
            html += 'data-name="' + pair.fallen_name + '" data-desc="' + pair.fallen_desc + '" data-pro="' + pair.fallen_pro + '" data-con="' + pair.fallen_con + '">';
            html += '<h5>' + pair.fallen_name + '</h5><p>' + pair.fallen_desc + '</p><p class="pro">利点: ' + pair.fallen_pro + '</p><p class="con">欠点: ' + pair.fallen_con + '</p></div>';
            
            html += '</div>';
        });
        html += '</div><div class="accordion-close-trigger">▲ 閉じる</div></div></div>';
        container.insertAdjacentHTML('beforeend', html);
    });
    
    // 変更検知リスナー
    document.querySelectorAll('input[name^="feature_pair_"]').forEach(function(r) {
        r.addEventListener('change', updateSelectedFeatures);
    });
    
    // ▼▼▼ 修正箇所: 選択/解除のトグルロジックを復活 ▼▼▼
    document.querySelectorAll('.feature-option').forEach(function(div) {
        div.addEventListener('click', function(e) {
            // ラジオボタン自体をクリックした場合は重複処理を防ぐ
            if (e.target.type === 'radio') return;

            var radio = div.querySelector('input');
            var group = radio.name;
            
            // 「クリックする前の状態」を保存しておく（ここが重要）
            var wasChecked = radio.checked;

            // 同じグループ（Prime/Fallenのペア）を一度すべて解除する
            document.querySelectorAll('input[name="' + group + '"]').forEach(function(r) {
                r.checked = false;
                r.parentElement.classList.remove('selected');
            });

            // 「以前チェックされていなかった」場合のみ、チェックを入れる
            // （以前チェックされていたなら、解除されたままになる＝トグル動作）
            if (!wasChecked) {
                radio.checked = true;
                div.classList.add('selected');
            }
            
            updateSelectedFeatures();
        });
    });
}

/**
 * ▼ 追加: キャラクターメモをクリップボードにコピーする
 */
async function copyMemoToClipboard() {
    const memoText = document.getElementById('char-memo').value;
    
    if (!memoText) {
        showLoaderMessage("メモが空です。", { isSuccess: false });
        return;
    }

    try {
        // モダンブラウザ向け (HTTPS環境必須)
        await navigator.clipboard.writeText(memoText);
        showLoaderMessage("メモをクリップボードにコピーしました。", { isSuccess: true });
    } catch (err) {
        // 失敗時（非SSL環境など）のフォールバック
        try {
            const textarea = document.getElementById('char-memo');
            textarea.select();
            document.execCommand('copy');
            window.getSelection().removeAllRanges(); // 選択解除
            showLoaderMessage("メモをコピーしました。", { isSuccess: true });
        } catch (fallbackErr) {
            console.error('Copy failed:', err, fallbackErr);
            showLoaderMessage("コピーに失敗しました。", { isSuccess: false });
        }
    }
}

// =========================================================================
// 計算とUI更新のコア関数
// =========================================================================

/**
 * ライフパスの変更時に呼び出され、全ての計算をゼロから実行する。
 */
function updateAllCalculations() {
    calculateAndUpdateLifepathStats();
    updateAllSkillRelatedCalculations();
}

/**
 * スキルのチェックボックスが変更されたときに呼び出されるイベントハンドラ。
 * この関数の役割は、ユーザーの操作を検知して状態データ（selectedSkills）を更新し、
 * その後のUI更新処理を呼び出すことだけに限定される。
 */
function handleSkillChange(event) {
    const checkbox = event.target;
    const skillName = checkbox.value;
    const isChecked = checkbox.checked;
    if (isChecked) {
        selectedSkills.add(skillName);
    } else {
        selectedSkills.delete(skillName);
    }
    updateAllSkillRelatedCalculations();
}

/**
 * スキルに関連するすべてのUI更新と計算をまとめて実行する関数。
 * 複数の場所から呼び出される共通の処理をここにまとめる。
 */
function updateAllSkillRelatedCalculations() {
    updateSkillsUI();
    calculateAndUpdateRAVector();
    updateSelectedSkills();
}

/**
 * ライフパスに基づいて基礎能力値と商才を計算し、表示を更新する。
 * 商才の二重計上を防ぐため、計算ロジックをより正確なものに変更。
 */
function calculateAndUpdateLifepathStats() {
    const bonuses = {};
    ALL_STATS.forEach(s => bonuses[s] = 0); 
    document.querySelectorAll('.lifepath-select').forEach(select => {
        if (select.selectedIndex > 0) { 
            const bonusData = JSON.parse(select.options[select.selectedIndex].dataset.bonus);
            for (const stat in bonusData) {
                bonuses[stat] += bonusData[stat];
            }
        }
    });
    const finalStats = {};
    const baseStats = ["体力", "知力", "魅力", "運動", "芸術", "統御"];
    baseStats.forEach(stat => {
        finalStats[stat] = bonuses[stat];
    });
    finalStats["創造力"] = finalStats["知力"] + finalStats["芸術"];
    finalStats["交渉力"] = finalStats["魅力"] + finalStats["統御"];
    finalStats["市場感覚"] = finalStats["体力"] + finalStats["運動"];
    finalStats["創造力"] += bonuses["創造力"];
    finalStats["交渉力"] += bonuses["交渉力"];
    finalStats["市場感覚"] += bonuses["市場感覚"];
    ALL_STATS.forEach(stat => {
        document.getElementById(`stat-${stat}`).value = `${stat}: ${finalStats[stat]}`;
    });
    updateLifepathDescription('lifepath-birth');
    updateLifepathDescription('lifepath-upbringing');
    updateLifepathDescription('lifepath-trigger');
}

/**
 * 【最終修正】スキルポイントを計算し、表示とカードの状態を更新する。
 * 計算ループ内で重複加算を防ぐロジックを追加。
 */
function updateSkillsUI() {
    let usedPoints = 0;
    const allSkillCheckboxes = document.querySelectorAll('input[name="skills"]');
    const processedSkills = new Set();
    selectedSkills.forEach(skillName => {
        if (!processedSkills.has(skillName)) {
            const checkbox = document.querySelector(`input[name="skills"][value="${skillName}"]`);
            if (checkbox) {
                const skillLevel = Number(checkbox.dataset.level);
                usedPoints += skillLevel;
                processedSkills.add(skillName);
            }
        }
    });
    const remainingPoints = MAX_SKILL_POINTS - usedPoints;
    document.getElementById('skill-points-tracker').textContent = `残りスキルポイント: ${remainingPoints} / ${MAX_SKILL_POINTS}`;
    allSkillCheckboxes.forEach(checkbox => {
        const isSelected = selectedSkills.has(checkbox.value);
        const card = checkbox.closest('.skill-card');
        checkbox.checked = isSelected;
        card.classList.toggle('selected', isSelected);
        const isDisabled = !isSelected && (usedPoints + Number(checkbox.dataset.level) > MAX_SKILL_POINTS);
        checkbox.disabled = isDisabled;
        card.classList.toggle('disabled', isDisabled);
    });
}

/**
 * RAベクトルを計算し、表示とグラフを更新する。
 * ライフパスから算出される基礎能力値を元に、RAベクトルの基礎値を計算するロジックを追加。
 */
function calculateAndUpdateRAVector() {
    const getStatValue = (statName) => {
        const inputElement = document.getElementById(`stat-${statName}`);
        if (inputElement && inputElement.value) {
            const valuePart = inputElement.value.split(':')[1];
            return parseInt(valuePart, 10) || 0; 
        }
        return 0;
    };
    const baseVectorR = getStatValue('運動') - getStatValue('統御');
    const baseVectorA = getStatValue('体力') - getStatValue('知力');
    let skillModifierR = 0;
    let skillModifierA = 0;
    selectedSkills.forEach(skillName => {
        const checkbox = document.querySelector(`input[name="skills"][value="${skillName}"]`);
        if (checkbox) {
            skillModifierR += Number(checkbox.dataset.r);
            skillModifierA += Number(checkbox.dataset.a);
        }
    });
    const finalVectorR = baseVectorR + skillModifierR;
    const finalVectorA = baseVectorA + skillModifierA;
    document.getElementById('stat-vector-r').textContent = finalVectorR;
    document.getElementById('stat-vector-a').textContent = finalVectorA;
    const position = getPosition(finalVectorR, finalVectorA);
    document.getElementById('stat-position').textContent = position;
    updateVectorChart(finalVectorR, finalVectorA, position);
}

// =========================================================================
// UI更新ヘルパー関数 (update系)
// =========================================================================

/**
 * 選択されたライフパスの説明文を表示する。
 * 説明文の先頭に、その項目名と得られる能力値ボーナスを追記する。
 */
function updateLifepathDescription(selectId) {
    const selectEl = document.getElementById(selectId);
    const descEl = document.getElementById(`${selectId}-desc`);
    if (selectEl.selectedIndex <= 0) {
        descEl.textContent = '';
        return; 
    }
    const selectedOption = selectEl.options[selectEl.selectedIndex];
    const description = selectedOption.dataset.description || '';
    const itemName = selectedOption.textContent; 
    const bonusData = JSON.parse(selectedOption.dataset.bonus); 
    const bonusStats = Object.keys(bonusData);
    const bonusText = bonusStats.length > 0 ? `《${bonusStats.join(', ')}》` : '';
    const headerText = `<h5>【${itemName}】<small>${bonusText}</small></h5>`;
    descEl.innerHTML = `${headerText}<p>${description}</p>`;
}

function updateSelectedFeatures() {
  const listContainer = document.getElementById('selected-features-list');
  listContainer.innerHTML = ''; 
  const selectedRadios = document.querySelectorAll('input[name^="feature_pair_"]:checked');
  if (selectedRadios.length === 0) {
    listContainer.innerHTML = '<p>特徴を選択すると、ここに表示されます。</p>';
    return;
  }
  selectedRadios.forEach(radio => {
    const data = radio.dataset;
    const card = document.createElement('div');
    card.className = `selected-feature-card ${data.type}-card`;
    card.innerHTML = `
      <h5>${data.name}</h5>
      <p>${data.desc}</p>
      <p class="pro"><b>利点:</b> ${data.pro}</p>
      <p class="con"><b>欠点:</b> ${data.con}</p>
    `;
    listContainer.appendChild(card);
  });
}

/**
 * 【変更】選択済みスキルをリスト表示する。
 * DOMのチェック状態（:checked）ではなく、状態データ（selectedSkills）に基づいて表示を生成する。
 */
function updateSelectedSkills() {
    const listContainer = document.getElementById('selected-skills-list');
    listContainer.innerHTML = '';
    if (selectedSkills.size === 0) {
        listContainer.innerHTML = '<p>スキルを選択すると、ここに表示されます。</p>';
        return;
    }
    selectedSkills.forEach(skillName => {
        const checkbox = document.querySelector(`input[name="skills"][value="${skillName}"]`);
        if (checkbox) {
            const card = checkbox.closest('.skill-card').cloneNode(true);
            card.classList.remove('selected'); 
            card.style.cursor = 'default';
            card.style.transform = 'none';
            card.onclick = null; 
            listContainer.appendChild(card);
        }
    });
}

function updateVectorChart(r, a, position) { 
    const point = document.getElementById('vector-point');
    const positionText = document.getElementById('position-text');
    const maxVectorValue = 10;
    const x = Math.max(-maxVectorValue, Math.min(maxVectorValue, r));
    const y = Math.max(-maxVectorValue, Math.min(maxVectorValue, a));
    point.style.left = `${50 + (x / maxVectorValue) * 50}%`;
    point.style.top = `${50 - (y / maxVectorValue) * 50}%`;
    positionText.textContent = position;
}

// =========================================================================
// データ計算・フォーム操作
// =========================================================================

function getPosition(r, a) {
    if (r >= -1 && r <= 1 && a >= -1 && a <= 1) return "器用貧乏フレックス";
    if (r > 3 && a >= -1 && a <= 1) return "行動のエージェント";
    if (r < -3 && a >= -1 && a <= 1) return "礎のアンカー";
    if (a > 3 && r >= -1 && r <= 1) return "剛腕のフィクサー";
    if (a < -3 && r >= -1 && r <= 1) return "知恵のコンサルタント";
    if (r > 0 && a > 0) return "脳筋ストライカー";
    if (r < 0 && a > 0) return "挑発ヴァンガード";
    if (r < 0 && a < 0) return "策士オラクル";
    if (r > 0 && a < 0) return "千手のトリックスター";
    return "器用貧乏フレックス";
}

/**
 * 【変更】フォームから現在のキャラクターデータを収集する。
 * スキル情報はDOMではなく、状態データ（selectedSkills）から取得する。
 */
async function getFormData() {
    const skills = Array.from(selectedSkills);
    const stats = {};
    ALL_STATS.forEach(stat => {
        const statElement = document.getElementById(`stat-${stat}`);
        // 基礎能力値は "体力: 5" のような形式のままなので split 必要
        const statValue = statElement ? statElement.value.split(': ')[1] : '0';
        stats[stat] = statValue !== undefined ? statValue : '0';
    });
    const selectedFeatures = Array.from(document.querySelectorAll('input[name^="feature_pair_"]:checked')).map(r => r.value);
    const characterId = document.getElementById('character-id-hidden').value;

    let passcodeHash = document.getElementById('auth-hash-hidden').value;
    if (!passcodeHash) {
        const inputCode = document.getElementById('auth-passcode').value || '0000';
        if (!/^\d{4}$/.test(inputCode)) {
            throw new Error("パスコードは4桁の数字である必要があります。");
        }
        passcodeHash = await digestMessage(inputCode);
    }

    // ▼▼▼ 画像アップロード処理の割り込み ▼▼▼
    const base64Data = document.getElementById('char-image-base64-hidden').value;
    let finalImageUrl = document.getElementById('char-image-url-hidden').value;

    // 新しい画像が選択されている場合のみアップロードを実行
    if (base64Data) {
        showLoaderMessage("画像をアップロード中...", { loader: true });
        try {
            // GAS側の関数をPromise化して呼び出すヘルパーが必要ですが、
            // ここでは簡易的に google.script.run を Promise でラップして待機します
            finalImageUrl = await new Promise((resolve, reject) => {
                const fileName = `char_${Date.now()}.jpg`;
                google.script.run
                    .withSuccessHandler(url => resolve(url))
                    .withFailureHandler(err => reject(err))
                    .saveImageToDrive(base64Data, fileName);
            });
        } catch (e) {
            throw new Error("画像のアップロードに失敗: " + e.message);
        }
    }

    const formData = {
        id: characterId,
        playerName: document.getElementById('player-name').value,
        charName: document.getElementById('char-name').value,
        birth: document.getElementById('lifepath-birth').value,
        upbringing: document.getElementById('lifepath-upbringing').value,
        trigger: document.getElementById('lifepath-trigger').value,
        
        // ▼ 追加項目
        ambition: document.getElementById('ambition').value,
        
        // ▼ 状態 (数値として取得)
        hp: document.getElementById('hit-point').value,
        mp: document.getElementById('mental-point').value,
        ip: document.getElementById('inspiration-point').value,

        // ▼ リソース (ID変更に対応)
        resHuman: document.getElementById('resource-human').value,
        resAsset: document.getElementById('resource-asset').value,
        resFund: document.getElementById('resource-fund').value,
        money: document.getElementById('money').value,

        imageUrl: finalImageUrl,

        // ▼ メモ
        memo: document.getElementById('char-memo').value,
        
        skills: skills,
        stats: stats,
        vectorR: document.getElementById('stat-vector-r').textContent,
        vectorA: document.getElementById('stat-vector-a').textContent,
        position: document.getElementById('stat-position').textContent,
        nickname: document.getElementById('nickname').value,
        useNickname: document.getElementById('use-nickname').checked,
        credit: document.getElementById('fuhyo-credit').value.split(': ')[1] || '0',
        fame: document.getElementById('fuhyo-fame').value.split(': ')[1] || '0',
        notoriety: document.getElementById('fuhyo-notoriety').value.split(': ')[1] || '0',
        features: selectedFeatures,
        passcodeHash: passcodeHash
    };
    return formData;
}

/**
 * サーバーから読み込んだデータに基づいてフォームの値を設定する。
 */
function setFormData(data) {
    document.getElementById('character-id-hidden').value = data.id || '';
    document.getElementById('player-name').value = data.playerName || '';
    document.getElementById('char-name').value = data.charName || '';
    document.getElementById('nickname').value = data.nickname || '';
    document.getElementById('use-nickname').checked = data.useNickname || false;
    document.getElementById('ambition').value = data.ambition || '';
    document.getElementById('hit-point').value = data.hp || '5';
    document.getElementById('mental-point').value = data.mp || '5';
    document.getElementById('inspiration-point').value = data.ip || '0';
    document.getElementById('resource-human').value = data.resHuman || '0';
    document.getElementById('resource-asset').value = data.resAsset || '0';
    document.getElementById('resource-fund').value = data.resFund || '0';
    document.getElementById('money').value = data.money || '0';
    document.getElementById('char-memo').value = data.memo || '';
    
    // 修正: バッククォート廃止
    document.getElementById('fuhyo-credit').value = '信用: ' + (data.credit||0);
    document.getElementById('fuhyo-fame').value = '名声: ' + (data.fame||0);
    document.getElementById('fuhyo-notoriety').value = '悪名: ' + (data.notoriety||0);

    document.getElementById('lifepath-birth').value = data.birth || '';
    document.getElementById('lifepath-upbringing').value = data.upbringing || '';
    document.getElementById('lifepath-trigger').value = data.trigger || '';

    document.querySelectorAll('.feature-option').forEach(function(div) { div.classList.remove('selected'); });
    document.querySelectorAll('input[name^="feature_pair_"]').forEach(function(r) { r.checked = false; });
    (data.features || []).forEach(function(val) {
        var radio = document.querySelector('input[name^="feature_pair_"][value="' + val + '"]');
        if (radio) {
            radio.checked = true;
            radio.parentElement.classList.add('selected');
        }
    });
    updateSelectedFeatures();

    selectedSkills.clear();
    (data.skills || []).forEach(function(s) { selectedSkills.add(s); });
    updateAllCalculations();

    // 画像復元とURL正規化
    var imgUrl = data.imageUrl || '';
    if (imgUrl) {
        var fid = null;
        var m1 = imgUrl.match(/\/d\/([^/]+)/);
        if (m1) fid = m1[1];
        else if (imgUrl.includes('id=')) {
            var m2 = imgUrl.match(/id=([^&]+)/);
            if (m2) fid = m2[1];
        }
        if (fid) imgUrl = 'https://drive.google.com/thumbnail?id=' + fid + '&sz=s4000';
    }
    
     document.getElementById('char-image-url-hidden').value = imgUrl;
    
    var statusSpan = document.getElementById('char-image-status');
    
    if (imgUrl) {
        document.getElementById('char-image-preview').src = imgUrl;
        statusSpan.textContent = ""; // 登録済みならプレビューに出るので文字は消す（すっきりさせる）
    } else {
        document.getElementById('char-image-preview').removeAttribute('src');
        statusSpan.textContent = "【未設定】";
        statusSpan.style.color = "#666";
    }
    
    document.getElementById('char-image-base64-hidden').value = '';

    document.getElementById('save-new-btn').style.display = 'none';
    document.getElementById('update-btn').style.display = 'inline-block';
    document.getElementById('delete-btn').style.display = 'inline-block';
    document.getElementById('duplicate-btn').style.display = 'inline-block';

    lockButtons();
    
    document.getElementById('auth-hash-hidden').value = data.passcodeHash || '';
    document.getElementById('auth-passcode').value = '';
}


/**
 * フォーム全体を初期状態にリセットする。
 */
function clearForm() {
    document.getElementById('character-sheet').reset();
    selectedSkills.clear();

    document.getElementById('character-id-hidden').value = ''; 
    document.querySelectorAll('.feature-option').forEach(div => div.classList.remove('selected'));
    updateSelectedFeatures();
    
    // 値のリセット (reset()で初期値に戻らないものを明示的に)
    document.getElementById('fuhyo-credit').value = "信用: 0";
    document.getElementById('fuhyo-fame').value = "名声: 0";
    document.getElementById('fuhyo-notoriety').value = "悪名: 0";
    
    // ID変更したリソースなども念の為リセット(resetでvalue属性値に戻るが確実にするため)
    document.getElementById('hit-point').value = 5;
    document.getElementById('mental-point').value = 5;
    document.getElementById('inspiration-point').value = 0;
    document.getElementById('resource-human').value = 0;
    document.getElementById('resource-asset').value = 0;
    document.getElementById('resource-fund').value = 0;

    updateAllCalculations();

    clearImageSelection();
    
    document.getElementById('update-btn').style.display = 'none';
    document.getElementById('delete-btn').style.display = 'none';
    document.getElementById('save-new-btn').style.display = 'inline-block';
    document.getElementById('auth-change-btn').style.display = 'none';
    document.getElementById('auth-register-btn').style.display = 'none';
    document.getElementById('auth-status-icon').textContent = '';
    
    const passInput = document.getElementById('auth-passcode');
    passInput.value = '';
    passInput.placeholder = '0000'; 
    document.getElementById('auth-hash-hidden').value = '';

    window.scrollTo(0, 0);
}

// =========================================================================
// 画像処理ロジック
// =========================================================================

/**
 * 画像選択時にリサイズしてプレビュー＆Base64化する
 */
function handleImageSelect(e) {
    var file = e.target.files[0];
    if (!file) return;
    
    // ▼ 追加: 選択されたファイル名を表示する
    var statusSpan = document.getElementById('char-image-status');
    statusSpan.textContent = "画像: " + file.name;
    statusSpan.style.color = "#d32f2f";

    var reader = new FileReader();
    reader.onload = function(ev) {
        var img = new Image();
        img.onload = function() {
            var cvs = document.createElement('canvas');
            var MAX = 600;
            var w = img.width, h = img.height;
            if (w > h) { if (w > MAX) { h *= MAX/w; w = MAX; } }
            else { if (h > MAX) { w *= MAX/h; h = MAX; } }
            cvs.width = w; cvs.height = h;
            cvs.getContext('2d').drawImage(img, 0, 0, w, h);
            var data = cvs.toDataURL('image/jpeg', 0.8);
            document.getElementById('char-image-preview').src = data;
            document.getElementById('char-image-base64-hidden').value = data;
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

function clearImageSelection() {
    document.getElementById('char-image-input').value = '';
    document.getElementById('char-image-preview').src = '';
    document.getElementById('char-image-base64-hidden').value = ''; // 新規データをクリア
    document.getElementById('char-image-url-hidden').value = '';    // 既存URLもクリア

    // ▼ 追加: ステータス更新
    document.getElementById('char-image-status').textContent = "【未設定】";
}

// =========================================================================
// Google Apps Script連携
// =========================================================================
/**
 * サーバー(コード.gs)に問い合わせ、保存されているキャラクターのリストを取得して画面に表示します。
 * この関数は、ページの初回読み込み時、キャラクターの新規保存後、削除後に呼び出されます。
 */
function loadCharacterList() {
    const listElement = document.getElementById('char-list');
    const loaderElement = document.getElementById('loader');
    const contentElement = document.getElementById('char-list-content');
    const triggerElement = document.getElementById('char-list-trigger');

    listElement.innerHTML = '';
    loaderElement.style.display = 'block';

    google.script.run
        .withSuccessHandler(characterDataList => {
            loaderElement.style.display = 'none';

            // ▼▼▼ 修正箇所: characterDataList が null の場合のガードを追加 ▼▼▼
            if (!characterDataList || characterDataList.length === 0) {
                listElement.innerHTML = '<li>保存されたキャラクターはいません。</li>';
            } else {
                characterDataList.forEach(char => {
                    const li = document.createElement('li');
                    let dateStr = '';
                    if (char.updatedAt) {
                        const d = new Date(char.updatedAt);
                        if (!isNaN(d.getTime())) {
                            const y = d.getFullYear();
                            const m = (d.getMonth() + 1).toString().padStart(2, '0');
                            const day = d.getDate().toString().padStart(2, '0');
                            dateStr = `${y}/${m}/${day}`;
                        }
                    }
                    const textSpan = document.createElement('span');
                    textSpan.innerHTML = `
                        <small>ID:${char.id}</small> <strong>${char.charName}</strong><br>
                        <small>${char.playerName} <span style="color:#888; margin-left:0.5em;">🔄 ${dateStr}</span></small>
                    `;
                    li.appendChild(textSpan);
                    
                    const viewButton = document.createElement('button');
                    viewButton.textContent = '表示';
                    viewButton.className = 'button-secondary';
                    viewButton.onclick = () => loadCharacterData(char.id);
                    
                    li.appendChild(viewButton);
                    listElement.appendChild(li);
                });
            }

            if (triggerElement.classList.contains('active')) {
                contentElement.style.maxHeight = contentElement.scrollHeight + "px";
            }
        })
        .withFailureHandler(error => {
            loaderElement.style.display = 'none';
            showLoaderMessage(`リストの読み込みに失敗しました: ${error.message}`, { isSuccess: false });
        })
        .getCharacterList();
}

async function saveCharacter() { // asyncに変更
    try {
        const data = await getFormData(); // await
        if (!data.charName || !data.playerName) {
            showLoaderMessage("プレイヤー名とキャラクター名は必須です。", { isSuccess: false });
            return;
        }
        showLoaderMessage("キャラクターを保存中です...", { loader: true }); 
        google.script.run
            .withSuccessHandler(response => {
                hideLoaderMessage(); 
                showLoaderMessage(response, { isSuccess: true });
                loadCharacterList();
                clearForm();
            })
            .withFailureHandler(error => {
                hideLoaderMessage(); 
                showLoaderMessage(`保存失敗: ${error.message}`, { isSuccess: false });
            })
            .saveNewCharacterSheet(data);
    } catch (e) {
        showLoaderMessage(`エラー: ${e.message}`, { isSuccess: false });
    }
}

async function updateCharacter() { // asyncに変更
    try {
        const data = await getFormData(); // await
        // 更新時は元のハッシュ(hidden)をそのまま送る（パスワード変更は別ルート）
        // getFormDataでauth-hash-hiddenを優先して読むようにしているのでOK
        
        if (!data.charName || !data.playerName) {
            showLoaderMessage("プレイヤー名とキャラクター名は必須です。", { isSuccess: false });
            return;
        }
        showLoaderMessage("キャラクターを更新中です...", { loader: true });
        google.script.run
            .withSuccessHandler(response => {
                hideLoaderMessage(); 
                showLoaderMessage(response, { isSuccess: true });
                loadCharacterList();
            })
            .withFailureHandler(error => {
                hideLoaderMessage(); 
                showLoaderMessage(`更新失敗: ${error.message}`, { isSuccess: false });
            })
            .updateCharacterSheet(data);
    } catch (e) {
        showLoaderMessage(`エラー: ${e.message}`, { isSuccess: false });
    }
}

/**
 * キャラクターデータをIDで読み込むように変更
 */
function loadCharacterData(characterId) {
    if (!characterId) return;
    
    showLoaderMessage("キャラクターを読み込み中です...", { loader: true });
    google.script.run
        .withSuccessHandler(data => {
            if (data) {
                hideLoaderMessage();
                setFormData(data);
                showLoaderMessage(`ID: ${characterId} のデータを読み込みました。`, { isSuccess: true });
                window.scrollTo(0, 0); 
            } else {
                hideLoaderMessage();
                showLoaderMessage(`ID: ${characterId} のデータが見つかりませんでした。`, { isSuccess: false });
            }
        })
        .withFailureHandler(error => {
            hideLoaderMessage();
            showLoaderMessage(`データ読み込み失敗: ${error.message}`, { isSuccess: false });
        })
        .getCharacterData(characterId);
}

/**
 * 現在表示中のデータを元に、新規保存モードへ移行する（複製）
 */
function duplicateCharacter() {
    // IDをクリア（これで新規扱いになる）
    document.getElementById('character-id-hidden').value = '';
    
    // 認証情報をクリア（新しいパスコードを設定させるため）
    document.getElementById('auth-hash-hidden').value = '';
    document.getElementById('auth-passcode').value = '';
    document.getElementById('auth-status-icon').textContent = '';
    
    // ボタン表示の切り替え（複製ボタンは隠さない）
    document.getElementById('save-new-btn').style.display = 'inline-block';
    document.getElementById('update-btn').style.display = 'none';
    document.getElementById('delete-btn').style.display = 'none';
    
    // 認証関連ボタンの非表示
    document.getElementById('auth-change-btn').style.display = 'none';
    document.getElementById('auth-register-btn').style.display = 'none';

    showLoaderMessage("複製しました。内容を編集して「新規保存」してください。", { isSuccess: true });
    window.scrollTo(0, 0);
}

/**
 * 【改修】キャラクターをIDで削除するように変更
 */
function deleteCharacter() {
    const characterId = document.getElementById('character-id-hidden').value;
    if (!characterId) {
        showLoaderMessage("削除対象のキャラクターが選択されていません。", { isSuccess: false });
        return;
    }
    const charName = document.getElementById('char-name').value;
    if (!confirm(`本当に「${charName}」(ID: ${characterId})を削除しますか？この操作は取り消せません。`)) {
        return;
    }
    showLoaderMessage("キャラクターを削除中です...", { loader: true });
    google.script.run
        .withSuccessHandler(response => {
            hideLoaderMessage();
            showLoaderMessage(response, { isSuccess: true });
            loadCharacterList();
            clearForm(); 
        })
        .withFailureHandler(error => {
            hideLoaderMessage();
            showLoaderMessage(`削除失敗: ${error.message}`, { isSuccess: false });
        })
        .deleteCharacterSheet(characterId);
}

// =========================================================================
// ココフォリア連携機能
// =========================================================================

/**
 * キャラクターデータをココフォリア形式のJSONに変換し、クリップボードにコピーする
 * (シンタックスエラー回避のため、文字列結合を + に変更した修正版)
 */
async function copyToCcfolia() {
    try {
        var name = document.getElementById('char-name').value || '名称未設定';
        var pl = document.getElementById('player-name').value || '未設定';
        var nick = document.getElementById('nickname').value;
        var useNick = document.getElementById('use-nickname').checked;
        var id = document.getElementById('character-id-hidden').value;
        var img = document.getElementById('char-image-url-hidden').value || null;
        
        // 修正: バッククォート廃止
        var dispName = (useNick && nick) ? '[' + nick + '] ' + name : name;

        var extUrl = "";
        if (id && typeof DEPLOY_URL !== 'undefined' && DEPLOY_URL) {
            extUrl = DEPLOY_URL + "?id=" + id;
        }

        var parse = function(id) {
            var v = document.getElementById(id).value;
            var m = v.match(/-?\d+/);
            return m ? parseInt(m[0]) : 0;
        };
        var hp = parse('hit-point');
        var mp = parse('mental-point');

        var params = [];
        var cmds = [];
        ALL_STATS.forEach(function(k) {
            var v = parse('stat-' + k);
            params.push({ label: k, value: String(v) });
            // 修正: バッククォート廃止
            cmds.push('1d10+{' + k + '}>=6 ' + k + '判定');
        });
        
        var addParam = function(k, id) {
            params.push({ label: k, value: String(parse(id)) });
        };
        addParam('IP', 'inspiration-point');
        addParam('信用', 'fuhyo-credit');
        addParam('名声', 'fuhyo-fame');
        addParam('悪名', 'fuhyo-notoriety');
        addParam('人材', 'resource-human');
        addParam('資産', 'resource-asset');
        addParam('資金', 'resource-fund');
        
        cmds.push('1d10+{IP}>=6 IP判定');
        cmds.push('1d10+{信用}>=6 信用判定');

        var r = parseInt(document.getElementById('stat-vector-r').textContent||0);
        var a = parseInt(document.getElementById('stat-vector-a').textContent||0);
        params.push({label:'R',value:String(r)}, {label:'A',value:String(a)});

        var skills = Array.from(selectedSkills).join(' / ');
        var feats = [];
        document.querySelectorAll('.selected-feature-card h5').forEach(function(e){ feats.push(e.textContent); });
        var pos = document.getElementById('stat-position').textContent;
        
        // 修正: バッククォート廃止（最も重要）
        var memo = 'PL: ' + pl + '\n' +
                   'ポジション: ' + pos + '\n' +
                   '【特徴】\n' + feats.join(' / ') + '\n' +
                   '【スキル】\n' + skills + '\n\n' +
                   "Generated by Candle's EntrySheet";

        var json = {
            kind: "character",
            data: {
                name: dispName, memo: memo, initiative: 0, externalUrl: extUrl,
                status: [{label:"HP",value:hp,max:hp}, {label:"MP",value:mp,max:mp}],
                params: params, iconUrl: img, faces: [], x:0, y:0, angle:0, width:4, height:4,
                active:true, secret:false, invisible:false, hideStatus:false, color:"",
                commands: cmds.join('\n'), owner:null
            }
        };
        
        await navigator.clipboard.writeText(JSON.stringify(json));
        showLoaderMessage("クリップボードにコピーしました", { isSuccess: true });
    } catch(e) {
        console.error(e);
        showLoaderMessage("コピー失敗: " + e.message, { isSuccess: false });
    }
}

// =========================================================================
// フローティングメッセージ制御（改修版）
// =========================================================================

// 自動消去用のタイマーIDを保持する変数
let messageClearTimer;

/**
 * フローティングメッセージを表示する。
 * @param {string} message - 表示するテキスト
 * @param {object} options - オプション
 * @param {boolean} [options.loader=false] - trueの場合、自動で消えず操作をブロックする
 * @param {boolean} [options.isSuccess=true] - メッセージの見た目を制御する
 */
function showLoaderMessage(message, options = {}) {
    const { loader = false, isSuccess = true } = options;

    const modal = document.getElementById('loader-modal');
    const messageBox = modal.querySelector('.modal-message');
    const textElement = document.getElementById('loader-text');

    // 以前のタイマーが残っていればクリア
    clearTimeout(messageClearTimer);

    // メッセージとスタイルの設定
    textElement.textContent = message;
    messageBox.classList.toggle('is-error', !isSuccess);

    // 表示モードの切り替え
    if (loader) {
        // ローダーモード：バックドロップあり、自動で消えない
        modal.classList.remove('is-toast');
    } else {
        // トーストモード：バックドロップなし、自動で消える
        modal.classList.add('is-toast');
        messageClearTimer = setTimeout(() => {
            hideLoaderMessage();
        }, 2000); // 2000ms後に自動消去
    }
    
    // メッセージを表示
    modal.classList.add('is-active');
}

/**
 * フローティングメッセージとバックドロップを非表示にする
 */
function hideLoaderMessage() {
    document.getElementById('loader-modal').classList.remove('is-active');
}

</script>