require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Chess } = require('chess.js');
const { Server } = require('socket.io');

/* =====================================================
   FAIL FAST
===================================================== */
if (!process.env.MONGO_URI) {
  console.error('❌ MONGO_URI missing');
  process.exit(1);
}

const PORT = process.env.PORT || 3001;
const DISCONNECT_GRACE_MS = 30000;
const MOVE_WINDOW_MS = 10000;
const MOVE_LIMIT = 50;

/* =====================================================
   EXPRESS
===================================================== */
const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH']
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

/* =====================================================
   DATABASE
===================================================== */
mongoose.connect(process.env.MONGO_URI, {
  maxPoolSize: 20,
  minPoolSize: 5
})
  .then(() => console.log('✅ Mongo Connected'))
  .catch(err => {
    console.error('❌ Mongo Error', err.message);
    process.exit(1);
  });

/* =====================================================
   HELPERS
===================================================== */
function genId() {
  return crypto.randomBytes(4).toString('hex');
}

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function sanitizeUser(user) {
  if (!user) return null;
  const obj = user.toObject ? user.toObject() : user;
  delete obj.passwordHash;
  return obj;
}

/* =====================================================
   DEFAULT RATINGS
===================================================== */
function defaultNormalRatings() {
  return {
    bullet_30s: 400,
    bullet_1m: 400,
    bullet_2m: 400,
    bullet_2p3: 400,
    blitz_3m: 400,
    blitz_5m: 400,
    blitz_5p5: 400,
    rapid_7m: 400,
    rapid_10m: 400,
    rapid_15m: 400,
    rapid_15p5: 400,
    classical_30m: 400
  };
}

function defaultPhoenixRatings() {
  return {
    blitz_4m: 400,
    blitz_5m: 400,
    blitz_5p6: 400,
    rapid_7m: 400,
    rapid_10m: 400,
    rapid_15m: 400,
    rapid_15p5: 400,
    classical_30m: 400
  };
}

/* =====================================================
   TIME KEYS
===================================================== */
function getTimeKey(seconds, increment = 0) {
  if (seconds === 30 && increment === 0) return { mode: 'normal', cat: 'bullet_30s' };
  if (seconds === 60 && increment === 0) return { mode: 'normal', cat: 'bullet_1m' };
  if (seconds === 120 && increment === 0) return { mode: 'normal', cat: 'bullet_2m' };
  if (seconds === 120 && increment === 3) return { mode: 'normal', cat: 'bullet_2p3' };
  if (seconds === 180 && increment === 0) return { mode: 'normal', cat: 'blitz_3m' };
  if (seconds === 300 && increment === 0) return { mode: 'normal', cat: 'blitz_5m' };
  if (seconds === 300 && increment === 5) return { mode: 'normal', cat: 'blitz_5p5' };
  if (seconds === 420 && increment === 0) return { mode: 'normal', cat: 'rapid_7m' };
  if (seconds === 600 && increment === 0) return { mode: 'normal', cat: 'rapid_10m' };
  if (seconds === 900 && increment === 0) return { mode: 'normal', cat: 'rapid_15m' };
  if (seconds === 900 && increment === 5) return { mode: 'normal', cat: 'rapid_15p5' };
  if (seconds === 1800 && increment === 0) return { mode: 'normal', cat: 'classical_30m' };
  return { mode: 'normal', cat: 'blitz_5m' };
}

function getPhoenixTimeKey(seconds, increment = 0) {
  if (seconds === 240 && increment === 0) return { mode: 'phoenix', cat: 'blitz_4m' };
  if (seconds === 300 && increment === 0) return { mode: 'phoenix', cat: 'blitz_5m' };
  if (seconds === 300 && increment === 6) return { mode: 'phoenix', cat: 'blitz_5p6' };
  if (seconds === 420 && increment === 0) return { mode: 'phoenix', cat: 'rapid_7m' };
  if (seconds === 600 && increment === 0) return { mode: 'phoenix', cat: 'rapid_10m' };
  if (seconds === 900 && increment === 0) return { mode: 'phoenix', cat: 'rapid_15m' };
  if (seconds === 900 && increment === 5) return { mode: 'phoenix', cat: 'rapid_15p5' };
  if (seconds === 1800 && increment === 0) return { mode: 'phoenix', cat: 'classical_30m' };
  return { mode: 'phoenix', cat: 'blitz_5m' };
}

/* =====================================================
   ELO / TIER / PGN
===================================================== */
function calcElo(player, opponent, score) {
  const K = 32;
  const expected = 1 / (1 + Math.pow(10, (opponent - player) / 400));
  return Math.round(player + K * (score - expected));
}

function getTier(rating) {
  if (rating < 800) return { name: 'Beginner', emoji: '🌱' };
  if (rating < 1300) return { name: 'Intermediate', emoji: '⭐' };
  if (rating < 1800) return { name: 'Advanced', emoji: '⚔️' };
  if (rating < 2200) return { name: 'Master', emoji: '👑' };
  return { name: 'Grandmaster', emoji: '🔥' };
}

function generatePGN(game, result) {
  const date = new Date().toISOString().split('T')[0];
  let pgnResult = '*';
  if (result === 'win') pgnResult = '1-0';
  else if (result === 'loss') pgnResult = '0-1';
  else if (result === 'draw') pgnResult = '1/2-1/2';

  const moves = game.chess.history({ verbose: true })
    .map((m, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ${m.san}` : m.san))
    .join(' ');

  return `[Event "Phoenix Chess"]\n[Site "Phoenix"]\n[Date "${date}"]\n[White "${game.usernames.w}"]\n[Black "${game.usernames.b}"]\n[Result "${pgnResult}"]\n[TimeControl "${game.timerSeconds}+${game.increment}"]\n\n${moves}\n${pgnResult}`;
}

function getOpponentColor(color) {
  return color === 'w' ? 'b' : 'w';
}

/* =====================================================
   SCHEMAS
===================================================== */
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  email: { type: String, default: null, lowercase: true },
  phone: { type: String, default: null },
  displayName: String,
  bio: { type: String, default: '' },
  country: { type: String, default: '' },
  flair: { type: String, default: '' },
  profilePic: { type: String, default: null },
  createdAt: { type: Number, default: Date.now },
  ratings: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({ normal: defaultNormalRatings(), phoenix: defaultPhoenixRatings() })
  },
  peakRatings: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({ normal: defaultNormalRatings(), phoenix: defaultPhoenixRatings() })
  },
  stats: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({
      normal: { wins: 0, losses: 0, draws: 0 },
      phoenix: { wins: 0, losses: 0, draws: 0 }
    })
  },
  matchHistory: { type: Array, default: [] },
  winStreak: { type: Number, default: 0 },
  bestWinStreak: { type: Number, default: 0 }
}, { minimize: false });

UserSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });

const SessionSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true, lowercase: true },
  createdAt: { type: Date, default: Date.now, expires: 604800 },
  lastActivity: { type: Date, default: Date.now },
  ipAddress: String,
  userAgent: String
});

const User = mongoose.model('User', UserSchema);
const Session = mongoose.model('Session', SessionSchema);

/* =====================================================
   MEMORY
===================================================== */
const games = {};
const waitingPlayers = { normal: [], phoenix: [] };
const socketToGame = {};
const moveTracker = {};
const disconnectTimers = {};

function getMoveTrackerKey(username, gameId) {
  return `${username || 'anon'}:${gameId || 'nogame'}`;
}

function canMakeMove(username, gameId) {
  const key = getMoveTrackerKey(username, gameId);
  const now = Date.now();
  if (!moveTracker[key]) moveTracker[key] = [];
  moveTracker[key] = moveTracker[key].filter(ts => now - ts < MOVE_WINDOW_MS);
  if (moveTracker[key].length >= MOVE_LIMIT) return false;
  moveTracker[key].push(now);
  return true;
}

function cleanupMoveTracker(gameId, username) {
  const key = getMoveTrackerKey(username, gameId);
  delete moveTracker[key];
}

function removeFromQueues(socketId) {
  for (const mode of ['normal', 'phoenix']) {
    waitingPlayers[mode] = waitingPlayers[mode].filter(s => s.id !== socketId);
  }
}

function clearGameTimer(gameId) {
  const g = games[gameId];
  if (g?.timerInterval) {
    clearInterval(g.timerInterval);
    g.timerInterval = null;
  }
}

/* =====================================================
   AUTH MIDDLEWARE
===================================================== */
async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const session = await Session.findOne({ token });
    if (!session) return res.status(401).json({ error: 'Invalid Session' });

    session.lastActivity = new Date();
    await session.save();

    req.username = session.username;
    req.token = token;
    next();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Auth Failed' });
  }
}

/* =====================================================
   AUTH ROUTES
===================================================== */
app.post('/auth/register', async (req, res) => {
  try {
    const { username, password, email, phone } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const safeUsername = String(username).toLowerCase();
    const exists = await User.findOne({ username: safeUsername });
    if (exists) return res.status(400).json({ error: 'Username Taken' });

    const user = new User({
      username: safeUsername,
      passwordHash: hashPassword(password),
      email: email ? String(email).toLowerCase() : null,
      phone: phone || null,
      displayName: username
    });

    await user.save();
    const token = genToken();
    await new Session({ token, username: user.username, ipAddress: req.ip, userAgent: req.headers['user-agent'] }).save();

    res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    if (!res.headersSent) {
      if (err.code === 11000) return res.status(409).json({ error: 'Email already in use' });
      res.status(500).json({ error: err.message });
    }
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const safeUsername = username ? String(username).toLowerCase() : '';

    const user = await User.findOne({
      $or: [
        { username: safeUsername },
        { email: safeUsername },
        { phone: username }
      ]
    });

    if (!user || user.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ error: 'Invalid Credentials' });
    }

    const token = genToken();
    await new Session({ token, username: user.username, ipAddress: req.ip, userAgent: req.headers['user-agent'] }).save();

    res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Login Failed' });
  }
});

app.post('/auth/logout', authMiddleware, async (req, res) => {
  try {
    await Session.deleteOne({ token: req.token });
    res.json({ success: true });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Logout Failed' });
  }
});

app.post('/auth/verify', authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.username });
    if (!user) return res.status(404).json({ error: 'User Not Found' });
    res.json({ valid: true, user: sanitizeUser(user) });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Verify Failed' });
  }
});

/* =====================================================
   PROFILE
===================================================== */
app.get('/profile/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User Not Found' });
    res.json(sanitizeUser(user));
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Profile Failed' });
  }
});

app.patch('/profile/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.username });
    if (!user) return res.status(404).json({ error: 'User Not Found' });

    const { displayName, bio, country, flair, profilePic, email, phone } = req.body;

    if (displayName !== undefined) user.displayName = displayName;
    if (bio !== undefined) user.bio = bio;
    if (country !== undefined) user.country = country;
    if (flair !== undefined) user.flair = flair;
    if (profilePic !== undefined) user.profilePic = profilePic;
    if (email !== undefined) user.email = email ? String(email).toLowerCase() : null;
    if (phone !== undefined) user.phone = phone || null;

    await user.save();
    res.json(sanitizeUser(user));
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Profile Update Failed' });
  }
});

/* =====================================================
   LEADERBOARD / HISTORY
===================================================== */
app.get('/leaderboard/:mode/:cat', async (req, res) => {
  try {
    const { mode, cat } = req.params;
    const users = await User.find({});

    const ranked = users
      .filter(u => u.ratings?.[mode]?.[cat] !== undefined)
      .sort((a, b) => b.ratings[mode][cat] - a.ratings[mode][cat])
      .slice(0, 100)
      .map((u, i) => ({
        rank: i + 1,
        username: u.username,
        displayName: u.displayName,
        country: u.country,
        rating: u.ratings[mode][cat],
        tier: getTier(u.ratings[mode][cat])
      }));

    res.json(ranked);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Leaderboard Failed' });
  }
});

app.get('/history/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User Not Found' });
    res.json(user.matchHistory.slice(-100).reverse());
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'History Failed' });
  }
});

/* =====================================================
   GAME CREATION / CLEANUP
===================================================== */
function createGame(socket1, socket2, mode, timerSeconds, increment) {
  const gameId = genId();
  const chess = new Chess();
  const p1White = Math.random() > 0.5;
  const timeKey = mode === 'phoenix' ? getPhoenixTimeKey(timerSeconds, increment) : getTimeKey(timerSeconds, increment);

  games[gameId] = {
    id: gameId,
    mode,
    chess,
    timerSeconds,
    increment,
    timeKey,
    players: {
      w: p1White ? socket1.id : socket2.id,
      b: p1White ? socket2.id : socket1.id
    },
    usernames: {
      w: p1White ? socket1.username : socket2.username,
      b: p1White ? socket2.username : socket1.username
    },
    timers: { w: timerSeconds, b: timerSeconds },
    timerInterval: null,
    started: false,
    illegalMoves: { w: 0, b: 0 },
    createdAt: Date.now(),
    finished: false
  };

  socketToGame[socket1.id] = gameId;
  socketToGame[socket2.id] = gameId;

  return {
    gameId,
    colors: {
      [socket1.id]: p1White ? 'w' : 'b',
      [socket2.id]: p1White ? 'b' : 'w'
    }
  };
}

function startTimer(gameId) {
  const g = games[gameId];
  if (!g) return;

  clearInterval(g.timerInterval);
  g.timerInterval = setInterval(() => {
    const currentTurn = g.chess.turn();
    g.timers[currentTurn]--;
    io.to(gameId).emit('timerUpdate', g.timers);

    if (g.timers[currentTurn] <= 0) {
      clearInterval(g.timerInterval);
      const winner = currentTurn === 'w' ? 'b' : 'w';
      endGame(gameId, winner, 'Time Out');
    }
  }, 1000);
}

function clearDisconnectTimer(gameId) {
  if (disconnectTimers[gameId]) {
    clearTimeout(disconnectTimers[gameId]);
    delete disconnectTimers[gameId];
  }
}

function cleanupGameState(gameId) {
  const g = games[gameId];
  if (!g) return;
  clearInterval(g.timerInterval);
  clearDisconnectTimer(gameId);
  cleanupMoveTracker(gameId, g.usernames.w);
  cleanupMoveTracker(gameId, g.usernames.b);
  delete socketToGame[g.players.w];
  delete socketToGame[g.players.b];
  delete games[gameId];
}

async function saveMatchRecord(usernames, gameId, resultByColor, reason, pgn, history) {
  for (const color of ['w', 'b']) {
    const username = usernames[color];
    const user = await User.findOne({ username });
    if (!user) continue;

    const result = resultByColor[color];
    user.matchHistory.push({
      gameId,
      date: Date.now(),
      result,
      opponent: usernames[getOpponentColor(color)],
      pgn,
      moves: history,
      reason
    });
    user.markModified('matchHistory');
    await user.save();
  }
}

async function updateRatingsAndStats(game, result) {
  const { mode, cat } = game.timeKey;
  const white = await User.findOne({ username: game.usernames.w });
  const black = await User.findOne({ username: game.usernames.b });
  if (!white || !black) return;

  const wr = white.ratings?.[mode]?.[cat] ?? 400;
  const br = black.ratings?.[mode]?.[cat] ?? 400;

  if (result === '1-0') {
    white.ratings[mode][cat] = calcElo(wr, br, 1);
    black.ratings[mode][cat] = calcElo(br, wr, 0);
    white.stats[mode].wins++;
    black.stats[mode].losses++;
    white.winStreak++;
    black.winStreak = 0;
  } else if (result === '0-1') {
    white.ratings[mode][cat] = calcElo(wr, br, 0);
    black.ratings[mode][cat] = calcElo(br, wr, 1);
    white.stats[mode].losses++;
    black.stats[mode].wins++;
    black.winStreak++;
    white.winStreak = 0;
  } else {
    const whiteScore = 0.5;
    const blackScore = 0.5;
    white.ratings[mode][cat] = calcElo(wr, br, whiteScore);
    black.ratings[mode][cat] = calcElo(br, wr, blackScore);
    white.stats[mode].draws++;
    black.stats[mode].draws++;
    white.winStreak = 0;
    black.winStreak = 0;
  }

  white.bestWinStreak = Math.max(white.bestWinStreak, white.winStreak);
  black.bestWinStreak = Math.max(black.bestWinStreak, black.winStreak);

  white.peakRatings[mode][cat] = Math.max(white.peakRatings?.[mode]?.[cat] ?? 0, white.ratings[mode][cat]);
  black.peakRatings[mode][cat] = Math.max(black.peakRatings?.[mode]?.[cat] ?? 0, black.ratings[mode][cat]);

  white.markModified('ratings');
  black.markModified('ratings');
  white.markModified('peakRatings');
  black.markModified('peakRatings');
  white.markModified('stats');
  black.markModified('stats');
  white.markModified('winStreak');
  black.markModified('winStreak');
  white.markModified('bestWinStreak');
  black.markModified('bestWinStreak');

  await Promise.all([white.save(), black.save()]);
}

async function endGame(gameId, winnerColor, reason) {
  const g = games[gameId];
  if (!g || g.finished) return;
  g.finished = true;

  clearInterval(g.timerInterval);
  clearDisconnectTimer(gameId);

  const loserColor = getOpponentColor(winnerColor);
  const result = winnerColor === 'w' ? '1-0' : '0-1';
  const pgn = generatePGN(g, winnerColor === 'w' ? 'win' : 'loss');
  const history = g.chess.history({ verbose: true });

  await updateRatingsAndStats(g, result);
  await saveMatchRecord(g.usernames, gameId, {
    w: winnerColor === 'w' ? 'win' : 'loss',
    b: winnerColor === 'b' ? 'win' : 'loss'
  }, reason, pgn, history);

  io.to(gameId).emit('gameOver', {
    winner: winnerColor,
    result,
    reason,
    fen: g.chess.fen()
  });

  cleanupGameState(gameId);
}

async function endDraw(gameId, reason) {
  const g = games[gameId];
  if (!g || g.finished) return;
  g.finished = true;

  clearInterval(g.timerInterval);
  clearDisconnectTimer(gameId);

  const pgn = generatePGN(g, 'draw');
  const history = g.chess.history({ verbose: true });

  await updateRatingsAndStats(g, '1/2-1/2');
  await saveMatchRecord(g.usernames, gameId, {
    w: 'draw',
    b: 'draw'
  }, reason, pgn, history);

  io.to(gameId).emit('gameOver', {
    winner: null,
    result: '1/2-1/2',
    reason,
    fen: g.chess.fen()
  });

  cleanupGameState(gameId);
}

/* =====================================================
   SOCKET.IO
===================================================== */
io.on('connection', (socket) => {
  console.log('🟢', socket.id);

  socket.on('authenticate', async ({ token }) => {
    try {
      const session = await Session.findOne({ token });
      if (!session) return;
      socket.username = session.username;
      socket.emit('authenticated', { username: session.username });
    } catch {}
  });

  socket.on('findGame', ({ mode = 'normal', timerSeconds = 600, increment = 0 }) => {
    if (!socket.username) return;

    socket.mode = mode;
    socket.timerSeconds = timerSeconds;
    socket.increment = increment;

    const queue = waitingPlayers[mode];
    const idx = queue.findIndex(s => s.mode === mode && s.timerSeconds === timerSeconds && s.increment === increment);
    const opponent = idx >= 0 ? queue.splice(idx, 1)[0] : null;

    if (opponent) {
      const { gameId, colors } = createGame(socket, opponent, mode, timerSeconds, increment);
      socket.join(gameId);
      opponent.join(gameId);

      const game = games[gameId];
      const getPayload = (selfSocket, otherSocket) => ({
        gameId,
        color: colors[selfSocket.id],
        timers: game.timers,
        opponent: {
          username: otherSocket.username,
          displayName: otherSocket.username,
          rating: 400
        },
        category: game.timeKey.cat
      });

      socket.emit('gameFound', getPayload(socket, opponent));
      opponent.emit('gameFound', getPayload(opponent, socket));

      game.started = true;
      startTimer(gameId);
    } else {
      if (!queue.some(s => s.id === socket.id)) queue.push(socket);
      socket.emit('waiting');
    }
  });

  socket.on('cancelSearch', () => {
    removeFromQueues(socket.id);
  });

  socket.on('makeMove', ({ gameId, from, to, promotion }) => {
    const g = games[gameId];
    if (!g || g.finished) return;

    const color = g.players.w === socket.id ? 'w' : 'b';
    if (g.chess.turn() !== color) return;

    if (!canMakeMove(socket.username, gameId)) return;

    try {
      const move = g.chess.move({ from, to, promotion: promotion || 'q' });
      if (!move) {
        g.illegalMoves[color]++;
        return;
      }

      if (g.increment > 0) g.timers[color] += g.increment;

      const isCheck = g.chess.inCheck();
      const isCheckmate = g.chess.isCheckmate();
      const isDraw = g.chess.isDraw();
      const captured = !!move.captured;
      const history = g.chess.history({ verbose: true });

      io.to(gameId).emit('moveMade', {
        from: move.from,
        to: move.to,
        fen: g.chess.fen(),
        turn: g.chess.turn(),
        history,
        timers: g.timers,
        isCheck,
        isCheckmate,
        isDraw,
        captured,
        check: isCheck,
        checkmate: isCheckmate,
        draw: isDraw
      });

      if (isCheckmate) {
        endGame(gameId, color, 'Checkmate');
      } else if (isDraw) {
        endDraw(gameId, 'Draw');
      }
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('resign', ({ gameId }) => {
    const g = games[gameId];
    if (!g || g.finished) return;
    const loser = g.players.w === socket.id ? 'w' : 'b';
    const winner = loser === 'w' ? 'b' : 'w';
    endGame(gameId, winner, 'Resignation');
  });

  socket.on('offerDraw', ({ gameId }) => {
    socket.to(gameId).emit('drawOffered');
  });

  socket.on('respondDraw', ({ gameId, accept }) => {
    if (accept) endDraw(gameId, 'Draw Agreement');
    else socket.to(gameId).emit('drawDeclined');
  });

  socket.on('reconnectGame', ({ gameId }) => {
    const g = games[gameId];
    if (!g || !socket.username || g.finished) return;

    let color = null;
    if (g.usernames.w === socket.username) {
      g.players.w = socket.id;
      color = 'w';
    }
    if (g.usernames.b === socket.username) {
      g.players.b = socket.id;
      color = 'b';
    }

    if (color) {
      socket.join(gameId);
      socketToGame[socket.id] = gameId;
      clearDisconnectTimer(gameId);
      socket.emit('gameRecovered', {
        gameId,
        color,
        fen: g.chess.fen(),
        timers: g.timers,
        history: g.chess.history({ verbose: true })
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('⚪', socket.id);
    removeFromQueues(socket.id);

    const gameId = socketToGame[socket.id];
    if (!gameId) return;

    const g = games[gameId];
    if (!g || g.finished) return;

    clearDisconnectTimer(gameId);
    disconnectTimers[gameId] = setTimeout(() => {
      const current = games[gameId];
      if (!current || current.finished) return;

      if (current.players.w === socket.id || current.players.b === socket.id) {
        const loser = current.players.w === socket.id ? 'w' : 'b';
        const winner = loser === 'w' ? 'b' : 'w';
        endGame(gameId, winner, 'Disconnected');
      }
    }, DISCONNECT_GRACE_MS);
  });
});

/* =====================================================
   HEALTH
===================================================== */
app.get('/', async (req, res) => {
  res.json({
    status: 'Phoenix Chess V6+ Active',
    database: mongoose.connection.readyState === 1,
    activeGames: Object.keys(games).length,
    normalQueue: waitingPlayers.normal.length,
    phoenixQueue: waitingPlayers.phoenix.length
  });
});

/* =====================================================
   REDIS SCALING HOOK

npm i ioredis
npm i @socket.io/redis-adapter

const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');
const pub = new Redis(process.env.REDIS_URL);
const sub = pub.duplicate();
io.adapter(createAdapter(pub, sub));
===================================================== */

/* =====================================================
   START
===================================================== */
server.listen(PORT, () => {
  console.log('🚀 Phoenix Chess V6+ Started');
  console.log('🌍 Port:', PORT);
  console.log('📊 Active Games:', Object.keys(games).length);
  console.log('✅ Production Ready');
});
