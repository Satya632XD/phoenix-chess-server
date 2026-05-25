const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Chess } = require('chess.js');
const crypto = require('crypto');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ─── MONGOOSE PERMANENT DATABASE INTEGRATION ───────────────────────────
const MONGO_URI = "mongodb+srv://phoenix_admin:Satya123@cluster0.jebirhm.mongodb.net/phoenix_chess?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected permanently to MongoDB Atlas Cloud!'))
  .catch(err => console.error('❌ Database connection crash:', err.message));

// ─── SESSION SCHEMA FOR PERMANENT STORAGE ───────────────────────────────
const SessionSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true, lowercase: true },
  createdAt: { type: Date, default: Date.now, expires: 604800 }, // 7 days TTL
  lastActivity: { type: Date, default: Date.now },
  ipAddress: String,
  userAgent: String
});

const Session = mongoose.model('Session', SessionSchema);

// ─── USER SCHEMA (UNCHANGED - GOOD!) ─────────────────────────────────────
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  email: { type: String, default: null, lowercase: true, unique: true, sparse: true },
  phone: { type: String, default: null },
  displayName: String,
  bio: { type: String, default: '' },
  country: { type: String, default: '' },
  aim: { type: String, default: '' },
  flair: { type: String, default: '' },
  profilePic: { type: String, default: null },
  createdAt: { type: Number, default: Date.now },
  ratings: { type: mongoose.Schema.Types.Mixed, default: defaultNormalRatings },
  peakRatings: { type: mongoose.Schema.Types.Mixed, default: defaultNormalRatings },
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

const User = mongoose.model('User', UserSchema);

// ─── ANALYSIS SCHEMA FOR MOVE ANALYSIS ──────────────────────────────────
const AnalysisSchema = new mongoose.Schema({
  gameId: { type: String, required: true, unique: true },
  moves: [{
    moveNumber: Number,
    san: String,
    from: String,
    to: String,
    color: String,
    eval: Number,
    depth: Number,
    bestMove: String,
    bestEval: Number,
    classification: String, // Best, Good, Decent, Inaccuracy, Mistake, Blunder, Brilliant
    explanation: String,
    tacticalPattern: String, // e.g., "Pin", "Fork", "Skewer", "Sacrifice"
    positionalAssessment: String
  }],
  overallAccuracy: Number,
  engineDepth: { type: Number, default: 20 },
  createdAt: { type: Date, default: Date.now }
});

const Analysis = mongoose.model('Analysis', AnalysisSchema);

// Memory containers for active items (games only - sessions are in DB)
const games = {};
const waitingPlayers = { normal: [], phoenix: [] };

// ─── Time format helpers ──────────────────────────────────────────────────
function getTimeKey(seconds, increment) {
  const inc = increment || 0;
  if (seconds === 30  && inc === 0) return { mode: 'normal', cat: 'bullet_30s' };
  if (seconds === 60  && inc === 0) return { mode: 'normal', cat: 'bullet_1m' };
  if (seconds === 120 && inc === 0) return { mode: 'normal', cat: 'bullet_2m' };
  if (seconds === 120 && inc === 3) return { mode: 'normal', cat: 'bullet_2p3' };
  if (seconds === 180 && inc === 0) return { mode: 'normal', cat: 'blitz_3m' };
  if (seconds === 300 && inc === 0) return { mode: 'normal', cat: 'blitz_5m' };
  if (seconds === 300 && inc === 5) return { mode: 'normal', cat: 'blitz_5p5' };
  if (seconds === 420 && inc === 0) return { mode: 'normal', cat: 'rapid_7m' };
  if (seconds === 600 && inc === 0) return { mode: 'normal', cat: 'rapid_10m' };
  if (seconds === 900 && inc === 0) return { mode: 'normal', cat: 'rapid_15m' };
  if (seconds === 900 && inc === 5) return { mode: 'normal', cat: 'rapid_15p5' };
  if (seconds === 1800 && inc === 0) return { mode: 'normal', cat: 'classical_30m' };
  return { mode: 'normal', cat: 'blitz_5m' };
}

function getPhoenixTimeKey(seconds, increment) {
  const inc = increment || 0;
  if (seconds === 240 && inc === 0) return { mode: 'phoenix', cat: 'blitz_4m' };
  if (seconds === 300 && inc === 0) return { mode: 'phoenix', cat: 'blitz_5m' };
  if (seconds === 300 && inc === 6) return { mode: 'phoenix', cat: 'blitz_5p6' };
  if (seconds === 420 && inc === 0) return { mode: 'phoenix', cat: 'rapid_7m' };
  if (seconds === 600 && inc === 0) return { mode: 'phoenix', cat: 'rapid_10m' };
  if (seconds === 900 && inc === 0) return { mode: 'phoenix', cat: 'rapid_15m' };
  if (seconds === 900 && inc === 5) return { mode: 'phoenix', cat: 'rapid_15p5' };
  if (seconds === 1800 && inc === 0) return { mode: 'phoenix', cat: 'classical_30m' };
  return { mode: 'phoenix', cat: 'blitz_5m' };
}

function getCategory(seconds, increment) {
  const total = seconds + (increment || 0) * 40;
  if (total < 180) return 'bullet';
  if (total < 600) return 'blitz';
  if (total < 1800) return 'rapid';
  return 'classical';
}

function getTier(rating) {
  if (rating < 800)  return { name: 'Beginner',             emoji: '🌱', color: 'green'  };
  if (rating < 1300) return { name: 'Intermediate',         emoji: '⭐', color: 'yellow' };
  if (rating < 1800) return { name: 'Advanced',             emoji: '⚔️', color: 'blue'   };
  if (rating < 2000) return { name: 'Master',               emoji: '👑', color: 'purple' };
  if (rating < 2300) return { name: 'International Master', emoji: '💎', color: 'cyan'   };
  return                    { name: 'Grandmaster',           emoji: '🔥', color: 'orange' };
}

function calcElo(playerRating, opponentRating, result) {
  const K = 32;
  const expected = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
  return Math.round(playerRating + K * (result - expected));
}

function defaultNormalRatings() {
  return {
    bullet_30s: 400, bullet_1m: 400, bullet_2m: 400, bullet_2p3: 400,
    blitz_3m: 400, blitz_5m: 400, blitz_5p5: 400,
    rapid_7m: 400, rapid_10m: 400, rapid_15m: 400, rapid_15p5: 400,
    classical_30m: 400,
  };
}

function defaultPhoenixRatings() {
  return {
    blitz_4m: 400, blitz_5m: 400, blitz_5p6: 400,
    rapid_7m: 400, rapid_10m: 400, rapid_15m: 400, rapid_15p5: 400,
    classical_30m: 400,
  };
}

function createUser(username, passwordHash, email, phone) {
  return {
    username,
    passwordHash,
    email: email || null,
    phone: phone || null,
    displayName: username,
    bio: '',
    country: '',
    aim: '',
    flair: '',
    profilePic: null,
    createdAt: Date.now(),
    ratings: {
      normal: defaultNormalRatings(),
      phoenix: defaultPhoenixRatings(),
    },
    peakRatings: {
      normal: defaultNormalRatings(),
      phoenix: defaultPhoenixRatings(),
    },
    stats: {
      normal:  { wins: 0, losses: 0, draws: 0 },
      phoenix: { wins: 0, losses: 0, draws: 0 },
    },
    matchHistory: [],
    winStreak: 0,
    bestWinStreak: 0,
  };
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── UPDATED MIDDLEWARE - CHECKS DATABASE FOR SESSIONS ──────────────────
async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized - No token' });
  
  try {
    const session = await Session.findOne({ token });
    if (!session) return res.status(401).json({ error: 'Unauthorized - Invalid or expired token' });
    
    // Update last activity
    session.lastActivity = new Date();
    await session.save();
    
    req.username = session.username;
    req.token = token;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized - Session check failed' });
  }
}

function sanitizeUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

function generatePGN(game, result) {
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0];
  
  let pgnResult = '*';
  if (result === 'win') pgnResult = '1-0';
  else if (result === 'loss') pgnResult = '0-1';
  else if (result === 'draw') pgnResult = '1/2-1/2';
  
  const moves = game.chess.history({ verbose: true })
    .map((m, i) => {
      if (i % 2 === 0) return `${Math.floor(i/2) + 1}. ${m.san}`;
      return m.san;
    })
    .join(' ');
  
  return `[Event "Phoenix Chess Game"]\n[Site "phoenix-chess.com"]\n[Date "${dateStr}"]\n[White "${game.usernames.w}"]\n[Black "${game.usernames.b}"]\n[Result "${pgnResult}"]\n[TimeControl "${game.timerSeconds}+${game.increment}"]\n\n${moves} ${pgnResult}`;
}

// ─── REGISTER - NOW SAVES SESSION TO DATABASE ────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { username, password, email, phone } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 characters' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Username: letters, numbers, underscores only' });
  
  try {
    const existingUser = await User.findOne({ username: username.toLowerCase() });
    if (existingUser) return res.status(400).json({ error: 'Username already taken' });
    
    if (email) {
      const emailExists = await User.findOne({ email: email.toLowerCase() });
      if (emailExists) return res.status(400).json({ error: 'Email already registered' });
    }

    const userObj = createUser(username, hashPassword(password), email?.toLowerCase(), phone);
    const dbUser = new User(userObj);
    await dbUser.save();

    // ✅ CREATE SESSION IN DATABASE (PERMANENT)
    const token = generateToken();
    const session = new Session({
      token,
      username: username.toLowerCase(),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    await session.save();
    
    res.json({ token, user: sanitizeUser(dbUser.toObject()) });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal Server Error during registration' });
  }
});

// ─── LOGIN - NOW SAVES SESSION TO DATABASE ───────────────────────────────
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    let user = await User.findOne({
      $or: [
        { username: username?.toLowerCase() },
        { email: username?.toLowerCase() },
        { phone: username }
      ]
    });

    if (!user || user.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // ✅ CREATE SESSION IN DATABASE (PERMANENT)
    const token = generateToken();
    const session = new Session({
      token,
      username: user.username.toLowerCase(),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    await session.save();
    
    res.json({ token, user: sanitizeUser(user.toObject()) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal Server Error during login' });
  }
});

// ─── LOGOUT - NOW REMOVES SESSION FROM DATABASE ──────────────────────────
app.post('/auth/logout', authMiddleware, async (req, res) => {
  try {
    await Session.deleteOne({ token: req.token });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ─── VERIFY TOKEN - KEEP TOKENS ALIVE ────────────────────────────────────
app.post('/auth/verify', authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ valid: true, user: sanitizeUser(user.toObject()) });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ─── PROFILE ROUTES ───────────────────────────────────────────────────────
app.get('/profile/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    let modified = false;
    if (!user.ratings?.normal?.bullet_30s) {
      user.ratings.normal = { ...defaultNormalRatings(), ...user.ratings.normal };
      user.peakRatings.normal = { ...defaultNormalRatings(), ...user.peakRatings.normal };
      user.markModified('ratings');
      user.markModified('peakRatings');
      modified = true;
    }
    if (!user.ratings?.phoenix?.blitz_4m) {
      user.ratings.phoenix = { ...defaultPhoenixRatings(), ...user.ratings.phoenix };
      user.peakRatings.phoenix = { ...defaultPhoenixRatings(), ...user.peakRatings.phoenix };
      user.markModified('ratings');
      user.markModified('peakRatings');
      modified = true;
    }
    if (modified) {
      await user.save();
    }
    res.json(sanitizeUser(user.toObject()));
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve profile' });
  }
});

app.get('/profile/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(sanitizeUser(user.toObject()));
  } catch (err) {
    res.status(500).json({ error: 'Error fetching profile' });
  }
});

app.patch('/profile/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const { displayName, bio, country, aim, flair, profilePic } = req.body;
    if (displayName !== undefined) user.displayName = displayName.slice(0, 30);
    if (bio !== undefined) user.bio = bio.slice(0, 200);
    if (country !== undefined) user.country = country.slice(0, 50);
    if (aim !== undefined) user.aim = aim.slice(0, 100);
    if (flair !== undefined) user.flair = flair.slice(0, 10);
    if (profilePic !== undefined) user.profilePic = profilePic;
    
    await user.save();
    res.json(sanitizeUser(user.toObject()));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ─── LEADERBOARD ──────────────────────────────────────────────────────────
app.get('/leaderboard/:mode/:cat', async (req, res) => {
  const { mode, cat } = req.params;
  try {
    const allUsers = await User.find({});
    const ranked = allUsers
      .filter(u => u.ratings?.[mode]?.[cat] !== undefined)
      .sort((a, b) => (b.ratings[mode][cat] || 400) - (a.ratings[mode][cat] || 400))
      .slice(0, 100)
      .map((u, i) => ({
        rank: i + 1,
        username: u.username,
        displayName: u.displayName,
        flair: u.flair,
        country: u.country,
        rating: u.ratings[mode][cat],
        tier: getTier(u.ratings[mode][cat]),
        stats: u.stats[mode],
      }));
    res.json(ranked);
  } catch (err) {
    res.status(500).json({ error: 'Leaderboard gathering failed' });
  }
});

// ─── MATCH HISTORY ────────────────────────────────────────────────────────
app.get('/history/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.matchHistory.slice(-100).reverse());
  } catch (err) {
    res.status(500).json({ error: 'Error pulling profile history' });
  }
});

app.get('/history/:username/export', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      username: user.username,
      exportDate: new Date().toISOString(),
      totalGames: user.matchHistory.length,
      matches: user.matchHistory
    });
  } catch (err) {
    res.status(500).json({ error: 'Export build failed' });
  }
});

app.get('/game/:gameId', async (req, res) => {
  const { gameId } = req.params;
  try {
    const targetUser = await User.findOne({ "matchHistory.gameId": gameId });
    if (targetUser) {
      const game = targetUser.matchHistory.find(m => m.gameId === gameId);
      return res.json(game);
    }
    res.status(404).json({ error: 'Game not found' });
  } catch (err) {
    res.status(500).json({ error: 'Error extracting game metadata' });
  }
});

// ─── ANALYSIS ROUTES (NEW) ────────────────────────────────────────────────
app.get('/analysis/:gameId', async (req, res) => {
  try {
    const analysis = await Analysis.findOne({ gameId: req.params.gameId });
    if (!analysis) return res.status(404).json({ error: 'Analysis not found' });
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching analysis' });
  }
});

app.post('/analysis/:gameId', authMiddleware, async (req, res) => {
  try {
    const { moves, overallAccuracy, engineDepth } = req.body;
    const { gameId } = req.params;
    
    let analysis = await Analysis.findOne({ gameId });
    if (!analysis) {
      analysis = new Analysis({ gameId, moves, overallAccuracy, engineDepth });
    } else {
      analysis.moves = moves;
      analysis.overallAccuracy = overallAccuracy;
      analysis.engineDepth = engineDepth;
    }
    
    await analysis.save();
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save analysis' });
  }
});

app.patch('/game/:gameId/notes', authMiddleware, async (req, res) => {
  const { gameId } = req.params;
  const { notes } = req.body;
  try {
    const user = await User.findOne({ username: req.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const game = user.matchHistory.find(m => m.gameId === gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    
    game.notes = { ...game.notes, ...notes };
    user.markModified('matchHistory');
    await user.save();
    
    res.json({ success: true, notes: game.notes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update analysis remarks' });
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────
app.get('/', async (req, res) => {
  let dbActive = mongoose.connection.readyState === 1;
  let userCount = dbActive ? await User.countDocuments({}) : 0;
  let sessionCount = dbActive ? await Session.countDocuments({}) : 0;
  res.json({
    status: 'Phoenix Chess Server running ✅',
    players: userCount,
    activeSessions: sessionCount,
    activeGames: Object.keys(games).length,
    databaseConnected: dbActive
  });
});

// ─── MATCHMAKING ──────────────────────────────────────────────────────────
function createGame(socket1, socket2, mode, timerSeconds, increment) {
  const gameId = Math.random().toString(36).substring(2, 8).toUpperCase();
  const chess = new Chess();
  const isP1White = Math.random() > 0.5;

  games[gameId] = {
    id: gameId,
    mode,
    chess,
    timerSeconds,
    increment: increment || 0,
    timeKey: mode === 'phoenix'
      ? getPhoenixTimeKey(timerSeconds, increment)
      : getTimeKey(timerSeconds, increment),
    category: getCategory(timerSeconds, increment),
    players: {
      w: isP1White ? socket1.id : socket2.id,
      b: isP1White ? socket2.id : socket1.id,
    },
    usernames: {
      w: isP1White ? socket1.username : socket2.username,
      b: isP1White ? socket2.username : socket1.username,
    },
    timers: { w: timerSeconds, b: timerSeconds },
    timerInterval: null,
    started: false,
  };

  return {
    gameId,
    colors: {
      [socket1.id]: isP1White ? 'w' : 'b',
      [socket2.id]: isP1White ? 'b' : 'w',
    },
  };
}

function startTimer(gameId) {
  const game = games[gameId];
  if (!game) return;
  game.timerInterval = setInterval(() => {
    const turn = game.chess.turn();
    game.timers[turn]--;
    io.to(gameId).emit('timerUpdate', { w: game.timers.w, b: game.timers.b });
    if (game.timers[turn] <= 0) {
      clearInterval(game.timerInterval);
      const winner = turn === 'w' ? 'b' : 'w';
      endGame(gameId, winner === 'w' ? 'White wins' : 'Black wins', 'Time out', winner, turn);
    }
  }, 1000);
}

async function endGame(gameId, result, reason, winnerColor, loserColor) {
  const game = games[gameId];
  if (!game) return;
  clearInterval(game.timerInterval);
  io.to(gameId).emit('gameOver', { result, reason });

  const mode = game.mode;
  const { cat } = game.timeKey;

  try {
    // DRAW or STALEMATE
    if (reason === 'Draw' || (!winnerColor && !loserColor)) {
      const u1 = game.usernames.w ? await User.findOne({ username: game.usernames.w }) : null;
      const u2 = game.usernames.b ? await User.findOne({ username: game.usernames.b }) : null;
      
      if (u1 && u2) {
        const r1 = u1.ratings[mode][cat] || 400;
        const r2 = u2.ratings[mode][cat] || 400;
        u1.ratings[mode][cat] = calcElo(r1, r2, 0.5);
        u2.ratings[mode][cat] = calcElo(r2, r1, 0.5);
        u1.peakRatings[mode][cat] = Math.max(u1.peakRatings[mode][cat] || 400, u1.ratings[mode][cat]);
        u2.peakRatings[mode][cat] = Math.max(u2.peakRatings[mode][cat] || 400, u2.ratings[mode][cat]);
        u1.stats[mode].draws++;
        u2.stats[mode].draws++;
        
        const rc1 = u1.ratings[mode][cat] - r1;
        const rc2 = u2.ratings[mode][cat] - r2;
        const moveHistory = game.chess.history({ verbose: true });
        
        const matchRecord1 = {
          gameId, mode, cat, result: 'draw', opponent: u2.username, ratingChange: rc1, date: Date.now(), color: 'w',
          pgn: generatePGN(game, 'draw'),
          moves: moveHistory.map((m) => ({ ...m, eval: 0, depth: 0, bestEval: 0, classification: 'Decent' })),
          analysis: {
            total_moves: moveHistory.length, accuracy: 50,
            classifications: { Best: 0, Good: 0, Decent: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0, Brilliant: 0 },
            blunders: [], brilliant_moves: []
          },
          notes: {}
        };
        
        u1.matchHistory.push(matchRecord1);
        u2.matchHistory.push({ ...matchRecord1, opponent: u1.username, ratingChange: rc2, color: 'b' });
        
        u1.markModified('ratings'); u1.markModified('peakRatings'); u1.markModified('stats'); u1.markModified('matchHistory');
        u2.markModified('ratings'); u2.markModified('peakRatings'); u2.markModified('stats'); u2.markModified('matchHistory');
        
        await u1.save();
        await u2.save();
      }
    } 
    // WIN/LOSS
    else if (winnerColor && loserColor) {
      const winUN = game.usernames[winnerColor];
      const losUN = game.usernames[loserColor];
      const winner = winUN ? await User.findOne({ username: winUN }) : null;
      const loser  = losUN ? await User.findOne({ username: losUN }) : null;
      
      if (winner && loser) {
        const wr = winner.ratings[mode][cat] || 400;
        const lr = loser.ratings[mode][cat]  || 400;
        winner.ratings[mode][cat] = calcElo(wr, lr, 1);
        loser.ratings[mode][cat]  = calcElo(lr, wr, 0);
        winner.peakRatings[mode][cat] = Math.max(winner.peakRatings[mode][cat] || 400, winner.ratings[mode][cat]);
        winner.stats[mode].wins++;
        loser.stats[mode].losses++;
        winner.winStreak = (winner.winStreak || 0) + 1;
        loser.winStreak = 0;
        winner.bestWinStreak = Math.max(winner.bestWinStreak || 0, winner.winStreak);
        
        const rc = winner.ratings[mode][cat] - wr;
        const moveHistory = game.chess.history({ verbose: true });
        
        const matchRecordWinner = {
          gameId, mode, cat, result: 'win', opponent: loser.username, ratingChange: rc, date: Date.now(), color: winnerColor,
          pgn: generatePGN(game, 'win'),
          moves: moveHistory.map((m) => ({ ...m, eval: 0, depth: 0, bestEval: 0, classification: 'Decent' })),
          analysis: {
            total_moves: moveHistory.length, accuracy: 50,
            classifications: { Best: 0, Good: 0, Decent: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0, Brilliant: 0 },
            blunders: [], brilliant_moves: []
          },
          notes: {}
        };
        
        const matchRecordLoser = {
          gameId, mode, cat, result: 'loss', opponent: winner.username, ratingChange: -rc, date: Date.now(), color: loserColor,
          pgn: generatePGN(game, 'loss'),
          moves: moveHistory.map((m) => ({ ...m, eval: 0, depth: 0, bestEval: 0, classification: 'Decent' })),
          analysis: {
            total_moves: moveHistory.length, accuracy: 50,
            classifications: { Best: 0, Good: 0, Decent: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0, Brilliant: 0 },
            blunders: [], brilliant_moves: []
          },
          notes: {}
        };
        
        winner.matchHistory.push(matchRecordWinner);
        loser.matchHistory.push(matchRecordLoser);
        
        winner.markModified('ratings'); winner.markModified('peakRatings'); winner.markModified('stats'); winner.markModified('matchHistory');
        loser.markModified('ratings'); loser.markModified('stats'); loser.markModified('matchHistory');
        
        await winner.save();
        await loser.save();
      }
    }
  } catch (err) {
    console.error('CRITICAL Error saving end game results:', err.message);
  }

  delete games[gameId];
}

// ─── SOCKET.IO ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('authenticate', async ({ token }) => {
    try {
      const session = await Session.findOne({ token });
      if (session) {
        const user = await User.findOne({ username: session.username });
        if (user) {
          socket.username = session.username;
          socket.emit('authenticated', { username: session.username, user: sanitizeUser(user.toObject()) });
        }
      }
    } catch (err) {
      console.error('Auth error:', err);
    }
  });

  socket.on('findGame', async ({ mode, timerSeconds, increment, token }) => {
    try {
      if (token) {
        const session = await Session.findOne({ token });
        if (session) socket.username = session.username;
      }
      
      const modeKey = mode === 'phoenix' ? 'phoenix' : 'normal';
      const queue = waitingPlayers[modeKey];

      if (queue.length > 0) {
        const opponent = queue.shift();
        const { gameId, colors } = createGame(socket, opponent, modeKey, timerSeconds || 600, increment || 0);
        const game = games[gameId];
        socket.join(gameId);
        opponent.join(gameId);

        const getInfo = async (un) => {
          if (!un) return null;
          const u = await User.findOne({ username: un });
          if (!u) return null;
          const { cat } = game.timeKey;
          return {
            username: u.username,
            displayName: u.displayName,
            flair: u.flair,
            rating: u.ratings[modeKey][cat] || 400,
            tier: getTier(u.ratings[modeKey][cat] || 400),
          };
        };

        socket.emit('gameFound', {
          gameId, color: colors[socket.id], timers: game.timers,
          opponent: await getInfo(opponent.username), category: game.category,
        });
        opponent.emit('gameFound', {
          gameId, color: colors[opponent.id], timers: game.timers,
          opponent: await getInfo(socket.username), category: game.category,
        });

        game.started = true;
        startTimer(gameId);
      } else {
        waitingPlayers[modeKey].push(socket);
        socket.emit('waiting');
      }
    } catch (err) {
      console.error('Find game error:', err);
    }
  });

  socket.on('makeMove', ({ gameId, from, to, promotion }) => {
    const game = games[gameId];
    if (!game) return;
    const playerColor = game.players.w === socket.id ? 'w' : 'b';
    if (game.chess.turn() !== playerColor) return;
    try {
      const result = game.chess.move({ from, to, promotion: promotion || 'q' });
      if (!result) return;
      if (game.increment > 0) game.timers[playerColor] += game.increment;
      const isCheckmate = game.chess.isCheckmate();
      const isDraw = game.chess.isDraw();
      io.to(gameId).emit('moveMade', {
        from: result.from, to: result.to, promotion: result.promotion,
        fen: game.chess.fen(), turn: game.chess.turn(),
        isCheck: game.chess.inCheck(), isCheckmate, isDraw,
        captured: result.captured,
        history: game.chess.history({ verbose: true }),
        timers: game.timers,
      });
      if (isCheckmate) {
        endGame(gameId, playerColor === 'w' ? 'White wins' : 'Black wins', 'Checkmate', playerColor, playerColor === 'w' ? 'b' : 'w');
      } else if (isDraw) {
        endGame(gameId, 'Draw', 'Draw', null, null);
      }
    } catch (e) { 
      console.error('Move error:', e); 
    }
  });

  socket.on('resign', ({ gameId }) => {
    const game = games[gameId];
    if (!game) return;
    const loser = game.players.w === socket.id ? 'w' : 'b';
    const winner = loser === 'w' ? 'b' : 'w';
    endGame(gameId, winner === 'w' ? 'White wins' : 'Black wins', 'Resignation', winner, loser);
  });

  socket.on('offerDraw', ({ gameId }) => {
    socket.to(gameId).emit('drawOffered');
  });

  socket.on('respondDraw', ({ gameId, accept }) => {
    if (accept) {
      endGame(gameId, 'Draw', 'Draw agreement', null, null);
    } else {
      socket.to(gameId).emit('drawDeclined');
    }
  });

  socket.on('cancelSearch', () => {
    for (const m of ['normal', 'phoenix']) {
      waitingPlayers[m] = waitingPlayers[m].filter(s => s.id !== socket.id);
    }
  });

  socket.on('disconnect', () => {
    for (const m of ['normal', 'phoenix']) {
      waitingPlayers[m] = waitingPlayers[m].filter(s => s.id !== socket.id);
    }
    for (const gameId of Object.keys(games)) {
      const game = games[gameId];
      if (game.players.w === socket.id || game.players.b === socket.id) {
        const loser = game.players.w === socket.id ? 'w' : 'b';
        const winner = loser === 'w' ? 'b' : 'w';
        endGame(gameId, winner === 'w' ? 'White wins' : 'Black wins', 'Opponent disconnected', winner, loser);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Phoenix Chess Server running on port ${PORT}`);
  console.log(`🌍 Data synced to Cloud Database Cluster`);
  console.log(`📊 Sessions stored in MongoDB for persistence`);
});
