/* ===== 退屈しのぎの飼育論 - app.js ===== */
'use strict';

/* --------------------------------------------------
   ゲーム状態
-------------------------------------------------- */
const GS = {
  playerName: '',
  score: 0,
  currentNode: 's1_n1',
  outfitChoice: 'B',
  choiceHistory: [],
  textLog: [],
  isTyping: false,
  _typingTimer: null,
  _cancelTyping: null,
  scenario: null,
  currentBg: 'bg-bedroom',
  pendingNext: null,
};

/* --------------------------------------------------
   テキスト速度設定
-------------------------------------------------- */
let typingSpeed = 35;   /* ms/文字 */

/* --------------------------------------------------
   DOM取得ヘルパー
-------------------------------------------------- */
const $ = id => document.getElementById(id);

/* --------------------------------------------------
   初期化
-------------------------------------------------- */
async function init() {
  /* サービスワーカー登録 */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  /* シナリオ読み込み */
  try {
    const res = await fetch('./scenario.json');
    GS.scenario = await res.json();
  } catch (e) {
    alert('シナリオの読み込みに失敗しました。');
    return;
  }

  /* プレイヤー名を確認 */
  const savedName = localStorage.getItem('taikutsu_playerName');
  if (savedName) {
    GS.playerName = savedName;
    showScreen('title');
  } else {
    showScreen('name-input');
  }

  /* イベント登録 */
  bindEvents();
}

/* --------------------------------------------------
   画面切り替え
-------------------------------------------------- */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = $(`screen-${name}`);
  if (target) {
    target.classList.add('active');
    onScreenShown(name);
  }
}

function onScreenShown(name) {
  if (name === 'log')      renderLog();
  if (name === 'settings') updateSettingsUI();
}

/* --------------------------------------------------
   イベント登録
-------------------------------------------------- */
function bindEvents() {
  /* タイトル */
  $('btn-new-game').addEventListener('click', startNewGame);
  $('btn-title-settings').addEventListener('click', () => showScreen('settings'));

  /* 名前入力 */
  $('name-input-field').addEventListener('input', onNameInput);
  $('btn-name-confirm').addEventListener('click', confirmName);

  /* メッセージウィンドウ（タップ送り） */
  $('msg-box').addEventListener('click', onMsgTap);

  /* コントロールボタン */
  $('btn-log').addEventListener('click', () => showScreen('log'));
  $('btn-menu').addEventListener('click', () => showScreen('settings'));

  /* サブ画面の戻るボタン */
  ['log', 'settings'].forEach(name => {
    const btn = $(`btn-back-${name}`);
    if (btn) btn.addEventListener('click', () => showScreen('game'));
  });

  /* エンディング */
  $('btn-ending-title').addEventListener('click', () => showScreen('title'));
  $('btn-ending-retry').addEventListener('click', startNewGame);

  /* スライダー */
  const speedSlider = $('speed-slider');
  if (speedSlider) {
    speedSlider.addEventListener('input', () => {
      typingSpeed = 100 - parseInt(speedSlider.value);
      $('speed-val').textContent = speedSlider.value;
    });
  }

  /* 設定：名前変更 */
  $('btn-change-name').addEventListener('click', () => {
    showScreen('name-input');
    $('name-input-field').value = GS.playerName;
    onNameInput();
  });
}

/* --------------------------------------------------
   名前入力
-------------------------------------------------- */
function onNameInput() {
  const val = $('name-input-field').value.trim();
  const preview = $('name-preview');
  if (val) {
    preview.innerHTML = `えいとが呼ぶ名前：<span class="name-highlight">${escHtml(val)}ちゃん</span>`;
  } else {
    preview.textContent = '名前を入力してください';
  }
}

function confirmName() {
  const val = $('name-input-field').value.trim();
  if (!val) return;
  GS.playerName = val;
  localStorage.setItem('taikutsu_playerName', val);
  showScreen('title');
}

/* --------------------------------------------------
   新規ゲーム
-------------------------------------------------- */
function startNewGame() {
  GS.score = 0;
  GS.currentNode = GS.scenario.startNode;
  GS.outfitChoice = 'B';
  GS.choiceHistory = [];
  GS.textLog = [];
  GS.pendingNext = null;
  _stopTyping();

  updateScoreBar();
  $('choice-overlay').classList.remove('visible');

  showScreen('game');

  /* 少し待ってからノード処理開始 */
  setTimeout(() => processNode(GS.currentNode), 300);
}

/* --------------------------------------------------
   ノード処理（コアループ）
-------------------------------------------------- */
function processNode(nodeId) {
  if (!nodeId || !GS.scenario) return;

  const node = GS.scenario.nodes[nodeId];
  if (!node) { console.warn('Node not found:', nodeId); return; }

  GS.currentNode = nodeId;

  switch (node.type) {
    case 'bg':
      changeBg(node.bg);
      processNode(node.next);
      break;

    case 'narrate':
      showMessage(null, node.text, 'narrator', node.next);
      break;

    case 'thought':
      showMessage('私', node.text, 'thought', node.next);
      break;

    case 'dialogue':
      showMessage(node.speaker, node.text, node.speakerStyle || 'dialogue', node.next);
      updateCharExpression(node.speaker, node.text);
      break;

    case 'choice':
      showChoices(node);
      break;

    case 'conditional': {
      const val = GS[node.variable] || 'B';
      const nextId = node.cases[val] || node.cases['B'];
      processNode(nextId);
      break;
    }

    case 'ending_calc':
      calculateEnding();
      break;

    default:
      console.warn('Unknown node type:', node.type);
  }
}

/* --------------------------------------------------
   メッセージ表示
-------------------------------------------------- */
function showMessage(speaker, text, style, nextNodeId) {
  /* choice オーバーレイを隠す */
  $('choice-overlay').classList.remove('visible');

  const processed = processText(text);
  const speakerEl = $('speaker-name');
  const textEl    = $('msg-text');
  const nextArrow = $('next-indicator');

  /* 話者名 */
  if (speaker === null) {
    speakerEl.className = 'speaker-name speaker-narrator';
    speakerEl.textContent = '';
    textEl.className = 'msg-text narrator-style';
  } else if (speaker === '私') {
    speakerEl.className = 'speaker-name speaker-player';
    speakerEl.textContent = GS.playerName || '私';
    textEl.className = style === 'thought' ? 'msg-text thought-style' : 'msg-text';
  } else {
    speakerEl.className = 'speaker-name' + (style === 'phone' ? ' speaker-phone' : '');
    speakerEl.textContent = speaker;
    textEl.className = 'msg-text';
  }

  nextArrow.classList.remove('visible');
  GS.pendingNext = nextNodeId;

  /* テキストログに追加 */
  GS.textLog.push({ speaker: speaker || 'ナレーター', text: processed });

  /* タイピング表示 */
  typeText(textEl, processed, () => {
    nextArrow.classList.add('visible');
  });
}

/* --------------------------------------------------
   タイピングエフェクト
-------------------------------------------------- */
function typeText(el, text, onDone) {
  _stopTyping();

  GS.isTyping = true;
  el.dataset.full = text;
  el.innerHTML = '';

  let i = 0;
  let cancelled = false;
  const cursor = document.createElement('span');
  cursor.className = 'msg-cursor';

  GS._cancelTyping = () => { cancelled = true; };

  function _finish() {
    el.innerHTML = text.replace(/\n/g, '<br>');
    el.appendChild(cursor);
    GS.isTyping = false;
    GS._cancelTyping = null;
    if (onDone) onDone();
  }

  function tick() {
    if (cancelled) return;
    if (i >= text.length) { _finish(); return; }

    const ch = text[i++];
    el.innerHTML = text.slice(0, i).replace(/\n/g, '<br>');
    el.appendChild(cursor);

    let delay = typingSpeed;
    if (ch === '…' || ch === '。') delay = typingSpeed * 3.5;
    else if (ch === '、')           delay = typingSpeed * 1.8;
    else if (ch === '\n')           delay = typingSpeed * 2.5;

    GS._typingTimer = setTimeout(tick, delay);
  }

  tick();
}

/* タイピングを完全停止するヘルパー */
function _stopTyping() {
  if (GS._cancelTyping) GS._cancelTyping();
  clearTimeout(GS._typingTimer);
  GS._cancelTyping = null;
  GS._typingTimer  = null;
  GS.isTyping = false;
}

/* --------------------------------------------------
   タップ送り
-------------------------------------------------- */
function onMsgTap() {
  /* 選択肢表示中は無視 */
  if ($('choice-overlay').classList.contains('visible')) return;

  /* タイピング中 → 全文を即時表示してタップ待ち状態へ */
  if (GS.isTyping) {
    _stopTyping();
    const textEl  = $('msg-text');
    const fullText = textEl.dataset.full || textEl.innerHTML;
    const cursor   = document.createElement('span');
    cursor.className = 'msg-cursor';
    textEl.innerHTML = fullText.replace(/\n/g, '<br>');
    textEl.appendChild(cursor);
    $('next-indicator').classList.add('visible');
    return; /* 次のタップで進む */
  }

  /* タイピング完了後 → 次のノードへ進む */
  const next = GS.pendingNext;
  if (next) {
    GS.pendingNext = null;
    processNode(next);
  }
}

/* --------------------------------------------------
   選択肢表示
-------------------------------------------------- */
function showChoices(node) {
  _stopTyping();
  GS.pendingNext = null;

  const overlay  = $('choice-overlay');
  const titleEl  = $('choice-title');
  const container = $('choice-buttons');

  titleEl.textContent = node.label || '選択してください';
  container.innerHTML = '';

  /* メッセージウィンドウの内容をクリア */
  $('msg-text').innerHTML = '';
  $('speaker-name').textContent = '';
  $('next-indicator').classList.remove('visible');

  const shuffled = [...node.choices].sort(() => Math.random() - 0.5);
  shuffled.forEach((choice, idx) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.innerHTML = `<span class="choice-label">${idx + 1}</span>${escHtml(processText(choice.text))}`;
    btn.addEventListener('click', () => makeChoice(choice));
    container.appendChild(btn);

    /* 少し遅れてフェードイン */
    btn.style.opacity = '0';
    btn.style.transform = 'translateY(8px)';
    btn.style.transition = 'all 0.3s';
    setTimeout(() => {
      btn.style.opacity = '1';
      btn.style.transform = 'translateY(0)';
    }, idx * 80 + 50);
  });

  overlay.classList.add('visible');
}

/* --------------------------------------------------
   選択肢決定
-------------------------------------------------- */
function makeChoice(choice) {
  /* 選択肢UIを隠す */
  $('choice-overlay').classList.remove('visible');

  /* スコア加算 */
  GS.score += choice.score;
  GS.choiceHistory.push({ text: choice.text, score: choice.score });
  updateScoreBar();

  /* storeAs：状態変数へ保存（服装選択など） */
  if (choice.storeAs) {
    GS[choice.storeAs] = choice.label;
  }

  /* レスポンステキストがある場合は表示してから次へ */
  if (choice.responseText) {
    const style = choice.speakerType || 'dialogue';
    const speaker = choice.responseSpeaker || null;
    showMessage(speaker, choice.responseText, style, choice.next);
    if (speaker !== null && speaker !== '私') {
      updateCharExpression(speaker, choice.responseText);
    }
  } else {
    processNode(choice.next);
  }
}

/* --------------------------------------------------
   テキスト加工（プレイヤー名置換）
-------------------------------------------------- */
function processText(text) {
  if (!text) return '';
  if (!GS.playerName) return text;
  return text.replace(/お姉さん(?!系)/g, `${GS.playerName}ちゃん`);
}

/* --------------------------------------------------
   背景変更
-------------------------------------------------- */
function changeBg(bgClass) {
  const bgEl = $('game-bg');
  bgEl.className = `game-bg ${bgClass}`;
  GS.currentBg = bgClass;

  /* 雨演出 */
  const rainEl = $('rain-overlay');
  if (bgClass === 'bg-rain-night') {
    rainEl.classList.add('active');
  } else {
    rainEl.classList.remove('active');
  }
}

/* --------------------------------------------------
   キャラクター表情更新（PNG対応）
   ファイル命名規則:
     chara_normal.PNG    通常
     chara_happy.png     笑顔・嬉しい
     chara_surprised.png 驚き
     chara_tired.png     消耗・落ち込み
     chara_intense.png   鋭い目・緊迫
-------------------------------------------------- */

/* 事前にロード済みか確認したPNGセット */
const _pngCache = {};

function _resolveExpr(text) {
  if (/笑|あはは|ウケる|最高|頼もし|嬉し|グッとくる|ツボ/.test(text)) return 'happy';
  if (/うわ|マジか|え、お|え、あ|ちょ、/.test(text))                 return 'surprised';
  if (/辛|疲|ダル|涙|消えればいい|ボロボロ|限界|泣きそう/.test(text)) return 'tired';
  if (/ゾクゾク|逃げ場|縛|特級|降参|一生/.test(text))               return 'intense';
  return 'normal';
}

function updateCharExpression(speaker, text, forceExpr) {
  const img = $('char-sprite');
  if (!img) return;

  /* えいと以外のときはキャラを非表示 */
  if (speaker !== 'えいと') {
    img.classList.add('hidden');
    return;
  }
  img.classList.remove('hidden');

  const expr  = forceExpr || _resolveExpr(text);
  const src   = `./chara_${expr}.PNG`;

  /* 同じ画像なら何もしない */
  if (img.dataset.currentExpr === expr) return;

  /* PNG が存在するか確認してから切り替え */
  if (_pngCache[src] === false) {
    /* このexprのPNGがない場合 → normalにフォールバック */
    _switchSprite(img, './chara_normal.PNG', 'normal');
    return;
  }

  const probe = new Image();
  probe.onload = () => {
    _pngCache[src] = true;
    _switchSprite(img, src, expr);
  };
  probe.onerror = () => {
    _pngCache[src] = false;
    /* expr固有のPNGがなければnormalを試みる */
    if (expr !== 'normal') {
      updateCharExpression(speaker, text, 'normal');
    } else {
      /* chara_normal.PNG すら無ければ非表示 */
      img.classList.add('hidden');
    }
  };
  probe.src = src;
}

function _switchSprite(img, src, expr) {
  /* フェードアウト → src切り替え → フェードイン */
  img.classList.add('fading');
  setTimeout(() => {
    img.src = src;
    img.dataset.currentExpr = expr;
    /* 表情クラスを付け替え */
    img.classList.remove('expr-happy', 'expr-surprised', 'expr-tired', 'expr-intense');
    if (expr !== 'normal') img.classList.add(`expr-${expr}`);
    img.classList.remove('fading');
  }, 180);
}

/* --------------------------------------------------
   スコアバー更新
-------------------------------------------------- */
function updateScoreBar() {
  const gaugeEl = $('hearts-gauge');
  if (!gaugeEl) return;

  const thresholds = [10, 19, 28, 38, 50];
  const filled = thresholds.filter(t => GS.score >= t).length;
  const hearts = gaugeEl.querySelectorAll('.heart-icon');

  hearts.forEach((h, i) => {
    const wasFilled = h.classList.contains('filled');
    const shouldFill = i < filled;
    h.textContent = shouldFill ? '♥' : '♡';
    if (shouldFill && !wasFilled) {
      h.classList.add('filled', 'pulse');
      setTimeout(() => h.classList.remove('pulse'), 400);
    } else if (!shouldFill) {
      h.classList.remove('filled', 'pulse');
    }
  });
}

/* --------------------------------------------------
   エンディング計算・表示
-------------------------------------------------- */
function calculateEnding() {
  const endings = GS.scenario.endings;
  let key = 'bad';

  if (GS.score >= 54)      key = 'happy';
  else if (GS.score >= 44) key = 'good';
  else if (GS.score >= 37) key = 'normal';

  const ending = endings[key];

  /* エンディング画面の内容をセット */
  changeBg(ending.bg);
  $('ending-label').textContent   = ending.label;
  $('ending-title').textContent   = ending.title;
  $('ending-score-num').textContent = GS.score + ' pt';

  const textEl = $('ending-text');
  textEl.textContent = '';

  showScreen('ending');

  /* テキストをゆっくり表示 */
  setTimeout(() => typeEndingText(textEl, ending.text), 500);
}

function typeEndingText(el, text) {
  const words = text.split('');
  let i = 0;
  function tick() {
    if (i >= words.length) return;
    i++;
    el.textContent = text.slice(0, i);
    setTimeout(tick, 18);
  }
  tick();
}

/* --------------------------------------------------
   テキストログ表示
-------------------------------------------------- */
function renderLog() {
  const container = $('log-entries');
  if (!container) return;
  container.innerHTML = '';

  const logs = GS.textLog.slice().reverse();
  logs.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = `
      <div class="log-entry-speaker">${escHtml(entry.speaker)}</div>
      <div class="log-entry-text">${escHtml(entry.text).replace(/\n/g, '<br>')}</div>`;
    container.appendChild(div);
  });
}

/* --------------------------------------------------
   設定UI
-------------------------------------------------- */
function updateSettingsUI() {
  const nameEl = $('settings-current-name');
  if (nameEl) nameEl.textContent = GS.playerName + 'ちゃん';
  const speedSlider = $('speed-slider');
  if (speedSlider) {
    speedSlider.value = 100 - typingSpeed;
    $('speed-val').textContent = speedSlider.value;
  }
}

/* --------------------------------------------------
   トースト通知
-------------------------------------------------- */
function showToast(msg) {
  let toast = $('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    Object.assign(toast.style, {
      position: 'fixed', bottom: '80px', left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(255,105,180,0.15)',
      border: '1px solid rgba(255,105,180,0.4)',
      color: '#ff69b4', fontFamily: 'sans-serif', fontSize: '12px',
      padding: '8px 20px', borderRadius: '20px',
      backdropFilter: 'blur(8px)', zIndex: '200',
      opacity: '0', transition: 'opacity 0.3s', pointerEvents: 'none',
    });
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

/* --------------------------------------------------
   HTMLエスケープ
-------------------------------------------------- */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* --------------------------------------------------
   キャラ画像の初期チェック
   chara_normal.PNG が存在しない場合は img を隠す
-------------------------------------------------- */
function initCharSprite() {
  const img = $('char-sprite');
  if (!img) return;
  img.classList.add('hidden');
  img.onload = () => {
    img.onload = null;
    img.onerror = null;
    _pngCache['./chara_normal.PNG'] = true;
    img.classList.remove('hidden');
    img.dataset.currentExpr = 'normal';
  };
  img.onerror = () => {
    img.onload = null;
    img.onerror = null;
    img.classList.add('hidden');
    _pngCache['./chara_normal.PNG'] = false;
  };
  img.src = './chara_normal.PNG';
}

/* --------------------------------------------------
   起動
-------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => { initCharSprite(); init(); });
