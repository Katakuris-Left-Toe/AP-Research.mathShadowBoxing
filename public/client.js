const socket = io(); 

// --- SCREENS ---
const nameScreen = document.getElementById('nameScreen');
const menuScreen = document.getElementById('menuScreen');
const gameScreen = document.getElementById('gameScreen');
const gameOverScreen = document.getElementById('gameOverScreen');

// --- NAME ---
const nameInput = document.getElementById('nameInput');
const nameBtn = document.getElementById('nameBtn');

// --- MENU ---
const createBtn = document.getElementById('createBtn');
const randomBtn = document.getElementById('randomBtn');
const showJoinBtn = document.getElementById('showJoinBtn');
const joinGroup = document.getElementById('joinGroup');
const joinBtn = document.getElementById('joinBtn');
const codeInput = document.getElementById('codeInput');
const waitingMsg = document.getElementById('waitingMsg');
const codeDisplay = document.getElementById('codeDisplay');
const errorMsg = document.getElementById('errorMsg');

// --- GAME ---
const roleDisplay = document.getElementById('roleDisplay');
const questionDisplay = document.getElementById('questionDisplay');
const answerInput = document.getElementById('answerInput');
const submitAnswerBtn = document.getElementById('submitAnswerBtn');
const timerDisplay = document.getElementById('timerDisplay');
const streakDisplay = document.getElementById('streakDisplay');
const statusDisplay = document.getElementById('statusDisplay');

const arrowBtns = document.querySelectorAll('.arrow-btn');

let currentCode = null;
let selectedDirection = null;
let myRole = null;
let playerName = '';

// --- LEADERBOARD ---
const leaderboardList = document.getElementById('leaderboardList');

// 🔹 Disable menu buttons until name entered
createBtn.disabled = true;
randomBtn.disabled = true;
showJoinBtn.disabled = true;

// --- NAME SUBMIT ---
function submitName() {
  const name = nameInput.value.trim();
  if (!name) return alert('Enter a name');
  playerName = name;
  localStorage.setItem('playerName', playerName);
  socket.emit('setName', { name: playerName });

  nameScreen.classList.add('hidden');
  menuScreen.classList.remove('hidden');

  createBtn.disabled = false;
  randomBtn.disabled = false;
  showJoinBtn.disabled = false;

  socket.emit('getLeaderboard');
}

nameBtn.onclick = submitName;
nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') submitName();
});

// --- Check if name is already stored ---
window.addEventListener('DOMContentLoaded', () => {
  const storedName = localStorage.getItem('playerName');
  if (storedName) {
    playerName = storedName;
    socket.emit('setName', { name: playerName });
    nameScreen.classList.add('hidden');
    menuScreen.classList.remove('hidden');
    createBtn.disabled = false;
    randomBtn.disabled = false;
    showJoinBtn.disabled = false;
    socket.emit('getLeaderboard');
  }
});

// --- MENU ---
createBtn.onclick = () => socket.emit('createGame');
randomBtn.onclick = () => socket.emit('randomGame');

showJoinBtn.onclick = () => joinGroup.classList.remove('hidden');

joinBtn.onclick = () => {
  socket.emit('joinGame', { code: codeInput.value.toUpperCase() });
};

// --- SEND ANSWER ---
function submitAnswer() {
  if (!currentCode) return;
  const val = answerInput.value;
  if (val === '') return;
  socket.emit('answer', { val, code: currentCode });
  answerInput.disabled = true;
  submitAnswerBtn.disabled = true;
}

submitAnswerBtn.onclick = submitAnswer;

answerInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') submitAnswer();
});

// --- DIRECTIONS ---
arrowBtns.forEach(btn => {
  btn.onclick = () => {
    if (btn.classList.contains('disabled')) return;

    selectedDirection = btn.dataset.dir;

    arrowBtns.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    socket.emit('direction', { dir: selectedDirection, code: currentCode });
  };
});

// --- SOCKET EVENTS ---
socket.on('gameCreated', ({ code }) => {
  currentCode = code;
  codeDisplay.textContent = code;
  waitingMsg.classList.remove('hidden');
});

socket.on('joinedGame', ({ code }) => {
  currentCode = code;
});

socket.on('roundStart', data => {
  menuScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');

  myRole = socket.id === data.attacker ? 'attacker' : 'defender';
  roleDisplay.textContent = myRole.toUpperCase();

  questionDisplay.textContent = data.question;
  answerInput.disabled = false;
  answerInput.value = '';
  submitAnswerBtn.disabled = false;
  selectedDirection = null;

  const allowedDirs = data.remainingDirs[myRole];
  arrowBtns.forEach(btn => {
    btn.classList.remove('selected', 'disabled');
    if (!allowedDirs.includes(btn.dataset.dir)) {
      btn.classList.add('disabled');
    }
  });
});

socket.on('tick', t => {
  timerDisplay.textContent = `Time: ${t}`;
});

// --- ROUND RESULT (Updated to show both players) ---
socket.on('roundResult', res => {
  const atk = res.attacker;
  const def = res.defender;

  statusDisplay.innerHTML = `
    ${atk.name} (Attacker): <span style="color:${atk.correct?'green':'red'}">${atk.correct ? 'Correct' : 'Wrong'}</span>, Direction: ${atk.direction || 'None'}<br>
    ${def.name} (Defender): <span style="color:${def.correct?'green':'red'}">${def.correct ? 'Correct' : 'Wrong'}</span>, Direction: ${def.direction || 'None'}<br>
    <strong>${res.hit ? 'HIT!' : 'MISS!'}</strong>
  `;
  
  streakDisplay.textContent = `Streak: ${res.streak}`;
});

socket.on('gameOver', ({ winnerName }) => {
  gameScreen.classList.add('hidden');
  gameOverScreen.classList.remove('hidden');
  document.getElementById('winnerText').textContent = `${winnerName} WINS`;
  socket.emit('getLeaderboard');
});

// --- LEADERBOARD ---
socket.on('leaderboard', data => {
  const topPlayers = Object.entries(data)
    .sort((a,b) => b[1]-a[1])
    .slice(0,5);

  leaderboardList.innerHTML = '';
  if(topPlayers.length === 0) {
    leaderboardList.innerHTML = '<li>No players yet</li>';
  } else {
    topPlayers.forEach(([name,wins]) => {
      const li = document.createElement('li');
      li.textContent = `${name}: ${wins}`;
      leaderboardList.appendChild(li);
    });
  }
});
