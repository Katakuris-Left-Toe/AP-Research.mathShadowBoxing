const express = require('express'); 
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

// --- Leaderboard setup ---
const LEADERBOARD_FILE = './leaderboard.json';
if (!fs.existsSync(LEADERBOARD_FILE)) fs.writeFileSync(LEADERBOARD_FILE, '{}');
let leaderboard = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));

// --- Game state ---
const games = {};
const waitingPlayers = [];

// --- Helpers ---
function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

// --- Tier helper ---
function getTierMax(hitStreak) {
  if (hitStreak <= 1) return 30;
  if (hitStreak === 2) return 50;
  return 100;
}

// --- Generate math problem ---
function generateMathProblem(maxOperand) {
  const type = Math.random() < 0.5 ? 'add' : 'sub';
  let a = Math.floor(Math.random() * (maxOperand + 1));
  let b = Math.floor(Math.random() * (maxOperand + 1));

  if (type === 'sub' && b > a) [a, b] = [b, a];

  return {
    question: type === 'add' ? `${a} + ${b}` : `${a} - ${b}`,
    answer: type === 'add' ? a + b : a - b
  };
}

// --- Start round ---
function startRound(code) {
  const game = games[code];
  if (!game) return;

  const maxOperand = getTierMax(game.hitStreak);
  const problem = generateMathProblem(maxOperand);

  game.correctAnswer = problem.answer;
  game.answers = {};
  game.atkDir = null;
  game.defDir = null;
  game.roundActive = true;
  game.timeRemaining = 15;

  const attacker = game.players[game.attackerIndex];
  const defender = game.players[1 - game.attackerIndex];

  io.to(code).emit('roundStart', {
    attacker,
    defender,
    question: problem.question,
    time: 15,
    remainingDirs: game.remainingDirs
  });

  game.timer = setInterval(() => {
    game.timeRemaining--;
    io.to(code).emit('tick', game.timeRemaining);
    if (game.timeRemaining <= 0) resolveRound(code);
  }, 1000);
}

// --- Early resolve ---
function checkEarlyResolve(code) {
  const game = games[code];
  if (!game || !game.roundActive) return;

  const bothAnswered = Object.keys(game.answers).length === 2;
  const bothChoseDirection = game.atkDir !== null && game.defDir !== null;

  if (bothAnswered && bothChoseDirection) resolveRound(code);
}

// --- Resolve round (updated) ---
function resolveRound(code) {
  const game = games[code];
  if (!game || !game.roundActive) return;

  clearInterval(game.timer);
  game.roundActive = false;

  const attacker = game.players[game.attackerIndex];
  const defender = game.players[1 - game.attackerIndex];

  const atkCorrect = game.answers[attacker] === game.correctAnswer;
  const defCorrect = game.answers[defender] === game.correctAnswer;

  let hit = false;

  // --- Hit logic ---
  if (!atkCorrect && !defCorrect) hit = false;
  else if (!atkCorrect && defCorrect) hit = false;
  else if (atkCorrect && !defCorrect) hit = true;
  else if (atkCorrect && defCorrect) {
    if (game.atkDir === game.defDir) hit = true;
    else hit = false;
  }

  if (hit) {
    game.hitStreak++;

    if (game.atkDir) {
      const atkIndex = game.remainingDirs.attacker.indexOf(game.atkDir);
      if (atkIndex > -1) game.remainingDirs.attacker.splice(atkIndex, 1);

      const defIndex = game.remainingDirs.defender.indexOf(game.atkDir);
      if (defIndex > -1) game.remainingDirs.defender.splice(defIndex, 1);
    }
  } else {
    game.hitStreak = 0;
    game.attackerIndex = 1 - game.attackerIndex;
    game.remainingDirs.attacker = ['up','down','left','right'];
    game.remainingDirs.defender = ['up','down','left','right'];
  }

  if (game.remainingDirs.attacker.length === 0 || game.remainingDirs.defender.length === 0) {
    game.attackerIndex = 1 - game.attackerIndex;
    game.remainingDirs.attacker = ['up','down','left','right'];
    game.remainingDirs.defender = ['up','down','left','right'];
    game.hitStreak = 0;
  }

  // --- Send detailed round result ---
  io.to(code).emit('roundResult', {
    hit,
    streak: game.hitStreak,
    attacker: {
      name: game.names[attacker],
      correct: atkCorrect,
      direction: game.atkDir
    },
    defender: {
      name: game.names[defender],
      correct: defCorrect,
      direction: game.defDir
    },
    remainingDirs: game.remainingDirs
  });

  // --- Game over ---
  if (game.hitStreak >= 3) {
    const winnerName = game.names[attacker];
    io.to(code).emit('gameOver', { winner: attacker, winnerName });
    if (!leaderboard[winnerName]) leaderboard[winnerName] = 0;
    leaderboard[winnerName]++;
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2));
    delete games[code];
    return;
  }

  setTimeout(() => startRound(code), 2000);
}

// --- Socket connections ---
io.on('connection', socket => {
  console.log('Player connected:', socket.id);

  socket.on('setName', ({ name }) => {
    socket.playerName = name;
  });

  socket.on('getLeaderboard', () => {
    socket.emit('leaderboard', leaderboard);
  });

  // --- Create game ---
  socket.on('createGame', () => {
    if (!socket.playerName) return;
    let code = generateCode();
    while (games[code]) code = generateCode();

    games[code] = {
      players: [socket.id],
      names: { [socket.id]: socket.playerName },
      attackerIndex: 0,
      hitStreak: 0,
      roundActive: false,
      remainingDirs: { attacker: ['up','down','left','right'], defender: ['up','down','left','right'] }
    };
    socket.join(code);
    socket.emit('gameCreated', { code });
  });

  // --- Join specific game ---
  socket.on('joinGame', ({ code }) => {
    const game = games[code];
    if (!game) return socket.emit('error',{message:'Game not found'});
    if (game.players.length >= 2) return socket.emit('error',{message:'Game full'});

    game.players.push(socket.id);
    game.names[socket.id] = socket.playerName;
    socket.join(code);
    socket.emit('joinedGame',{code});
    startRound(code);
  });

  // --- Random matchmaking ---
  socket.on('randomGame', () => {
    if (waitingPlayers.length > 0) {
      const waiting = waitingPlayers.shift();
      const code = waiting.code;
      const game = games[code];
      if (game && game.players.length === 1) {
        game.players.push(socket.id);
        game.names[socket.id] = socket.playerName;
        socket.join(code);
        socket.emit('joinedGame',{code});
        io.to(waiting.playerId).emit('playerMatched');
        startRound(code);
      }
    } else {
      let code = generateCode();
      while (games[code]) code = generateCode();
      games[code] = { 
        players:[socket.id], 
        names:{[socket.id]:socket.playerName}, 
        attackerIndex:0, 
        hitStreak:0, 
        roundActive:false, 
        remainingDirs:{attacker:['up','down','left','right'], defender:['up','down','left','right']} 
      };
      socket.join(code);
      waitingPlayers.push({ playerId: socket.id, code });
      socket.emit('gameCreated',{code});
    }
  });

  // --- Answer ---
  socket.on('answer', ({ val, code }) => {
    const game = games[code]; 
    if(!game||!game.roundActive) return;
    game.answers[socket.id] = parseInt(val);
    checkEarlyResolve(code);
  });

  // --- Direction ---
  socket.on('direction', ({ dir, code }) => {
    const game = games[code]; 
    if(!game||!game.roundActive) return;
    const attacker = game.players[game.attackerIndex];
    const defender = game.players[1 - game.attackerIndex];

    if(socket.id === attacker) game.atkDir = dir;
    else if(socket.id === defender) game.defDir = dir;

    checkEarlyResolve(code);
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    const idx = waitingPlayers.findIndex(p=>p.playerId===socket.id);
    if(idx!==-1) waitingPlayers.splice(idx,1);

    for(const code in games){
      const game = games[code];
      if(game.players.includes(socket.id)){
        io.to(code).emit('playerDisconnected');
        if(game.timer) clearInterval(game.timer);
        delete games[code];
      }
    }
  });
});

// --- Server start ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
