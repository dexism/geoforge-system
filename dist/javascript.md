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
    document.getElementById('clear-btn').addEventListener('click', clearForm);
    document.getElementById('delete-btn').addEventListener('click', deleteCharacter);
    
    // --- 認証関連のイベントリスナー (追加) ---
    const passcodeInput = document.getElementById('auth-passcode');
    passcodeInput.addEventListener('input', handlePasscodeInput);
    
    document.getElementById('auth-change-btn').addEventListener('click', enterChangePasscodeMode);
    document.getElementById('auth-register-btn').addEventListener('click', registerNewPasscode);

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
    const skillListContainer = document.querySelector('.skill-list');
    skillListContainer.innerHTML = ''; 
    Object.keys(SKILLS).forEach(category => {
        const accordion = document.createElement('div');
        accordion.className = 'accordion';
        const summary = document.createElement('summary');
        summary.className = 'accordion-trigger';
        summary.innerHTML = `<span class="arrow"></span> ${category}`;
        accordion.appendChild(summary);
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'accordion-content';
        const contentDiv = document.createElement('div'); 
        contentDiv.style.padding = "1rem"; 
        SKILLS[category].forEach(skill => {
            const card = document.createElement('div');
            card.className = 'skill-card';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.name = 'skills';
            checkbox.value = skill.name;
            checkbox.setAttribute('data-level', skill.level);
            checkbox.setAttribute('data-r', skill.r);
            checkbox.setAttribute('data-a', skill.a);
            const header = document.createElement('div');
            header.className = 'skill-card-header';
            const h5 = document.createElement('h5');
            h5.textContent = skill.name;
            const span = document.createElement('span');
            const r_val = skill.r >= 0 ? `+${skill.r}` : skill.r;
            const a_val = skill.a >= 0 ? `+${skill.a}` : skill.a;
            span.textContent = `《L ${skill.level} / R ${r_val} / A ${a_val}》`;
            const description = document.createElement('p');
            description.className = 'skill-description';
            description.textContent = skill.description;
            header.appendChild(h5);
            header.appendChild(span);
            card.appendChild(checkbox);
            card.appendChild(header);
            card.appendChild(description);
            contentDiv.appendChild(card);
        });
        contentWrapper.appendChild(contentDiv);
        const closeTrigger = document.createElement('div');
        closeTrigger.className = 'accordion-close-trigger';
        closeTrigger.innerHTML = '▲ 閉じる';
        contentWrapper.appendChild(closeTrigger);
        accordion.appendChild(contentWrapper);
        skillListContainer.appendChild(accordion);
    });
}

function populateFeaturesList() {
    const container = document.getElementById('features-selection-accordions');
    container.innerHTML = ''; 
    Object.keys(FEATURES_DATA).forEach(category => {
        const accordion = document.createElement('div');
        accordion.className = 'accordion';
        const summary = document.createElement('summary');
        summary.className = 'accordion-trigger';
        summary.innerHTML = `<span class="arrow"></span> ${category}`;
        accordion.appendChild(summary);
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'accordion-content';
        const contentDiv = document.createElement('div'); 
        contentDiv.style.padding = "1rem"; 
        FEATURES_DATA[category].forEach((pair, index) => {
            const pairCard = document.createElement('div');
            pairCard.className = 'feature-pair-card';
            const radioGroupName = `feature_pair_${category}_${index}`;
            const primeDiv = document.createElement('div');
            primeDiv.className = 'feature-option prime';
            primeDiv.innerHTML = `
                <input type="radio" name="${radioGroupName}" value="${pair.prime_name}" data-type="prime" data-name="${pair.prime_name}" data-desc="${pair.prime_desc}" data-pro="${pair.prime_pro}" data-con="${pair.prime_con}">
                    <h5>${pair.prime_name}</h5>
                    <p>${pair.prime_desc}</p>
                    <p class="pro"><b>利点:</b> ${pair.prime_pro}</p>
                    <p class="con"><b>欠点:</b> ${pair.prime_con}</p>
            `;
            const fallenDiv = document.createElement('div');
            fallenDiv.className = 'feature-option fallen';
            fallenDiv.innerHTML = `
                <input type="radio" name="${radioGroupName}" value="${pair.fallen_name}" data-type="fallen" data-name="${pair.fallen_name}" data-desc="${pair.fallen_desc}" data-pro="${pair.fallen_pro}" data-con="${pair.fallen_con}">
                    <h5>${pair.fallen_name}</h5>
                    <p>${pair.fallen_desc}</p>
                    <p class="pro"><b>利点:</b> ${pair.fallen_pro}</p>
                    <p class="con"><b>欠点:</b> ${pair.fallen_con}</p>
            `;
            pairCard.appendChild(primeDiv);
            pairCard.appendChild(fallenDiv);
            contentDiv.appendChild(pairCard);
            [primeDiv, fallenDiv].forEach(div => {
                div.addEventListener('click', () => {
                    const radio = div.querySelector('input');
                    const wasChecked = radio.checked;
                    primeDiv.classList.remove('selected');
                    fallenDiv.classList.remove('selected');
                    primeDiv.querySelector('input').checked = false;
                    fallenDiv.querySelector('input').checked = false;
                    if (!wasChecked) {
                        div.classList.add('selected');
                        radio.checked = true;
                    }
                    primeDiv.querySelector('input').dispatchEvent(new Event('change'));
                });
            });
        });
        contentWrapper.appendChild(contentDiv);
        const closeTrigger = document.createElement('div');
        closeTrigger.className = 'accordion-close-trigger';
        closeTrigger.innerHTML = '▲ 閉じる';
        contentWrapper.appendChild(closeTrigger);
        accordion.appendChild(contentWrapper);
        container.appendChild(accordion);
    });
    document.querySelectorAll('input[name^="feature_pair_"]').forEach(radio => {
        radio.addEventListener('change', updateSelectedFeatures);
    });
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
        const statValue = statElement ? statElement.value.split(': ')[1] : '0';
        stats[stat] = statValue !== undefined ? statValue : '0';
    });
    const selectedFeatures = Array.from(document.querySelectorAll('input[name^="feature_pair_"]:checked')).map(r => r.value);
    const characterId = document.getElementById('character-id-hidden').value;

    // ▼▼▼ パスコードの処理 (追加) ▼▼▼
    // 新規保存時は入力されたコード、空なら0000をハッシュ化して送信
    let passcodeHash = document.getElementById('auth-hash-hidden').value;
    if (!passcodeHash) { // 新規の場合
        const inputCode = document.getElementById('auth-passcode').value || '0000';
        if (!/^\d{4}$/.test(inputCode)) {
            throw new Error("パスコードは4桁の数字である必要があります。");
        }
        passcodeHash = await digestMessage(inputCode);
    }

    const formData = {
        id: characterId,
        playerName: document.getElementById('player-name').value,
        charName: document.getElementById('char-name').value,
        birth: document.getElementById('lifepath-birth').value,
        upbringing: document.getElementById('lifepath-upbringing').value,
        trigger: document.getElementById('lifepath-trigger').value,
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
        // ▼▼▼
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
    document.getElementById('fuhyo-credit').value = `信用: ${data.credit || 0}`;
    document.getElementById('fuhyo-fame').value = `名声: ${data.fame || 0}`;
    document.getElementById('fuhyo-notoriety').value = `悪名: ${data.notoriety || 0}`;
    document.getElementById('lifepath-birth').value = data.birth || '';
    document.getElementById('lifepath-upbringing').value = data.upbringing || '';
    document.getElementById('lifepath-trigger').value = data.trigger || '';
    
    document.querySelectorAll('.feature-option').forEach(div => div.classList.remove('selected'));
    document.querySelectorAll('input[name^="feature_pair_"]').forEach(radio => {
        radio.checked = (data.features || []).includes(radio.value);
        if (radio.checked) {
            radio.parentElement.classList.add('selected');
        }
    });
    updateSelectedFeatures();

    selectedSkills.clear();
    (data.skills || []).forEach(skillName => {
        selectedSkills.add(skillName);
    });

    updateAllCalculations();

    // ▼▼▼ ボタン・認証状態の制御 (追加) ▼▼▼
    document.getElementById('save-new-btn').style.display = 'none';
    document.getElementById('update-btn').style.display = 'inline-block';
    document.getElementById('delete-btn').style.display = 'inline-block';

    // 読み込み時はロック状態にする
    lockButtons(); 
    
    // 認証用ハッシュを隠しフィールドにセット
    document.getElementById('auth-hash-hidden').value = data.passcodeHash || ''; 
    
    // 認証入力欄をクリア
    const passInput = document.getElementById('auth-passcode');
    passInput.value = '';
    passInput.placeholder = ''; 
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
    document.getElementById('fuhyo-credit').value = "信用: 0";
    document.getElementById('fuhyo-fame').value = "名声: 0";
    document.getElementById('fuhyo-notoriety').value = "悪名: 0";

    updateAllCalculations();
    
    // ▼▼▼ ボタン・認証状態の初期化 (追加) ▼▼▼
    document.getElementById('update-btn').style.display = 'none';
    document.getElementById('delete-btn').style.display = 'none';
    document.getElementById('save-new-btn').style.display = 'inline-block';
    document.getElementById('auth-change-btn').style.display = 'none';
    document.getElementById('auth-register-btn').style.display = 'none';
    document.getElementById('auth-status-icon').textContent = '';
    
    // 認証入力欄のリセット
    const passInput = document.getElementById('auth-passcode');
    passInput.value = '';
    passInput.placeholder = '0000'; // 新規保存時のデフォルト
    document.getElementById('auth-hash-hidden').value = '';

    window.scrollTo(0, 0);
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
            if (characterDataList.length === 0) {
                listElement.innerHTML = '<li>保存されたキャラクターはいません。</li>';
            } else {
                characterDataList.forEach(char => { 
                    const li = document.createElement('li');
                    const textSpan = document.createElement('span');
                    textSpan.innerHTML = `
                        <small>ID:${char.id}</small> <strong>${char.charName}</strong><br>
                        <small>${char.playerName}</small>
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